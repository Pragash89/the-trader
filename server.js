require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const engine = require('./engine/trading');
const { checkAndCloseTrades } = require('./engine/sltp');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/client', require('./routes/client'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/mt5', require('./routes/mt5'));

// Initialize MT5 connection (non-blocking — app starts even if MT5 is offline)
const mt5Manager = require('./mt5/manager');
mt5Manager.init().then(ok => {
  if (ok) console.log('[MT5] Manager account ready');
}).catch(err => console.error('[MT5] Startup error:', err.message));

// Unauthenticated price feed — powers the public landing page ticker/market table.
// Prices are computed deterministically from wall-clock time (see engine/trading.js),
// so there's no server-side state to keep warm between requests.
app.get('/api/public/prices', (req, res) => {
  res.json(engine.getAllPrices());
});

// Vercel Cron target — sweeps ALL open trades for SL/TP hits. This is a safety net
// for accounts that aren't actively polling /api/client/prices (which also checks
// SL/TP for the current user on every call). Configured in vercel.json.
app.get('/api/cron/sltp', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const closed = await checkAndCloseTrades();
    res.json({ closed: closed.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check — visit /api/health to diagnose startup issues
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    jwt_secret_set: !!process.env.JWT_SECRET,
    postgres_url_set: !!(process.env.POSTGRES_URL || process.env.DATABASE_URL),
    blob_token_set: !!process.env.BLOB_READ_WRITE_TOKEN,
    metaapi_set: !!process.env.METAAPI_TOKEN,
    mt5_account_set: !!process.env.MT5_ACCOUNT_ID,
    node: process.version,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

// Serve HTML pages
const pages = ['login', 'register', 'dashboard', 'admin', 'webtrader'];
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 fallback
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vercel imports this file as a serverless function and calls the exported app
// directly — app.listen() only runs for local dev / non-Vercel hosting.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║       THE TRADER — FOREX BROKERAGE       ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Server running at http://localhost:${PORT}   ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Admin:  admin@thetrader.com              ║');
    console.log('║  Pass:   Admin@2024!                      ║');
    console.log('║  Demo:   demo@thetrader.com               ║');
    console.log('║  Pass:   Demo@1234!                       ║');
    console.log('╚══════════════════════════════════════════╝\n');
  });
}

module.exports = app;
