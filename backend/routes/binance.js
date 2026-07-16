const router = require("express").Router();
const Binance = require("binance-api-node").default;
const supabase = require("../db");

// ======================================================
// Create Binance Client
// ======================================================
async function getBinanceClient(email) {
  const { data, error } = await supabase
    .from("users")
    .select("binance_api_key, binance_secret_key")
    .eq("email", email)
    .single();

  if (error) {
    throw new Error("Database error: " + error.message);
  }

  if (!data || !data.binance_api_key || !data.binance_secret_key) {
    throw new Error("Binance API keys not found.");
  }

  return Binance({
    apiKey: data.binance_api_key.trim(),
    apiSecret: data.binance_secret_key.trim()
  });
}

// ======================================================
// Validate Binance API Keys
// ======================================================
async function validateKeys(apiKey, secretKey) {
  const client = Binance({
    apiKey: apiKey.trim(),
    apiSecret: secretKey.trim()
  });

  try {
    const account = await client.accountInfo();
    return {
      valid: true,
      account
    };
  } catch (err) {
    throw new Error(err.message);
  }
}

// ======================================================
// Connect Binance
// POST /api/binance/connect
// ======================================================
router.post("/connect", async (req, res) => {
  const { email, apiKey, secretKey } = req.body;

  if (!email || !apiKey || !secretKey) {
    return res.status(400).json({
      success: false,
      error: "Email, API Key and Secret Key are required."
    });
  }

  try {
    console.log("Validating Binance keys...");
    await validateKeys(apiKey, secretKey);

    const { error } = await supabase
      .from("users")
      .update({
        binance_api_key: apiKey.trim(),
        binance_secret_key: secretKey.trim()
      })
      .eq("email", email);

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    console.log("Binance connected:", email);

    res.json({
      success: true,
      message: "Binance connected successfully."
    });

  } catch (err) {
    console.error(err);
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Disconnect Binance
// POST /api/binance/disconnect
// ======================================================
router.post("/disconnect", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required."
    });
  }

  try {
    const { error } = await supabase
      .from("users")
      .update({
        binance_api_key: null,
        binance_secret_key: null
      })
      .eq("email", email);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: "Binance disconnected."
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Connection Status
// GET /api/binance/status?email=...
// ======================================================
router.get("/status", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required."
    });
  }

  try {
    const { data } = await supabase
      .from("users")
      .select("binance_api_key")
      .eq("email", email)
      .single();

    res.json({
      success: true,
      connected: !!data?.binance_api_key
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Get Account Information
// GET /api/binance/account?email=...
// ======================================================
router.get("/account", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const account = await client.accountInfo();

    res.json({
      success: true,
      account
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Get USDT Balance
// GET /api/binance/balance?email=...
// ======================================================
router.get("/balance", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const account = await client.accountInfo();

    const balances = account.balances.filter(
      asset => Number(asset.free) > 0 || Number(asset.locked) > 0
    );

    res.json({
      success: true,
      balances
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Get Symbol Price
// GET /api/binance/price?symbol=BTCUSDT
// ======================================================
router.get("/price", async (req, res) => {
  const symbol = (req.query.symbol || "").toUpperCase();

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: "Symbol is required."
    });
  }

  try {
    const client = Binance();
    const prices = await client.prices();

    if (!prices[symbol]) {
      return res.status(404).json({
        success: false,
        error: "Invalid symbol."
      });
    }

    res.json({
      success: true,
      symbol,
      price: prices[symbol]
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Get 24hr Ticker
// GET /api/binance/ticker?symbol=BTCUSDT
// ======================================================
router.get("/ticker", async (req, res) => {
  const symbol = (req.query.symbol || "").toUpperCase();

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: "Symbol is required."
    });
  }

  try {
    const client = Binance();
    // Try dailyStats first, fallback to prices
    let ticker;
    try {
      ticker = await client.dailyStats({ symbol });
    } catch (statsErr) {
      // If dailyStats fails, use prices as fallback
      const prices = await client.prices();
      ticker = { symbol, price: prices[symbol] || 'N/A' };
    }

    res.json({
      success: true,
      ticker
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Exchange Information
// GET /api/binance/exchangeInfo
// ======================================================
router.get("/exchangeInfo", async (req, res) => {
  try {
    const client = Binance();
    const info = await client.exchangeInfo();

    res.json({
      success: true,
      exchange: info
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Candlestick Data
// GET /api/binance/klines?symbol=BTCUSDT&interval=1m
// ======================================================
router.get("/klines", async (req, res) => {
  const symbol = (req.query.symbol || "BTCUSDT").toUpperCase();
  const interval = req.query.interval || "1m";

  try {
    const client = Binance();
    const candles = await client.candles({
      symbol,
      interval,
      limit: 500
    });

    res.json({
      success: true,
      symbol,
      interval,
      candles
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Market Order
// POST /api/binance/order/market
// ======================================================
router.post("/order/market", async (req, res) => {
  const { email, symbol, side, quantity } = req.body;

  if (!email || !symbol || !side || !quantity) {
    return res.status(400).json({
      success: false,
      error: "email, symbol, side and quantity are required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const order = await client.order({
      symbol: symbol.toUpperCase(),
      side: side.toUpperCase(),
      type: "MARKET",
      quantity: quantity.toString()
    });

    res.json({
      success: true,
      order
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Limit Order
// POST /api/binance/order/limit
// ======================================================
router.post("/order/limit", async (req, res) => {
  const { email, symbol, side, quantity, price } = req.body;

  if (!email || !symbol || !side || !quantity || !price) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const order = await client.order({
      symbol: symbol.toUpperCase(),
      side: side.toUpperCase(),
      type: "LIMIT",
      timeInForce: "GTC",
      quantity: quantity.toString(),
      price: price.toString()
    });

    res.json({
      success: true,
      order
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Open Orders
// GET /api/binance/orders/open
// ======================================================
router.get("/orders/open", async (req, res) => {
  const { email, symbol } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const orders = await client.openOrders({
      symbol: symbol ? symbol.toUpperCase() : undefined
    });

    res.json({
      success: true,
      orders
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Order History
// GET /api/binance/orders/history
// ======================================================
router.get("/orders/history", async (req, res) => {
  const { email, symbol } = req.query;

  if (!email || !symbol) {
    return res.status(400).json({
      success: false,
      error: "Email and symbol required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const orders = await client.allOrders({
      symbol: symbol.toUpperCase()
    });

    res.json({
      success: true,
      orders
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Cancel Order
// POST /api/binance/order/cancel
// ======================================================
router.post("/order/cancel", async (req, res) => {
  const { email, symbol, orderId } = req.body;

  if (!email || !symbol || !orderId) {
    return res.status(400).json({
      success: false,
      error: "email, symbol and orderId are required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const result = await client.cancelOrder({
      symbol: symbol.toUpperCase(),
      orderId: Number(orderId)
    });

    res.json({
      success: true,
      result
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Trade History
// GET /api/binance/myTrades
// ======================================================
router.get("/myTrades", async (req, res) => {
  const { email, symbol } = req.query;

  if (!email || !symbol) {
    return res.status(400).json({
      success: false,
      error: "Email and symbol required."
    });
  }

  try {
    const client = await getBinanceClient(email);
    const trades = await client.myTrades({
      symbol: symbol.toUpperCase()
    });

    res.json({
      success: true,
      trades
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Test Binance Connection
// GET /api/binance/test
// ======================================================
router.get("/test", async (req, res) => {
  try {
    const client = Binance();
    const time = await client.time();

    res.json({
      success: true,
      serverTime: time,
      message: "Binance API connection successful"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================================================
// Export Router
// ======================================================
module.exports = router;
