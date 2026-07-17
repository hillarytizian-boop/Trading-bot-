const Binance = require("binance-api-node").default;
const HttpsProxyAgent = require("https-proxy-agent");

function createBinanceClient(apiKey, secretKey) {
    console.log('[createBinanceClient] apiKey:', apiKey ? apiKey.slice(0,4) + '...' : 'null');
    console.log('[createBinanceClient] secretKey:', secretKey ? secretKey.slice(0,4) + '...' : 'null');

    if (!apiKey || !secretKey) {
        throw new Error("Missing Binance API credentials");
    }

    const proxy = process.env.PROXY_URL;

    // ─── Build config with both naming conventions ────────────────
    const config = {
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim(),
        apiSecret: secretKey.trim(), // ← older versions use this
        recvWindow: 60000,
        timeout: 30000,
    };

    if (proxy) {
        console.log('[createBinanceClient] Using proxy:', proxy);
        config.httpsAgent = new HttpsProxyAgent(proxy);
    } else {
        console.log('[createBinanceClient] No proxy used.');
    }

    // ─── Log the config (masked) ────────────────────────────────────
    console.log('[createBinanceClient] config keys:', Object.keys(config));
    console.log('[createBinanceClient] config.apiKey length:', config.apiKey ? config.apiKey.length : 0);
    console.log('[createBinanceClient] config.secretKey length:', config.secretKey ? config.secretKey.length : 0);

    // ─── Create client and log internal state ──────────────────────
    const client = Binance(config);

    // Check if the client has the keys (if the library exposes them)
    console.log('[createBinanceClient] client.apiKey:', client.apiKey ? client.apiKey.slice(0,4) + '...' : 'undefined');
    console.log('[createBinanceClient] client.secretKey:', client.secretKey ? client.secretKey.slice(0,4) + '...' : 'undefined');

    return client;
}

async function verifyKeys(apiKey, secretKey) {
    try {
        console.log('[verifyKeys] Received apiKey length:', apiKey ? apiKey.length : 0);
        console.log('[verifyKeys] Received secretKey length:', secretKey ? secretKey.length : 0);
        const client = createBinanceClient(apiKey, secretKey);
        const account = await client.accountInfo();
        return { success: true, account };
    } catch (err) {
        console.error("Binance verification failed");
        console.error("Code:", err.code);
        console.error("Message:", err.message);
        console.error("Body:", err.body);
        return { success: false, code: err.code, message: err.message, body: err.body };
    }
}

module.exports = {
    createBinanceClient,
    verifyKeys,
};
