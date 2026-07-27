// Postgres-backed data layer (Vercel Postgres). Each "collection" is a table with
// a TEXT primary key (_id) and a JSONB `data` column, so the find/findOne/insert/update
// calls used throughout routes/*.js work unchanged — only the storage backend moved
// from NeDB (local file) to Postgres (serverless-safe, no local disk required).
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('[DB] POSTGRES_URL not set — connect a Vercel Postgres store or set POSTGRES_URL in .env');
}

// max:1 — each serverless instance keeps a single connection; Vercel Postgres'
// connection string already points at a pooler, so this avoids exhausting Postgres
// connections under concurrent invocations.
const pool = new Pool({
  connectionString,
  max: 1,
  ssl: connectionString && !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

const TABLES = ['users', 'accounts', 'trades', 'transactions', 'kyc', 'notifications', 'admins'];

let migrated = null;
function migrate() {
  if (!migrated) {
    migrated = (async () => {
      for (const t of TABLES) {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (_id TEXT PRIMARY KEY, data JSONB NOT NULL)`);
      }
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users ((data->>'email'))`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_account_number_idx ON users ((data->>'account_number'))`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_account_number_idx ON accounts ((data->>'account_number'))`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS admins_email_idx ON admins ((data->>'email'))`);
      await pool.query(`CREATE INDEX IF NOT EXISTS trades_status_idx ON trades ((data->>'status'))`);
      await pool.query(`CREATE INDEX IF NOT EXISTS trades_user_idx ON trades ((data->>'user_id'))`);
      await pool.query(`CREATE INDEX IF NOT EXISTS txns_user_idx ON transactions ((data->>'user_id'))`);
    })();
  }
  return migrated;
}

// Field names are always literal keys from our own route code (never derived from
// request bodies), so interpolating them into the SQL text is safe — only values
// (pushed into `params`) come from user input, and those are always parameterized.
function fieldCond(key, value, params) {
  if (value === null || value === undefined) {
    return `(data->'${key}' IS NULL OR data->'${key}' = 'null'::jsonb)`;
  }
  params.push(String(value));
  return `data->>'${key}' = $${params.length}`;
}

function buildWhere(filter, params) {
  const clauses = [];
  for (const [key, value] of Object.entries(filter || {})) {
    if (key === '$or') {
      const orClauses = value.map(sub => '(' + buildWhere(sub, params) + ')');
      clauses.push('(' + orClauses.join(' OR ') + ')');
    } else {
      clauses.push(fieldCond(key, value, params));
    }
  }
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

async function find(table, filter) {
  await migrate();
  const params = [];
  const where = buildWhere(filter, params);
  const { rows } = await pool.query(`SELECT data FROM ${table} WHERE ${where}`, params);
  return rows.map(r => r.data);
}

async function findOne(table, filter) {
  await migrate();
  const params = [];
  const where = buildWhere(filter, params);
  const { rows } = await pool.query(`SELECT data FROM ${table} WHERE ${where} LIMIT 1`, params);
  return rows[0] || null;
}

async function insert(table, doc) {
  await migrate();
  await pool.query(`INSERT INTO ${table} (_id, data) VALUES ($1, $2::jsonb)`, [doc._id, JSON.stringify(doc)]);
  return doc;
}

async function update(table, filter, modifier, opts = {}) {
  await migrate();
  const patch = modifier.$set || {};
  const params = [];
  const where = buildWhere(filter, params);
  params.push(JSON.stringify(patch));
  const patchIdx = params.length;
  if (opts.multi) {
    const { rowCount } = await pool.query(`UPDATE ${table} SET data = data || $${patchIdx}::jsonb WHERE ${where}`, params);
    return rowCount;
  }
  const { rowCount } = await pool.query(
    `UPDATE ${table} SET data = data || $${patchIdx}::jsonb WHERE _id = (SELECT _id FROM ${table} WHERE ${where} LIMIT 1)`,
    params
  );
  return rowCount;
}

function collection(table) {
  return {
    find: (filter) => find(table, filter),
    findOne: (filter) => findOne(table, filter),
    insert: (doc) => insert(table, doc),
    update: (filter, modifier, opts) => update(table, filter, modifier, opts),
    ensureIndex: () => migrate(),
  };
}

const db = {
  users: collection('users'),
  accounts: collection('accounts'),
  trades: collection('trades'),
  transactions: collection('transactions'),
  kyc: collection('kyc'),
  notifications: collection('notifications'),
  admins: collection('admins'),
};

async function seedData() {
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

seedData().catch(err => console.error('[DB] seed error:', err.message));

module.exports = db;
