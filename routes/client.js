const express = require('express');
const router = express.Router();
const db = require('../database/db');
const engine = require('../engine/trading');
const { checkAndCloseTrades } = require('../engine/sltp');
const { authenticateClient } = require('../middleware/auth');
const multer = require('multer');
const { put } = require('@vercel/blob');
const { v4: uuidv4 } = require('uuid');

// Vercel's filesystem is read-only/ephemeral outside /tmp, so KYC documents are
// buffered in memory and streamed straight to Vercel Blob storage instead of disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 } });

function now() { return new Date().toISOString(); }

// Get profile
router.get('/profile', authenticateClient, async (req, res) => {
  const user = await db.users.findOne({ _id: req.user.id });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password, ...safeUser } = user;
  const accounts = await db.accounts.find({ user_id: req.user.id });
  res.json({ user: safeUser, accounts });
});

// Update profile
router.put('/profile', authenticateClient, async (req, res) => {
  const { first_name, last_name, phone, address, city } = req.body;
  await db.users.update({ _id: req.user.id }, { $set: { first_name, last_name, phone, address, city } });
  res.json({ message: 'Profile updated' });
});

// Dashboard
router.get('/dashboard', authenticateClient, async (req, res) => {
  try {
    await checkAndCloseTrades({ user_id: req.user.id });
    const user = await db.users.findOne({ _id: req.user.id });
    const accounts = await db.accounts.find({ user_id: req.user.id });
    const openTrades = await db.trades.find({ user_id: req.user.id, status: 'open' });
    const recentTrades = await db.trades.find({ user_id: req.user.id, status: 'closed' });
    const allTxns = await db.transactions.find({ user_id: req.user.id });
    const notifs = await db.notifications.find({ $or: [{ user_id: req.user.id }, { user_id: null }], read: false });

    // Sort
    recentTrades.sort((a, b) => new Date(b.close_time) - new Date(a.close_time));
    allTxns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Update P&L on open trades
    let totalProfit = 0;
    const tradesWithPnl = openTrades.map(trade => {
      const price = engine.getPrice(trade.symbol);
      if (price) {
        const cur = trade.type === 'buy' ? price.bid : price.ask;
        const profit = engine.calculateProfit(trade.symbol, trade.type, trade.volume, trade.open_price, cur);
        totalProfit += profit;
        return { ...trade, current_price: cur, profit };
      }
      return trade;
    });

    const { password, ...safeUser } = user;
    res.json({
      user: { ...safeUser, equity: parseFloat(((user.balance || 0) + totalProfit).toFixed(2)) },
      accounts,
      open_trades: tradesWithPnl,
      recent_trades: recentTrades.slice(0, 10),
      transactions: allTxns.slice(0, 10),
      notifications: notifs.slice(0, 20),
      total_open_profit: parseFloat(totalProfit.toFixed(2)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Open trades
router.get('/trades/open', authenticateClient, async (req, res) => {
  await checkAndCloseTrades({ user_id: req.user.id });
  const trades = await db.trades.find({ user_id: req.user.id, status: 'open' });
  const result = trades.map(trade => {
    const price = engine.getPrice(trade.symbol);
    if (price) {
      const cur = trade.type === 'buy' ? price.bid : price.ask;
      return { ...trade, current_price: cur, profit: engine.calculateProfit(trade.symbol, trade.type, trade.volume, trade.open_price, cur) };
    }
    return trade;
  });
  res.json(result);
});

// Trade history
router.get('/trades/history', authenticateClient, async (req, res) => {
  const trades = await db.trades.find({ user_id: req.user.id, status: 'closed' });
  trades.sort((a, b) => new Date(b.close_time) - new Date(a.close_time));
  res.json(trades.slice(0, parseInt(req.query.limit) || 50));
});

// Open trade
router.post('/trades/open', authenticateClient, async (req, res) => {
  try {
    const { symbol, type, volume, stop_loss, take_profit, comment } = req.body;
    if (!symbol || !type || !volume) return res.status(400).json({ error: 'Missing required fields' });
    if (!['buy', 'sell'].includes(type)) return res.status(400).json({ error: 'Invalid trade type' });
    if (volume <= 0 || volume > 100) return res.status(400).json({ error: 'Volume must be 0.01–100' });

    const price = engine.getPrice(symbol);
    if (!price) return res.status(400).json({ error: 'Symbol not found' });

    const user = await db.users.findOne({ _id: req.user.id });
    if (!user || user.kyc_status !== 'approved') return res.status(403).json({ error: 'KYC verification required to trade' });

    const account = await db.accounts.findOne({ user_id: req.user.id });
    if (!account) return res.status(404).json({ error: 'Trading account not found' });

    const openPrice = type === 'buy' ? price.ask : price.bid;
    const priceData = engine.prices[symbol];
    const marginRequired = (openPrice * (priceData.contract || 100000) * volume) / (user.leverage || 100);
    const commission = parseFloat((volume * 3.5).toFixed(2));

    if ((user.free_margin || 0) < marginRequired + commission) {
      return res.status(400).json({ error: `Insufficient margin. Required: $${(marginRequired + commission).toFixed(2)}, Available: $${(user.free_margin || 0).toFixed(2)}` });
    }

    const tradeId = uuidv4().replace(/-/g, '');
    const ticket = engine.ticketFromId(tradeId);

    await db.trades.insert({
      _id: tradeId,
      user_id: req.user.id,
      account_id: account._id,
      ticket,
      symbol,
      type,
      volume: parseFloat(volume),
      open_price: openPrice,
      current_price: openPrice,
      stop_loss: stop_loss || 0,
      take_profit: take_profit || 0,
      swap: 0,
      commission,
      profit: 0,
      status: 'open',
      comment: comment || '',
      open_time: now(),
    });

    await db.users.update({ _id: req.user.id }, {
      $set: {
        balance: parseFloat(((user.balance || 0) - commission).toFixed(2)),
        margin: parseFloat(((user.margin || 0) + marginRequired).toFixed(2)),
        free_margin: parseFloat(((user.free_margin || 0) - marginRequired - commission).toFixed(2)),
      }
    });

    res.json({ message: 'Trade opened', ticket, symbol, type, volume: parseFloat(volume), open_price: openPrice, commission, margin_used: parseFloat(marginRequired.toFixed(2)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to open trade' });
  }
});

// Close trade
router.post('/trades/:tradeId/close', authenticateClient, async (req, res) => {
  try {
    const trade = await db.trades.findOne({ _id: req.params.tradeId, user_id: req.user.id, status: 'open' });
    if (!trade) return res.status(404).json({ error: 'Trade not found or already closed' });

    const price = engine.getPrice(trade.symbol);
    if (!price) return res.status(400).json({ error: 'Cannot get current price' });

    const closePrice = trade.type === 'buy' ? price.bid : price.ask;
    const profit = engine.calculateProfit(trade.symbol, trade.type, trade.volume, trade.open_price, closePrice);
    const priceData = engine.prices[trade.symbol];
    const user = await db.users.findOne({ _id: req.user.id });
    const marginReturn = (trade.open_price * (priceData.contract || 100000) * trade.volume) / (user.leverage || 100);

    await db.trades.update({ _id: trade._id }, { $set: { status: 'closed', close_price: closePrice, profit, close_time: now() } });

    const newBalance = parseFloat(((user.balance || 0) + profit + marginReturn).toFixed(2));
    const newMargin = parseFloat(Math.max(0, (user.margin || 0) - marginReturn).toFixed(2));
    const newFreeMargin = parseFloat(((user.free_margin || 0) + profit + marginReturn).toFixed(2));

    await db.users.update({ _id: req.user.id }, { $set: { balance: newBalance, margin: newMargin, free_margin: newFreeMargin } });

    res.json({ message: 'Trade closed', close_price: closePrice, profit, balance: newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to close trade' });
  }
});

// Modify SL/TP
router.put('/trades/:tradeId', authenticateClient, async (req, res) => {
  const { stop_loss, take_profit } = req.body;
  await db.trades.update({ _id: req.params.tradeId, user_id: req.user.id }, { $set: { stop_loss: stop_loss || 0, take_profit: take_profit || 0 } });
  res.json({ message: 'Trade modified' });
});

// Prices — polled every ~1s by the dashboard/webtrader; also enforces this user's
// SL/TP on every poll so open positions get closed close to real-time even without
// a background process.
router.get('/prices', authenticateClient, async (req, res) => {
  await checkAndCloseTrades({ user_id: req.user.id });
  res.json(engine.getAllPrices());
});
router.get('/prices/:symbol', authenticateClient, (req, res) => {
  const p = engine.getPrice(req.params.symbol.toUpperCase());
  if (!p) return res.status(404).json({ error: 'Symbol not found' });
  res.json({ symbol: req.params.symbol.toUpperCase(), bid: p.bid, ask: p.ask });
});

// Deposit request
router.post('/transactions/deposit', authenticateClient, async (req, res) => {
  const { amount, method } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: 'Minimum deposit is $100' });
  const ref = 'DEP' + Date.now();
  await db.transactions.insert({ _id: uuidv4().replace(/-/g,''), user_id: req.user.id, type: 'deposit', amount: parseFloat(amount), currency: 'USD', status: 'pending', method: method || 'Bank Transfer', reference: ref, created_at: now() });
  res.json({ message: 'Deposit request submitted. Processing within 24 hours.', reference: ref });
});

// Withdrawal request
router.post('/transactions/withdraw', authenticateClient, async (req, res) => {
  const { amount, method, notes } = req.body;
  const user = await db.users.findOne({ _id: req.user.id });
  if (!amount || amount < 50) return res.status(400).json({ error: 'Minimum withdrawal is $50' });
  if (amount > (user.balance || 0)) return res.status(400).json({ error: 'Insufficient balance' });
  const ref = 'WIT' + Date.now();
  await db.transactions.insert({ _id: uuidv4().replace(/-/g,''), user_id: req.user.id, type: 'withdrawal', amount: parseFloat(amount), currency: 'USD', status: 'pending', method: method || 'Bank Transfer', reference: ref, notes: notes || '', created_at: now() });
  await db.users.update({ _id: req.user.id }, { $set: { balance: parseFloat(((user.balance || 0) - amount).toFixed(2)) } });
  res.json({ message: 'Withdrawal request submitted. Processing within 1-3 business days.', reference: ref });
});

// Transactions
router.get('/transactions', authenticateClient, async (req, res) => {
  const txns = await db.transactions.find({ user_id: req.user.id });
  txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(txns);
});

// Upload KYC — accepts multiple documents in a single request
router.post('/kyc/upload', authenticateClient, upload.array('documents', 10), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  const { type } = req.body;

  const uploaded = [];
  for (const file of req.files) {
    const blobName = `kyc/${req.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${fileExt(file.originalname)}`;
    const blob = await put(blobName, file.buffer, { access: 'public', contentType: file.mimetype });
    const doc = { _id: uuidv4().replace(/-/g,''), user_id: req.user.id, type, filename: file.originalname, url: blob.url, status: 'pending', uploaded_at: now() };
    await db.kyc.insert(doc);
    uploaded.push(doc);
  }

  const user = await db.users.findOne({ _id: req.user.id });
  if (user.kyc_status === 'pending') {
    await db.users.update({ _id: req.user.id }, { $set: { kyc_status: 'under_review' } });
  }
  res.json({ message: `${uploaded.length} document(s) uploaded for review`, documents: uploaded });
});

function fileExt(filename) {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i);
}

// Mark notifications read
router.put('/notifications/read', authenticateClient, async (req, res) => {
  await db.notifications.update({ user_id: req.user.id, read: false }, { $set: { read: true } }, { multi: true });
  res.json({ message: 'Marked as read' });
});

module.exports = router;
