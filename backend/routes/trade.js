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
    return {
      model,
      success: true,
      data: {
        signal: 'HOLD',
        confidence: 30,
        reason: 'AI error – holding position',
      },
    };
  }
}

async function calculateATR(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=14`;
    const res = await fetch(url);
    const data = await res.json();
    const highs = data.map(c => parseFloat(c[2]));
    const lows = data.map(c => parseFloat(c[3]));
    const closes = data.map(c => parseFloat(c[4]));
    let trSum = 0;
    for (let i = 1; i < closes.length; i++) {
      trSum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    }
    return trSum / (closes.length - 1);
  } catch (e) {
    return 0.02 * 1000;
  }
}

router.post('/auto', async (req, res) => {
  const { email, symbol, price, indicators, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const market = symbol || 'BTCUSDT';
    const currentPrice = price || 0;

    const atr = await calculateATR(market);
    const slMultiplier = 2.5;
    const tpMultiplier = 5;

    const prompt = `Current BTC/USDT price: $${currentPrice}
RSI: ${indicators?.rsi ?? 50}
MACD: ${indicators?.macd ?? 0}
EMA20: ${indicators?.ema ?? currentPrice}
EMA50: ${indicators?.ema50 ?? 'N/A'}
ATR: ${atr.toFixed(2)}

Provide a trading signal (BUY, SELL, or HOLD) with confidence and reason. Respond with JSON.`;

    const results = await Promise.allSettled(MODELS.map(m => queryNvidiaModel(m, prompt)));
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value.data);
    if (successful.length === 0) {
      return res.json({ signal: 'HOLD', confidence: 30, reason: 'No AI response – holding' });
    }

    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);

    if (finalSignal === 'HOLD' || avgConfidence < 70) {
      return res.json({ signal: 'HOLD', confidence: avgConfidence, reason: 'Low confidence' });
    }

    const existing = await supabase.from('trades').select('*').eq('user_email', email).eq('status', 'open').single();
    if (existing.data) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trade active' });
    }

    const user = await supabase.from('users').select('paper_balance').eq('email', email).single();
    const balance = user.data?.paper_balance || 1000;
    const riskPct = 0.01;
    let tradeAmount = Math.min(balance * riskPct, 0.50);
    tradeAmount = Math.max(tradeAmount, 0.10);
    const quantity = tradeAmount / currentPrice;

    const slDistance = atr * slMultiplier;
    const tpDistance = atr * tpMultiplier;
    let stopLoss, takeProfit;
    if (finalSignal === 'BUY') {
      stopLoss = currentPrice - slDistance;
      takeProfit = currentPrice + tpDistance;
    } else {
      stopLoss = currentPrice + slDistance;
      takeProfit = currentPrice - tpDistance;
    }

    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: market,
      type: finalSignal,
      entry_price: currentPrice,
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
      trade: { id: tradeId, type: finalSignal, entryPrice: currentPrice, quantity, stopLoss, takeProfit },
    });
  } catch (error) {
    console.error('[AutoTrade] Error:', error.message);
    res.json({ signal: 'HOLD', confidence: 20, reason: 'Error – holding position' });
  }
});

module.exports = router;
