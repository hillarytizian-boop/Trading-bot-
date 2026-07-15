const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;

// ─── Connect: save API keys (encrypted in production) ──────────────
router.post('/connect', async (req, res) => {
  const { email, apiKey, secretKey } = req.body;
  if (!email || !apiKey || !secretKey) {
    return res.status(400).json({ error: 'Missing email, apiKey, or secretKey' });
  }
  // Test keys before saving
  try {
    const client = Binance({ apiKey, secretKey });
    await client.accountInfo(); // throws if invalid
  } catch (err) {
    return res.status(400).json({ error: 'Invalid Binance API keys: ' + err.message });
  }
  const { error } = await supabase
    .from('users')
    .update({ binance_api_key: apiKey, binance_secret_key: secretKey })
    .eq('email', email);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Keys saved and verified' });
});

// ─── Disconnect: remove keys ──────────────────────────────────────────
router.post('/disconnect', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  await supabase
    .from('users')
    .update({ binance_api_key: null, binance_secret_key: null })
    .eq('email', email);
  res.json({ success: true, message: 'Disconnected' });
});

// ─── Status: check if connected ──────────────────────────────────────
router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key')
    .eq('email', email)
    .single();
  if (error || !data?.binance_api_key) return res.json({ connected: false });
  return res.json({ connected: true });
});

// ─── Balance: real USDT balance ──────────────────────────────────────
router.get('/balance', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();
  if (error || !data?.binance_api_key) {
    return res.status(401).json({ error: 'Binance not connected' });
  }
  try {
    const client = Binance({ apiKey: data.binance_api_key, secretKey: data.binance_secret_key });
    const account = await client.accountInfo();
    const usdt = account.balances.find(b => b.asset === 'USDT');
    const balance = usdt ? parseFloat(usdt.free).toFixed(2) : '0.00';
    res.json({ balance });
  } catch (err) {
    // If keys invalid, clear them
    await supabase
      .from('users')
      .update({ binance_api_key: null, binance_secret_key: null })
      .eq('email', email);
    res.status(401).json({ error: 'Invalid keys – please reconnect' });
  }
});

module.exports = router;
