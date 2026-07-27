/* ===== WEBTRADER.JS — TradingView embedded chart ===== */
'use strict';

const token = localStorage.getItem('tt_token');
if (!token) { window.location.href = '/login'; }

// ── State ──────────────────────────────────────────────────────────────────
let currentSymbol = 'EURUSD';
let prices = {};
let account = { balance: 0, equity: 0, margin: 0 };
let openTrades = [];
let closedTrades = [];

// ── Symbol meta ───────────────────────────────────────────────────────────
const SYMBOLS = [
  { sym:'EURUSD',name:'EUR/USD',cat:'Forex' },  { sym:'GBPUSD',name:'GBP/USD',cat:'Forex' },
  { sym:'USDJPY',name:'USD/JPY',cat:'Forex' },  { sym:'AUDUSD',name:'AUD/USD',cat:'Forex' },
  { sym:'USDCHF',name:'USD/CHF',cat:'Forex' },  { sym:'NZDUSD',name:'NZD/USD',cat:'Forex' },
  { sym:'USDCAD',name:'USD/CAD',cat:'Forex' },  { sym:'EURJPY',name:'EUR/JPY',cat:'Forex' },
  { sym:'GBPJPY',name:'GBP/JPY',cat:'Forex' },  { sym:'EURGBP',name:'EUR/GBP',cat:'Forex' },
  { sym:'XAUUSD',name:'Gold',cat:'Metals' },    { sym:'XAGUSD',name:'Silver',cat:'Metals' },
  { sym:'US30',name:'Dow Jones',cat:'Indices' }, { sym:'US500',name:'S&P 500',cat:'Indices' },
  { sym:'NAS100',name:'NASDAQ',cat:'Indices' },  { sym:'GER40',name:'DAX 40',cat:'Indices' },
  { sym:'BTCUSD',name:'Bitcoin',cat:'Crypto' },  { sym:'ETHUSD',name:'Ethereum',cat:'Crypto' },
  { sym:'USOUSD',name:'Crude Oil',cat:'Energy' },
];

const DP = {
  EURUSD:5,GBPUSD:5,AUDUSD:5,USDCHF:5,NZDUSD:5,USDCAD:5,EURGBP:5,
  USDJPY:3,EURJPY:3,GBPJPY:3,
  XAUUSD:2,XAGUSD:3,BTCUSD:1,ETHUSD:2,USOUSD:3,
  US30:1,US500:2,NAS100:2,GER40:1
};

const fmt = (s, v) => v.toFixed(DP[s] ?? 5);
const fmtUSD = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildSymbolList();
  connectWS();
  loadDashboard();
  loadHistory();
  initPanelTabs();
  initBottomTabs();
  selectSymbol('EURUSD');
});

// ── Symbol list ────────────────────────────────────────────────────────────
function buildSymbolList() {
  const el = document.getElementById('symbolList');
  SYMBOLS.forEach(({ sym, name }) => {
    const div = document.createElement('div');
    div.className = 'wt-sym-item';
    div.id = 'sym_' + sym;
    div.innerHTML = `<div class="wt-si-name">${name}</div><div class="wt-si-price" id="sip_${sym}">—</div><div class="wt-si-chg" id="sic_${sym}"></div>`;
    div.onclick = () => selectSymbol(sym);
    el.appendChild(div);
  });
}

function filterSymbols() {
  const q = document.getElementById('symbolSearch').value.toLowerCase();
  document.querySelectorAll('.wt-sym-item').forEach(el => {
    const sym = el.id.replace('sym_','');
    const info = SYMBOLS.find(s => s.sym === sym);
    el.style.display = (info.sym.toLowerCase().includes(q) || info.name.toLowerCase().includes(q) || info.cat.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function selectSymbol(sym) {
  currentSymbol = sym;
  // update sidebar active
  document.querySelectorAll('.wt-sym-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym_' + sym);
  if (el) { el.classList.add('active'); el.scrollIntoView({ block:'nearest' }); }
  // update order panel select
  document.getElementById('opSymbol').value = sym;
  // update chart symbol name in topbar
  const info = SYMBOLS.find(s => s.sym === sym);
  document.getElementById('curSymName').textContent = info ? info.name : sym;
  // reload chart data for new symbol
  loadChartForSymbol(sym);
  updateOrderPrices();
  calcMargin();
}

// ── Live prices (polling — serverless-friendly, no persistent connection) ──────
// GET /api/client/prices also re-checks this user's SL/TP on the server on every
// call, so a position can disappear between polls — loadDashboard() (polled every
// 5s below) picks up the resulting balance/history change.
let knownOpenTradeIds = new Set();

function connectWS() {
  pollPrices();
  setInterval(pollPrices, 1000);
  setInterval(watchForClosedTrades, 5000);
}

async function pollPrices() {
  try {
    const data = await apiFetch('/api/client/prices');
    handlePrices(data);
  } catch (e) {}
}

async function watchForClosedTrades() {
  const prevIds = knownOpenTradeIds;
  await loadDashboard();
  knownOpenTradeIds = new Set(openTrades.map(t => t._id));
  if (prevIds.size && [...prevIds].some(id => !knownOpenTradeIds.has(id))) {
    showToast('A position closed (SL/TP hit) — check your history for details.', 'success');
    loadHistory();
  }
}

function handlePrices(data) {
  const prevPrices = { ...prices };
  prices = data;

  // update symbol sidebar
  SYMBOLS.forEach(({ sym }) => {
    if (!data[sym]) return;
    const { bid, ask } = data[sym];
    const mid = (bid + ask) / 2;
    const prev = prevPrices[sym] ? (prevPrices[sym].bid + prevPrices[sym].ask) / 2 : mid;
    const chgPct = prev ? ((mid - prev) / prev * 100) : 0;
    const priceEl = document.getElementById('sip_' + sym);
    const chgEl = document.getElementById('sic_' + sym);
    if (priceEl) {
      priceEl.textContent = fmt(sym, bid);
      priceEl.className = 'wt-si-price ' + (mid >= prev ? 'up' : 'dn');
    }
    if (chgEl) chgEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(3) + '%';
  });

  // update topbar for current symbol
  if (data[currentSymbol]) {
    const { bid, ask } = data[currentSymbol];
    const mid = (bid + ask) / 2;
    const prev = prevPrices[currentSymbol] ? (prevPrices[currentSymbol].bid + prevPrices[currentSymbol].ask) / 2 : mid;
    const chgPct = ((mid - prev) / prev * 100).toFixed(3);
    document.getElementById('curBid').textContent = fmt(currentSymbol, bid);
    document.getElementById('curAsk').textContent = fmt(currentSymbol, ask);
    const chgEl = document.getElementById('curChg');
    chgEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct + '%';
    chgEl.className = 'wt-sym-chg ' + (mid >= prev ? 'up' : 'dn');

    // update order panel prices
    updateOrderPrices();
  }

  // update open positions P&L
  updatePositionsPnl();
}

// ── Chart (TradingView embedded widget — free, brings its own full indicator &
// drawing toolset so traders can use everything they're already familiar with) ──
// Note: this widget renders TradingView's own real market data for visual/technical
// analysis. Order execution (bid/ask, P&L, SL/TP) always uses this platform's own
// price feed via pollPrices()/handlePrices() below — the two are intentionally
// decoupled, same as how a broker's terminal and its charting package differ.
const TV_SYMBOLS = {
  EURUSD: 'OANDA:EURUSD', GBPUSD: 'OANDA:GBPUSD', USDJPY: 'OANDA:USDJPY', AUDUSD: 'OANDA:AUDUSD',
  USDCHF: 'OANDA:USDCHF', USDCAD: 'OANDA:USDCAD', NZDUSD: 'OANDA:NZDUSD', EURJPY: 'OANDA:EURJPY',
  GBPJPY: 'OANDA:GBPJPY', EURGBP: 'OANDA:EURGBP', XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD',
  BTCUSD: 'COINBASE:BTCUSD', ETHUSD: 'COINBASE:ETHUSD', USOUSD: 'TVC:USOIL',
  US30: 'FOREXCOM:US30', US500: 'FOREXCOM:SPXUSD', NAS100: 'FOREXCOM:NSXUSD', GER40: 'FOREXCOM:DE40',
};

// The free TradingView embed has no live "change symbol" API, so switching
// symbols re-creates the widget — cheap enough for how often a trader switches.
function loadChartForSymbol(sym) {
  const container = document.getElementById('tvChartWidget');
  if (!container || typeof TradingView === 'undefined') return;
  container.innerHTML = '';
  new TradingView.widget({
    autosize: true,
    symbol: TV_SYMBOLS[sym] || 'OANDA:EURUSD',
    interval: '15',
    timezone: 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'en',
    toolbar_bg: '#161b22',
    enable_publishing: false,
    allow_symbol_change: false,
    hide_side_toolbar: false,
    withdateranges: true,
    details: false,
    container_id: 'tvChartWidget',
  });
}

function toggleFullscreen() {
  const el = document.getElementById('chartContainer');
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// ── Panel tabs ─────────────────────────────────────────────────────────────
function initPanelTabs() {
  document.querySelectorAll('.wt-ptab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.wt-ptab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.wt-ptab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('ptab-' + btn.dataset.ptab).classList.add('active');
    };
  });
}

function initBottomTabs() {
  document.querySelectorAll('.wt-btab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.wt-btab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.wt-btab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('btab-' + btn.dataset.btab).classList.add('active');
    };
  });
}

// ── Order panel ────────────────────────────────────────────────────────────
function onSymbolChange() {
  const sym = document.getElementById('opSymbol').value;
  selectSymbol(sym);
}

function updateOrderPrices() {
  const p = prices[currentSymbol];
  if (!p) return;
  const spread = ((p.ask - p.bid) * Math.pow(10, DP[currentSymbol] ?? 5)).toFixed(1);
  document.getElementById('opBuy').textContent = fmt(currentSymbol, p.ask);
  document.getElementById('opSell').textContent = fmt(currentSymbol, p.bid);
  document.getElementById('opSpread').textContent = spread;
  document.getElementById('buyPrice').textContent = fmt(currentSymbol, p.ask);
  document.getElementById('sellPrice').textContent = fmt(currentSymbol, p.bid);
}

function adjVol(delta) {
  const inp = document.getElementById('opVolume');
  let v = parseFloat(inp.value) + delta;
  v = Math.max(0.01, Math.min(100, Math.round(v * 100) / 100));
  inp.value = v.toFixed(2);
  calcMargin();
}

function calcMargin() {
  const sym = document.getElementById('opSymbol').value || currentSymbol;
  const vol = parseFloat(document.getElementById('opVolume').value) || 0.01;
  const p = prices[sym];
  if (!p) return;
  const mid = (p.bid + p.ask) / 2;
  const contractSizes = { XAUUSD:100, XAGUSD:5000, BTCUSD:1, ETHUSD:1, US30:1, US500:1, NAS100:1, GER40:1, USOUSD:1000 };
  const cs = contractSizes[sym] || 100000;
  const leverage = 100;
  const margin = (vol * cs * mid) / leverage;
  const free = account.equity - account.margin;
  document.getElementById('opMargin').textContent = '$' + margin.toFixed(2);
  document.getElementById('opFree').textContent = '$' + Math.max(0, free).toFixed(2);
}

async function placeOrder(type) {
  const sym = document.getElementById('opSymbol').value || currentSymbol;
  const vol = parseFloat(document.getElementById('opVolume').value);
  const sl = parseFloat(document.getElementById('opSL').value) || 0;
  const tp = parseFloat(document.getElementById('opTP').value) || 0;
  const msgEl = document.getElementById('orderMsg');

  try {
    const res = await apiFetch('/api/client/trades/open', 'POST', { symbol: sym, type, volume: vol, sl: sl || undefined, tp: tp || undefined });
    msgEl.className = 'wt-msg success';
    msgEl.textContent = `✓ ${type.toUpperCase()} ${vol} ${sym} @ ${fmt(sym, res.trade.open_price)} — Ticket #${res.trade.ticket}`;
    msgEl.style.display = 'block';
    setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
    loadDashboard();
  } catch (e) {
    msgEl.className = 'wt-msg error';
    msgEl.textContent = '✗ ' + e.message;
    msgEl.style.display = 'block';
    setTimeout(() => { msgEl.style.display = 'none'; }, 5000);
  }
}

async function closeTrade(tradeId, sym) {
  try {
    await apiFetch(`/api/client/trades/${tradeId}/close`, 'POST');
    loadDashboard();
    loadHistory();
    showToast('Position closed', 'success');
  } catch (e) {
    showToast('Close failed: ' + e.message, 'error');
  }
}

// ── Dashboard data ─────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const data = await apiFetch('/api/client/dashboard');
    const acct = data.accounts?.[0];
    if (!acct) return;
    account.balance = acct.balance;
    account.margin = acct.margin_used || 0;

    // calc equity from open trades
    const totalPnl = (data.open_trades || []).reduce((s, t) => s + (t.profit || 0), 0);
    account.equity = account.balance + totalPnl;

    document.getElementById('wtBalance').textContent = '$' + account.balance.toFixed(2);
    document.getElementById('wtEquity').textContent = '$' + account.equity.toFixed(2);
    document.getElementById('wtPnl').textContent = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
    document.getElementById('wtPnl').className = 'wt-ai-val ' + (totalPnl >= 0 ? 'pos' : 'neg');

    openTrades = data.open_trades || [];
    renderPositions();
    calcMargin();
  } catch (e) {}
}

async function loadHistory() {
  try {
    const data = await apiFetch('/api/client/dashboard');
    closedTrades = (data.recent_trades || []).filter(t => t.status === 'closed');
    renderHistory();
  } catch (e) {}
}

// ── Positions rendering ────────────────────────────────────────────────────
function renderPositions() {
  document.getElementById('wtPosBadge').textContent = openTrades.length;
  renderPositionTable();
  renderPositionCards();
}

function renderPositionTable() {
  const tbody = document.getElementById('posTableBody');
  if (!openTrades.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="wt-empty">No open positions</td></tr>';
    return;
  }
  tbody.innerHTML = openTrades.map(t => {
    const p = prices[t.symbol] || {};
    const cur = t.type === 'buy' ? (p.bid || t.open_price) : (p.ask || t.open_price);
    const pnl = t.profit || 0;
    const pnlClass = pnl >= 0 ? 'pos' : 'neg';
    const d = new Date(t.open_time);
    return `<tr>
      <td>${t.ticket || '#'}</td>
      <td>${t.symbol}</td>
      <td class="${t.type === 'buy' ? 'buy-cell' : 'sell-cell'}">${t.type.toUpperCase()}</td>
      <td>${t.volume}</td>
      <td>${fmt(t.symbol, t.open_price)}</td>
      <td>${fmt(t.symbol, cur)}</td>
      <td>${t.sl ? fmt(t.symbol, t.sl) : '—'}</td>
      <td>${t.tp ? fmt(t.symbol, t.tp) : '—'}</td>
      <td class="pos-pnl ${pnlClass}" id="pnl_${t._id}">${fmtUSD(pnl)}</td>
      <td>${d.toLocaleTimeString()}</td>
      <td><button class="wt-close-btn" onclick="closeTrade('${t._id}','${t.symbol}')">Close</button></td>
    </tr>`;
  }).join('');
}

function renderPositionCards() {
  const el = document.getElementById('positionsList');
  if (!openTrades.length) {
    el.innerHTML = '<div class="wt-no-pos">No open positions</div>';
    return;
  }
  el.innerHTML = openTrades.map(t => {
    const pnl = t.profit || 0;
    const pnlClass = pnl >= 0 ? 'pos' : 'neg';
    return `<div class="wt-pos-card">
      <div class="wt-pc-header">
        <span class="wt-pc-sym">${t.symbol}</span>
        <span class="wt-pc-type ${t.type}">${t.type.toUpperCase()}</span>
      </div>
      <div class="wt-pc-row"><span>${t.volume} lot</span><span>#${t.ticket || ''}</span></div>
      <div class="wt-pc-row"><span>Open: ${fmt(t.symbol, t.open_price)}</span><span class="wt-pc-pnl ${pnlClass}" id="card_pnl_${t._id}">${fmtUSD(pnl)}</span></div>
      ${t.sl ? `<div class="wt-pc-row"><span>SL: ${fmt(t.symbol, t.sl)}</span>${t.tp ? `<span>TP: ${fmt(t.symbol, t.tp)}</span>` : ''}</div>` : ''}
      <button class="wt-pc-close" onclick="closeTrade('${t._id}','${t.symbol}')">Close Position</button>
    </div>`;
  }).join('');
}

function renderHistory() {
  const tbody = document.getElementById('histTableBody');
  if (!closedTrades.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="wt-empty">No closed trades</td></tr>';
    return;
  }
  tbody.innerHTML = closedTrades.map(t => {
    const pnl = t.profit || 0;
    const pnlClass = pnl >= 0 ? 'pos' : 'neg';
    const opened = new Date(t.open_time).toLocaleString();
    const closed = t.close_time ? new Date(t.close_time).toLocaleString() : '—';
    return `<tr>
      <td>${t.ticket || '#'}</td>
      <td>${t.symbol}</td>
      <td class="${t.type === 'buy' ? 'buy-cell' : 'sell-cell'}">${t.type.toUpperCase()}</td>
      <td>${t.volume}</td>
      <td>${fmt(t.symbol, t.open_price)}</td>
      <td>${t.close_price ? fmt(t.symbol, t.close_price) : '—'}</td>
      <td class="pos-pnl ${pnlClass}">${fmtUSD(pnl)}</td>
      <td>${t.commission ? '-$' + t.commission.toFixed(2) : '$0.00'}</td>
      <td>${opened}</td>
      <td>${closed}</td>
    </tr>`;
  }).join('');
}

function updatePositionsPnl() {
  let totalPnl = 0;
  openTrades.forEach(t => {
    const p = prices[t.symbol];
    if (!p) return;
    const cur = t.type === 'buy' ? p.bid : p.ask;
    // simple pnl estimate (server is authoritative)
    const pnl = t.profit || 0;
    totalPnl += pnl;
    const pnlEl = document.getElementById('pnl_' + t._id);
    if (pnlEl) { pnlEl.textContent = fmtUSD(pnl); pnlEl.className = 'pos-pnl ' + (pnl >= 0 ? 'pos' : 'neg'); }
    const cardPnl = document.getElementById('card_pnl_' + t._id);
    if (cardPnl) { cardPnl.textContent = fmtUSD(pnl); cardPnl.className = 'wt-pc-pnl ' + (pnl >= 0 ? 'pos' : 'neg'); }
  });
  const totalEl = document.getElementById('wtTotalPnl');
  if (totalEl) { totalEl.textContent = fmtUSD(totalPnl); totalEl.className = 'pnl-val ' + (totalPnl >= 0 ? 'pos' : 'neg'); }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:180px;right:16px;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:700;z-index:9999;max-width:280px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;`;
  if (type === 'success') { t.style.background = '#1a3a27'; t.style.color = '#3fb950'; t.style.border = '1px solid rgba(63,185,80,0.3)'; }
  else { t.style.background = '#3a1a1a'; t.style.color = '#f85149'; t.style.border = '1px solid rgba(248,81,73,0.3)'; }
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ── API helper ─────────────────────────────────────────────────────────────
async function apiFetch(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
