/**
 * MT5 Manager Integration via MetaAPI
 * Connects to Fxcentrum Real-Live server using manager credentials.
 * All trader account data (balance, equity, positions, history) comes from real MT5.
 */

const MetaApi = require('metaapi.cloud-sdk').default;

let api = null;
let managerAccount = null;
let metastats = null;

const METAAPI_TOKEN   = process.env.METAAPI_TOKEN;
const MT5_ACCOUNT_ID  = process.env.MT5_ACCOUNT_ID; // Manager account ID in MetaAPI dashboard

async function init() {
  if (!METAAPI_TOKEN || !MT5_ACCOUNT_ID) {
    console.warn('[MT5] METAAPI_TOKEN or MT5_ACCOUNT_ID not set — MT5 integration disabled');
    return false;
  }
  try {
    api = new MetaApi(METAAPI_TOKEN);
    metastats = api.metaStats;
    managerAccount = await api.metatraderAccountApi.getAccount(MT5_ACCOUNT_ID);

    if (!['DEPLOYED', 'DEPLOYING'].includes(managerAccount.state)) {
      await managerAccount.deploy();
    }
    await managerAccount.waitConnected();
    console.log('[MT5] Connected to Fxcentrum Real-Live via MetaAPI');
    return true;
  } catch (err) {
    console.error('[MT5] Init failed:', err.message);
    return false;
  }
}

// Get a streaming connection (reuse if open)
let _connection = null;
async function getConnection() {
  if (!managerAccount) throw new Error('MT5 not initialized');
  if (_connection) return _connection;
  _connection = managerAccount.getStreamingConnection();
  await _connection.connect();
  await _connection.waitSynchronized();
  return _connection;
}

/**
 * Get full account summary for a given MT5 login number.
 * Returns: { login, balance, equity, margin, freeMargin, leverage, currency }
 */
async function getAccountInfo(mt5Login) {
  try {
    const conn = await getConnection();
    const info = conn.terminalState.accountInformation;
    // For manager: info is the manager's own account.
    // For client accounts, use the MetaAPI management API below.
    return info;
  } catch (err) {
    console.error('[MT5] getAccountInfo error:', err.message);
    return null;
  }
}

/**
 * Get open positions for a MT5 login.
 * Returns array of position objects.
 */
async function getPositions(mt5Login) {
  try {
    const conn = await getConnection();
    return conn.terminalState.positions || [];
  } catch (err) {
    console.error('[MT5] getPositions error:', err.message);
    return [];
  }
}

/**
 * Get closed trade history for a MT5 login.
 */
async function getHistory(mt5Login, fromDate, toDate) {
  try {
    const conn = await getConnection();
    const deals = conn.historyStorage.deals || [];
    const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toDate ? new Date(toDate) : new Date();
    return deals.filter(d => {
      const t = new Date(d.time);
      return t >= from && t <= to;
    });
  } catch (err) {
    console.error('[MT5] getHistory error:', err.message);
    return [];
  }
}

/**
 * Get all client accounts managed by this manager.
 * Uses MetaAPI Management API.
 */
async function getAllClientAccounts() {
  try {
    if (!api) return [];
    const accounts = await api.metatraderAccountApi.getAccounts({ limit: 1000 });
    return accounts.map(a => ({
      id: a.id,
      login: a.login,
      name: a.name,
      server: a.server,
      state: a.state,
      connectionStatus: a.connectionStatus,
      type: a.type,
    }));
  } catch (err) {
    console.error('[MT5] getAllClientAccounts error:', err.message);
    return [];
  }
}

/**
 * Get real-time stats for a specific client MT5 account (by MetaAPI account ID).
 */
async function getClientAccountStats(metaapiAccountId) {
  try {
    const clientAccount = await api.metatraderAccountApi.getAccount(metaapiAccountId);
    if (clientAccount.state !== 'DEPLOYED') await clientAccount.deploy();
    const conn = clientAccount.getStreamingConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 30 });
    const info = conn.terminalState.accountInformation;
    const positions = conn.terminalState.positions || [];
    await conn.close();
    return { info, positions };
  } catch (err) {
    console.error('[MT5] getClientAccountStats error:', err.message);
    return null;
  }
}

/**
 * Get live account information via RPC (faster than streaming for one-off calls).
 */
async function getAccountSummary(metaapiAccountId) {
  try {
    const account = await api.metatraderAccountApi.getAccount(metaapiAccountId);
    if (!['DEPLOYED', 'DEPLOYING'].includes(account.state)) await account.deploy();
    await account.waitConnected();
    const conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 30 });
    const info    = await conn.getAccountInformation();
    const positions = await conn.getPositions();
    const orders  = await conn.getOrders();
    await conn.close();
    return { info, positions, orders };
  } catch (err) {
    console.error('[MT5] getAccountSummary error:', err.message);
    return null;
  }
}

module.exports = { init, getAccountInfo, getPositions, getHistory, getAllClientAccounts, getClientAccountStats, getAccountSummary };
