const MetaApi = require('metaapi.cloud-sdk').default;

const TOKEN     = process.env.METAAPI_TOKEN;
const ACCOUNT_ID = process.env.MT5_ACCOUNT_ID;

let api     = null;
let account = null;
let ready   = false;

async function init() {
  if (!TOKEN || !ACCOUNT_ID) {
    console.warn('[MT5] METAAPI_TOKEN or MT5_ACCOUNT_ID not set — running in mock mode');
    return false;
  }
  try {
    api = new MetaApi(TOKEN);
    account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);
    if (account.state !== 'DEPLOYED') {
      console.log('[MT5] Deploying account...');
      await account.deploy();
    }
    await account.waitConnected();
    ready = true;
    console.log('[MT5] Connected to Fxcentrum Real-Live ✓');
    return true;
  } catch (err) {
    console.error('[MT5] Connection failed:', err.message);
    return false;
  }
}

function isReady() { return ready; }

/**
 * Fetch live account info + open positions + pending orders via RPC.
 * Returns null on failure so caller can fall back to stored DB values.
 */
async function getAccountSummary() {
  if (!ready || !account) return null;
  let conn;
  try {
    conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 60 });

    const [info, positions, orders] = await Promise.all([
      conn.getAccountInformation(),
      conn.getPositions(),
      conn.getOrders(),
    ]);

    return { info, positions, orders };
  } catch (err) {
    console.error('[MT5] getAccountSummary error:', err.message);
    return null;
  } finally {
    if (conn) conn.close().catch(() => {});
  }
}

/**
 * Fetch closed trade history for a date range.
 */
async function getDealHistory(fromDate, toDate) {
  if (!ready || !account) return [];
  let conn;
  try {
    conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 60 });
    const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to   = toDate   ? new Date(toDate)   : new Date();
    const deals = await conn.getDealsByTimeRange(from, to);
    return deals || [];
  } catch (err) {
    console.error('[MT5] getDealHistory error:', err.message);
    return [];
  } finally {
    if (conn) conn.close().catch(() => {});
  }
}

module.exports = { init, isReady, getAccountSummary, getDealHistory };
