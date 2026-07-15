const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;

// Test endpoint – checks keys without saving
router.post('/test', async (req, res) => {
  const { apiKey, secretKey } = req.body;
  console.log('[Binance] Testing keys...');
  try {
    const client = Binance({ apiKey: apiKey.trim(), secretKey: secretKey.trim() });
    const account = await client.accountInfo();
    const usdt = account.balances.find(b => b.asset === 'USDT');
    res.json({
      valid: true,
      balance: usdt ? parseFloat(usdt.free).toFixed(2) : '0.00',
      accountType: account.accountType,
    });
  } catch (err) {
    console.error('[Binance] Test failed:', err.message);
    res.status(400).json({ valid: false, error: err.message });
  }
});

router.post('/connect', async (req, res) => {
  const { email, apiKey, secretKey } = req.body;
  console.log('[Binance] Connect attempt for:', email);
  console.log('[Binance] API Key starts with:', apiKey?.slice(0, 6));

  if (!email || !apiKey || !secretKey) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const client = Binance({ apiKey: apiKey.trim(), secretKey: secretKey.trim() });
    const account = await client.accountInfo();
    console.log('[Binance] Account verified:', account.accountType);
  } catch (err) {
    console.error('[Binance] Connection error:', err.message);
    return res.status(400).json({ error: 'Invalid Binance API keys: ' + err.message });
  }

  const { error } = await supabase
    .from('users')
    .update({
      binance_api_key: apiKey.trim(),
      binance_secret_key: secretKey.trim(),
    })
    .eq('email', email);

  if (error) {
    console.error('[Binance] Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, message: 'Keys saved and verified' });
});

router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  const { data } = await supabase
    .from('users')
    .select('binance_api_key')
    .eq('email', email)
    .single();
  res.json({ connected: !!(data?.binance_api_key) });
});

router.get('/balance', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  const { data } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();
  if (!data?.binance_api_key) return res.status(401).json({ error: 'Not connected' });
  try {
    const client = Binance({ apiKey: data.binance_api_key, secretKey: data.binance_secret_key });
    const account = await client.accountInfo();
    const usdt = account.balances.find(b => b.asset === 'USDT');
    res.json({ balance: usdt ? parseFloat(usdt.free).toFixed(2) : '0.00' });
  } catch (err) {
    await supabase.from('users').update({ binance_api_key: null, binance_secret_key: null }).eq('email', email);
    res.status(401).json({ error: 'Invalid keys – please reconnect' });
  }
});

module.exports = router;
