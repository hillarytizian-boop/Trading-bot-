const router = require('express').Router();
const supabase = require('../db');
const { getAnalysis } = require('./ai');
const { v4: uuidv4 } = require('uuid');
const technical = require('technicalindicators');
const Binance = require('binance-api-node').default;

// ─── CONFIG ──────────────────────────────────────────────────────────
const CONFIG = {
  baseConfidenceThreshold: 50,
  minConfidenceThreshold: 30,
  maxTradeAmount: 0.50,
  minTradeAmount: 0.10,
  riskPerTrade: 0.01,          // 1% of balance (will be adjusted)
  stopLossPercent: 2,
  takeProfitPercent: 5,
  maxDailyLoss: 0.05,
  kellyFraction: 0.25,         // use 25% of Kelly for safety
};

// ─── PERSISTENT STATE ──────────────────────────────────────────────
async function loadAgentState(email) {
  const { data, error } = await supabase
    .from('users')
    .select('agent_state')
    .eq('email', email)
    .single();
  if (error || !data?.agent_state) {
    return {
      running: false,
      tradesToday: 0,
      dailyLoss: 0,
      totalPnL: 0,
      activeTradeId: null,
      tradeOpenTime: null,
      paperBalance: 1000,
      priceHistory: [],
      lastSignal: null,
      lastTradeAttempt: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      startingBalance: 1000,
      tradeHistory: [],
      // Performance tracking
      signalStats: { BUY: { wins: 0, losses: 0 }, SELL: { wins: 0, losses: 0 } },
    };
  }
  return data.agent_state;
}

async function saveAgentState(email, state) {
  await supabase.from('users').update({ agent_state: state }).eq('email', email);
}

async function getCandles(symbol, interval = '1m', limit = 50) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => parseFloat(c[4]));
}

// ─── RISK OF RUIN ───────────────────────────────────────────────────
function riskOfRuin(winRate, riskPerTrade) {
  if (winRate <= 0 || winRate >= 1) return 0;
  const lossRate = 1 - winRate;
  const r = lossRate / winRate;
  if (r >= 1) return 1; // edge case
  return Math.pow(r, 0.5 / riskPerTrade);
}

// ─── KELLY SIZING ──────────────────────────────────────────────────
function kellyFraction(winRate, avgWin, avgLoss) {
  if (avgLoss === 0) return 0;
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const k = (p * b - q) / b;
  return Math.max(0, Math.min(k, 0.1)); // cap at 10%
}

// ─── MAIN AGENT LOOP ──────────────────────────────────────────────
let processingLock = false;

async function agentLoop(email) {
  if (processingLock) return;
  processingLock = true;

  try {
    const state = await loadAgentState(email);
    if (!state.running) { processingLock = false; return; }

    const settingsRes = await supabase
      .from('users')
      .select('bot_settings, paper_balance, binance_api_key, binance_secret_key')
      .eq('email', email)
      .single();
    const settings = settingsRes.data || {};
    const isPaper = settings.bot_settings?.paperMode !== false;
    const symbol = settings.bot_settings?.market || 'BTCUSDT';

    // Get price and update history
    const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const priceData = await priceRes.json();
    const price = parseFloat(priceData.price);
    if (!price) { processingLock = false; return; }

    state.priceHistory.push(price);
    if (state.priceHistory.length > 100) state.priceHistory.shift();
    if (state.priceHistory.length < 20) {
      const closes = await getCandles(symbol);
      state.priceHistory = closes;
    }

    // ─── Check open trade ──────────────────────────────────────────
    if (state.activeTradeId) {
      const trade = await supabase
        .from('trades')
        .select('*')
        .eq('id', state.activeTradeId)
        .single();
      if (trade.data) {
        const t = trade.data;
        const entry = t.entry_price;
        const sl = t.stop_loss;
        const tp = t.take_profit;
        const openedAt = new Date(t.opened_at);
        const elapsed = (new Date() - openedAt) / 1000;
        let closed = false;
        if (t.type === 'BUY') {
          if (price <= sl || price >= tp || elapsed > 120) closed = true;
        } else {
          if (price >= sl || price <= tp || elapsed > 120) closed = true;
        }
        if (closed) {
          const pnl = (t.type === 'BUY') ? (price - entry) * t.quantity : (entry - price) * t.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: 'SL/TP/TIME',
          }).eq('id', state.activeTradeId);

          // Update performance stats
          const sigType = t.type;
          if (pnl > 0) {
            state.signalStats[sigType].wins += 1;
          } else {
            state.signalStats[sigType].losses += 1;
          }

          if (isPaper) {
            state.paperBalance += pnl;
          }
          state.activeTradeId = null;
          state.tradeOpenTime = null;
          if (pnl > 0) state.consecutiveWins++; else state.consecutiveLosses++;
          state.totalPnL += pnl;
          if (pnl < 0) state.dailyLoss += Math.abs(pnl);
          await saveAgentState(email, state);
          processingLock = false;
          return;
        }
      } else {
        state.activeTradeId = null;
        await saveAgentState(email, state);
        processingLock = false;
        return;
      }
      processingLock = false;
      return;
    }

    // ─── Get signal ──────────────────────────────────────────────────
    const closes = state.priceHistory;
    if (closes.length < 20) { processingLock = false; return; }

    // Compute indicators for AI
    const rsi = technical.RSI.calculate({ values: closes, period: 14 });
    const macd = technical.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
    });
    const ind = {
      rsi: rsi[rsi.length-1],
      macd: macd[macd.length-1],
      closes: closes,
    };

    // AI analysis (passes closes for enhanced fallback)
    const aiResult = await getAnalysis(
      symbol,
      price,
      { rsi: ind.rsi, macd: ind.macd ? ind.macd.MACD : 0, closes: closes },
      email
    );
    state.lastSignal = aiResult;

    // ─── Adaptive confidence based on volatility ──────────────────
    // Compute volatility (ATR approximation)
    const atr = (Math.max(...closes.slice(-20)) - Math.min(...closes.slice(-20))) / 20;
    const volPct = atr / price;
    let threshold = CONFIG.baseConfidenceThreshold;
    if (volPct > 0.03) threshold = Math.max(CONFIG.minConfidenceThreshold, threshold - 10); // lower in high vol
    else if (volPct < 0.01) threshold = Math.min(70, threshold + 10); // higher in low vol

    const finalSignal = (aiResult.signal !== 'HOLD' && aiResult.confidence >= threshold)
      ? aiResult.signal
      : 'HOLD';

    if (finalSignal === 'HOLD') {
      state.lastTradeAttempt = `HOLD (${aiResult.confidence}%)`;
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Determine balance ──────────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = state.paperBalance;
    } else {
      if (!settings.binance_api_key) {
        state.lastTradeAttempt = 'Binance not connected';
        await saveAgentState(email, state);
        processingLock = false;
        return;
      }
      const client = Binance({ apiKey: settings.binance_api_key, secretKey: settings.binance_secret_key });
      const account = await client.accountInfo();
      const usdt = account.balances.find(b => b.asset === 'USDT');
      balance = usdt ? parseFloat(usdt.free) : 0;
    }

    if (balance < 1) {
      state.lastTradeAttempt = 'Balance < $1';
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Kelly sizing ──────────────────────────────────────────────
    const stats = state.signalStats[finalSignal];
    const total = stats.wins + stats.losses;
    let winRate = total > 0 ? stats.wins / total : 0.5;
    // Use overall win rate if specific signal has too few trades
    const totalTrades = Object.values(state.signalStats).reduce((s, t) => s + t.wins + t.losses, 0);
    if (total < 5) {
      winRate = totalTrades > 0 ? (Object.values(state.signalStats).reduce((s, t) => s + t.wins, 0) / totalTrades) : 0.5;
    }
    // Average win/loss (global)
    const trades = await supabase
      .from('trades')
      .select('pnl')
      .eq('user_email', email)
      .eq('status', 'closed');
    const pnls = trades.data?.map(t => t.pnl) || [];
    const avgWin = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0) / (pnls.filter(p => p > 0).length || 1);
    const avgLoss = Math.abs(pnls.filter(p => p < 0).reduce((a, b) => a + b, 0)) / (pnls.filter(p => p < 0).length || 1);

    let kelly = kellyFraction(winRate, avgWin || 1, avgLoss || 1);
    kelly *= CONFIG.kellyFraction; // 25% of Kelly
    kelly = Math.max(0.005, Math.min(kelly, 0.03)); // clamp between 0.5% and 3%

    // Risk-of-ruin check
    const ror = riskOfRuin(winRate, kelly);
    if (ror > 0.1) {
      kelly *= 0.5; // reduce risk if ruin probability too high
    }

    const tradeAmount = Math.max(CONFIG.minTradeAmount, Math.min(balance * kelly, CONFIG.maxTradeAmount));
    const quantity = tradeAmount / price;

    // ─── Stop Loss / Take Profit ──────────────────────────────────
    const slPercent = CONFIG.stopLossPercent;
    const tpPercent = CONFIG.takeProfitPercent;
    let stopLoss, takeProfit;
    if (finalSignal === 'BUY') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }

    // ─── Execute trade ──────────────────────────────────────────────
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: symbol,
      type: finalSignal,
      entry_price: price,
      quantity: quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      duration: 120,
      signal_confidence: aiResult.confidence,
      signal_reason: aiResult.reason || 'AI signal',
      status: 'open',
      opened_at: new Date().toISOString(),
      is_paper: isPaper,
    }]);

    state.activeTradeId = tradeId;
    state.tradeOpenTime = new Date();
    state.tradesToday++;
    state.lastTradeAttempt = `✅ ${finalSignal} at ${price} ($${tradeAmount.toFixed(2)})`;
    await saveAgentState(email, state);

    console.log(`📄 ${isPaper ? 'PAPER' : 'REAL'} TRADE: ${finalSignal} ${symbol} at ${price} ($${tradeAmount.toFixed(2)})`);

  } catch (error) {
    console.error('[Agent] Loop error:', error);
  } finally {
    processingLock = false;
    const state = await loadAgentState(email);
    if (state.running) {
      setTimeout(() => agentLoop(email), 5000);
    }
  }
}

// ─── ENDPOINTS ──────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const state = await loadAgentState(email);
    if (state.running) return res.json({ status: 'already running' });

    state.running = true;
    state.tradesToday = 0;
    state.dailyLoss = 0;
    state.totalPnL = 0;
    state.priceHistory = [];
    state.lastTradeAttempt = null;

    const settings = (await supabase.from('users').select('bot_settings').eq('email', email).single()).data || {};
    const symbol = settings.bot_settings?.market || 'BTCUSDT';
    const closes = await getCandles(symbol);
    state.priceHistory = closes;

    await saveAgentState(email, state);
    processingLock = false;
    setTimeout(() => agentLoop(email), 1000);

    res.json({ status: 'started' });
  } catch (err) {
    console.error('[Agent] Start error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const state = await loadAgentState(email);
  state.running = false;
  await saveAgentState(email, state);
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const state = await loadAgentState(email);
  res.json(state);
});

module.exports = router;
