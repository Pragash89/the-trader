const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

function now() { return new Date().toISOString(); }

// Dashboard overview
router.get('/dashboard', authenticateAdmin, async (req, res) => {
  try {
    const allUsers = await db.users.find({ role: 'client' });
    const allTrades = await db.trades.find({ status: 'open' });
    const allTxns = await db.transactions.find({});
    const pendingKyc = await db.kyc.find({ status: 'pending' });

    const pendingDeposits = allTxns.filter(t => t.type === 'deposit' && t.status === 'pending');
    const pendingWithdrawals = allTxns.filter(t => t.type === 'withdrawal' && t.status === 'pending');
    const approvedDeposits = allTxns.filter(t => t.type === 'deposit' && t.status === 'approved');
    const approvedWithdrawals = allTxns.filter(t => t.type === 'withdrawal' && t.status === 'approved');

    const recentClients = [...allUsers].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,10).map(u => {
      const { password, ...safe } = u; return safe;
    });

    res.json({
      stats: {
        total_clients: allUsers.length,
        active_clients: allUsers.filter(u => u.account_status === 'active').length,
        pending_kyc: pendingKyc.length + allUsers.filter(u => u.kyc_status === 'under_review').length,
        pending_deposits: { count: pendingDeposits.length, total: pendingDeposits.reduce((s,t)=>s+t.amount,0) },
        pending_withdrawals: { count: pendingWithdrawals.length, total: pendingWithdrawals.reduce((s,t)=>s+t.amount,0) },
        total_deposited: approvedDeposits.reduce((s,t)=>s+t.amount,0),
        total_withdrawn: approvedWithdrawals.reduce((s,t)=>s+t.amount,0),
        open_trades: allTrades.length,
      },
      recent_clients: recentClients,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Get all clients
router.get('/clients', authenticateAdmin, async (req, res) => {
  try {
    const { search, kyc, status } = req.query;
    let users = await db.users.find({ role: 'client' });

    if (search) {
      const s = search.toLowerCase();
      users = users.filter(u =>
        u.email?.toLowerCase().includes(s) ||
        u.first_name?.toLowerCase().includes(s) ||
        u.last_name?.toLowerCase().includes(s) ||
        u.account_number?.toLowerCase().includes(s)
      );
    }
    if (kyc) users = users.filter(u => u.kyc_status === kyc);
    if (status) users = users.filter(u => u.account_status === status);

    users.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
    const safeUsers = users.map(u => { const { password, ...safe } = u; return safe; });
    res.json({ clients: safeUsers, total: safeUsers.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

// Get single client
router.get('/clients/:id', authenticateAdmin, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.params.id, role: 'client' });
    if (!user) return res.status(404).json({ error: 'Client not found' });
    const { password, ...safeUser } = user;

    const accounts = await db.accounts.find({ user_id: req.params.id });
    const trades = await db.trades.find({ user_id: req.params.id });
    trades.sort((a,b) => new Date(b.open_time)-new Date(a.open_time));
    const transactions = await db.transactions.find({ user_id: req.params.id });
    transactions.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
    const documents = await db.kyc.find({ user_id: req.params.id });

    res.json({ user: safeUser, accounts, trades: trades.slice(0,50), transactions, documents });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load client' });
  }
});

// Update client
router.put('/clients/:id', authenticateAdmin, async (req, res) => {
  try {
    const { account_status, kyc_status, balance, leverage } = req.body;
    const updates = {};
    if (account_status !== undefined) updates.account_status = account_status;
    if (kyc_status !== undefined) updates.kyc_status = kyc_status;
    if (balance !== undefined) updates.balance = parseFloat(balance);
    if (leverage !== undefined) updates.leverage = parseInt(leverage);

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

    await db.users.update({ _id: req.params.id }, { $set: updates });

    if (kyc_status === 'approved') {
      await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: req.params.id, title: 'KYC Approved ✅', message: 'Your identity has been verified. You can now trade!', type: 'success', read: false, created_at: now() });
    }
    if (account_status === 'suspended') {
      await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: req.params.id, title: 'Account Suspended', message: 'Your account has been suspended. Please contact support.', type: 'error', read: false, created_at: now() });
    }

    res.json({ message: 'Client updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Adjust balance
router.post('/clients/:id/adjust-balance', authenticateAdmin, async (req, res) => {
  try {
    const { amount, type, notes } = req.body;
    const user = await db.users.findOne({ _id: req.params.id, role: 'client' });
    if (!user) return res.status(404).json({ error: 'Client not found' });

    const adj = type === 'credit' ? Math.abs(parseFloat(amount)) : -Math.abs(parseFloat(amount));
    const newBalance = parseFloat(((user.balance || 0) + adj).toFixed(2));
    await db.users.update({ _id: req.params.id }, { $set: { balance: newBalance, free_margin: newBalance } });

    await db.transactions.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: req.params.id,
      type: type === 'credit' ? 'deposit' : 'withdrawal',
      amount: Math.abs(parseFloat(amount)),
      currency: 'USD',
      status: 'approved',
      method: 'Manual Adjustment',
      reference: 'ADJ' + Date.now(),
      notes: notes || '',
      created_at: now(),
      processed_at: now(),
    });

    res.json({ message: 'Balance adjusted', new_balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to adjust balance' });
  }
});

// Get all transactions
router.get('/transactions', authenticateAdmin, async (req, res) => {
  try {
    const { status, type, limit } = req.query;
    let txns = await db.transactions.find({});

    if (status) txns = txns.filter(t => t.status === status);
    if (type) txns = txns.filter(t => t.type === type);

    txns.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));

    // Enrich with user info
    const userMap = {};
    const allUsers = await db.users.find({ role: 'client' });
    allUsers.forEach(u => { userMap[u._id] = u; });

    const enriched = txns.slice(0, parseInt(limit) || 100).map(t => ({
      ...t,
      email: userMap[t.user_id]?.email || '—',
      first_name: userMap[t.user_id]?.first_name || '—',
      last_name: userMap[t.user_id]?.last_name || '—',
      account_number: userMap[t.user_id]?.account_number || '—',
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

// Approve/reject transaction
router.put('/transactions/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const txn = await db.transactions.findOne({ _id: req.params.id });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    await db.transactions.update({ _id: txn._id }, { $set: { status, admin_notes: admin_notes || '', processed_at: now() } });

    if (status === 'approved' && txn.type === 'deposit') {
      const user = await db.users.findOne({ _id: txn.user_id });
      if (user) {
        const newBal = parseFloat(((user.balance || 0) + txn.amount).toFixed(2));
        await db.users.update({ _id: txn.user_id }, { $set: { balance: newBal, free_margin: parseFloat((newBal - (user.margin||0)).toFixed(2)) } });
        await db.accounts.update({ user_id: txn.user_id }, { $set: { balance: newBal } });
      }
      await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: txn.user_id, title: 'Deposit Approved ✅', message: `Your deposit of $${txn.amount.toFixed(2)} has been credited to your account.`, type: 'success', read: false, created_at: now() });
    }

    if (status === 'rejected' && txn.type === 'withdrawal') {
      const user = await db.users.findOne({ _id: txn.user_id });
      if (user) await db.users.update({ _id: txn.user_id }, { $set: { balance: parseFloat(((user.balance || 0) + txn.amount).toFixed(2)) } });
      await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: txn.user_id, title: 'Withdrawal Rejected', message: `Your withdrawal of $${txn.amount.toFixed(2)} was rejected. Funds returned.`, type: 'error', read: false, created_at: now() });
    }

    if (status === 'approved' && txn.type === 'withdrawal') {
      await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: txn.user_id, title: 'Withdrawal Approved ✅', message: `Your withdrawal of $${txn.amount.toFixed(2)} has been processed.`, type: 'success', read: false, created_at: now() });
    }

    res.json({ message: `Transaction ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process transaction' });
  }
});

// Get KYC docs
router.get('/kyc', authenticateAdmin, async (req, res) => {
  try {
    const docs = await db.kyc.find({ status: 'pending' });
    docs.sort((a,b) => new Date(a.uploaded_at)-new Date(b.uploaded_at));
    const userMap = {};
    const users = await db.users.find({ role: 'client' });
    users.forEach(u => { userMap[u._id] = u; });
    const enriched = docs.map(d => ({ ...d, email: userMap[d.user_id]?.email, first_name: userMap[d.user_id]?.first_name, last_name: userMap[d.user_id]?.last_name, account_number: userMap[d.user_id]?.account_number }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load KYC' });
  }
});

// Review KYC
router.put('/kyc/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const doc = await db.kyc.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await db.kyc.update({ _id: req.params.id }, { $set: { status, notes: notes || '', reviewed_at: now() } });

    const pending = await db.kyc.find({ user_id: doc.user_id, status: 'pending' });
    if (pending.length === 0) {
      await db.users.update({ _id: doc.user_id }, { $set: { kyc_status: 'approved' } });
      await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: doc.user_id, title: 'KYC Fully Approved ✅', message: 'All documents verified. You can now trade!', type: 'success', read: false, created_at: now() });
    }
    res.json({ message: 'Document reviewed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to review KYC' });
  }
});

// All trades
router.get('/trades', authenticateAdmin, async (req, res) => {
  try {
    const trades = await db.trades.find({});
    trades.sort((a,b) => new Date(b.open_time)-new Date(a.open_time));
    const userMap = {};
    const users = await db.users.find({ role: 'client' });
    users.forEach(u => { userMap[u._id] = u; });
    const enriched = trades.slice(0, 100).map(t => ({ ...t, email: userMap[t.user_id]?.email, first_name: userMap[t.user_id]?.first_name, last_name: userMap[t.user_id]?.last_name, account_number: userMap[t.user_id]?.account_number }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load trades' });
  }
});

// Financial report
router.get('/reports/financial', authenticateAdmin, async (req, res) => {
  try {
    const allTxns = await db.transactions.find({ status: 'approved' });
    const users = await db.users.find({ role: 'client' });

    const depositsByDate = {};
    allTxns.filter(t=>t.type==='deposit').forEach(t => {
      const d = t.created_at?.split('T')[0]; if (!d) return;
      depositsByDate[d] = (depositsByDate[d] || 0) + t.amount;
    });

    const deposits = Object.entries(depositsByDate).sort((a,b) => b[0].localeCompare(a[0])).slice(0,30).map(([date,total]) => ({ date, total }));

    const topClients = [...users].sort((a,b) => (b.balance||0)-(a.balance||0)).slice(0,10).map(u => ({ email: u.email, first_name: u.first_name, last_name: u.last_name, account_number: u.account_number, balance: u.balance || 0 }));

    res.json({ deposits, top_clients: topClients });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// Notify clients
router.post('/notify', authenticateAdmin, async (req, res) => {
  const { user_id, title, message, type } = req.body;
  await db.notifications.insert({ _id: uuidv4().replace(/-/g,''), user_id: user_id || null, title, message, type: type || 'info', read: false, created_at: now() });
  res.json({ message: 'Notification sent' });
});

// Link a client's MetaAPI account ID to their website user record
// Admin does this once per client after creating their MT5 account in the Manager
router.post('/users/:id/mt5', authenticateAdmin, async (req, res) => {
  try {
    const { mt5_login, mt5_account_id } = req.body;
    if (!mt5_account_id) return res.status(400).json({ error: 'mt5_account_id required' });
    await db.users.update({ _id: req.params.id }, {
      $set: { mt5_login, mt5_account_id, mt5_linked_at: now() }
    });
    res.json({ message: 'MT5 account linked successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all MT5 accounts visible to the manager (via MetaAPI)
router.get('/mt5/accounts', authenticateAdmin, async (req, res) => {
  try {
    const mt5 = require('../mt5/manager');
    const accounts = await mt5.getAllClientAccounts();
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
