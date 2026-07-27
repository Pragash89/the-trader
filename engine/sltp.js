// Stop-loss / take-profit enforcement — runs inline on demand (per-request) instead
// of a background setInterval, since Vercel functions don't stay alive between
// requests. Called from price-polling/dashboard routes (scoped to the current user)
// and from the /api/cron/sltp endpoint (Vercel Cron sweep across all open trades) as
// a safety net for accounts that aren't actively polling.
const db = require('../database/db');
const engine = require('./trading');
const { v4: uuidv4 } = require('uuid');

async function checkAndCloseTrades(userFilter = {}) {
  const openTrades = await db.trades.find({ status: 'open', ...userFilter });
  const closed = [];

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
    if (!shouldClose) continue;

    const profit = engine.calculateProfit(trade.symbol, trade.type, trade.volume, trade.open_price, currentPrice);
    const meta = engine.prices[trade.symbol];
    const user = await db.users.findOne({ _id: trade.user_id });
    const marginReturn = (trade.open_price * (meta?.contract || 100000) * trade.volume) / (user?.leverage || 100);

    await db.trades.update({ _id: trade._id }, { $set: { status: 'closed', close_price: currentPrice, profit, close_time: new Date().toISOString() } });

    if (user) {
      const newBal = parseFloat(((user.balance || 0) + profit + marginReturn).toFixed(2));
      const newMargin = parseFloat(Math.max(0, (user.margin || 0) - marginReturn).toFixed(2));
      await db.users.update({ _id: user._id }, { $set: { balance: newBal, margin: newMargin, free_margin: parseFloat((newBal - newMargin).toFixed(2)) } });
    }

    await db.notifications.insert({
      _id: uuidv4().replace(/-/g, ''),
      user_id: trade.user_id,
      title: 'Trade Closed (SL/TP)',
      message: `${trade.symbol} ${trade.type.toUpperCase()} ${trade.volume} lot(s) closed at ${currentPrice}. P&L: $${profit.toFixed(2)}`,
      type: profit >= 0 ? 'success' : 'warning',
      read: false,
      created_at: new Date().toISOString(),
    });

    closed.push({ trade_id: trade._id, profit, close_price: currentPrice });
  }

  return closed;
}

module.exports = { checkAndCloseTrades };
