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
        reason: content.slice(0, 200) || 'No reason',
      },
    };
  } catch (error) {
    return { model, success: false, error: error.message };
  }
}

router.post('/auto', async (req, res) => {
  const { email, symbol, price, indicators } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const rsi = indicators?.rsi ?? 50;
    const macd = indicators?.macd ?? 0;
    const ema = indicators?.ema ?? price;
    const market = symbol || 'BTCUSDT';

    const prompt = `You are a professional cryptocurrency trader.
Current BTC/USDT price: $${price}
RSI: ${rsi}
MACD: ${macd}
EMA20: ${ema}
EMA50: ${indicators?.ema50 || 'N/A'}
ATR: ${indicators?.atr || 'N/A'}
Respond ONLY as JSON:
{"signal":"BUY","confidence":84,"reason":"..."}
Never return HOLD unless genuinely no edge.`;

    const results = await Promise.allSettled(MODELS.map(m => queryNvidiaModel(m, prompt)));
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value.data);
    if (successful.length === 0) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'NVIDIA unavailable' });
    }

    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);

    if (finalSignal === 'HOLD' || avgConfidence < 60) {
      return res.json({ signal: 'HOLD', confidence: avgConfidence, reason: 'Low confidence' });
    }

    const existing = await supabase.from('trades').select('*').eq('user_email', email).eq('status', 'open').single();
    if (existing.data) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trade active' });
    }

    const user = await supabase.from('users').select('paper_balance').eq('email', email).single();
    const balance = user.data?.paper_balance || 1000;
    const tradeAmount = Math.min(balance * 0.01, 0.50);
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
