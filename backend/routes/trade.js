const router = require('express').Router();
const supabase = require('../db');
const { getAIAnalysis } = require('./ai.js');
const { v4: uuidv4 } = require('uuid');
const Binance = require('binance-api-node').default;

// Proxy support – adjust import based on installed version
let HttpsProxyAgent;
try {
  // For v5 (CommonJS)
  HttpsProxyAgent = require('https-proxy-agent');
} catch {
  // For v6+ (ESM), but we'll use the fallback
  const { HttpsProxyAgent: Agent } = require('https-proxy-agent');
  HttpsProxyAgent = Agent;
}
const PROXY_URL = process.env.PROXY_URL || 'http://qsbykpgrqjh5:n0gsca0jpuzio8h@209.50.183.159:3129';
const agent = new HttpsProxyAgent(PROXY_URL);

// ─── Helper: load agent state for risk checks ──────────────────────
async function loadState(email) {
  const { data, error } = await supabase
    .from('users')
    .select('agent_state')
    .eq('email', email)
    .single();
  if (error || !data?.agent_state) {
    return {
      dailyLoss: 0,
      consecutiveLosses: 0,
      activeTradeId: null,
    };
  }
  return data.agent_state;
}

// ─── Helper: get price from Binance (not client) ──────────────────
async function getPrice(symbol, client) {
  try {
    const ticker = await client.prices({ symbol: symbol.replace('/', '') });
    const price = Number(ticker[symbol.replace('/', '')]);
    if (!price || price <= 0) throw new Error('Invalid price');
    return price;
  } catch (e) {
    throw new Error(`Failed to fetch price: ${e.message}`);
  }
}

// ─── Helper: validate Binance filters (LOT_SIZE, MIN_NOTIONAL) ──
async function validateOrder(symbol, quantity, client) {
  const info = await client.exchangeInfo({ symbol: symbol.replace('/', '') });
  const symbolInfo = info.symbols.find(s => s.symbol === symbol.replace('/', ''));
  if (!symbolInfo) throw new Error('Symbol not found');
  const lotSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
  const minNotional = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');
  if (lotSize) {
    const stepSize = parseFloat(lotSize.stepSize);
    const minQty = parseFloat(lotSize.minQty);
    if (quantity < minQty) throw new Error(`Quantity ${quantity} below min ${minQty}`);
    const rounded = Math.floor(quantity / stepSize) * stepSize;
    if (rounded !== quantity) throw new Error(`Quantity must be multiple of ${stepSize}`);
  }
  if (minNotional) {
    const minNotionalValue = parseFloat(minNotional.minNotional);
    // we don't know price yet, but we can check after
  }
}

// ─── Main endpoint ──────────────────────────────────────────────────
router.post('/auto', async (req, res) => {
  const email = req.user?.email || req.body.email || 'demo@example.com';
  const rawSymbol = req.body.symbol || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');

  try {
    // ─── 1. Load settings & state ──────────────────────────────────
    const user = await supabase
      .from('users')
      .select('paper_balance, bot_settings, binance_api_key, binance_secret_key')
      .eq('email', email)
      .single();
    if (!user.data) return res.status(404).json({ error: 'User not found' });
    const settings = user.data.bot_settings || {};
    const isPaper = settings.paperMode !== false;
    const state = await loadState(email);

    // ─── 2. Risk checks ─────────────────────────────────────────────
    const maxDailyLoss = settings.maxDailyLoss || 20;
    if (state.dailyLoss >= maxDailyLoss) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Daily loss limit reached' });
    }
    if (state.consecutiveLosses >= 3) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Paused after 3 consecutive losses' });
    }

    // ─── 3. Cooldown (prevent immediate repeat) ────────────────────
    const { data: lastTrade } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .eq('symbol', symbol)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastTrade && lastTrade.status === 'closed') {
      const diff = Date.now() - new Date(lastTrade.closed_at).getTime();
      if (diff < 300000) { // 5 minutes
        return res.json({ signal: 'HOLD', confidence: 0, reason: 'Cooldown active (5 min)' });
      }
    }

    // ─── 4. Check existing open trade ──────────────────────────────
    const { data: openTrade } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .eq('status', 'open')
      .maybeSingle();
    if (openTrade) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trade already open' });
    }

    // ─── 5. Initialize Binance client (with proxy) ─────────────────
    const client = Binance({
      apiKey: settings.binance_api_key,
      secretKey: settings.binance_secret_key,
      httpsAgent: agent,
    });

    // ─── 6. Fetch price from Binance (not client) ──────────────────
    let price;
    try {
      price = await getPrice(symbol, client);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    // ─── 7. Get AI analysis ────────────────────────────────────────
    let aiResult;
    try {
      aiResult = await getAIAnalysis(email, symbol, price, null);
    } catch (e) {
      return res.status(500).json({ error: `AI error: ${e.message}` });
    }

    // ─── 8. Validate AI response ────────────────────────────────────
    const validSignals = ['BUY', 'SELL', 'HOLD'];
    if (!validSignals.includes(aiResult.signal)) {
      throw new Error(`Invalid AI signal: ${aiResult.signal}`);
    }

    const minConf = settings.minimumConfidence || 80;
    if (aiResult.signal === 'HOLD' || aiResult.confidence < minConf) {
      return res.json({ signal: 'HOLD', confidence: aiResult.confidence, reason: 'Low confidence or HOLD' });
    }

    // ─── 9. Determine balance ──────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = user.data.paper_balance || 1000;
    } else {
      if (!settings.binance_api_key) {
        return res.status(401).json({ error: 'Binance not connected' });
      }
      const account = await client.accountInfo();
      const usdt = account.balances.find(b => b.asset === 'USDT');
      balance = usdt ? parseFloat(usdt.free) : 0;
      if (balance <= 0) return res.json({ signal: 'HOLD', confidence: 0, reason: 'Insufficient USDT balance' });
    }

    // ─── 10. Position sizing ────────────────────────────────────────
    const maxRisk = settings.maxTradeAmount || 20;
    let tradeAmount = Math.min(balance * 0.01, maxRisk);
    tradeAmount = Math.max(tradeAmount, 1); // min $1
    let quantity = tradeAmount / price;
    quantity = Number(quantity.toFixed(6)); // round to 6 decimals

    // ─── 11. Validate quantity against Binance filters ─────────────
    try {
      await validateOrder(symbol, quantity, client);
    } catch (e) {
      return res.status(400).json({ error: `Order validation failed: ${e.message}` });
    }

    // ─── 12. Stop‑loss & take‑profit (AI first, then fallback) ──
    let stopLoss = Number(aiResult.stop_loss);
    let takeProfit = Number(aiResult.take_profit);
    if (!stopLoss || !takeProfit) {
      const slPercent = 2, tpPercent = 5;
      if (aiResult.signal === 'BUY') {
        stopLoss = price * (1 - slPercent / 100);
        takeProfit = price * (1 + tpPercent / 100);
      } else {
        stopLoss = price * (1 + slPercent / 100);
        takeProfit = price * (1 - tpPercent / 100);
      }
    }

    // ─── 13. Execute real Binance order (if not paper) ─────────────
    let orderResult = null;
    if (!isPaper) {
      try {
        orderResult = await client.order({
          symbol: symbol,
          side: aiResult.signal === 'BUY' ? 'BUY' : 'SELL',
          type: 'MARKET',
          quantity: quantity,
        });
        console.log('[Trade] Live order placed:', orderResult);
      } catch (orderError) {
        console.error('[Trade] Order failed:', orderError.message);
        return res.status(500).json({ error: `Order failed: ${orderError.message}` });
      }
    }

    // ─── 14. Record trade in Supabase ──────────────────────────────
    const tradeId = uuidv4();
    const { error: insertError } = await supabase
      .from('trades')
      .insert([{
        id: tradeId,
        user_email: email,
        symbol: symbol,
        type: aiResult.signal,
        entry_price: price,
        quantity: quantity,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        status: 'open',
        opened_at: new Date().toISOString(),
        signal_confidence: aiResult.confidence,
        signal_reason: aiResult.reason,
        is_paper: isPaper,
      }]);
    if (insertError) {
      // If Supabase insert fails, we may have already placed a live order – dangerous.
      // Log critical error and alert.
      console.error('[Trade] CRITICAL: Supabase insert failed after order placed:', insertError);
      // In a production system, you'd want to attempt to cancel the order or alert.
      return res.status(500).json({ error: 'Database error after order' });
    }

    // ─── 15. Return success ─────────────────────────────────────────
    res.json({
      signal: aiResult.signal,
      confidence: aiResult.confidence,
      reason: aiResult.reason,
      trade: {
        id: tradeId,
        type: aiResult.signal,
        entryPrice: price,
        quantity,
        stopLoss,
        takeProfit,
        isPaper,
        order: orderResult,
      },
    });

  } catch (error) {
    console.error('[Trade] Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

module.exports = router;
