// Mock trading engine — serverless-safe: prices are a pure, deterministic function
// of wall-clock time (base trend + a couple of bounded sine waves + small per-second
// jitter, all seeded from the symbol name). No setInterval, no in-memory state to
// keep alive — any invocation, on any instance, at any time computes the same value,
// which is what makes this safe to run as short-lived Vercel functions.
// Replace with real MT5/broker price feeds when budget allows.

const SYMBOLS = {
  EURUSD: { base: 1.08215, digits: 5, point: 0.00001, contract: 100000, spread: 0.00015, bandPct: 0.0010 },
  GBPUSD: { base: 1.27350, digits: 5, point: 0.00001, contract: 100000, spread: 0.00020, bandPct: 0.0012 },
  USDJPY: { base: 149.827, digits: 3, point: 0.001,   contract: 100000, spread: 0.015,   bandPct: 0.0010 },
  AUDUSD: { base: 0.65188, digits: 5, point: 0.00001, contract: 100000, spread: 0.00015, bandPct: 0.0012 },
  USDCHF: { base: 0.90128, digits: 5, point: 0.00001, contract: 100000, spread: 0.00015, bandPct: 0.0009 },
  USDCAD: { base: 1.36220, digits: 5, point: 0.00001, contract: 100000, spread: 0.00020, bandPct: 0.0011 },
  NZDUSD: { base: 0.59880, digits: 5, point: 0.00001, contract: 100000, spread: 0.00020, bandPct: 0.0012 },
  EURJPY: { base: 162.160, digits: 3, point: 0.001,   contract: 100000, spread: 0.020,   bandPct: 0.0012 },
  GBPJPY: { base: 189.645, digits: 3, point: 0.001,   contract: 100000, spread: 0.030,   bandPct: 0.0014 },
  EURGBP: { base: 0.85030, digits: 5, point: 0.00001, contract: 100000, spread: 0.00020, bandPct: 0.0008 },
  XAUUSD: { base: 2034.75, digits: 2, point: 0.01,    contract: 100,    spread: 0.50,    bandPct: 0.0040 },
  XAGUSD: { base: 22.465,  digits: 3, point: 0.001,   contract: 5000,   spread: 0.030,   bandPct: 0.0050 },
  BTCUSD: { base: 43275.0, digits: 1, point: 0.1,     contract: 1,      spread: 50.0,    bandPct: 0.0060 },
  ETHUSD: { base: 2288.5,  digits: 2, point: 0.01,    contract: 1,      spread: 2.0,     bandPct: 0.0070 },
  USOUSD: { base: 78.465,  digits: 3, point: 0.001,   contract: 1000,   spread: 0.030,   bandPct: 0.0045 },
  US30:   { base: 38422.5, digits: 1, point: 0.1,     contract: 1,      spread: 5.0,     bandPct: 0.0030 },
  US500:  { base: 4985.0,  digits: 2, point: 0.01,    contract: 1,      spread: 1.0,     bandPct: 0.0030 },
  NAS100: { base: 17651.5, digits: 1, point: 0.1,     contract: 1,      spread: 3.0,     bandPct: 0.0035 },
  GER40:  { base: 17282.0, digits: 1, point: 0.1,     contract: 1,      spread: 4.0,     bandPct: 0.0032 },
};

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 — tiny deterministic PRNG; same seed always produces the same sequence.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x = (x + Math.imul(x ^ (x >>> 7), x | 61)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const PERIOD_SLOW = 6 * 3600 * 1000;  // ~6h drift
const PERIOD_MED   = 40 * 60 * 1000;  // ~40min swing
const PERIOD_FAST  = 70 * 1000;       // ~70s ripple

function computeBid(symbol, meta, tMs) {
  const rnd = mulberry32(hash32(symbol));
  const phase1 = rnd() * Math.PI * 2;
  const phase2 = rnd() * Math.PI * 2;
  const phase3 = rnd() * Math.PI * 2;

  const band = meta.base * meta.bandPct;
  const wave =
    band * 0.50 * Math.sin((2 * Math.PI * tMs) / PERIOD_SLOW + phase1) +
    band * 0.35 * Math.sin((2 * Math.PI * tMs) / PERIOD_MED + phase2) +
    band * 0.15 * Math.sin((2 * Math.PI * tMs) / PERIOD_FAST + phase3);

  const bucket = Math.floor(tMs / 1000);
  const jrnd = mulberry32(hash32(symbol + ':' + bucket))();
  const jitter = (jrnd * 2 - 1) * band * 0.04;

  return parseFloat((meta.base + wave + jitter).toFixed(meta.digits));
}

function getPrice(symbol, atMs) {
  const meta = SYMBOLS[symbol];
  if (!meta) return null;
  const t = atMs != null ? atMs : Date.now();
  const bid = computeBid(symbol, meta, t);
  const ask = parseFloat((bid + meta.spread).toFixed(meta.digits));
  return { bid, ask, digits: meta.digits, point: meta.point, contract: meta.contract, spread: meta.spread };
}

function getAllPrices(atMs) {
  const t = atMs != null ? atMs : Date.now();
  const result = {};
  for (const symbol of Object.keys(SYMBOLS)) {
    const p = getPrice(symbol, t);
    result[symbol] = { bid: p.bid, ask: p.ask, digits: p.digits, spread: parseFloat((p.ask - p.bid).toFixed(p.digits)) };
  }
  return result;
}

// Deterministic, collision-resistant-enough ticket number derived from a trade's
// own id — no shared counter needed, so it's safe across serverless instances.
function ticketFromId(id) {
  const h = hash32(String(id));
  return 100000 + (h % 900000);
}

function calculateProfit(symbol, type, volume, openPrice, currentPrice) {
  const meta = SYMBOLS[symbol];
  if (!meta) return 0;
  const priceDiff = type === 'buy' ? currentPrice - openPrice : openPrice - currentPrice;
  const profit = priceDiff * meta.contract * volume;
  return parseFloat(profit.toFixed(2));
}

function getMarketInfo(symbol, atMs) {
  const p = getPrice(symbol, atMs);
  if (!p) return null;
  return {
    symbol,
    bid: p.bid,
    ask: p.ask,
    digits: p.digits,
    spread: parseFloat((p.ask - p.bid).toFixed(p.digits)),
    contract_size: p.contract,
    margin_required: (p.ask * p.contract * 0.01).toFixed(2),
  };
}

module.exports = {
  prices: SYMBOLS, // static per-symbol metadata (digits/point/contract/spread) — read-only lookups elsewhere
  getPrice,
  getAllPrices,
  calculateProfit,
  getMarketInfo,
  ticketFromId,
};
