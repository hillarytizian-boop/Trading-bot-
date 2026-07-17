const router = require('express').Router();
const supabase = require('../db');
const { getAIAnalysis } = require('./ai.js');
const { v4: uuidv4 } = require('uuid');
const Binance = require('binance-api-node').default;
const HttpsProxyAgent = require('https-proxy-agent');

const PROXY_URL = process.env.PROXY_URL || 'http://qsbykpgrqjh5:n0gsca0jpuzio8h@209.50.183.159:3129';
const agent = new HttpsProxyAgent(PROXY_URL);

// ─── 2. Prevent duplicate loops ────────────────────────────────────
const activeLoops = new Map();

async function loadState(email) {
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
      paperBalance: 1000,
      priceHistory: [],
      activeTradeId: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      totalPnL: 0,
    };
  }
  return data.agent_state;
}

async function saveState(email, state) {
  await supabase.from('users').update({ agent_state: state }).eq('email', email);
}

async function storeSignal(email, symbol, aiResult, price) {
  try {
    const signal = {
      user_email: email,
      symbol: symbol,
      signal: aiResult.signal || 'HOLD',
      confidence: aiResult.confidence || 0,
      reason: aiResult.reason || '',
      trend: aiResult.trend || null,
      market_regime: aiResult.market_regime || null,
      entry_price: aiResult.entry_price || price || null,
      stop_loss: aiResult.stop_loss || null,
      take_profit: aiResult.take_profit || null,
      risk_reward: aiResult.risk_reward || null,
      expected_move_percent: aiResult.expected_move_percent || null,
      trade_duration: aiResult.trade_duration || null,
      pros: aiResult.pros || null,
      cons: aiResult.cons || null,
      indicator_scores: aiResult.indicator_scores || null,
      data: aiResult.data || null,
    };
    await supabase.from('signals').insert([signal]);
  } catch (e) {
    console.error('[Agent] Failed to store signal:', e.message);
  }
}

async function getPrice(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('/', '')}`;
    const res = await fetch(url, { agent, timeout: 5000 });
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.error('[Agent] Price fetch error:', e.message);
    return null;
  }
}

async function agentLoop(email) {
  const state = await loadState(email);
  if (!state.running) return;

  try {
    const user = await supabase
      .from('users')
      .select('bot_settings, paper_balance, binance_api_key, binance_secret_key')
      .eq('email', email)
      .single();
    const settings = user.data || {};
    const isPaper = settings.bot_settings?.paperMode !== false;
    const symbol = settings.bot_settings?.market || 'BTCUSDT';

    const price = await getPrice(symbol);

    // ─── 9. Prevent stale prices ──────────────────────────────────
    if (!Number.isFinite(price)) {
      throw new Error('Invalid market price');
    }

    state.priceHistory.push(price);
    if (state.priceHistory.length > 100) state.priceHistory.shift();

    const aiResult = await getAIAnalysis(email, symbol, price, state.priceHistory);
    await storeSignal(email, symbol, aiResult, price);

    // ─── Check open trade ──────────────────────────────────────────
    if (state.activeTradeId) {
      const { data: trade } = await supabase
        .from('trades')
        .select('*')
        .eq('id', state.activeTradeId)
        .single();

      if (trade && trade.status === 'open') {
        const entry = trade.entry_price;
        let sl = trade.stop_loss;
        let tp = trade.take_profit;
        const elapsed = (new Date() - new Date(trade.opened_at)) / 1000;

        // ─── 8. Trailing stop ──────────────────────────────────────
        if (trade.type === 'BUY' && price > entry * 1.02) {
          const newSl = Math.max(sl, price * 0.995);
          if (newSl > sl) {
            await supabase
              .from('trades')
              .update({ stop_loss: newSl })
              .eq('id', trade.id);
            sl = newSl;
          }
        }
        if (trade.type === 'SELL' && price < entry * 0.98) {
          const newSl = Math.min(sl, price * 1.005);
          if (newSl < sl) {
            await supabase
              .from('trades')
              .update({ stop_loss: newSl })
              .eq('id', trade.id);
            sl = newSl;
          }
        }

        let closed = false;
        if (trade.type === 'BUY') {
          if (price <= sl || price >= tp || elapsed > 120) closed = true;
        } else {
          if (price >= sl || price <= tp || elapsed > 120) closed = true;
        }
        if (closed) {
          const pnl = (trade.type === 'BUY') ? (price - entry) * trade.quantity : (entry - price) * trade.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
          }).eq('id', state.activeTradeId);

          if (isPaper) state.paperBalance += pnl;
          state.totalPnL += pnl;
          if (pnl > 0) state.consecutiveWins++; else state.consecutiveLosses++;
          if (pnl < 0) state.dailyLoss += Math.abs(pnl);
          state.activeTradeId = null;
          await saveState(email, state);
        }
        return;
      } else {
        state.activeTradeId = null;
        await saveState(email, state);
      }
    }

    // ─── 4. Minimum confidence (configurable) ─────────────────────
    const minConf = settings.bot_settings?.minimumConfidence || 80;
    if (aiResult.signal === 'HOLD' || aiResult.confidence < minConf) {
      await saveState(email, state);
      return;
    }

    // ─── 5. Stop after consecutive losses ─────────────────────────
    if (state.consecutiveLosses >= 3) {
      console.log(`[Agent] Trading paused for ${email} after 3 consecutive losses.`);
      state.running = false;
      await saveState(email, state);
      activeLoops.delete(email);
      return;
    }

    // ─── 6. Daily loss limit ──────────────────────────────────────
    const maxDailyLoss = settings.bot_settings?.maxDailyLoss || 20;
    if (state.dailyLoss >= maxDailyLoss) {
      console.log(`[Agent] Daily loss limit reached (${state.dailyLoss} >= ${maxDailyLoss}). Stopping.`);
      state.running = false;
      await saveState(email, state);
      activeLoops.delete(email);
      return;
    }

    // ─── 7. Cooldown after same‑direction closed trade ────────────
    const { data: lastTrade } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .eq('symbol', symbol)
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();
    if (lastTrade && lastTrade.type === aiResult.signal && lastTrade.status === 'closed') {
      const diff = Date.now() - new Date(lastTrade.closed_at).getTime();
      if (diff < 300000) { // 5 minutes
        console.log(`[Agent] Cooldown active for ${symbol} (${aiResult.signal}). Skipping.`);
        await saveState(email, state);
        return;
      }
    }

    // ─── Determine balance ──────────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = state.paperBalance;
    } else {
      if (!settings.binance_api_key) { await saveState(email, state); return; }
      const client = Binance({
        apiKey: settings.binance_api_key,
        secretKey: settings.binance_secret_key,
        httpsAgent: agent,
      });
      const account = await client.accountInfo();
      const usdt = account.balances.find(b => b.asset === 'USDT');
      balance = usdt ? parseFloat(usdt.free) : 0;
    }

    if (balance < 1) { await saveState(email, state); return; }

    // ─── 3. Position sizing (configurable max) ────────────────────
    let tradeAmount = Math.min(
      balance * 0.01,
      settings.bot_settings?.maxTradeAmount || 5
    );
    tradeAmount = Math.max(tradeAmount, 1); // min $1

    const quantity = tradeAmount / price;

    // ─── 1. Use AI's SL/TP if provided ────────────────────────────
    let stopLoss = Number(aiResult.stop_loss);
    let takeProfit = Number(aiResult.take_profit);
    if (!stopLoss || !takeProfit) {
      const slPercent = 2;
      const tpPercent = 5;
      if (aiResult.signal === 'BUY') {
        stopLoss = price * (1 - slPercent / 100);
        takeProfit = price * (1 + tpPercent / 100);
      } else {
        stopLoss = price * (1 + slPercent / 100);
        takeProfit = price * (1 - tpPercent / 100);
      }
    }

    // ─── 10. Execute real Binance order if live ──────────────────
    if (!isPaper) {
      const client = Binance({
        apiKey: settings.binance_api_key,
        secretKey: settings.binance_secret_key,
        httpsAgent: agent,
      });
      try {
        const order = await client.order({
          symbol: symbol.replace('/', ''),
          side: aiResult.signal === 'BUY' ? 'BUY' : 'SELL',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });
        console.log(`[Agent] Live order placed:`, order);
      } catch (orderError) {
        console.error('[Agent] Failed to place live order:', orderError.message);
        return; // don't record trade if order fails
      }
    }

    // ─── Record trade in Supabase ──────────────────────────────────
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
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

    state.activeTradeId = tradeId;
    state.tradesToday++;
    await saveState(email, state);
    console.log(`📈 AGENT: ${aiResult.signal} ${symbol} at ${price}, amount $${tradeAmount.toFixed(2)}`);

  } catch (error) {
    console.error('[Agent] Loop error:', error.message);
  } finally {
    const refreshed = await loadState(email);
    if (refreshed.running) {
      setTimeout(() => agentLoop(email), 5000);
    } else {
      activeLoops.delete(email);
    }
  }
}

// ─── Endpoints ──────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const email = req.user?.email || req.body.email || 'demo@example.com';

  // ─── 2. Prevent duplicate loops ──────────────────────────────────
  if (activeLoops.has(email)) {
    return res.json({ status: 'already running' });
  }

  const state = await loadState(email);
  if (state.running) return res.json({ status: 'already running' });

  state.running = true;
  state.tradesToday = 0;
  state.dailyLoss = 0;
  state.totalPnL = 0;
  state.consecutiveWins = 0;
  state.consecutiveLosses = 0;
  state.activeTradeId = null;
  await saveState(email, state);

  activeLoops.set(email, true);
  setTimeout(() => agentLoop(email), 1000);

  res.json({ status: 'started' });
});

router.post('/stop', async (req, res) => {
  const email = req.user?.email || req.body.email || 'demo@example.com';
  const state = await loadState(email);
  state.running = false;
  await saveState(email, state);
  activeLoops.delete(email);
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  const email = req.user?.email || req.query.email || 'demo@example.com';
  const state = await loadState(email);
  res.json(state);
});

router.get('/latest-signal', async (req, res) => {
  const email = req.user?.email || req.query.email || 'demo@example.com';
  const { symbol } = req.query;
  try {
    const query = supabase
      .from('signals')
      .select('*')
      .eq('user_email', email);
    if (symbol) {
      const cleanSymbol = symbol.replace(/\//g, '');
      query.eq('symbol', cleanSymbol);
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    res.json(data?.[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
