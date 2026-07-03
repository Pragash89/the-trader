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

  // Overlay live MT5 data on top of stored values
  loadMT5Account();
}

async function loadMT5Account() {
  try {
    const res = await fetch('/api/mt5/account', { headers: authHeaders() });
    if (!res.ok) return;
    const mt5 = await res.json();
    const badge = document.getElementById('mt5LiveBadge');

    if (mt5.live) {
      // Full live data from MetaAPI — override all overview metrics
      setElTxt('metricBalance',    '$' + fmt2(mt5.balance));
      setElTxt('metricEquity',     '$' + fmt2(mt5.equity));
      setElTxt('metricMargin',     '$' + fmt2(mt5.margin));
      setElTxt('metricFreeMargin', '$' + fmt2(mt5.freeMargin));
      if (mt5.login) { const el = document.getElementById('accNum'); if (el) el.textContent = `MT5: ${mt5.login}`; }
      if (mt5.positions && mt5.positions.length > 0) {
        openTrades = mt5.positions.map(p => ({
          _id: p.id, symbol: p.symbol, type: p.type, volume: p.volume,
          open_price: p.openPrice, current_price: p.currentPrice, profit: p.profit,
          swap: p.swap || 0, stop_loss: p.stopLoss || 0, take_profit: p.takeProfit || 0,
          open_time: p.openTime, live: true,
        }));
        renderPositions();
        renderMiniTrades();
      }
      if (badge) { badge.style.display = 'inline-flex'; badge.textContent = `● LIVE · MT5 ${mt5.server || ''}`; }

    } else if (mt5.linked && mt5.mt5_login) {
      // Account linked but pending admin verification — show pending badge
      if (badge) { badge.style.display = 'inline-flex'; badge.style.background = '#92400e'; badge.textContent = `⏳ MT5 ${mt5.mt5_login} · Pending Verification`; }
      // Clear demo balance from overview so it's not misleading
      setElTxt('metricBalance',    '$0.00');
      setElTxt('metricEquity',     '$0.00');
      setElTxt('metricFreeMargin', '$0.00');
      const el = document.getElementById('accNum');
      if (el) el.textContent = `MT5: ${mt5.mt5_login}`;
    }
  } catch (e) { /* silent */ }
}

function fmt2(n) { return (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function setElTxt(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ===== MT5 ACCOUNT PAGE =====
function showMT5Page() {
  fetch('/api/mt5/account', { headers: authHeaders() })
    .then(r => r.json())
    .then(mt5 => {
      if (mt5.live) {
        // Full live data from MetaAPI
        document.getElementById('mt5-options-panel').style.display = 'none';
        document.getElementById('mt5-connected-panel').style.display = 'block';
        setElTxt('mt5-conn-login',    mt5.login || '—');
        setElTxt('mt5-conn-name',     mt5.name  || '—');
        setElTxt('mt5-conn-balance',  '$' + fmt2(mt5.balance));
        setElTxt('mt5-conn-equity',   '$' + fmt2(mt5.equity));
        setElTxt('mt5-conn-leverage', '1:' + (mt5.leverage || 100));
        setElTxt('mt5-conn-currency', mt5.currency || 'USD');
        if (mt5.server) setElTxt('mt5-conn-server', '● Connected to ' + mt5.server);
      } else if (mt5.linked && mt5.mt5_login) {
        // User submitted their MT5 login — pending admin verification
        document.getElementById('mt5-options-panel').style.display = 'none';
        document.getElementById('mt5-connected-panel').style.display = 'block';
        setElTxt('mt5-conn-login',    mt5.mt5_login);
        setElTxt('mt5-conn-name',     'Pending verification');
        setElTxt('mt5-conn-balance',  '$' + fmt2(mt5.balance));
        setElTxt('mt5-conn-equity',   '$' + fmt2(mt5.equity));
        setElTxt('mt5-conn-leverage', '1:' + (mt5.leverage || 100));
        setElTxt('mt5-conn-currency', 'USD');
        setElTxt('mt5-conn-server', '⏳ Account submitted — admin will verify within 24h');
      } else {
        document.getElementById('mt5-options-panel').style.display = 'block';
        document.getElementById('mt5-connected-panel').style.display = 'none';
      }
    }).catch(() => {
      document.getElementById('mt5-options-panel').style.display = 'block';
      document.getElementById('mt5-connected-panel').style.display = 'none';
    });
}

async function connectMT5Account() {
  const login = document.getElementById('mt5LoginNum')?.value.trim();
  const password = document.getElementById('mt5LoginPass')?.value.trim();
  const msgEl = document.getElementById('mt5ConnectMsg');
  if (!login || !password) {
    showMT5Msg('mt5ConnectMsg', 'error', 'Please enter your MT5 login number and password.');
    return;
  }
  showMT5Msg('mt5ConnectMsg', 'info', 'Verifying your MT5 account...');
  try {
    const res = await fetch('/api/mt5/connect', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ mt5_login: login, mt5_password: password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection failed');
    showMT5Msg('mt5ConnectMsg', 'success', '✅ MT5 account connected! Refreshing...');
    setTimeout(() => showMT5Page(), 1500);
  } catch (err) {
    showMT5Msg('mt5ConnectMsg', 'error', '❌ ' + err.message);
  }
}

async function requestMT5Account() {
  const type  = document.getElementById('newAccType')?.value;
  const notes = document.getElementById('newAccNotes')?.value || '';
  showMT5Msg('mt5OpenMsg', 'info', 'Submitting your request...');
  try {
    const res = await fetch('/api/mt5/request', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ account_type: type, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    showMT5Msg('mt5OpenMsg', 'success', '✅ Account request submitted! Our team will open your MT5 account within 24 hours and email your login credentials.');
    document.getElementById('newAccNotes').value = '';
  } catch (err) {
    showMT5Msg('mt5OpenMsg', 'error', '❌ ' + err.message);
  }
}

function showMT5Msg(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  el.style.color = type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#2563eb';
  el.style.background = type === 'success' ? '#f0fdf4' : type === 'error' ? '#fef2f2' : '#eff6ff';
  el.style.border = `1px solid ${type === 'success' ? '#6ee7b7' : type === 'error' ? '#fca5a5' : '#bfdbfe'}`;
  el.textContent = text;
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

// ===== DEPOSIT =====
const PROMO_CODES = ['T2026T157','T2026T237','T2026T315','T2026T447','T2026T492','T2026T561','T2026T657','T2026T781'];
let promoApplied = false;
let selectedDepMethod = null;
let selectedDepLabel = null;

function setAmount(n) { const el = document.getElementById('depositAmount'); if (el) el.value = n; }

function onMethodSelect(method, label) {
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  const errEl = document.getElementById('dep-step1-err');
  if (!amount || amount < 100) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Please enter a valid amount (minimum $100) before selecting a payment method.'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  selectedDepMethod = method;
  selectedDepLabel = label;
  promoApplied = false;
  document.getElementById('dep-step1').style.display = 'none';
  document.getElementById('dep-step2').style.display = 'block';
  document.getElementById('dep-step3').style.display = 'none';
  const ml = document.getElementById('dep-gate-method-label');
  if (ml) ml.textContent = label;
  const pc = document.getElementById('promoCode');
  if (pc) pc.value = '';
  const msg = document.getElementById('promoMsg');
  if (msg) msg.style.display = 'none';
}

function backToStep1() {
  document.getElementById('dep-step1').style.display = 'block';
  document.getElementById('dep-step2').style.display = 'none';
  document.getElementById('dep-step3').style.display = 'none';
  promoApplied = false;
  selectedDepMethod = null;
  document.querySelectorAll('input[name="pm"]').forEach(r => r.checked = false);
}

function applyPromoGate() {
  const code = document.getElementById('promoCode')?.value.trim().toUpperCase();
  const msg = document.getElementById('promoMsg');
  if (!msg) return;
  if (PROMO_CODES.includes(code)) {
    promoApplied = true;
    msg.style.display = 'block';
    msg.style.color = '#059669';
    msg.textContent = '✅ Promo code verified! Loading payment details...';
    setTimeout(() => {
      document.getElementById('dep-step2').style.display = 'none';
      document.getElementById('dep-step3').style.display = 'block';
      const lbl = document.getElementById('dep-step3-label');
      if (lbl) lbl.textContent = selectedDepLabel;
      ['dep-bank','dep-card','dep-crypto','dep-upi'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const panel = document.getElementById('dep-' + selectedDepMethod);
      if (panel) panel.style.display = 'block';
    }, 600);
  } else {
    promoApplied = false;
    msg.style.display = 'block';
    msg.style.color = '#dc2626';
    msg.textContent = '❌ Invalid promo code. Please speak to an Account Manager to receive your personalised code.';
  }
}

// Card number formatter & error
function formatCardNum(el) {
  let v = el.value.replace(/\D/g,'').substring(0,16);
  el.value = v.replace(/(.{4})/g,'$1 ').trim();
  const icon = document.getElementById('cardTypeIcon');
  if (icon) { if (v[0]==='4') icon.textContent='💳'; else if (v[0]==='5') icon.textContent='💳'; else if (v.startsWith('37')||v.startsWith('34')) icon.textContent='💳'; else icon.textContent='💳'; }
}
function checkCard() {
  const val = document.getElementById('cardNumber')?.value.replace(/\s/g,'') || '';
  const errEl = document.getElementById('cardError');
  if (errEl && val.length >= 4) { errEl.style.display = 'block'; }
}
function formatExpiry(el) {
  let v = el.value.replace(/\D/g,'');
  if (v.length >= 2) v = v.substring(0,2) + ' / ' + v.substring(2,4);
  el.value = v;
}

// Crypto wallets — ⚠️ REPLACE THESE WITH YOUR ACTUAL WALLET ADDRESSES
const WALLETS = {
  btc: { label: 'Bitcoin (BTC) Wallet Address', addr: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', warn: '⚠️ Send only BTC to this address. Wrong network = permanent loss.' },
  eth: { label: 'Ethereum (ETH) Wallet Address — ERC-20', addr: '0x742d35Cc6634C0532925a3b8f4C9E2a4a7F8D3b', warn: '⚠️ Send only ETH (ERC-20) to this address.' },
  usdt_trc20: { label: 'USDT Wallet — TRC-20 (Tron)', addr: 'TQn9Y2khddWmXvAQmSEV4gECe8LpyCMT5g', warn: '⚠️ Send only USDT on TRC-20 network. Do NOT send ERC-20 here.' },
  usdt_erc20: { label: 'USDT Wallet — ERC-20 (Ethereum)', addr: '0x742d35Cc6634C0532925a3b8f4C9E2a4a7F8D3b', warn: '⚠️ Send only USDT on ERC-20 network. Do NOT send TRC-20 here.' },
  usdt_bep20: { label: 'USDT Wallet — BEP-20 (BSC)', addr: '0x9F8cCb27D4B451eAf3A3e09d4CD43EC2Ba98eE7', warn: '⚠️ Send only USDT on BEP-20 (Binance Smart Chain) network.' },
  bnb: { label: 'BNB Wallet Address — BEP-20', addr: '0x9F8cCb27D4B451eAf3A3e09d4CD43EC2Ba98eE7', warn: '⚠️ Send only BNB on BEP-20 network.' },
  ltc: { label: 'Litecoin (LTC) Wallet Address', addr: 'ltc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6ed', warn: '⚠️ Send only LTC to this address.' },
  xrp: { label: 'Ripple (XRP) Wallet Address', addr: 'rN7n3473SaZBCG4dFL80SoFBpSCMgpf5HN', warn: '⚠️ XRP Destination Tag: 1234567. Include tag or funds may be lost.' },
};

function selectCoin(coin, el) {
  document.querySelectorAll('.crypto-opt').forEach(o => o.classList.remove('active'));
  if (el) el.classList.add('active');
  const w = WALLETS[coin];
  if (!w) return;
  document.getElementById('walletLabel').textContent = w.label;
  document.getElementById('walletAddr').textContent = w.addr;
  document.getElementById('walletWarn').textContent = w.warn;
}

function copyWallet() {
  const addr = document.getElementById('walletAddr')?.textContent;
  if (addr) { navigator.clipboard.writeText(addr).then(() => { const btn = document.querySelector('.copy-btn'); if(btn){btn.textContent='✅ Copied!'; setTimeout(()=>btn.textContent='📋 Copy Address',2000); } }); }
}

// UPI
const UPI_IDS = { phonepe:'thetrader@ybl', gpay:'thetrader@oksbi', paytm:'thetrader@paytm', amazon:'thetrader@apl', bhim:'thetrader@upi', cred:'thetrader@axl', airtel:'thetrader@airtelp', mobikwik:'thetrader@mbk' };
function selectUPI(svc, el) {
  document.querySelectorAll('.upi-opt').forEach(o => o.classList.remove('active'));
  if (el) el.classList.add('active');
  const id = UPI_IDS[svc] || 'thetrader@ybl';
  const el2 = document.getElementById('upiAddr');
  if (el2) el2.textContent = id;
}

function copyText(text, badgeId) {
  navigator.clipboard.writeText(text).then(() => {
    const el = document.getElementById(badgeId);
    if (el) { el.textContent = '✓ Copied'; setTimeout(() => el.textContent = 'Copy', 2000); }
  });
}


async function submitDeposit() {
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  const method = selectedDepLabel || 'Bank Transfer';
  const msgEl = document.getElementById('depositMsg');
  if (msgEl) msgEl.style.display = 'none';
  if (!amount || amount < 100) { showMsg('depositMsg', 'error', 'Minimum deposit is $100'); return; }

  const btn = document.getElementById('depositBtn');
  btn.disabled = true; btn.textContent = 'Processing...';
  try {
    const body = { amount, method };
    if (promoApplied) body.promo = document.getElementById('promoCode')?.value.trim().toUpperCase();
    const res = await fetch(`${API}/transactions/deposit`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showMsg('depositMsg', 'success', `✅ Deposit request submitted! Reference: ${data.reference}. Our team will confirm within 24h.`);
    document.getElementById('depositAmount').value = '';
    await loadDashboard();
  } catch (err) {
    showMsg('depositMsg', 'error', '❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Deposit';
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
  if (page === 'mt5') showMT5Page();
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
