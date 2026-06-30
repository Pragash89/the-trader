/* ===== WEBTRADER.JS — TradingView Lightweight Charts ===== */
'use strict';

const token = localStorage.getItem('token');
if (!token) { window.location.href = '/login'; }

// ── State ──────────────────────────────────────────────────────────────────
let currentSymbol = 'EURUSD';
let currentTF = '1m';
let currentChartType = 'candlestick';
let prices = {};
let account = { balance: 0, equity: 0, margin: 0 };
let openTrades = [];
let closedTrades = [];
let ws = null;
let wsReconnectTimer = null;
let showMA = false, showBB = false, showVolume = false;

// ── Chart objects ──────────────────────────────────────────────────────────
let mainChart = null, mainSeries = null, maSeries = null, bbUpperSeries = null, bbLowerSeries = null;
let volumeChart = null, volumeSeries = null;
let ohlcData = {};   // symbol -> tf -> bars[]
let priceHistory = {}; // symbol -> last 200 ticks for on-the-fly aggregation

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
  initChart();
  connectWS();
  loadDashboard();
  loadHistory();
  initPanelTabs();
  initBottomTabs();
  initTimeframes();
  initChartTypes();
  selectSymbol('EURUSD');
  generateHistoricalData();
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

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);

  ws.onopen = () => { clearTimeout(wsReconnectTimer); };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'prices') {
        handlePrices(msg.data);
      } else if (msg.type === 'trade_closed') {
        showToast(`Trade #${msg.ticket} closed. P&L: ${fmtUSD(msg.profit)}`, msg.profit >= 0 ? 'success' : 'error');
        loadDashboard();
        loadHistory();
      } else if (msg.type === 'notification') {
        showToast(msg.message, 'success');
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };
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

    // push tick into chart
    pushTick(currentSymbol, mid);
    // update order panel prices
    updateOrderPrices();
  }

  // update open positions P&L
  updatePositionsPnl();
}

// ── Chart ──────────────────────────────────────────────────────────────────
function initChart() {
  const container = document.getElementById('chartContainer');
  mainChart = LightweightCharts.createChart(container, {
    layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#30363d', textColor: '#8b949e', fontSize: 11 },
    timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false, fontSize: 11 },
    handleScroll: true,
    handleScale: true,
  });

  mainSeries = mainChart.addCandlestickSeries({
    upColor: '#3fb950', downColor: '#f85149',
    borderUpColor: '#3fb950', borderDownColor: '#f85149',
    wickUpColor: '#3fb950', wickDownColor: '#f85149',
  });

  // crosshair data display
  mainChart.subscribeCrosshairMove(param => {
    if (!param.time || !mainSeries) return;
    const data = param.seriesData.get(mainSeries);
    if (data) {
      document.getElementById('ohlcDisplay').textContent =
        `O:${fmt(currentSymbol,data.open)} H:${fmt(currentSymbol,data.high)} L:${fmt(currentSymbol,data.low)} C:${fmt(currentSymbol,data.close)}`;
    }
  });

  // resize observer
  new ResizeObserver(() => {
    mainChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  }).observe(container);

  // Volume chart (hidden by default)
  const vc = document.getElementById('volumeContainer');
  volumeChart = LightweightCharts.createChart(vc, {
    layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
    rightPriceScale: { borderColor: '#30363d', textColor: '#8b949e', fontSize: 10, scaleMargins: { top: 0.1, bottom: 0 } },
    timeScale: { visible: false },
  });
  volumeSeries = volumeChart.addHistogramSeries({ color: '#2f81f740', priceFormat: { type: 'volume' } });
  new ResizeObserver(() => {
    volumeChart.applyOptions({ width: vc.clientWidth, height: vc.clientHeight });
  }).observe(vc);
}

function getBarTime(timestamp, tfMs) {
  return Math.floor(timestamp / tfMs) * tfMs / 1000;
}

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };

// Generate synthetic historical bars going back in time
function generateHistoricalData() {
  SYMBOLS.forEach(({ sym }) => {
    ohlcData[sym] = {};
    Object.keys(TF_MS).forEach(tf => {
      ohlcData[sym][tf] = generateBars(sym, tf);
    });
  });
  loadChartForSymbol(currentSymbol);
}

function generateBars(sym, tf) {
  const basePrice = getBasePrice(sym);
  const volatility = getVolatility(sym);
  const tfMs = TF_MS[tf];
  const numBars = 300;
  const now = Date.now();
  const bars = [];
  let price = basePrice;

  for (let i = numBars; i >= 0; i--) {
    const barTime = Math.floor((now - i * tfMs) / tfMs) * tfMs / 1000;
    const o = price;
    const moves = Math.floor(tfMs / 800) + 1;
    let hi = o, lo = o, cl = o;
    for (let m = 0; m < moves; m++) {
      const u1 = Math.random(), u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      cl = cl * (1 + z * volatility);
      hi = Math.max(hi, cl);
      lo = Math.min(lo, cl);
    }
    price = cl;
    bars.push({ time: barTime, open: +o.toFixed(DP[sym]??5), high: +hi.toFixed(DP[sym]??5), low: +lo.toFixed(DP[sym]??5), close: +cl.toFixed(DP[sym]??5), volume: Math.floor(Math.random() * 1000 + 100) });
  }
  return bars;
}

function getBasePrice(sym) {
  const bases = { EURUSD:1.08, GBPUSD:1.27, USDJPY:150.2, AUDUSD:0.655, USDCHF:0.895, NZDUSD:0.605, USDCAD:1.365, EURJPY:162.3, GBPJPY:190.5, EURGBP:0.852, XAUUSD:2320, XAGUSD:27.5, BTCUSD:67000, ETHUSD:3500, USOUSD:82.5, US30:38500, US500:5200, NAS100:18200, GER40:18000 };
  return bases[sym] || 1.0;
}

function getVolatility(sym) {
  const v = { BTCUSD:0.002, ETHUSD:0.003, US30:0.001, US500:0.001, NAS100:0.0015, GER40:0.001, XAUUSD:0.0008, XAGUSD:0.001, USOUSD:0.001 };
  return v[sym] || 0.0003;
}

function loadChartForSymbol(sym) {
  if (!ohlcData[sym] || !ohlcData[sym][currentTF]) return;
  const bars = ohlcData[sym][currentTF];
  if (mainSeries && bars.length) {
    if (currentChartType === 'candlestick') {
      mainSeries.setData(bars);
    } else if (currentChartType === 'line') {
      mainSeries.setData(bars.map(b => ({ time: b.time, value: b.close })));
    } else {
      mainSeries.setData(bars.map(b => ({ time: b.time, value: b.close })));
    }
    if (volumeSeries) {
      volumeSeries.setData(bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? '#3fb95040' : '#f8514940' })));
    }
    mainChart.timeScale().fitContent();
    // update indicators
    if (showMA) renderMA(bars);
    if (showBB) renderBB(bars);
  }
}

function pushTick(sym, price) {
  if (!ohlcData[sym]) ohlcData[sym] = {};
  const tfMs = TF_MS[currentTF];
  const bars = ohlcData[sym][currentTF];
  if (!bars || !bars.length) return;
  const nowSec = Math.floor(Date.now() / tfMs) * tfMs / 1000;
  const last = bars[bars.length - 1];
  const p = +price.toFixed(DP[sym] ?? 5);

  if (last.time === nowSec) {
    last.high = Math.max(last.high, p);
    last.low = Math.min(last.low, p);
    last.close = p;
    last.volume = (last.volume || 0) + 1;
  } else {
    const newBar = { time: nowSec, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p, volume: 1 };
    bars.push(newBar);
    if (bars.length > 500) bars.shift();
  }

  if (sym !== currentSymbol) return;
  if (currentChartType === 'candlestick') {
    mainSeries.update({ time: bars[bars.length-1].time, open: bars[bars.length-1].open, high: bars[bars.length-1].high, low: bars[bars.length-1].low, close: bars[bars.length-1].close });
  } else {
    mainSeries.update({ time: bars[bars.length-1].time, value: bars[bars.length-1].close });
  }
  if (volumeSeries) {
    const lb = bars[bars.length-1];
    volumeSeries.update({ time: lb.time, value: lb.volume, color: lb.close >= lb.open ? '#3fb95040' : '#f8514940' });
  }
}

// ── Indicators ─────────────────────────────────────────────────────────────
function toggleMA() {
  showMA = !showMA;
  document.getElementById('maBtn').classList.toggle('active', showMA);
  if (!showMA && maSeries) { mainChart.removeSeries(maSeries); maSeries = null; }
  else { renderMA(ohlcData[currentSymbol]?.[currentTF] || []); }
}

function renderMA(bars) {
  if (maSeries) { mainChart.removeSeries(maSeries); maSeries = null; }
  if (!bars.length) return;
  maSeries = mainChart.addLineSeries({ color: '#d29922', lineWidth: 1, priceLineVisible: false });
  const period = 20;
  const data = bars.slice(period - 1).map((b, i) => {
    const slice = bars.slice(i, i + period);
    const avg = slice.reduce((a, c) => a + c.close, 0) / period;
    return { time: b.time, value: +avg.toFixed(DP[currentSymbol] ?? 5) };
  });
  maSeries.setData(data);
}

function toggleBB() {
  showBB = !showBB;
  document.getElementById('bbBtn').classList.toggle('active', showBB);
  if (!showBB) {
    if (bbUpperSeries) { mainChart.removeSeries(bbUpperSeries); bbUpperSeries = null; }
    if (bbLowerSeries) { mainChart.removeSeries(bbLowerSeries); bbLowerSeries = null; }
  } else { renderBB(ohlcData[currentSymbol]?.[currentTF] || []); }
}

function renderBB(bars) {
  if (bbUpperSeries) mainChart.removeSeries(bbUpperSeries);
  if (bbLowerSeries) mainChart.removeSeries(bbLowerSeries);
  if (!bars.length) return;
  const period = 20, k = 2;
  const upper = [], lower = [];
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a,c) => a + c.close, 0) / period;
    const std = Math.sqrt(slice.reduce((a,c) => a + Math.pow(c.close - avg, 2), 0) / period);
    upper.push({ time: bars[i].time, value: +(avg + k * std).toFixed(DP[currentSymbol]??5) });
    lower.push({ time: bars[i].time, value: +(avg - k * std).toFixed(DP[currentSymbol]??5) });
  }
  bbUpperSeries = mainChart.addLineSeries({ color: '#2f81f780', lineWidth: 1, priceLineVisible: false, lineStyle: 1 });
  bbLowerSeries = mainChart.addLineSeries({ color: '#2f81f780', lineWidth: 1, priceLineVisible: false, lineStyle: 1 });
  bbUpperSeries.setData(upper);
  bbLowerSeries.setData(lower);
}

function toggleVolume() {
  showVolume = !showVolume;
  document.getElementById('volumeBtn').classList.toggle('active', showVolume);
  const vc = document.getElementById('volumeContainer');
  vc.classList.toggle('visible', showVolume);
  setTimeout(() => {
    volumeChart.applyOptions({ width: vc.clientWidth, height: vc.clientHeight });
  }, 50);
}

// ── Timeframe / chart type ─────────────────────────────────────────────────
function initTimeframes() {
  document.querySelectorAll('.wt-tf').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.wt-tf').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTF = btn.dataset.tf;
      loadChartForSymbol(currentSymbol);
    };
  });
}

function initChartTypes() {
  document.querySelectorAll('.wt-ct').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.wt-ct').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const ct = btn.dataset.ct;
      if (ct === currentChartType) return;
      currentChartType = ct;
      if (mainSeries) mainChart.removeSeries(mainSeries);
      if (maSeries) { mainChart.removeSeries(maSeries); maSeries = null; }
      if (bbUpperSeries) { mainChart.removeSeries(bbUpperSeries); bbUpperSeries = null; }
      if (bbLowerSeries) { mainChart.removeSeries(bbLowerSeries); bbLowerSeries = null; }
      if (ct === 'candlestick') {
        mainSeries = mainChart.addCandlestickSeries({ upColor:'#3fb950',downColor:'#f85149',borderUpColor:'#3fb950',borderDownColor:'#f85149',wickUpColor:'#3fb950',wickDownColor:'#f85149' });
      } else if (ct === 'line') {
        mainSeries = mainChart.addLineSeries({ color:'#2f81f7', lineWidth:2, priceLineVisible:true });
      } else {
        mainSeries = mainChart.addAreaSeries({ topColor:'rgba(47,129,247,0.3)', bottomColor:'rgba(47,129,247,0.0)', lineColor:'#2f81f7', lineWidth:2 });
      }
      loadChartForSymbol(currentSymbol);
    };
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
