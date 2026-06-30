// Admin Panel JS

const API = '/api/admin';
let adminToken = localStorage.getItem('tt_admin_token');
let adminData = null;
let depChart = null;

// Check auth on load
if (adminToken) {
  document.getElementById('adminLoginScreen').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
  initAdmin();
} else {
  document.getElementById('adminLoginScreen').style.display = 'flex';
  document.getElementById('adminApp').style.display = 'none';
}

function adminHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken };
}

async function adminLogin() {
  const email = document.getElementById('adminEmail').value;
  const password = document.getElementById('adminPassword').value;
  const errorEl = document.getElementById('adminLoginError');
  const btn = document.getElementById('adminLoginBtn');

  btn.disabled = true; btn.textContent = 'Signing in...'; errorEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    adminToken = data.token;
    adminData = data.admin;
    localStorage.setItem('tt_admin_token', adminToken);
    document.getElementById('adminLoginScreen').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    initAdmin();
  } catch (err) {
    errorEl.textContent = err.message; errorEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

async function initAdmin() {
  try {
    // Set admin info
    const stored = JSON.parse(localStorage.getItem('tt_admin_token') ? '{}' : '{}');
    await loadAdminData();

    // Decode token to get name
    const parts = adminToken.split('.');
    if (parts[1]) {
      const payload = JSON.parse(atob(parts[1]));
      const initials = payload.name ? payload.name.split(' ').map(w=>w[0]).join('').toUpperCase() : 'A';
      ['adminAvatar','adminChipAvatar'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = initials; });
      setVal('adminName', payload.name || 'Admin');
      setVal('adminRole', payload.role || 'admin');
      setVal('adminChipName', payload.name?.split(' ')[0] || 'Admin');
    }

    // Nav listeners
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        showPage(btn.dataset.page);
        if (btn.dataset.page === 'deposits') loadDeposits();
        if (btn.dataset.page === 'withdrawals') loadWithdrawals();
        if (btn.dataset.page === 'kyc') loadKyc();
        if (btn.dataset.page === 'clients') searchClients();
        if (btn.dataset.page === 'trades') loadTrades();
        if (btn.dataset.page === 'reports') loadReports();
      });
    });

    document.getElementById('adminLogout')?.addEventListener('click', () => {
      localStorage.removeItem('tt_admin_token');
      location.reload();
    });

  } catch (err) {
    if (err.status === 401) { localStorage.removeItem('tt_admin_token'); location.reload(); }
    console.error(err);
  }
}

async function loadAdminData() {
  const res = await fetch(`${API}/dashboard`, { headers: adminHeaders() });
  if (!res.ok) throw { status: res.status };
  const data = await res.json();
  const s = data.stats;

  setVal('statTotal', s.total_clients);
  setVal('statActive', s.active_clients);
  setVal('statKyc', s.pending_kyc);
  setVal('statTrades', s.open_trades);
  setVal('statDeposited', '$' + (s.total_deposited || 0).toLocaleString('en-US', {maximumFractionDigits:0}));
  setVal('statWithdrawn', '$' + (s.total_withdrawn || 0).toLocaleString('en-US', {maximumFractionDigits:0}));
  setVal('statPendDep', s.pending_deposits.count);
  setVal('statPendDepAmt', '$' + (s.pending_deposits.total || 0).toFixed(2));
  setVal('statPendWit', s.pending_withdrawals.count);
  setVal('statPendWitAmt', '$' + (s.pending_withdrawals.total || 0).toFixed(2));
  setVal('depositCount', s.pending_deposits.count || '');
  setVal('withdrawCount', s.pending_withdrawals.count || '');
  setVal('kycCount', s.pending_kyc || '');

  // Recent clients
  const rc = document.getElementById('recentClientsList');
  if (rc) {
    rc.innerHTML = (data.recent_clients || []).map(c => `
      <div class="rc-row">
        <div class="rc-avatar">${(c.first_name[0]+c.last_name[0]).toUpperCase()}</div>
        <div><div class="rc-name">${c.first_name} ${c.last_name}</div><div class="rc-email">${c.email}</div></div>
        <span class="status-badge ${c.kyc_status}">${c.kyc_status}</span>
        <div class="rc-balance">$${(c.balance||0).toFixed(2)}</div>
        <button class="btn-view" onclick="viewClient('${c.id}')">View</button>
      </div>
    `).join('') || '<div class="empty-state">No clients yet</div>';
  }

  // Pending actions
  const pa = document.getElementById('pendingActionsList');
  if (pa) {
    const items = [];
    if (s.pending_deposits.count) items.push(`<div class="pa-row"><div class="pa-icon dep">💰</div><span>${s.pending_deposits.count} deposit(s) pending approval — $${(s.pending_deposits.total||0).toFixed(2)}</span><button class="pa-btn" onclick="showPage('deposits');loadDeposits()">Review</button></div>`);
    if (s.pending_withdrawals.count) items.push(`<div class="pa-row"><div class="pa-icon wit">💸</div><span>${s.pending_withdrawals.count} withdrawal(s) pending — $${(s.pending_withdrawals.total||0).toFixed(2)}</span><button class="pa-btn" onclick="showPage('withdrawals');loadWithdrawals()">Review</button></div>`);
    if (s.pending_kyc) items.push(`<div class="pa-row"><div class="pa-icon kyc">🪪</div><span>${s.pending_kyc} KYC document(s) need review</span><button class="pa-btn" onclick="showPage('kyc');loadKyc()">Review</button></div>`);
    pa.innerHTML = items.join('') || '<div class="empty-state">No pending actions — all clear! ✅</div>';
  }
}

// ===== CLIENTS =====
let searchTimeout;
function searchClients() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(doSearchClients, 400);
}

async function doSearchClients() {
  const search = document.getElementById('clientSearch')?.value || '';
  const kyc = document.getElementById('kycFilter')?.value || '';
  const status = document.getElementById('statusFilter')?.value || '';

  const params = new URLSearchParams({ search, kyc, status, limit: 100 });
  const res = await fetch(`${API}/clients?${params}`, { headers: adminHeaders() });
  const data = await res.json();
  setVal('clientCount', data.total || 0);

  const body = document.getElementById('clientsBody');
  if (!body) return;
  if (!data.clients?.length) { body.innerHTML = '<tr><td colspan="9" class="empty-state">No clients found</td></tr>'; return; }

  body.innerHTML = data.clients.map(c => `<tr>
    <td><code style="font-size:11px">${c.account_number}</code></td>
    <td><strong>${c.first_name} ${c.last_name}</strong></td>
    <td style="color:var(--text2)">${c.email}</td>
    <td>${c.country || '—'}</td>
    <td style="color:var(--teal);font-weight:700">$${(c.balance||0).toFixed(2)}</td>
    <td><span class="status-badge ${c.kyc_status}">${c.kyc_status}</span></td>
    <td><span class="status-badge ${c.account_status}">${c.account_status}</span></td>
    <td style="color:var(--text3);font-size:12px">${fmtDate(c.created_at)}</td>
    <td>
      <button class="btn-view" onclick="viewClient('${c.id}')">View</button>
      ${c.account_status === 'active'
        ? `<button class="btn-suspend" onclick="updateClient('${c.id}', {account_status:'suspended'})">Suspend</button>`
        : `<button class="btn-activate" onclick="updateClient('${c.id}', {account_status:'active'})">Activate</button>`}
    </td>
  </tr>`).join('');
}

async function viewClient(id) {
  const res = await fetch(`${API}/clients/${id}`, { headers: adminHeaders() });
  const data = await res.json();
  const u = data.user;

  document.getElementById('modalTitle').textContent = `${u.first_name} ${u.last_name} — ${u.account_number}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="modal-section">
      <h4>Account Info</h4>
      <div class="modal-detail-grid">
        <div class="modal-detail"><div class="mdl">Email</div><div class="mdv">${u.email}</div></div>
        <div class="modal-detail"><div class="mdl">Phone</div><div class="mdv">${u.phone||'—'}</div></div>
        <div class="modal-detail"><div class="mdl">Country</div><div class="mdv">${u.country||'—'}</div></div>
        <div class="modal-detail"><div class="mdl">Leverage</div><div class="mdv">1:${u.leverage||100}</div></div>
        <div class="modal-detail"><div class="mdl">Balance</div><div class="mdv" style="color:var(--teal)">$${(u.balance||0).toFixed(2)}</div></div>
        <div class="modal-detail"><div class="mdl">KYC Status</div><div class="mdv"><span class="status-badge ${u.kyc_status}">${u.kyc_status}</span></div></div>
        <div class="modal-detail"><div class="mdl">Account Status</div><div class="mdv"><span class="status-badge ${u.account_status}">${u.account_status}</span></div></div>
        <div class="modal-detail"><div class="mdl">Member Since</div><div class="mdv">${fmtDate(u.created_at)}</div></div>
      </div>
    </div>
    <div class="modal-section">
      <h4>Quick Actions</h4>
      <div class="modal-action-row">
        <select id="kycAction"><option value="approved">Approve KYC</option><option value="under_review">Set Under Review</option><option value="rejected">Reject KYC</option></select>
        <button class="btn-approve" onclick="updateClient('${u.id}', {kyc_status: document.getElementById('kycAction').value});closeModal()">Set KYC</button>
      </div>
      <div class="modal-action-row">
        <input type="number" id="adjAmount" placeholder="Amount USD" min="0">
        <select id="adjType"><option value="credit">Credit (Add)</option><option value="debit">Debit (Remove)</option></select>
        <input type="text" id="adjNote" placeholder="Reason / note">
        <button class="btn-approve" onclick="adjustBalance('${u.id}')">Adjust Balance</button>
      </div>
      <div class="modal-action-row">
        <button class="${u.account_status==='active'?'btn-reject':'btn-approve'}" onclick="updateClient('${u.id}', {account_status:'${u.account_status==='active'?'suspended':'active'}'});closeModal()">
          ${u.account_status==='active'?'Suspend Account':'Activate Account'}
        </button>
      </div>
    </div>
    <div class="modal-section">
      <h4>Open Trades (${data.trades?.filter(t=>t.status==='open').length||0})</h4>
      ${data.trades?.filter(t=>t.status==='open').length ? `
        <table class="data-table">
          <thead><tr><th>Symbol</th><th>Type</th><th>Vol</th><th>Open</th><th>Time</th></tr></thead>
          <tbody>${data.trades.filter(t=>t.status==='open').map(t=>`
            <tr><td>${t.symbol}</td><td><span class="type-badge ${t.type}">${t.type.toUpperCase()}</span></td><td>${t.volume}</td><td>${t.open_price}</td><td>${fmtDate(t.open_time)}</td></tr>
          `).join('')}</tbody>
        </table>` : '<div class="empty-state">No open trades</div>'}
    </div>
    <div class="modal-section">
      <h4>Recent Transactions</h4>
      ${data.transactions?.length ? data.transactions.slice(0,5).map(t=>`
        <div class="txn-row"><div>${t.type} — $${t.amount.toFixed(2)}</div><span class="status-badge ${t.status}">${t.status}</span><span style="font-size:11px;color:var(--text3)">${fmtDate(t.created_at)}</span></div>
      `).join('') : '<div class="empty-state">No transactions</div>'}
    </div>
  `;
  document.getElementById('clientModal').style.display = 'flex';
}

async function updateClient(id, fields) {
  try {
    const res = await fetch(`${API}/clients/${id}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(fields) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadAdminData();
    doSearchClients();
    alert('✅ ' + data.message);
  } catch (err) { alert('Error: ' + err.message); }
}

async function adjustBalance(id) {
  const amount = parseFloat(document.getElementById('adjAmount')?.value);
  const type = document.getElementById('adjType')?.value;
  const notes = document.getElementById('adjNote')?.value;
  if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }

  try {
    const res = await fetch(`${API}/clients/${id}/adjust-balance`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ amount, type, notes }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`✅ Balance adjusted. New balance: $${data.new_balance.toFixed(2)}`);
    closeModal();
    await loadAdminData();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== DEPOSITS =====
async function loadDeposits() {
  const status = document.getElementById('depStatusFilter')?.value || 'pending';
  const params = new URLSearchParams({ type: 'deposit', status, limit: 100 });
  const res = await fetch(`${API}/transactions?${params}`, { headers: adminHeaders() });
  const data = await res.json();

  const body = document.getElementById('depositsBody');
  if (!body) return;
  if (!data.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">No deposits found</td></tr>'; return; }

  body.innerHTML = data.map(t => `<tr>
    <td><code style="font-size:11px">${t.reference}</code></td>
    <td><strong>${t.first_name} ${t.last_name}</strong><br><span style="font-size:11px;color:var(--text3)">${t.email}</span></td>
    <td style="color:var(--teal);font-weight:700">$${t.amount.toFixed(2)}</td>
    <td>${t.method||'—'}</td>
    <td><span class="status-badge ${t.status}">${t.status}</span></td>
    <td style="font-size:12px;color:var(--text3)">${fmtDate(t.created_at)}</td>
    <td>
      ${t.status === 'pending' ? `
        <button class="btn-approve" onclick="processTransaction('${t.id}','approved')">✓ Approve</button>
        <button class="btn-reject" onclick="processTransaction('${t.id}','rejected')">✗ Reject</button>
      ` : '<span style="color:var(--text3);font-size:12px">Processed</span>'}
    </td>
  </tr>`).join('');
}

// ===== WITHDRAWALS =====
async function loadWithdrawals() {
  const status = document.getElementById('witStatusFilter')?.value || 'pending';
  const params = new URLSearchParams({ type: 'withdrawal', status, limit: 100 });
  const res = await fetch(`${API}/transactions?${params}`, { headers: adminHeaders() });
  const data = await res.json();

  const body = document.getElementById('withdrawalsBody');
  if (!body) return;
  if (!data.length) { body.innerHTML = '<tr><td colspan="8" class="empty-state">No withdrawals found</td></tr>'; return; }

  body.innerHTML = data.map(t => `<tr>
    <td><code style="font-size:11px">${t.reference}</code></td>
    <td><strong>${t.first_name} ${t.last_name}</strong><br><span style="font-size:11px;color:var(--text3)">${t.email}</span></td>
    <td style="color:var(--red);font-weight:700">$${t.amount.toFixed(2)}</td>
    <td>${t.method||'—'}</td>
    <td style="max-width:150px;font-size:12px;color:var(--text2)">${t.notes||'—'}</td>
    <td><span class="status-badge ${t.status}">${t.status}</span></td>
    <td style="font-size:12px;color:var(--text3)">${fmtDate(t.created_at)}</td>
    <td>
      ${t.status === 'pending' ? `
        <button class="btn-approve" onclick="processTransaction('${t.id}','approved')">✓ Approve</button>
        <button class="btn-reject" onclick="processTransaction('${t.id}','rejected')">✗ Reject</button>
      ` : '<span style="color:var(--text3);font-size:12px">Processed</span>'}
    </td>
  </tr>`).join('');
}

async function processTransaction(id, status) {
  const notes = status === 'rejected' ? prompt('Rejection reason (optional):') || '' : '';
  try {
    const res = await fetch(`${API}/transactions/${id}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ status, admin_notes: notes }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadAdminData();
    loadDeposits(); loadWithdrawals();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== KYC =====
async function loadKyc() {
  const res = await fetch(`${API}/kyc`, { headers: adminHeaders() });
  const data = await res.json();

  const body = document.getElementById('kycBody');
  if (!body) return;
  if (!data.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">No pending KYC documents</td></tr>'; return; }

  body.innerHTML = data.map(d => `<tr>
    <td><strong>${d.first_name} ${d.last_name}</strong><br><span style="font-size:11px;color:var(--text3)">${d.email}</span></td>
    <td><code style="font-size:11px">${d.account_number}</code></td>
    <td style="text-transform:capitalize">${d.type?.replace(/_/g,' ')}</td>
    <td><a href="/uploads/${d.filename}" target="_blank" style="color:var(--blue);font-size:13px">📄 View Doc</a></td>
    <td style="font-size:12px;color:var(--text3)">${fmtDate(d.uploaded_at)}</td>
    <td><span class="status-badge ${d.status}">${d.status}</span></td>
    <td>
      <button class="btn-approve" onclick="reviewKyc('${d.id}','approved')">✓ Approve</button>
      <button class="btn-reject" onclick="reviewKyc('${d.id}','rejected')">✗ Reject</button>
    </td>
  </tr>`).join('');
}

async function reviewKyc(id, status) {
  const notes = status === 'rejected' ? prompt('Rejection reason:') || '' : '';
  try {
    const res = await fetch(`${API}/kyc/${id}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ status, notes }) });
    if (!res.ok) throw new Error((await res.json()).error);
    await loadKyc(); await loadAdminData();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== TRADES =====
async function loadTrades() {
  const res = await fetch(`${API}/trades?limit=100`, { headers: adminHeaders() });
  const data = await res.json();
  const body = document.getElementById('tradesBody');
  if (!body) return;
  if (!data.length) { body.innerHTML = '<tr><td colspan="9" class="empty-state">No open trades</td></tr>'; return; }

  body.innerHTML = data.filter(t=>t.status==='open').map(t => `<tr>
    <td>${t.ticket}</td>
    <td><strong>${t.first_name} ${t.last_name}</strong><br><span style="font-size:11px;color:var(--text3)">${t.account_number}</span></td>
    <td>${t.symbol}</td>
    <td><span class="type-badge ${t.type}">${t.type.toUpperCase()}</span></td>
    <td>${t.volume}</td>
    <td>${t.open_price}</td>
    <td>${t.stop_loss||'—'}</td>
    <td>${t.take_profit||'—'}</td>
    <td style="font-size:12px;color:var(--text3)">${fmtDate(t.open_time)}</td>
  </tr>`).join('') || '<tr><td colspan="9" class="empty-state">No open trades</td></tr>';
}

// ===== REPORTS =====
async function loadReports() {
  const res = await fetch(`${API}/reports/financial`, { headers: adminHeaders() });
  const data = await res.json();

  // Top clients
  const tc = document.getElementById('topClientsList');
  if (tc) {
    tc.innerHTML = (data.top_clients||[]).map((c,i) => `
      <div class="tc-row">
        <div class="tc-rank">${i+1}</div>
        <div class="tc-info"><div class="tc-name">${c.first_name} ${c.last_name}</div><div class="tc-acc">${c.account_number}</div></div>
        <div class="tc-bal">$${(c.balance||0).toFixed(2)}</div>
      </div>
    `).join('') || '<div class="empty-state">No data</div>';
  }

  // Deposit chart
  const ctx = document.getElementById('depChart');
  if (ctx && data.deposits?.length) {
    if (depChart) depChart.destroy();
    depChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.deposits.map(d => d.date).reverse(),
        datasets: [{ label: 'Deposits ($)', data: data.deposits.map(d=>d.total).reverse(), backgroundColor: 'rgba(0,212,170,0.5)', borderColor: '#00d4aa', borderWidth: 1, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#546a88', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#546a88', callback: v => '$'+v }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }
}

// ===== NAVIGATION =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (nav) nav.classList.add('active');
}

function closeModal() { document.getElementById('clientModal').style.display = 'none'; }

// ===== HELPERS =====
function setVal(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
