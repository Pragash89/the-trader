const express  = require('express');
const router   = express.Router();
const { authenticateClient } = require('../middleware/auth');
const db       = require('../database/db');
const mt5      = require('../mt5/manager');

// GET /api/mt5/account — live balance, equity, positions from MT5
router.get('/account', authenticateClient, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const fallback = {
      live: false,
      linked: !!user.mt5_login,
      mt5_login: user.mt5_login || null,
      balance: user.balance || 0,
      equity: user.equity || 0,
      margin: user.margin || 0,
      freeMargin: user.free_margin || 0,
      leverage: user.leverage || 100,
      positions: [],
      orders: [],
    };

    if (!mt5.isReady()) return res.json(fallback);

    const data = await mt5.getAccountSummary();
    if (!data) return res.json(fallback);

    const { info, positions, orders } = data;

    // Sync real values back to our DB so dashboard loads fast next time
    await db.users.update({ _id: user._id }, {
      $set: {
        balance:     info.balance,
        equity:      info.equity,
        margin:      info.margin,
        free_margin: info.freeMargin,
        leverage:    info.leverage,
        last_mt5_sync: new Date().toISOString(),
      }
    });

    res.json({
      live: true,
      balance:    info.balance,
      equity:     info.equity,
      margin:     info.margin,
      freeMargin: info.freeMargin,
      leverage:   info.leverage,
      currency:   info.currency,
      name:       info.name,
      login:      info.login,
      server:     info.server,
      positions: (positions || []).map(p => ({
        id:           p.id,
        symbol:       p.symbol,
        type:         p.type === 'POSITION_TYPE_BUY' ? 'buy' : 'sell',
        volume:       p.volume,
        openPrice:    p.openPrice,
        currentPrice: p.currentPrice,
        profit:       p.profit,
        swap:         p.swap || 0,
        commission:   p.commission || 0,
        stopLoss:     p.stopLoss || 0,
        takeProfit:   p.takeProfit || 0,
        openTime:     p.time,
        comment:      p.comment || '',
      })),
      orders: (orders || []).map(o => ({
        id:         o.id,
        symbol:     o.symbol,
        type:       o.type,
        volume:     o.volume,
        openPrice:  o.openPrice,
        stopLoss:   o.stopLoss || 0,
        takeProfit: o.takeProfit || 0,
      })),
    });
  } catch (err) {
    console.error('[MT5 route /account]', err.message);
    res.status(500).json({ error: 'Failed to fetch MT5 data' });
  }
});

// GET /api/mt5/history?from=&to= — closed trade history
router.get('/history', authenticateClient, async (req, res) => {
  try {
    if (!mt5.isReady()) return res.json({ live: false, deals: [] });
    const deals = await mt5.getDealHistory(req.query.from, req.query.to);
    res.json({
      live: true,
      deals: deals.map(d => ({
        id:         d.id,
        symbol:     d.symbol,
        type:       d.type,
        volume:     d.volume,
        price:      d.price,
        profit:     d.profit,
        swap:       d.swap || 0,
        commission: d.commission || 0,
        time:       d.time,
        comment:    d.comment || '',
      })),
    });
  } catch (err) {
    console.error('[MT5 route /history]', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /api/mt5/status — quick check if MT5 is connected
router.get('/status', authenticateClient, (req, res) => {
  res.json({ connected: mt5.isReady() });
});

// POST /api/mt5/connect — link an existing MT5 account login to user profile
router.post('/connect', authenticateClient, async (req, res) => {
  try {
    const { mt5_login, mt5_password } = req.body;
    if (!mt5_login || !mt5_password) return res.status(400).json({ error: 'MT5 login and password are required' });

    // Store the MT5 credentials on user record so we can link it
    await db.users.update({ _id: req.user.id }, {
      $set: {
        mt5_login:    String(mt5_login),
        mt5_password: mt5_password,
        mt5_linked_at: new Date().toISOString(),
      }
    });

    // Notify admin
    const { v4: uuidv4 } = require('uuid');
    const user = await db.users.findOne({ _id: req.user.id });
    await db.notifications.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: null,
      title: 'MT5 Account Link Request',
      message: `${user.first_name} ${user.last_name} (${user.email}) submitted MT5 login ${mt5_login} for linking. Please verify and approve.`,
      type: 'info',
      read: false,
      created_at: new Date().toISOString(),
    });

    res.json({ success: true, message: 'MT5 account submitted for linking. Admin will verify and activate within 24 hours.' });
  } catch (err) {
    console.error('[MT5 /connect]', err.message);
    res.status(500).json({ error: 'Failed to submit MT5 connection' });
  }
});

// POST /api/mt5/request — open a brand-new MT5 account request
router.post('/request', authenticateClient, async (req, res) => {
  try {
    const { account_type, initial_deposit, notes } = req.body;
    if (!initial_deposit || parseFloat(initial_deposit) < 100) {
      return res.status(400).json({ error: 'Minimum initial deposit is $100' });
    }

    const { v4: uuidv4 } = require('uuid');
    const user = await db.users.findOne({ _id: req.user.id });
    const reqId = uuidv4().replace(/-/g,'');

    // Store request in transactions collection as a pending record
    await db.transactions.insert({
      _id: reqId,
      user_id: req.user.id,
      type: 'mt5_account_request',
      account_type: account_type || 'standard',
      amount: parseFloat(initial_deposit),
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    // Admin notification
    await db.notifications.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: null,
      title: 'New MT5 Account Request',
      message: `${user.first_name} ${user.last_name} (${user.email}) requested a ${account_type || 'standard'} MT5 account with $${initial_deposit} initial deposit. Notes: ${notes || 'None'}`,
      type: 'info',
      read: false,
      created_at: new Date().toISOString(),
    });

    // Client confirmation notification
    await db.notifications.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: req.user.id,
      title: 'MT5 Account Request Submitted',
      message: `Your request for a ${account_type || 'standard'} MT5 account with $${initial_deposit} initial deposit has been received. Our team will contact you within 24 hours.`,
      type: 'success',
      read: false,
      created_at: new Date().toISOString(),
    });

    res.json({ success: true, request_id: reqId });
  } catch (err) {
    console.error('[MT5 /request]', err.message);
    res.status(500).json({ error: 'Failed to submit account request' });
  }
});

module.exports = router;
