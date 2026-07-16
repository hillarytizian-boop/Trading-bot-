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
    console.error(`Model ${model} failed:`, error.message);
    return { model, success: false, error: error.message };
  }
}

// ─── Auto-trade endpoint ──────────────────────────────────────────
router.post('/auto', async (req, res) => {
  const { email, symbol, price, indicators, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // ─── Get NVIDIA AI signal ──────────────────────────────────────
    const rsi = indicators?.rsi ?? 50;
    const macd = indicators?.macd ?? 0;
    const ema = indicators?.ema ?? price;

    const prompt = `You are a professional crypto trading analyst.
Current BTC/USDT price: $${price}
RSI: ${rsi}
EMA: ${ema}
MACD: ${macd}
Provide a trading signal (BUY, SELL, or HOLD) with:
- confidence (0-100)
- brief reason (max 30 words)
Respond ONLY with valid JSON: {"signal":"BUY","confidence":85,"reason":"RSI oversold"}`;

    const results = await Promise.allSettled(
      MODELS.map(model => queryNvidiaModel(model, prompt))
    );
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length === 0) {
      return res.json({ signal: 'HOLD', confidence: 30, reason: 'NVIDIA unavailable' });
    }

    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);
    const reasons = successful.map(d => d.reason);

    const decision = {
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `NVIDIA AI: ${reasons.join(' ')}`,
      breakdown: successful.map((d, i) => ({
        model: MODELS[i] || 'unknown',
        signal: d.signal,
        confidence: d.confidence,
        reason: d.reason,
      })),
    };

    // ─── Auto-enter trade if BUY/SELL with confidence >= 60 ──────
    if (decision.signal !== 'HOLD' && decision.confidence >= 60) {
      // Check if there's already an open trade
      const existing = await supabase
        .from('trades')
        .select('*')
        .eq('user_email', email)
        .eq('status', 'open')
        .single();

      if (!existing.data) {
        // Get user balance
        const user = await supabase
          .from('users')
          .select('paper_balance')
          .eq('email', email)
          .single();
        const balance = user.data?.paper_balance || 1000;

        // Position sizing
        const tradeAmount = Math.min(balance * 0.01, 0.50);
        const quantity = tradeAmount / price;

        // Stop loss and take profit (AI decided)
        const slPercent = 2;
        const tpPercent = 5;
        let stopLoss, takeProfit;
        if (decision.signal === 'BUY') {
          stopLoss = price * (1 - slPercent / 100);
          takeProfit = price * (1 + tpPercent / 100);
        } else {
          stopLoss = price * (1 + slPercent / 100);
          takeProfit = price * (1 - tpPercent / 100);
        }

        // Enter trade
        const tradeId = uuidv4();
        await supabase.from('trades').insert([{
          id: tradeId,
          user_email: email,
          symbol: symbol || 'BTCUSDT',
          type: decision.signal,
          entry_price: price,
          quantity: quantity,
          stop_loss: stopLoss,
          take_profit: takeProfit,
          status: 'open',
          opened_at: new Date().toISOString(),
          signal_confidence: decision.confidence,
          signal_reason: decision.reason,
          is_paper: true,
        }]);

        decision.trade = {
          id: tradeId,
          type: decision.signal,
          entryPrice: price,
          quantity,
          stopLoss,
          takeProfit,
        };
      }
    }

    // ─── Auto-exit check ──────────────────────────────────────────
    if (existing?.data) {
      const trade = existing.data;
      const entry = trade.entry_price;
      const sl = trade.stop_loss;
      const tp = trade.take_profit;
      let closed = false;

      if (trade.type === 'BUY') {
        if (price <= sl) {
          const pnl = (price - entry) * trade.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: 'STOP_LOSS',
          }).eq('id', trade.id);
          closed = true;
        } else if (price >= tp) {
          const pnl = (price - entry) * trade.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: 'TAKE_PROFIT',
          }).eq('id', trade.id);
          closed = true;
        }
      } else {
        if (price >= sl) {
          const pnl = (entry - price) * trade.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: 'STOP_LOSS',
          }).eq('id', trade.id);
          closed = true;
        } else if (price <= tp) {
          const pnl = (entry - price) * trade.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: 'TAKE_PROFIT',
          }).eq('id', trade.id);
          closed = true;
        }
      }
      if (closed) {
        decision.exit = { type: 'EXIT', price, reason: 'SL/TP hit' };
      }
    }

    res.json(decision);
  } catch (error) {
    console.error('[AutoTrade] Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 30, reason: 'Error: ' + error.message });
  }
});

module.exports = router;
