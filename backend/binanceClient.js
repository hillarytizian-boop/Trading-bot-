const Binance = require("binance-api-node").default;
const HttpsProxyAgent = require("https-proxy-agent");

function createBinanceClient(apiKey, secretKey) {
    // ─── Log what we receive ──────────────────────────────────────
    console.log('[createBinanceClient] apiKey type:', typeof apiKey);
    console.log('[createBinanceClient] apiKey length:', apiKey ? apiKey.length : 0);
    console.log('[createBinanceClient] secretKey type:', typeof secretKey);
    console.log('[createBinanceClient] secretKey length:', secretKey ? secretKey.length : 0);

    if (!apiKey || !secretKey) {
        throw new Error("Missing Binance API credentials");
    }

    const proxy = process.env.PROXY_URL;
    const config = {
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim(),
        recvWindow: 60000,
        timeout: 30000,
    };

    if (proxy) {
        config.httpsAgent = new HttpsProxyAgent(proxy);
    }

    return Binance(config);
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
