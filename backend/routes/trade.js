const router = require('express').Router();
const supabase = require('../db');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODELS = ['deepseek-ai/deepseek-v4-pro', 'z-ai/glm-5.2'];

async function queryNvidiaModel(model, prompt) {
  try {
    const completion = await nvidiaClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 256,
      stream: false,
    });
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined) {
        return { model, success: true, data: parsed };
      }
    }
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200) || 'Analysis complete',
      },
    };
  } catch (error) {
    return { model, success: false, error: error.message };
  }
}

// ─── Multi-timeframe check ──────────────────────────────────────
async function checkTimeframes(symbol, price) {
  const timeframes = ['1m', '5m', '15m'];
  const signals = [];
  for (const tf of timeframes) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=20`;
      const res = await fetch(url);
      const data = await res.json();
      const closes = data.map(c => parseFloat(c[4]));
      const rsi = closes.length > 14 ? (() => {
        let gains = 0, losses = 0;
        for (let i = 1; i < closes.length; i++) {
          const diff = closes[i] - closes[i-1];
          if (diff >= 0) gains += diff;
          else losses += -diff;
        }
        const avgGain = gains / (closes.length - 1);
        const avgLoss = losses / (closes.length - 1);
        if (avgLoss === 0) return 100;
        return 100 - (100 / (1 + avgGain / avgLoss));
      })() : 50;
      if (rsi < 45) signals.push('BUY');
      else if (rsi > 55) signals.push('SELL');
      else signals.push('HOLD');
    } catch (e) {
      signals.push('HOLD');
    }
  }
  const buyCount = signals.filter(s => s === 'BUY').length;
  const sellCount = signals.filter(s => s === 'SELL').length;
  return buyCount >= 2 ? 'BUY' : sellCount >= 2 ? 'SELL' : 'HOLD';
}

// ─── Main auto-trade endpoint ──────────────────────────────────
router.post('/auto', async (req, res) => {
  const { email, symbol, price, indicators, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const rsi = indicators?.rsi ?? 50;
    const macd = indicators?.macd ?? 0;
    const ema = indicators?.ema ?? price;
    const market = symbol || 'BTCUSDT';

    // ─── 1. Multi-timeframe confirmation ──────────────────────
    const tfSignal = await checkTimeframes(market, price);
    if (tfSignal === 'HOLD') {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Timeframes disagree' });
    }

    // ─── 2. NVIDIA AI signal ──────────────────────────────────
    const prompt = `Current BTC/USDT price: $${price}, RSI: ${rsi}, EMA: ${ema}, MACD: ${macd}. Provide signal (BUY/SELL/HOLD) with confidence and reason. JSON only.`;
    const results = await Promise.allSettled(MODELS.map(m => queryNvidiaModel(m, prompt)));
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value.data);
    if (successful.length === 0) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'NVIDIA unavailable' });
    }
    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);

    // ─── 3. Adaptive confidence ───────────────────────────────
    const threshold = (tfSignal === finalSignal) ? 50 : 60;
    if (finalSignal === 'HOLD' || avgConfidence < threshold) {
      return res.json({ signal: 'HOLD', confidence: avgConfidence, reason: 'Low confidence' });
    }

    // ─── 4. Check open trade ──────────────────────────────────
    const existing = await supabase.from('trades').select('*').eq('user_email', email).eq('status', 'open').single();
    if (existing.data) {
      // ─── 5. Trailing stop & exit ─────────────────────────────
      const trade = existing.data;
      const entry = trade.entry_price;
      const sl = trade.stop_loss;
      const tp = trade.take_profit;
      let pnl = 0, closed = false;

      if (trade.type === 'BUY') {
        if (price <= sl) { pnl = (price - entry) * trade.quantity; closed = true; }
        else if (price >= tp) { pnl = (price - entry) * trade.quantity; closed = true; }
        else if (price > entry * 1.02) {
          await supabase.from('trades').update({ stop_loss: entry }).eq('id', trade.id);
        }
      } else {
        if (price >= sl) { pnl = (entry - price) * trade.quantity; closed = true; }
        else if (price <= tp) { pnl = (entry - price) * trade.quantity; closed = true; }
        else if (price < entry * 0.98) {
          await supabase.from('trades').update({ stop_loss: entry }).eq('id', trade.id);
        }
      }
      if (closed) {
        await supabase.from('trades').update({
          exit_price: price,
          pnl: pnl,
          status: 'closed',
          closed_at: new Date().toISOString(),
          close_reason: pnl > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
        }).eq('id', trade.id);
        return res.json({ signal: 'EXIT', confidence: 100, reason: `Trade closed with ${pnl > 0 ? 'profit' : 'loss'}` });
      }
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trade active' });
    }

    // ─── 6. Volume confirmation ──────────────────────────────
    let volumeOk = true;
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${market}&interval=1m&limit=20`;
      const res = await fetch(url);
      const data = await res.json();
      const volumes = data.map(c => parseFloat(c[5]));
      const avgVolume = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / (volumes.length - 1);
      const currentVolume = volumes[volumes.length-1];
      if (currentVolume < avgVolume * 0.7) volumeOk = false;
    } catch (e) { volumeOk = true; }
    if (!volumeOk) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Low volume' });
    }

    // ─── 7. Position sizing (Kelly) ───────────────────────────
    const user = await supabase.from('users').select('paper_balance').eq('email', email).single();
    const balance = user.data?.paper_balance || 1000;
    const riskPct = avgConfidence > 80 ? 0.02 : 0.01;
    const tradeAmount = Math.min(balance * riskPct, 0.50);
    const quantity = tradeAmount / price;

    const slPercent = 2;
    const tpPercent = 5;
    let stopLoss, takeProfit;
    if (finalSignal === 'BUY') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }

    // ─── 8. Enter trade ────────────────────────────────────────
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: market,
      type: finalSignal,
      entry_price: price,
      quantity: quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: 'open',
      opened_at: new Date().toISOString(),
      signal_confidence: avgConfidence,
      signal_reason: successful.map(d => d.reason).join(' '),
      is_paper: true,
    }]);

    res.json({
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `NVIDIA AI: ${successful.map(d => d.reason).join(' ')}`,
      trade: { id: tradeId, type: finalSignal, entryPrice: price, quantity, stopLoss, takeProfit },
    });
  } catch (error) {
    console.error('[AutoTrade] Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

module.exports = router;
