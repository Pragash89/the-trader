const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');

function genAccountNumber() { return 'TT' + Date.now().toString().slice(-7) + Math.floor(Math.random()*10); }
function genMT5Number() { return 'MT5' + Date.now().toString().slice(-8) + Math.floor(Math.random()*10); }

// Client register
router.post('/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone, country, date_of_birth } = req.body;
    if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'Required fields missing' });

    const existing = await db.users.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const userId = uuidv4().replace(/-/g, '');
    const accountNumber = genAccountNumber();
    const mt5Number = genMT5Number();
    const now = new Date().toISOString();

    await db.users.insert({
      _id: userId,
      account_number: accountNumber,
      email: email.toLowerCase(),
      password: hash,
      first_name, last_name,
      phone: phone || null,
      country: country || null,
      date_of_birth: date_of_birth || null,
      kyc_status: 'pending',
      account_status: 'active',
      leverage: 100,
      balance: 0,
      equity: 0,
      margin: 0,
      free_margin: 0,
      role: 'client',
      created_at: now,
    });

    await db.notifications.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: userId,
      title: 'Welcome to The Trader!',
      message: `Your account ${accountNumber} has been created. Please complete KYC to start trading.`,
      type: 'success',
      read: false,
      created_at: now,
    });

    res.status(201).json({ message: 'Account created successfully', account_number: accountNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Client login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.users.findOne({ email: email?.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.account_status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await db.users.update({ _id: user._id }, { $set: { last_login: new Date().toISOString() } });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: 'client', account_number: user.account_number },
      process.env.JWT_SECRET, { expiresIn: '24h' }
    );

    res.json({
      token,
      user: { id: user._id, email: user.email, first_name: user.first_name, last_name: user.last_name, account_number: user.account_number, kyc_status: user.kyc_status, balance: user.balance }
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);
    res.status(500).json({ error: 'Login failed', reason: err.message });
  }
});

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await db.admins.findOne({ email: email?.toLowerCase() });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role, name: admin.name },
      process.env.JWT_SECRET, { expiresIn: '8h' }
    );

    res.json({ token, admin: { id: admin._id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
