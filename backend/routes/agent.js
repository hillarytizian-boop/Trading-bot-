const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;
const { analyze } = require('./ai');
const { v4: uuidv4 } = require('uuid');

// ─── In‑memory state ──────────────────────────────────────────────
let agentState = {
  running: false,
  intervalId: null,
  lastSignal: null,
  tradesToday: 0,
  dailyLoss: 0,
  totalPnL: 0,
  activeTradeId: null,   // UUID of the currently open trade
};

// ─── Helper: get Binance client from stored keys ─────────────────
async function getBinanceClient(email) {
  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();
  if (error || !data?.binance_api_key) throw new Error('Binance not connected');
  return Binance({ apiKey: data.binance_api_key, secretKey: data.binance_secret_key });
}

// ─── Helper: get user settings from Supabase ──────────────────────
async function getSettings(email) {
  const { data, error } = await supabase
    .from('users')
    .select('bot_settings')
    .eq('email', email)
    .single();
  return data?.bot_settings || {
    tradeAmount: 10,
    maxDailyLoss: 10,
    maxTradesPerDay: 30,
    riskLevel: 'MEDIUM',
    market: 'BTCUSDT',
    autoCompound: false,
    stopLossPercent: 2,
    takeProfitPercent: 5,
  };
}

// ─── Helper: log a trade ──────────────────────────────────────────
async function logTrade(email, trade) {
  await supabase.from('trades').insert([{
    id: trade.id || uuidv4(),
    user_email: email,
    symbol: trade.symbol,
    type: trade.type,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice || null,
    quantity: trade.quantity,
    pnl: trade.pnl || 0,
    opened_at: trade.openedAt || new Date().toISOString(),
    closed_at: trade.closedAt || null,
    status: trade.status || 'open',
    stop_loss: trade.stopLoss,
    take_profit: trade.takeProfit,
  }]);
}

// ─── Helper: update an existing trade ─────────────────────────────
async function updateTrade(email, tradeId, updates) {
  await supabase
    .from('trades')
    .update(updates)
    .eq('id', tradeId)
    .eq('user_email', email);
}

// ─── Helper: fetch active trade (if any) ──────────────────────────
async function getActiveTrade(email) {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_email', email)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

// ─── Core agent loop ───────────────────────────────────────────────
async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const client = await getBinanceClient(email);
    const settings = await getSettings(email);
    const symbol = settings.market || 'BTCUSDT';

    // 1. Get current price
    const ticker = await client.prices({ symbol });
    const price = parseFloat(ticker[symbol]);

    // 2. Check if there's already an open trade
    const activeTrade = await getActiveTrade(email);
    if (activeTrade) {
      // Monitor and close if stop‑loss or take‑profit is hit
      // We'll check price against stopLoss and takeProfit
      const entry = activeTrade.entry_price;
      const sl = activeTrade.stop_loss;
      const tp = activeTrade.take_profit;
      let closed = false;

      if (activeTrade.type === 'BUY') {
        if (price <= sl) {
          // Stop loss hit
          await closeTrade(email, activeTrade.id, price, 'STOP_LOSS');
          closed = true;
        } else if (price >= tp) {
          // Take profit hit
          await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT');
          closed = true;
        }
      } else if (activeTrade.type === 'SELL') {
        if (price >= sl) {
          await closeTrade(email, activeTrade.id, price, 'STOP_LOSS');
          closed = true;
        } else if (price <= tp) {
          await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT');
          closed = true;
        }
      }

      if (closed) {
        agentState.activeTradeId = null;
        // Reset daily loss if needed (we'll update when closing)
      }
      return; // Skip new signal if trade was open
    }

    // 3. No open trade – get AI signal
    const indicators = { rsi: 50, ema: price * 0.99, macd: 0.01 }; // mock – you can compute real ones
    const signal = await analyze({ market: symbol, price, indicators });
    agentState.lastSignal = signal;

    // 4. Apply risk filters
    const confidenceThreshold = 70;
    if (signal.signal === 'HOLD' || signal.confidence < confidenceThreshold) {
      return; // wait for next loop
    }

    // 5. Check daily limits
    if (agentState.tradesToday >= settings.maxTradesPerDay) {
      console.log('Max trades per day reached.');
      return;
    }
    if (agentState.dailyLoss >= settings.maxDailyLoss) {
      console.log('Max daily loss reached. Stopping agent.');
      agentState.running = false;
      return;
    }

    // 6. Position sizing
    const account = await client.accountInfo();
    const usdtBalance = account.balances.find(b => b.asset === 'USDT');
    const balance = parseFloat(usdtBalance?.free || 0);
    const riskPerTrade = 0.02; // 2% of balance
    const amount = balance * riskPerTrade;
    if (amount < 10) {
      console.log('Insufficient balance to trade.');
      return;
    }

    // 7. Place market order
    const side = signal.signal.toLowerCase();
    const quantity = amount / price;
    const order = await client.order({
      symbol,
      side: side,
      type: 'MARKET',
      quantity: quantity,
    });

    // 8. Calculate stop‑loss and take‑profit prices
    const slPercent = settings.stopLossPercent || 2;
    const tpPercent = settings.takeProfitPercent || 5;
    let stopLoss, takeProfit;
    if (side === 'buy') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }

    // 9. Save trade to Supabase
    const tradeId = uuidv4();
    const tradeRecord = {
      id: tradeId,
      symbol,
      type: signal.signal,
      entryPrice: price,
      quantity,
      stopLoss,
      takeProfit,
      status: 'open',
      openedAt: new Date().toISOString(),
    };
    await logTrade(email, tradeRecord);
    agentState.activeTradeId = tradeId;
    agentState.tradesToday++;

    console.log(`Trade executed: ${signal.signal} ${symbol} at ${price}, SL: ${stopLoss}, TP: ${takeProfit}`);
  } catch (error) {
    console.error('Agent loop error:', error);
  }
}

// ─── Close a trade and update PnL ──────────────────────────────────
async function closeTrade(email, tradeId, exitPrice, reason) {
  // Fetch the trade
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .single();
  if (error || !data) return;

  const pnl = (data.type === 'BUY')
    ? (exitPrice - data.entry_price) * data.quantity
    : (data.entry_price - exitPrice) * data.quantity;

  await supabase
    .from('trades')
    .update({
      exit_price: exitPrice,
      pnl: pnl,
      status: 'closed',
      closed_at: new Date().toISOString(),
      close_reason: reason,
    })
    .eq('id', tradeId);

  // Update daily loss
  if (pnl < 0) agentState.dailyLoss += Math.abs(pnl);
  agentState.totalPnL += pnl;
  agentState.activeTradeId = null;
}

// ─── Agent control endpoints ──────────────────────────────────────
router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  if (agentState.running) {
    return res.json({ status: 'already running' });
  }

  // Reset daily counters if needed (or fetch from DB)
  agentState.tradesToday = 0;
  agentState.dailyLoss = 0;

  // Start the interval (every 60 seconds)
  agentState.intervalId = setInterval(() => agentLoop(email), 60000);
  agentState.running = true;

  res.json({ status: 'started' });
});

router.post('/stop', async (req, res) => {
  if (agentState.intervalId) {
    clearInterval(agentState.intervalId);
    agentState.intervalId = null;
  }
  agentState.running = false;
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  res.json({
    running: agentState.running,
    lastSignal: agentState.lastSignal,
    tradesToday: agentState.tradesToday,
    dailyLoss: agentState.dailyLoss,
    totalPnL: agentState.totalPnL,
    activeTradeId: agentState.activeTradeId,
  });
});

module.exports = router;
