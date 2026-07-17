const Binance = require("binance-api-node").default;
const HttpsProxyAgent = require("https-proxy-agent");

function createBinanceClient(apiKey, secretKey) {
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
        const client = createBinanceClient(apiKey, secretKey);
        const account = await client.accountInfo();
        return {
            success: true,
            account,
        };
    } catch (err) {
        console.error("Binance verification failed");
        console.error("Code:", err.code);
        console.error("Message:", err.message);
        console.error("Body:", err.body);
        return {
            success: false,
            code: err.code,
            message: err.message,
            body: err.body,
        };
    }
}

module.exports = {
    createBinanceClient,
    verifyKeys,
};
