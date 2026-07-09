const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;

// Helper to create a Binance client from stored keys
async function getBinanceClient(email) {
  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();

  if (error || !data?.binance_api_key) {
    throw new Error('Binance not connected');
  }
  return Binance({
    apiKey: data.binance_api_key,
    secretKey: data.binance_secret_key,
  });
}

// ─── CONNECT: store API keys in Supabase ──────────────────────────────
router.post('/connect', async (req, res) => {
  const { email, apiKey, secretKey } = req.body;
  if (!email || !apiKey || !secretKey) {
    return res.status(400).json({ error: 'Missing email, apiKey, or secretKey' });
  }

  // Test the keys before saving – if invalid, Binance will throw
  try {
    const testClient = Binance({ apiKey, secretKey });
    await testClient.accountInfo(); // throws if invalid
  } catch (err) {
    return res.status(400).json({ error: 'Invalid Binance API keys: ' + err.message });
  }

  const { error } = await supabase
    .from('users')
    .update({ binance_api_key: apiKey, binance_secret_key: secretKey })
    .eq('email', email);

  if (error) {
    console.error('Supabase update error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true, message: 'Keys saved and verified' });
});

// ─── STATUS: check if user has valid keys stored ──────────────────────
router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();

  if (error) {
    // User not found or no keys
    if (error.code === 'PGRST116') return res.json({ connected: false });
    return res.status(500).json({ error: error.message });
  }
  const connected = !!(data?.binance_api_key && data?.binance_secret_key);
  res.json({ connected });
});

// ─── BALANCE: fetch real USDT balance from Binance ────────────────────
router.get('/balance', async (req, res) => {

// ─── Get open orders (real-time from Binance) ──────────────────────
router.get("/open-orders", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Missing email" });
  try {
    const client = await getBinanceClient(email);
    const orders = await client.openOrders({ symbol: "BTCUSDT" });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const client = await getBinanceClient(email);
    const account = await client.accountInfo();
    const usdt = account.balances.find(b => b.asset === 'USDT');
    const balance = usdt ? parseFloat(usdt.free).toFixed(2) : '0.00';
    res.json({ balance });
  } catch (err) {
    // If keys are invalid, clear them from Supabase and return error
    if (err.message.includes('Binance not connected') || err.message.includes('API-key')) {
      await supabase
        .from('users')
        .update({ binance_api_key: null, binance_secret_key: null })
        .eq('email', email);
      return res.status(401).json({ error: 'Invalid or expired keys – please reconnect' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── ACCOUNT INFO (optional) ───────────────────────────────────────────
router.get('/account', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const client = await getBinanceClient(email);
    const account = await client.accountInfo();
    // Filter out zero balances
    const balances = account.balances
      .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map(b => ({ asset: b.asset, free: b.free, locked: b.locked }));
    res.json({ balances });
  } catch (err) {
    if (err.message.includes('Binance not connected')) {
      return res.status(401).json({ error: 'Binance not connected' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
