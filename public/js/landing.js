// Landing page interactivity

// Navbar scroll effect
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
});

// Hamburger menu
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});

// ===== Live price WebSocket =====
let ws;
const prevPrices = {};

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'prices') updateTicker(msg.data);
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}
connectWS();

function updateTicker(prices) {
  const symbolMap = {
    'EURUSD': 'tick-EURUSD', 'GBPUSD': 'tick-GBPUSD', 'USDJPY': 'tick-USDJPY',
    'XAUUSD': 'tick-XAUUSD', 'BTCUSD': 'tick-BTCUSD', 'AUDUSD': 'tick-AUDUSD',
    'US30': 'tick-US30', 'NAS100': 'tick-NAS100'
  };

  for (const [sym, id] of Object.entries(symbolMap)) {
    if (prices[sym]) {
      const el = document.getElementById(id);
      if (el) {
        const price = prices[sym].bid;
        const prev = prevPrices[sym];
        el.textContent = formatPrice(sym, price);
        if (prev) {
          el.parentElement.querySelector('.change').className = 'change ' + (price >= prev ? 'positive' : 'negative');
        }
        prevPrices[sym] = price;
      }
    }
  }

  // Hero card
  if (prices['EURUSD']) {
    const p = prices['EURUSD'];
    document.getElementById('heroPrice').textContent = p.bid.toFixed(5);
    document.getElementById('heroBid').textContent = p.bid.toFixed(5);
    document.getElementById('heroAsk').textContent = p.ask.toFixed(5);
    updateHeroChart(p.bid);
  }

  // Market table
  updateMarketTable(prices);
}

function formatPrice(symbol, price) {
  if (['USDJPY','EURJPY','GBPJPY'].includes(symbol)) return price.toFixed(3);
  if (['XAUUSD','XAGUSD'].includes(symbol)) return '$' + price.toFixed(2);
  if (['BTCUSD','ETHUSD'].includes(symbol)) return '$' + Math.round(price).toLocaleString();
  if (['US30','NAS100','GER40','US500'].includes(symbol)) return price.toFixed(1);
  return price.toFixed(5);
}

// ===== Hero chart mini sparkline =====
const chartData = Array(50).fill(1.08215);
function updateHeroChart(price) {
  chartData.push(price);
  if (chartData.length > 60) chartData.shift();

  const w = 300, h = 80;
  const min = Math.min(...chartData) - 0.00002;
  const max = Math.max(...chartData) + 0.00002;

  const points = chartData.map((v, i) => {
    const x = (i / (chartData.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h;
    return `${x},${y}`;
  });

  const lineD = 'M' + points.join(' L');
  const areaD = 'M0,' + h + ' L' + points.join(' L') + ` L${w},${h} Z`;

  const lineEl = document.getElementById('chartLine');
  const areaEl = document.getElementById('chartArea');
  if (lineEl) lineEl.setAttribute('d', lineD);
  if (areaEl) areaEl.setAttribute('d', areaD);
}

// ===== Market Table =====
const marketData = {
  forex: [
    { sym: 'EURUSD', name: 'Euro / US Dollar', lev: '1:500' },
    { sym: 'GBPUSD', name: 'British Pound / US Dollar', lev: '1:500' },
    { sym: 'USDJPY', name: 'US Dollar / Japanese Yen', lev: '1:500' },
    { sym: 'AUDUSD', name: 'Australian Dollar / US Dollar', lev: '1:200' },
    { sym: 'USDCHF', name: 'US Dollar / Swiss Franc', lev: '1:500' },
    { sym: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', lev: '1:200' },
  ],
  metals: [
    { sym: 'XAUUSD', name: 'Gold / US Dollar', lev: '1:100' },
    { sym: 'XAGUSD', name: 'Silver / US Dollar', lev: '1:100' },
  ],
  indices: [
    { sym: 'US30', name: 'Dow Jones 30', lev: '1:100' },
    { sym: 'US500', name: 'S&P 500', lev: '1:100' },
    { sym: 'NAS100', name: 'NASDAQ 100', lev: '1:100' },
    { sym: 'GER40', name: 'Germany DAX 40', lev: '1:100' },
  ],
  crypto: [
    { sym: 'BTCUSD', name: 'Bitcoin / US Dollar', lev: '1:10' },
    { sym: 'ETHUSD', name: 'Ethereum / US Dollar', lev: '1:10' },
  ],
  energy: [
    { sym: 'USOUSD', name: 'Crude Oil / US Dollar', lev: '1:50' },
  ],
};

let currentTab = 'forex';
let currentPrices = {};

function renderMarketTable(tab, prices) {
  const tbody = document.getElementById('marketTableBody');
  if (!tbody) return;
  const rows = marketData[tab] || [];
  tbody.innerHTML = rows.map(({ sym, name, lev }) => {
    const p = prices[sym] || {};
    const bid = p.bid || '—';
    const ask = p.ask || '—';
    const spread = p.spread != null ? p.spread.toFixed(p.digits > 2 ? 1 : 2) : '—';
    const change = ((Math.random() - 0.4) * 0.3).toFixed(2);
    const isUp = parseFloat(change) >= 0;
    return `<tr>
      <td><div class="sym-cell"><div class="sym-icon">${sym.substring(0,2)}</div><div><div class="sym-name">${sym}</div><div class="sym-full">${name}</div></div></div></td>
      <td class="price-cell">${typeof bid === 'number' ? bid.toFixed(p.digits || 5) : bid}</td>
      <td class="price-cell">${typeof ask === 'number' ? ask.toFixed(p.digits || 5) : ask}</td>
      <td class="spread-cell">${spread}</td>
      <td class="change-cell ${isUp ? 'positive' : 'negative'}">${isUp ? '+' : ''}${change}%</td>
      <td>${lev}</td>
      <td><a href="/register" class="trade-now-btn">Trade</a></td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderMarketTable(currentTab, currentPrices);
  });
});

function updateMarketTable(prices) {
  currentPrices = { ...currentPrices, ...prices };
  renderMarketTable(currentTab, currentPrices);
}

// Initial table render
renderMarketTable('forex', {});

// ===== Counter animation =====
function animateCounters() {
  document.querySelectorAll('.stat-num[data-target]').forEach(el => {
    const target = parseFloat(el.dataset.target);
    const isDecimal = el.dataset.decimal;
    let start = 0;
    const duration = 2000;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start = Math.min(start + step, target);
      el.textContent = isDecimal ? start.toFixed(parseInt(isDecimal)) : Math.floor(start).toLocaleString();
      if (start >= target) clearInterval(timer);
    }, 16);
  });
}

// Intersection observer for counters
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { animateCounters(); statsObserver.disconnect(); } });
}, { threshold: 0.3 });
const statsSection = document.querySelector('.stats-section');
if (statsSection) statsObserver.observe(statsSection);

// ===== Smooth scroll for anchor links =====
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(a.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    navLinks.classList.remove('open');
  });
});
