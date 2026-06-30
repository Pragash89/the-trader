require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const engine = require('./engine/trading');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

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

// WebSocket: real-time price streaming
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  // Send all current prices immediately
  ws.send(JSON.stringify({ type: 'prices', data: engine.getAllPrices() }));

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

engine.on('prices', (updates) => {
  const msg = JSON.stringify({ type: 'prices', data: updates });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
});

// Check stop-loss and take-profit every 2 seconds
const db = require('./database/db');
setInterval(async () => {
  try {
    const openTrades = await db.trades.find({ status: 'open' });

    for (const trade of openTrades) {
      const price = engine.getPrice(trade.symbol);
      if (!price) continue;

      const currentPrice = trade.type === 'buy' ? price.bid : price.ask;
      let shouldClose = false;

      if (trade.stop_loss > 0) {
        if (trade.type === 'buy' && currentPrice <= trade.stop_loss) shouldClose = true;
        if (trade.type === 'sell' && currentPrice >= trade.stop_loss) shouldClose = true;
      }
      if (trade.take_profit > 0) {
        if (trade.type === 'buy' && currentPrice >= trade.take_profit) shouldClose = true;
        if (trade.type === 'sell' && currentPrice <= trade.take_profit) shouldClose = true;
      }

      if (shouldClose) {
        const profit = engine.calculateProfit(trade.symbol, trade.type, trade.volume, trade.open_price, currentPrice);
        const priceData = engine.prices[trade.symbol];
        const user = await db.users.findOne({ _id: trade.user_id });
        const marginReturn = (trade.open_price * (priceData?.contract || 100000) * trade.volume) / (user?.leverage || 100);

        await db.trades.update({ _id: trade._id }, { $set: { status: 'closed', close_price: currentPrice, profit, close_time: new Date().toISOString() } });

        if (user) {
          const newBal = parseFloat(((user.balance || 0) + profit + marginReturn).toFixed(2));
          const newMargin = parseFloat(Math.max(0, (user.margin || 0) - marginReturn).toFixed(2));
          await db.users.update({ _id: user._id }, { $set: { balance: newBal, margin: newMargin, free_margin: parseFloat((newBal - newMargin).toFixed(2)) } });
        }

        await db.notifications.insert({ _id: require('uuid').v4().replace(/-/g,''), user_id: trade.user_id, title: `Trade Closed (SL/TP)`, message: `${trade.symbol} ${trade.type.toUpperCase()} ${trade.volume} lot(s) closed at ${currentPrice}. P&L: $${profit.toFixed(2)}`, type: profit >= 0 ? 'success' : 'warning', read: false, created_at: new Date().toISOString() });

        const closeMsg = JSON.stringify({ type: 'trade_closed', data: { trade_id: trade._id, profit, close_price: currentPrice } });
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) ws.send(closeMsg);
        }
      }
    }
  } catch (err) { /* silent */ }
}, 2000);

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       THE TRADER — FOREX BROKERAGE       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Server running at http://localhost:${PORT}   ║`);
  console.log('║  WebSocket: ws://localhost:3000/ws        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Admin:  admin@thetrader.com              ║');
  console.log('║  Pass:   Admin@2024!                      ║');
  console.log('║  Demo:   demo@thetrader.com               ║');
  console.log('║  Pass:   Demo@1234!                       ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
