// Dashboard JS — handles all client dashboard functionality

const API = '/api/client';
let token = localStorage.getItem('tt_token');
let userData = null;
let dashData = null;
let openTrades = [];
let ws = null;
let equityHistory = [];
let equityChart = null;
let livePrices = {};

// ===== AUTH CHECK =====
if (!token) { window.location.href = '/login'; }

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
}

// ===== INIT =====
async function init() {
  try {
    await loadDashboard();
    connectWS();
    setInterval(refreshOpenTrades, 3000);
    setGreeting();
  } catch (err) {
    if (err.status === 401) { localStorage.clear(); window.location.href = '/login'; }
    console.error(err);
  }
}

function setGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const greet = document.getElementById('overviewGreeting');
  if (greet && userData) greet.textContent = `${g}, ${userData.first_name}!`;
}

async function loadDashboard() {
  const res = await fetch(`${API}/dashboard`, { headers: authHeaders() });
  if (!res.ok) throw { status: res.status };
  dashData = await res.json();
  userData = dashData.user;
  openTrades = dashData.open_trades || [];

  renderUserInfo();
  renderMetrics();
  renderMiniTrades();
  renderRecentTxns();
  renderNotifications();
  renderPositions();
  renderHistory();
  renderTransactions();
  renderSettings();
  initEquityChart();
  initMarketWatch();
  checkKYC();
}

function renderUserInfo() {
  const u = userData;
  const initials = (u.first_name[0] + u.last_name[0]).toUpperCase();
  ['accAvatar', 'chipAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = initials;
  });
  const accName = document.getElementById('accName');
  if (accName) accName.textContent = `${u.first_name} ${u.last_name}`;
  const accNum = document.getElementById('accNum');
  if (accNum) accNum.textContent = u.account_number;
  const chipName = document.getElementById('chipName');
  if (chipName) chipName.textContent = u.first_name;

  // KYC badge
  const kycBadge = document.getElementById('kycBadge');
  if (kycBadge) {
    kycBadge.textContent = u.kyc_status === 'approved' ? 'Verified' : u.kyc_status === 'under_review' ? 'In Review' : 'Pending';
    kycBadge.className = 'acc-status kyc-' + u.kyc_status;
  }
}

function renderMetrics() {
  const u = userData;
  const pnl = dashData.total_open_profit || 0;
  const equity = (u.balance || 0) + pnl;
  const freeMargin = equity - (u.margin || 0);

  setVal('mBalance', fmt(u.balance));
  setVal('mEquity', fmt(equity));
  const pnlEl = document.getElementById('mPnl');
  if (pnlEl) { pnlEl.textContent = fmt(pnl); pnlEl.style.color = pnl >= 0 ? 'var(--teal)' : 'var(--red)'; }
  setVal('mFreeMargin', fmt(freeMargin));

  // Withdraw page balance
  setVal('withdrawBalance', fmt(u.balance));

  // Equity history for chart
  equityHistory.push(parseFloat(equity.toFixed(2)));
  if (equityHistory.length > 30) equityHistory.shift();
}

function checkKYC() {
  const banner = document.getElementById('kycBanner');
  if (banner && userData.kyc_status !== 'approved') banner.style.display = 'flex';
  else if (banner) banner.style.display = 'none';
}

function renderMiniTrades() {
  const container = document.getElementById('miniTrades');
  const countEl = document.getElementById('posCount');
  const navBadge = document.getElementById('openCount');
  if (!container) return;

  if (navBadge) navBadge.textContent = openTrades.length;
  if (countEl) countEl.textContent = `(${openTrades.length})`;

  if (!openTrades.length) {
    container.innerHTML = '<div class="empty-state">No open positions</div>';
    return;
  }
  container.innerHTML = openTrades.slice(0, 5).map(t => {
    const profit = typeof t.profit === 'number' ? t.profit : 0;
    return `<div class="mini-trade-row">
      <span class="mt-sym">${t.symbol}</span>
      <span class="mt-type ${t.type}">${t.type.toUpperCase()}</span>
      <span>${t.volume} lot</span>
      <span class="mt-pnl ${profit >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmt(profit)}</span>
    </div>`;
  }).join('');
}

function renderRecentTxns() {
  const container = document.getElementById('recentTxns');
  if (!container) return;
  const txns = dashData.transactions || [];
  if (!txns.length) { container.innerHTML = '<div class="empty-state">No transactions yet</div>'; return; }
  container.innerHTML = txns.slice(0, 5).map(t => `
    <div class="txn-row">
      <div class="txn-type">
        <div class="txn-icon ${t.type === 'deposit' ? 'dep' : 'wit'}">${t.type === 'deposit' ? '↓' : '↑'}</div>
        <div>
          <div>${t.type === 'deposit' ? 'Deposit' : 'Withdrawal'}</div>
          <div class="txn-ref">${t.reference}</div>
        </div>
      </div>
      <div>
        <div class="${t.type === 'deposit' ? 'pnl-pos' : 'pnl-neg'}" style="font-weight:700">${t.type === 'deposit' ? '+' : '-'}${fmt(t.amount)}</div>
        <div style="font-size:11px;color:var(--text3)">${fmtDate(t.created_at)}</div>
      </div>
      <div class="status-badge ${t.status}">${t.status}</div>
    </div>
  `).join('');
}

function renderNotifications() {
  const notifs = dashData.notifications || [];
  const badge = document.getElementById('notifBadge');
  const list = document.getElementById('notifList');

  if (badge) {
    badge.textContent = notifs.length;
    badge.style.display = notifs.length ? 'flex' : 'none';
  }
  if (list) {
    if (!notifs.length) { list.innerHTML = '<div class="notif-empty">No new notifications</div>'; return; }
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="notif-title">${n.title}</div>
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${fmtDate(n.created_at)}</div>
      </div>
    `).join('');
  }
}

function renderPositions() {
  const body = document.getElementById('positionsBody');
  const totalEl = document.getElementById('totalPnlDisplay');
  if (!body) return;

  if (!openTrades.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty-state">No open positions</td></tr>';
    if (totalEl) totalEl.textContent = '$0.00';
    return;
  }

  let total = 0;
  body.innerHTML = openTrades.map(t => {
    const profit = typeof t.profit === 'number' ? t.profit : 0;
    total += profit;
    return `<tr>
      <td>${t.ticket || '—'}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="type-badge ${t.type}">${t.type.toUpperCase()}</span></td>
      <td>${t.volume}</td>
      <td>${t.open_price}</td>
      <td>${t.current_price || '—'}</td>
      <td>${t.stop_loss || '—'}</td>
      <td>${t.take_profit || '—'}</td>
      <td class="${profit >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmt(profit)}</td>
      <td>${fmtDate(t.open_time)}</td>
      <td><button class="btn-close-trade" onclick="closeTrade('${t.id}', '${t.symbol}')">Close</button></td>
    </tr>`;
  }).join('');

  if (totalEl) { totalEl.textContent = fmt(total); totalEl.className = 'pnl-val ' + (total >= 0 ? 'pnl-pos' : 'pnl-neg'); }
}

function renderHistory() {
  const body = document.getElementById('historyBody');
  if (!body) return;
  const trades = dashData.recent_trades || [];
  if (!trades.length) { body.innerHTML = '<tr><td colspan="10" class="empty-state">No trade history</td></tr>'; return; }
  body.innerHTML = trades.map(t => `<tr>
    <td>${t.ticket || '—'}</td>
    <td><strong>${t.symbol}</strong></td>
    <td><span class="type-badge ${t.type}">${t.type.toUpperCase()}</span></td>
    <td>${t.volume}</td>
    <td>${t.open_price}</td>
    <td>${t.close_price || '—'}</td>
    <td class="${(t.profit||0) >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmt(t.profit||0)}</td>
    <td>${fmt(t.commission||0)}</td>
    <td>${fmtDate(t.open_time)}</td>
    <td>${fmtDate(t.close_time)}</td>
  </tr>`).join('');
}

function renderTransactions() {
  const body = document.getElementById('txnsBody');
  if (!body) return;
  const txns = dashData.transactions || [];
  if (!txns.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">No transactions</td></tr>'; return; }
  body.innerHTML = txns.map(t => `<tr>
    <td><code style="font-size:11px;color:var(--text2)">${t.reference}</code></td>
    <td style="text-transform:capitalize">${t.type}</td>
    <td class="${t.type === 'deposit' ? 'pnl-pos' : 'pnl-neg'}">${t.type === 'deposit' ? '+' : '-'}${fmt(t.amount)}</td>
    <td>${t.method || '—'}</td>
    <td><span class="status-badge ${t.status}">${t.status}</span></td>
    <td>${fmtDate(t.created_at)}</td>
  </tr>`).join('');
}

function renderSettings() {
  if (!userData) return;
  const fields = { setFirstName: 'first_name', setLastName: 'last_name', setEmail: 'email', setPhone: 'phone', setAddress: 'address', setCity: 'city' };
  for (const [id, field] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.value = userData[field] || '';
  }
  setVal('detAccNum', userData.account_number);
  setVal('detLeverage', '1:' + (userData.leverage || 100));
  setVal('detKyc', userData.kyc_status === 'approved' ? '✅ Approved' : userData.kyc_status === 'under_review' ? '🔄 In Review' : '⏳ Pending');
  setVal('detSince', fmtDate(userData.created_at));
}

// ===== EQUITY CHART =====
function initEquityChart() {
  const ctx = document.getElementById('equityChart');
  if (!ctx || equityChart) return;
  equityHistory = [userData.balance, userData.balance];
  equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: equityHistory.map((_, i) => ''),
      datasets: [{
        data: equityHistory, fill: true,
        borderColor: '#00d4aa', borderWidth: 2,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
          g.addColorStop(0, 'rgba(0,212,170,0.15)'); g.addColorStop(1, 'rgba(0,212,170,0)');
          return g;
        },
        tension: 0.4, pointRadius: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { display: false },
        y: { display: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#546a88', font: { size: 11 }, callback: v => '$' + v.toFixed(0) } }
      }
    }
  });
}

function updateEquityChart() {
  if (!equityChart) return;
  const pnl = openTrades.reduce((s, t) => s + (t.profit || 0), 0);
  const equity = (userData?.balance || 0) + pnl;
  equityHistory.push(equity);
  if (equityHistory.length > 30) equityHistory.shift();
  equityChart.data.labels = equityHistory.map((_, i) => '');
  equityChart.data.datasets[0].data = equityHistory;
  equityChart.update('none');
}

// ===== MARKET WATCH =====
const watchSymbols = ['EURUSD','GBPUSD','USDJPY','XAUUSD','AUDUSD','USDCHF','BTCUSD','ETHUSD','US30','NAS100'];

function initMarketWatch() {
  const container = document.getElementById('marketWatch');
  if (!container) return;
  container.innerHTML = watchSymbols.map(s => `
    <div class="mw-row" onclick="selectSymbol('${s}')">
      <span class="mw-sym">${s}</span>
      <div class="mw-prices">
        <span class="mw-bid" id="mwb-${s}">—</span>
        <span class="mw-ask" id="mwa-${s}">—</span>
      </div>
    </div>
  `).join('');
}

function selectSymbol(sym) {
  const el = document.getElementById('tradeSymbol');
  if (el) { el.value = sym; onSymbolChange(); showPage('trade'); }
}

// ===== WEBSOCKET =====
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'prices') handlePrices(msg.data);
    if (msg.type === 'trade_closed') handleTradeClosed(msg.data);
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}

function handlePrices(prices) {
  livePrices = { ...livePrices, ...prices };

  // Topbar
  ['EURUSD','GBPUSD','XAUUSD','BTCUSD'].forEach(sym => {
    if (prices[sym]) {
      const el = document.getElementById('tp-' + sym);
      if (el) {
        const p = prices[sym];
        el.textContent = sym === 'BTCUSD' ? '$' + p.bid.toFixed(0) : p.bid.toFixed(p.digits || 5);
      }
    }
  });

  // Market watch
  watchSymbols.forEach(sym => {
    if (prices[sym]) {
      const pb = document.getElementById('mwb-' + sym);
      const pa = document.getElementById('mwa-' + sym);
      const d = prices[sym].digits || 5;
      if (pb) pb.textContent = prices[sym].bid.toFixed(d);
      if (pa) pa.textContent = prices[sym].ask.toFixed(d);
    }
  });

  // Trade form
  const sym = document.getElementById('tradeSymbol')?.value;
  if (sym && prices[sym]) {
    const p = prices[sym];
    const d = p.digits || 5;
    setVal('pdBid', p.bid.toFixed(d));
    setVal('pdAsk', p.ask.toFixed(d));
    setVal('pdSpread', p.spread?.toFixed(1) || '—');
    setVal('sellBtnPrice', p.bid.toFixed(d));
    setVal('buyBtnPrice', p.ask.toFixed(d));
    calcMargin();
  }

  // Update open trade P&L
  let totalPnl = 0;
  openTrades = openTrades.map(t => {
    if (prices[t.symbol]) {
      const p = prices[t.symbol];
      const cur = t.type === 'buy' ? p.bid : p.ask;
      const profit = calcPnl(t.symbol, t.type, t.volume, t.open_price, cur);
      totalPnl += profit;
      return { ...t, current_price: cur, profit };
    }
    return t;
  });

  // Update P&L display
  const pnlEl = document.getElementById('mPnl');
  if (pnlEl) { pnlEl.textContent = fmt(totalPnl); pnlEl.style.color = totalPnl >= 0 ? 'var(--teal)' : 'var(--red)'; }

  const totalDisplay = document.getElementById('totalPnlDisplay');
  if (totalDisplay) { totalDisplay.textContent = fmt(totalPnl); totalDisplay.className = 'pnl-val ' + (totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'); }

  // Refresh position rows (P&L only)
  openTrades.forEach(t => {
    const row = document.querySelector(`[data-trade-id="${t.id}"]`);
    if (row) {
      const pnlCell = row.querySelector('.trade-pnl');
      if (pnlCell) { pnlCell.textContent = fmt(t.profit); pnlCell.className = 'trade-pnl ' + (t.profit >= 0 ? 'pnl-pos' : 'pnl-neg'); }
    }
  });

  updateEquityChart();
}

function handleTradeClosed(data) {
  openTrades = openTrades.filter(t => t.id !== data.trade_id);
  loadDashboard(); // Reload to get updated balance
}

function calcPnl(symbol, type, volume, openPrice, currentPrice) {
  const data = livePrices[symbol];
  if (!data) return 0;
  const priceDiff = type === 'buy' ? currentPrice - openPrice : openPrice - currentPrice;
  const contractSizes = {
    'XAUUSD': 100, 'XAGUSD': 5000, 'BTCUSD': 1, 'ETHUSD': 1,
    'USOUSD': 1000, 'US30': 1, 'US500': 1, 'NAS100': 1, 'GER40': 1,
  };
  const contract = contractSizes[symbol] || 100000;
  return parseFloat((priceDiff * contract * volume).toFixed(2));
}

// ===== REFRESH POSITIONS =====
async function refreshOpenTrades() {
  try {
    const res = await fetch(`${API}/trades/open`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      openTrades = data;
      renderPositions();
      renderMiniTrades();
    }
  } catch (_) {}
}

// ===== TRADE ACTIONS =====
function onSymbolChange() {
  const sym = document.getElementById('tradeSymbol')?.value;
  if (sym && livePrices[sym]) {
    const p = livePrices[sym];
    const d = p.digits || 5;
    setVal('pdBid', p.bid.toFixed(d));
    setVal('pdAsk', p.ask.toFixed(d));
    setVal('pdSpread', p.spread?.toFixed(1) || '—');
    setVal('sellBtnPrice', p.bid.toFixed(d));
    setVal('buyBtnPrice', p.ask.toFixed(d));
  }
  calcMargin();
}

function calcMargin() {
  const sym = document.getElementById('tradeSymbol')?.value;
  const vol = parseFloat(document.getElementById('tradeVolume')?.value) || 0;
  if (!sym || !vol || !livePrices[sym]) { setVal('tradeMargin', '—'); return; }
  const p = livePrices[sym].ask;
  const contractSizes = { 'XAUUSD': 100, 'XAGUSD': 5000, 'BTCUSD': 1, 'ETHUSD': 1, 'USOUSD': 1000, 'US30': 1, 'US500': 1, 'NAS100': 1, 'GER40': 1 };
  const contract = contractSizes[sym] || 100000;
  const leverage = userData?.leverage || 100;
  const margin = (p * contract * vol) / leverage;
  setVal('tradeMargin', '$' + margin.toFixed(2));
}

document.getElementById('tradeVolume')?.addEventListener('input', calcMargin);

async function placeTrade(type) {
  const symbol = document.getElementById('tradeSymbol')?.value;
  const volume = parseFloat(document.getElementById('tradeVolume')?.value);
  const stop_loss = parseFloat(document.getElementById('tradeSL')?.value) || 0;
  const take_profit = parseFloat(document.getElementById('tradeTP')?.value) || 0;
  const comment = document.getElementById('tradeComment')?.value;

  const msgEl = document.getElementById('tradeMsg');
  msgEl.style.display = 'none';

  try {
    const res = await fetch(`${API}/trades/open`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ symbol, type, volume, stop_loss, take_profit, comment })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showTradeMsg('success', `✅ ${type.toUpperCase()} ${volume} ${symbol} @ ${data.open_price} — Ticket #${data.ticket}`);
    await loadDashboard();
  } catch (err) {
    showTradeMsg('error', '❌ ' + err.message);
  }
}

function showTradeMsg(type, text) {
  const el = document.getElementById('tradeMsg');
  if (!el) return;
  el.textContent = text; el.className = 'trade-message ' + type; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

async function closeTrade(tradeId, symbol) {
  if (!confirm(`Close ${symbol} position?`)) return;
  try {
    const res = await fetch(`${API}/trades/${tradeId}/close`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadDashboard();
    renderPositions();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ===== DEPOSIT / WITHDRAW =====
function setAmount(n) { const el = document.getElementById('depositAmount'); if (el) el.value = n; }

async function submitDeposit() {
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  const method = document.querySelector('input[name="pm"]:checked')?.value || 'Bank Transfer';
  const msgEl = document.getElementById('depositMsg');
  msgEl.style.display = 'none';

  if (!amount || amount < 100) { showMsg('depositMsg', 'error', 'Minimum deposit is $100'); return; }

  const btn = document.getElementById('depositBtn');
  btn.disabled = true; btn.textContent = 'Submitting...';
  try {
    const res = await fetch(`${API}/transactions/deposit`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ amount, method }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showMsg('depositMsg', 'success', `✅ ${data.message} Reference: ${data.reference}`);
    document.getElementById('depositAmount').value = '';
    await loadDashboard();
  } catch (err) {
    showMsg('depositMsg', 'error', '❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Deposit Request';
  }
}

async function submitWithdraw() {
  const amount = parseFloat(document.getElementById('withdrawAmount')?.value);
  const method = document.querySelector('input[name="wpm"]:checked')?.value || 'Bank Transfer';
  const notes = document.getElementById('withdrawNotes')?.value;

  if (!amount || amount < 50) { showMsg('withdrawMsg', 'error', 'Minimum withdrawal is $50'); return; }

  const btn = document.getElementById('withdrawBtn');
  btn.disabled = true; btn.textContent = 'Submitting...';
  try {
    const res = await fetch(`${API}/transactions/withdraw`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ amount, method, notes }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showMsg('withdrawMsg', 'success', `✅ ${data.message} Reference: ${data.reference}`);
    document.getElementById('withdrawAmount').value = '';
    await loadDashboard();
  } catch (err) {
    showMsg('withdrawMsg', 'error', '❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Withdrawal';
  }
}

// ===== KYC =====
async function uploadKYC() {
  const file = document.getElementById('kycFile')?.files[0];
  const type = document.getElementById('kycDocType')?.value;
  if (!file) return;

  const formData = new FormData();
  formData.append('document', file);
  formData.append('type', type);

  try {
    const res = await fetch(`${API}/kyc/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showMsg('kycMsg', 'success', '✅ ' + data.message);
    document.getElementById('kycFile').value = '';
    await loadDashboard();
  } catch (err) {
    showMsg('kycMsg', 'error', '❌ ' + err.message);
  }
}

// Upload zone drag & drop
const uploadZone = document.getElementById('uploadZone');
if (uploadZone) {
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--blue)'; });
  uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
  uploadZone.addEventListener('drop', e => {
    e.preventDefault(); uploadZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) { document.getElementById('kycFile').files = e.dataTransfer.files; uploadKYC(); }
  });
}

// ===== PROFILE =====
async function saveProfile() {
  const payload = {
    first_name: document.getElementById('setFirstName')?.value,
    last_name: document.getElementById('setLastName')?.value,
    phone: document.getElementById('setPhone')?.value,
    address: document.getElementById('setAddress')?.value,
    city: document.getElementById('setCity')?.value,
  };
  try {
    const res = await fetch(`${API}/profile`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showMsg('settingsMsg', 'success', '✅ Profile updated successfully');
  } catch (err) {
    showMsg('settingsMsg', 'error', '❌ ' + err.message);
  }
}

// ===== NAVIGATION =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');
  closeSidebar();
}

document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

// Sidebar mobile
document.getElementById('sidebarToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').style.display = 'block';
});
document.getElementById('sidebarClose')?.addEventListener('click', closeSidebar);
document.getElementById('overlay')?.addEventListener('click', closeSidebar);
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('overlay').style.display = 'none';
}

// Notifications
document.getElementById('notifBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('notifPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('markReadBtn')?.addEventListener('click', async () => {
  await fetch(`${API}/notifications/read`, { method: 'PUT', headers: authHeaders() });
  document.getElementById('notifBadge').style.display = 'none';
  document.getElementById('notifPanel').style.display = 'none';
});

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/login';
});

// ===== HELPERS =====
function setVal(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function fmt(n) { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function showMsg(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text; el.className = 'trade-message ' + type; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 6000);
}

// ===== START =====
init();
