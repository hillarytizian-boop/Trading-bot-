const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;
const { analyze } = require('./ai');

let agentState = {
  running: false,
  intervalId: null,
  lastSignal: null,
  tradesToday: 0,
  dailyLoss: 0,
  totalPnL: 0,
};

async function getBinanceClient(email) {
  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();
  if (error || !data?.binance_api_key) throw new Error('Binance not connected');
  return Binance({ apiKey: data.binance_api_key, secretKey: data.binance_secret_key });
}

async function getSettings(email) {
  const { data, error } = await supabase
    .from('users')
    .select('bot_settings')
    .eq('email', email)
    .single();
  return data?.bot_settings || {};
}

async function logTrade(email, trade) {
  await supabase.from('trades').insert([{
    user_email: email,
    symbol: trade.symbol,
    type: trade.type,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice || null,
    quantity: trade.quantity,
    pnl: trade.pnl || 0,
    opened_at: trade.openedAt || new Date().toISOString(),
    status: trade.status || 'open',
  }]);
}

async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const client = await getBinanceClient(email);
    const ticker = await client.prices({ symbol: 'BTCUSDT' });
    const price = parseFloat(ticker.BTCUSDT);

    const indicators = { rsi: 55, ema: price * 0.99, macd: 0.01 };

    const signal = await analyze({ market: 'BTCUSDT', price, indicators });
    agentState.lastSignal = signal;

    if (signal.signal !== 'HOLD' && signal.confidence > 70) {
      const settings = await getSettings(email);
      const maxTrades = settings?.maxTradesPerDay || 30;

      if (agentState.tradesToday >= maxTrades) {
        console.log('Max trades per day reached.');
        return;
      }

      const account = await client.accountInfo();
      const usdtBalance = account.balances.find(b => b.asset === 'USDT');
      const balance = parseFloat(usdtBalance?.free || 0);
      const riskPerTrade = 0.02;
      const amount = balance * riskPerTrade;

      if (amount < 10) {
        console.log('Insufficient balance to trade.');
        return;
      }

      const side = signal.signal.toLowerCase();
      const order = await client.order({
        symbol: 'BTCUSDT',
        side: side,
        type: 'MARKET',
        quantity: amount / price,
      });

      await logTrade(email, {
        symbol: 'BTCUSDT',
        type: signal.signal,
        entryPrice: price,
        quantity: amount / price,
        status: 'open',
        openedAt: new Date().toISOString(),
      });
      agentState.tradesToday++;
      console.log(`Trade executed: ${signal.signal} BTCUSDT at ${price}`);
    }
  } catch (error) {
    console.error('Agent loop error:', error);
  }
}

router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  if (agentState.running) {
    return res.json({ status: 'already running' });
  }

  agentState.tradesToday = 0;
  agentState.dailyLoss = 0;

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
  });
});

module.exports = router;
