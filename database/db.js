const Datastore = require('nedb-promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const dataPath = path.join(__dirname, '../data');
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

const db = {
  users: Datastore.create({ filename: path.join(dataPath, 'users.db'), autoload: true }),
  accounts: Datastore.create({ filename: path.join(dataPath, 'accounts.db'), autoload: true }),
  trades: Datastore.create({ filename: path.join(dataPath, 'trades.db'), autoload: true }),
  transactions: Datastore.create({ filename: path.join(dataPath, 'transactions.db'), autoload: true }),
  kyc: Datastore.create({ filename: path.join(dataPath, 'kyc.db'), autoload: true }),
  notifications: Datastore.create({ filename: path.join(dataPath, 'notifications.db'), autoload: true }),
  admins: Datastore.create({ filename: path.join(dataPath, 'admins.db'), autoload: true }),
};

// Ensure unique indexes
db.users.ensureIndex({ fieldName: 'email', unique: true });
db.users.ensureIndex({ fieldName: 'account_number', unique: true });
db.accounts.ensureIndex({ fieldName: 'account_number', unique: true });
db.admins.ensureIndex({ fieldName: 'email', unique: true });

async function seedData() {
  // Seed admin
  const adminExists = await db.admins.findOne({ email: 'admin@thetrader.com' });
  if (!adminExists) {
    const hash = await bcrypt.hash('Admin@2024!', 12);
    await db.admins.insert({
      _id: uuidv4().replace(/-/g, ''),
      email: 'admin@thetrader.com',
      password: hash,
      name: 'Super Admin',
      role: 'superadmin',
      created_at: new Date().toISOString(),
    });
    console.log('Default admin: admin@thetrader.com / Admin@2024!');
  }

  // Seed demo client
  const demoExists = await db.users.findOne({ email: 'demo@thetrader.com' });
  if (!demoExists) {
    const hash = await bcrypt.hash('Demo@1234!', 12);
    const userId = uuidv4().replace(/-/g, '');
    const accountNumber = 'TT' + Date.now().toString().slice(-7) + '0';
    const mt5Number = 'MT5' + Date.now().toString().slice(-8);
    const now = new Date().toISOString();

    await db.users.insert({
      _id: userId,
      account_number: accountNumber,
      email: 'demo@thetrader.com',
      password: hash,
      first_name: 'Demo',
      last_name: 'Trader',
      phone: '+1234567890',
      country: 'United States',
      kyc_status: 'approved',
      account_status: 'active',
      leverage: 100,
      balance: 10000,
      equity: 10000,
      margin: 0,
      free_margin: 10000,
      role: 'client',
      created_at: now,
    });

    await db.accounts.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: userId,
      account_number: mt5Number,
      account_type: 'standard',
      currency: 'USD',
      balance: 10000,
      equity: 10000,
      margin: 0,
      leverage: 100,
      server: 'TheTrader-Live01',
      platform: 'MT5',
      status: 'active',
      created_at: now,
    });

    await db.transactions.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: userId,
      type: 'deposit',
      amount: 10000,
      currency: 'USD',
      status: 'approved',
      method: 'Bank Transfer',
      reference: 'DEMO-INIT-001',
      created_at: now,
      processed_at: now,
    });

    await db.notifications.insert({
      _id: uuidv4().replace(/-/g,''),
      user_id: userId,
      title: 'Welcome to The Trader!',
      message: `Your demo account ${accountNumber} is ready. Explore the platform!`,
      type: 'success',
      read: false,
      created_at: now,
    });

    console.log('Demo client: demo@thetrader.com / Demo@1234!');
  }
}

seedData().catch(console.error);

module.exports = db;
