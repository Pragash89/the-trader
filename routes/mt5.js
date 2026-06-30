/**
 * MT5 Integration Routes
 * All routes require a valid client JWT.
 * The client must have an mt5_account_id stored in their user record
 * (linked when admin assigns their MetaAPI account ID).
 */

const express = require('express');
const router  = express.Router();
const { authClient } = require('../middleware/auth');
const db      = require('../database/db');
const mt5     = require('../mt5/manager');

// GET /api/mt5/account — live account info from MT5
router.get('/account', authClient, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const accountId = user.mt5_account_id;
    if (!accountId) {
      return res.status(200).json({
        live: false,
        message: 'MT5 account not linked yet. Contact support.',
        balance: user.balance || 0,
        equity: user.equity || 0,
        margin: user.margin || 0,
        freeMargin: user.free_margin || 0,
        leverage: user.leverage || 100,
        currency: 'USD',
      });
    }

    const data = await mt5.getAccountSummary(accountId);
    if (!data) {
      // Fallback to stored values if MT5 unreachable
      return res.json({
        live: false,
        balance: user.balance || 0,
        equity: user.equity || 0,
        margin: user.margin || 0,
        freeMargin: user.free_margin || 0,
        leverage: user.leverage || 100,
        currency: 'USD',
        positions: [],
        orders: [],
      });
    }

    const { info, positions, orders } = data;

    // Sync MT5 values back to our local DB so dashboard loads fast next time
    await db.users.update({ _id: user._id }, {
      $set: {
        balance: info.balance,
        equity: info.equity,
        margin: info.margin,
        free_margin: info.freeMargin,
        leverage: info.leverage,
        last_mt5_sync: new Date().toISOString(),
      }
    });

    res.json({
      live: true,
      balance: info.balance,
      equity: info.equity,
      margin: info.margin,
      freeMargin: info.freeMargin,
      leverage: info.leverage,
      currency: info.currency,
      name: info.name,
      login: info.login,
      server: info.server,
      positions: positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        type: p.type === 'POSITION_TYPE_BUY' ? 'buy' : 'sell',
        volume: p.volume,
        openPrice: p.openPrice,
        currentPrice: p.currentPrice,
        profit: p.profit,
        swap: p.swap,
        commission: p.commission,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        openTime: p.time,
        comment: p.comment,
      })),
      orders: orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        type: o.type,
        volume: o.volume,
        openPrice: o.openPrice,
        stopLoss: o.stopLoss,
        takeProfit: o.takeProfit,
      })),
    });
  } catch (err) {
    console.error('[MT5 route] /account:', err.message);
    res.status(500).json({ error: 'Failed to fetch MT5 account data' });
  }
});

// GET /api/mt5/history — closed trades history
router.get('/history', authClient, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user?.mt5_account_id) return res.json({ live: false, deals: [] });

    const account = await require('metaapi.cloud-sdk').default(process.env.METAAPI_TOKEN)
      .metatraderAccountApi.getAccount(user.mt5_account_id);

    await account.waitConnected();
    const conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 30 });

    const from = new Date(req.query.from || Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to   = new Date(req.query.to || Date.now());
    const deals = await conn.getDealsByTimeRange(from, to);
    await conn.close();

    res.json({
      live: true,
      deals: deals.map(d => ({
        id: d.id,
        orderId: d.orderId,
        symbol: d.symbol,
        type: d.type,
        volume: d.volume,
        price: d.price,
        profit: d.profit,
        swap: d.swap,
        commission: d.commission,
        time: d.time,
        comment: d.comment,
      })),
    });
  } catch (err) {
    console.error('[MT5 route] /history:', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
