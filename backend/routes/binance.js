const router = require('express').Router();
const supabase = require('../db');
const { verifyKeys } = require('../binanceClient');

router.post('/connect', async (req, res) => {
    const { email, apiKey, secretKey } = req.body;

    // ─── Log the raw request body ──────────────────────────────────
    console.log('[Binance] Raw request body:', JSON.stringify(req.body, null, 2));

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    if (!apiKey || !apiKey.trim()) {
        return res.status(400).json({ error: 'API key is required and cannot be empty' });
    }
    if (!secretKey || !secretKey.trim()) {
        return res.status(400).json({ error: 'Secret key is required and cannot be empty' });
    }

    const trimmedApiKey = apiKey.trim();
    const trimmedSecret = secretKey.trim();

    console.log('[Binance] Trimmed API key length:', trimmedApiKey.length);
    console.log('[Binance] Trimmed Secret key length:', trimmedSecret.length);

    const result = await verifyKeys(trimmedApiKey, trimmedSecret);

    if (!result.success) {
        const errorMsg = result.message || result.body || 'Invalid API keys';
        return res.status(400).json({ error: errorMsg, code: result.code });
    }

    // ─── Save to Supabase ──────────────────────────────────────────
    const { error } = await supabase
        .from('users')
        .update({
            binance_api_key: trimmedApiKey,
            binance_secret_key: trimmedSecret,
        })
        .eq('email', email);

    if (error) {
        return res.status(500).json({ error: 'Database error: ' + error.message });
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

    if (!data?.binance_api_key) {
        return res.status(401).json({ error: 'Not connected' });
    }

    try {
        const { createBinanceClient } = require('../binanceClient');
        const client = createBinanceClient(data.binance_api_key, data.binance_secret_key);
        const account = await client.accountInfo();
        const usdt = account.balances.find(b => b.asset === 'USDT');
        res.json({ balance: usdt ? parseFloat(usdt.free).toFixed(2) : '0.00' });
    } catch (err) {
        await supabase
            .from('users')
            .update({ binance_api_key: null, binance_secret_key: null })
            .eq('email', email);
        res.status(401).json({ error: 'Invalid keys – reconnect' });
    }
});

module.exports = router;
