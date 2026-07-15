const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;

// ─── Test endpoint (no auth required) ──────────────────────────────
router.get('/test', (req, res) => {
  res.json({ status: 'Binance route OK', time: new Date().toISOString() });
});

// ─── Connect endpoint with detailed logging ────────────────────────
router.post('/connect', async (req, res) => {
  const { email, apiKey, secretKey } = req.body;
  
  console.log('========================================');
  console.log('[BINANCE] Connect request received');
  console.log('[BINANCE] Email:', email);
  console.log('[BINANCE] API Key length:', apiKey?.length || 0);
  console.log('[BINANCE] Secret Key length:', secretKey?.length || 0);
  console.log('[BINANCE] API Key (first 4 chars):', apiKey?.slice(0, 4));
  console.log('[BINANCE] Secret Key (first 4 chars):', secretKey?.slice(0, 4));
  console.log('========================================');

  if (!email || !apiKey || !secretKey) {
    console.log('[BINANCE] ❌ Missing fields');
    return res.status(400).json({ error: 'Missing email, apiKey, or secretKey' });
  }

  try {
    console.log('[BINANCE] Initializing Binance client...');
    const client = Binance({
      apiKey: apiKey.trim(),
      secretKey: secretKey.trim(),
    });
    
    console.log('[BINANCE] Testing account info...');
    const account = await client.accountInfo();
    console.log('[BINANCE] ✅ Account info successful!');
    console.log('[BINANCE] Account type:', account.accountType);
    console.log('[BINANCE] Can trade:', account.canTrade);
    console.log('[BINANCE] Can withdraw:', account.canWithdraw);
    
    // Get balance for USDT
    const usdt = account.balances.find(b => b.asset === 'USDT');
    console.log('[BINANCE] USDT balance:', usdt ? usdt.free : '0');
    
  } catch (err) {
    console.error('[BINANCE] ❌ Connection error:', err.message);
    console.error('[BINANCE] Error details:', err);
    return res.status(400).json({ error: 'Invalid Binance API keys: ' + err.message });
  }

  // Save keys to Supabase
  console.log('[BINANCE] Saving keys to Supabase...');
  const { error } = await supabase
    .from('users')
    .update({
      binance_api_key: apiKey.trim(),
      binance_secret_key: secretKey.trim(),
    })
    .eq('email', email);

  if (error) {
    console.error('[BINANCE] ❌ Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log('[BINANCE] ✅ Keys saved successfully');
  console.log('========================================');
  res.json({ success: true, message: 'Keys saved and verified' });
});

// ─── Status endpoint ────────────────────────────────────────────────
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

// ─── Balance endpoint ────────────────────────────────────────────────
router.get('/balance', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  
  const { data } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();
    
  if (!data?.binance_api_key) {
    return res.status(401).json({ error: 'Not connected' });
  }
  
  try {
    const client = Binance({
      apiKey: data.binance_api_key,
      secretKey: data.binance_secret_key,
    });
    const account = await client.accountInfo();
    const usdt = account.balances.find(b => b.asset === 'USDT');
    res.json({ balance: usdt ? parseFloat(usdt.free).toFixed(2) : '0.00' });
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
