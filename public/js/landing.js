/* ===== LANDING PAGE JS — THE TRADER ===== */

// Navbar scroll
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => { navbar.classList.toggle('scrolled', window.scrollY > 60); });

// Hamburger
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
if (hamburger) hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#') return;
    e.preventDefault();
    const t = document.querySelector(href);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    navLinks.classList.remove('open');
  });
});

// ===== Live prices (polling — serverless-friendly, no persistent connection needed) =====
const prevPrices = {};
let currentPrices = {};

async function pollPrices() {
  try {
    const res = await fetch('/api/public/prices');
    if (res.ok) onPrices(await res.json());
  } catch { /* transient network error — next poll will retry */ }
}
pollPrices();
setInterval(pollPrices, 1000);

function onPrices(prices) {
  currentPrices = { ...currentPrices, ...prices };
  updateTicker(prices);
  if (prices['EURUSD']) updateHeroCard(prices['EURUSD']);
  updatePlatformVisual(prices);
  renderMarketTable(currentTab, currentPrices);
}

// ===== Ticker =====
function updateTicker(prices) {
  const map = { EURUSD:'tick-EURUSD', GBPUSD:'tick-GBPUSD', USDJPY:'tick-USDJPY', XAUUSD:'tick-XAUUSD', BTCUSD:'tick-BTCUSD', AUDUSD:'tick-AUDUSD', US30:'tick-US30', NAS100:'tick-NAS100', GER40:'tick-GER40', ETHUSD:'tick-ETHUSD' };
  for (const [sym, id] of Object.entries(map)) {
    if (!prices[sym]) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    const bid = prices[sym].bid;
    const prev = prevPrices[sym];
    el.textContent = fmtPrice(sym, bid);
    const chgEl = el.parentElement?.querySelector('.change');
    if (chgEl && prev) chgEl.className = 'change ' + (bid >= prev ? 'positive' : 'negative');
    prevPrices[sym] = bid;
  }
}

function fmtPrice(sym, v) {
  if (['USDJPY','EURJPY','GBPJPY'].includes(sym)) return v.toFixed(3);
  if (['XAUUSD'].includes(sym)) return '$' + v.toFixed(2);
  if (['BTCUSD','ETHUSD'].includes(sym)) return '$' + Math.round(v).toLocaleString();
  if (['US30','NAS100','GER40','US500'].includes(sym)) return v.toFixed(1);
  if (['XAGUSD'].includes(sym)) return v.toFixed(3);
  return v.toFixed(5);
}

// ===== Hero card =====
const chartData = Array(60).fill(1.08215);
let chartCtx = null;

function updateHeroCard(p) {
  const priceEl = document.getElementById('heroPrice');
  const bidEl = document.getElementById('heroBid');
  const askEl = document.getElementById('heroAsk');
  if (priceEl) priceEl.textContent = p.bid.toFixed(5);
  if (bidEl) bidEl.textContent = p.bid.toFixed(5);
  if (askEl) askEl.textContent = p.ask.toFixed(5);
  chartData.push(p.bid);
  if (chartData.length > 60) chartData.shift();
  drawMiniChart();
}

function drawMiniChart() {
  const canvas = document.getElementById('heroMiniChart');
  if (!canvas) return;
  if (!chartCtx) chartCtx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  chartCtx.clearRect(0, 0, w, h);
  const min = Math.min(...chartData), max = Math.max(...chartData);
  const range = max - min || 0.0001;
  const pts = chartData.map((v, i) => ({ x: (i / (chartData.length - 1)) * w, y: h - ((v - min) / range) * (h - 4) - 2 }));
  const isUp = chartData[chartData.length - 1] >= chartData[0];
  const color = isUp ? '#10B981' : '#EF4444';
  const grad = chartCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, isUp ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  chartCtx.beginPath();
  pts.forEach((p, i) => i === 0 ? chartCtx.moveTo(p.x, p.y) : chartCtx.lineTo(p.x, p.y));
  chartCtx.lineTo(w, h); chartCtx.lineTo(0, h);
  chartCtx.fillStyle = grad; chartCtx.fill();
  chartCtx.beginPath();
  pts.forEach((p, i) => i === 0 ? chartCtx.moveTo(p.x, p.y) : chartCtx.lineTo(p.x, p.y));
  chartCtx.strokeStyle = color; chartCtx.lineWidth = 2; chartCtx.stroke();
}
drawMiniChart();

// ===== Platform visual live prices =====
function updatePlatformVisual(prices) {
  [['EURUSD','pv-EURUSD','pvc-EURUSD'], ['XAUUSD','pv-XAUUSD','pvc-XAUUSD'], ['BTCUSD','pv-BTCUSD','pvc-BTCUSD'], ['US30','pv-US30','pvc-US30'], ['GBPUSD','pv-GBPUSD','pvc-GBPUSD']].forEach(([sym, pid, cid]) => {
    if (!prices[sym]) return;
    const pEl = document.getElementById(pid);
    const cEl = document.getElementById(cid);
    if (pEl) pEl.textContent = fmtPrice(sym, prices[sym].bid);
    if (cEl && prevPrices[sym]) {
      const up = prices[sym].bid >= prevPrices[sym];
      cEl.textContent = up ? '+' + (Math.random() * 0.5).toFixed(2) + '%' : '-' + (Math.random() * 0.3).toFixed(2) + '%';
      cEl.className = 'pv-chg ' + (up ? 'up' : 'dn');
    }
  });
}

// ===== Market Table =====
const iconMap = { forex:'forex', metals:'metals', indices:'indices', crypto:'crypto', energy:'energy' };
const marketData = {
  forex: [
    { sym:'EURUSD', name:'Euro / US Dollar', icon:'€$', cat:'forex' },
    { sym:'GBPUSD', name:'British Pound / USD', icon:'£$', cat:'forex' },
    { sym:'USDJPY', name:'US Dollar / Japanese Yen', icon:'$¥', cat:'forex' },
    { sym:'AUDUSD', name:'Australian Dollar / USD', icon:'A$', cat:'forex' },
    { sym:'USDCHF', name:'US Dollar / Swiss Franc', icon:'$₣', cat:'forex' },
    { sym:'NZDUSD', name:'New Zealand Dollar / USD', icon:'N$', cat:'forex' },
  ],
  metals: [
    { sym:'XAUUSD', name:'Gold / US Dollar', icon:'Au', cat:'metals' },
    { sym:'XAGUSD', name:'Silver / US Dollar', icon:'Ag', cat:'metals' },
  ],
  indices: [
    { sym:'US30', name:'Dow Jones 30', icon:'DJ', cat:'indices' },
    { sym:'US500', name:'S&P 500', icon:'SP', cat:'indices' },
    { sym:'NAS100', name:'NASDAQ 100', icon:'NQ', cat:'indices' },
    { sym:'GER40', name:'Germany DAX 40', icon:'DE', cat:'indices' },
  ],
  crypto: [
    { sym:'BTCUSD', name:'Bitcoin / US Dollar', icon:'₿', cat:'crypto' },
    { sym:'ETHUSD', name:'Ethereum / US Dollar', icon:'Ξ', cat:'crypto' },
  ],
  energy: [
    { sym:'USOUSD', name:'Crude Oil / US Dollar', icon:'🛢', cat:'energy' },
  ],
};

let currentTab = 'forex';

function renderMarketTable(tab, prices) {
  const body = document.getElementById('marketTableBody');
  if (!body) return;
  const rows = marketData[tab] || [];
  body.innerHTML = rows.map(({ sym, name, icon, cat }) => {
    const p = prices[sym] || {};
    const bid = p.bid ? fmtPrice(sym, p.bid) : '—';
    const ask = p.ask ? fmtPrice(sym, p.ask) : '—';
    const spread = p.spread != null ? p.spread.toFixed(1) : '0.1';
    const chgVal = ((Math.random() - 0.45) * 0.5).toFixed(2);
    const isUp = parseFloat(chgVal) >= 0;
    return `<div class="market-row">
      <div class="mr-symbol">
        <div class="mr-icon ${cat}">${icon}</div>
        <div><div class="mr-name">${sym}</div><div class="mr-desc">${name}</div></div>
      </div>
      <div class="mr-price">${bid}</div>
      <div class="mr-price">${ask}</div>
      <div class="mr-spread"><span class="spread-badge">${spread}</span></div>
      <div class="mr-change ${isUp ? 'pos' : 'neg'}">${isUp ? '+' : ''}${chgVal}%</div>
      <div class="mr-trade"><a href="/register" class="trade-link">Trade</a></div>
    </div>`;
  }).join('');
}

// Market tabs (new CSS uses .market-tab)
document.querySelectorAll('.market-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.market-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderMarketTable(currentTab, currentPrices);
  });
});
renderMarketTable('forex', {});

// ===== Counter animation =====
function animateCounters() {
  document.querySelectorAll('.stat-num[data-target]').forEach(el => {
    if (el.dataset.animated) return;
    el.dataset.animated = '1';
    const target = parseFloat(el.dataset.target);
    const isDecimal = el.dataset.decimal;
    const isK = el.dataset.format === 'k';
    let cur = 0;
    const step = target / 80;
    const timer = setInterval(() => {
      cur = Math.min(cur + step, target);
      if (isK) el.textContent = (cur / 1000).toFixed(0) + 'K';
      else if (isDecimal) el.textContent = cur.toFixed(parseInt(isDecimal));
      else el.textContent = Math.floor(cur).toLocaleString();
      if (cur >= target) clearInterval(timer);
    }, 20);
  });
}

const statsObs = new IntersectionObserver(e => { e.forEach(x => { if (x.isIntersecting) animateCounters(); }); }, { threshold: 0.3 });
const statsSection = document.querySelector('.stats-section');
if (statsSection) statsObs.observe(statsSection);
