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

    if (!mt5.isReady()) {
      return res.json({
        live: false,
        balance: user.balance || 0,
        equity: user.equity || 0,
        margin: user.margin || 0,
        freeMargin: user.free_margin || 0,
        leverage: user.leverage || 100,
        positions: [],
        orders: [],
      });
    }

    const data = await mt5.getAccountSummary();
    if (!data) {
      return res.json({
        live: false,
        balance: user.balance || 0,
        equity: user.equity || 0,
        margin: user.margin || 0,
        freeMargin: user.free_margin || 0,
        leverage: user.leverage || 100,
        positions: [],
        orders: [],
      });
    }

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

module.exports = router;
