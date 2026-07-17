global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');
const { EMA } = require('technicalindicators');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODEL = 'deepseek-ai/deepseek-v4-pro';

async function queryNvidiaModel(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await nvidiaClient.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.4,
        top_p: 0.9,
        max_tokens: 700,
        stream: false,
        timeout: 15000,
      });
      const content = completion.choices[0].message.content;
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON returned');
        parsed = JSON.parse(match[0]);
      }
      if (parsed.signal && parsed.confidence !== undefined) {
        return { success: true, data: parsed };
      }
      const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
      const confidenceMatch = content.match(/(\d{1,3})%/);
      return {
        success: true,
        data: {
          signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
          confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
          reason: content.slice(0, 300),
        },
      };
    } catch (error) {
      lastError = error;
      console.warn(`[AI] Attempt ${attempt+1} failed:`, error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw lastError || new Error('All NVIDIA attempts failed');
}

function computeExtraIndicators(closes, highs, lows, volumes) {
  const avgVolume = volumes && volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  const currentVolume = volumes && volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const support = low * 0.99;
  const resistance = high * 1.01;

  const ema20 = EMA.calculate({ period: 20, values: closes }).at(-1);
  const ema50 = EMA.calculate({ period: 50, values: closes }).at(-1);
  const ema200 = EMA.calculate({ period: 200, values: closes }).at(-1);

  const bullish = ema20 > ema50 && ema50 > ema200;
  const bearish = ema20 < ema50 && ema50 < ema200;
  const trend = bullish ? 'Bullish' : bearish ? 'Bearish' : 'Sideways';

  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
  const highVolume = volumeRatio > 1.5;

  return {
    avgVolume,
    currentVolume,
    high,
    low,
    support,
    resistance,
    trend,
    ema20,
    ema50,
    ema200,
    bullish,
    bearish,
    volumeRatio,
    highVolume,
    trend1m: trend,
    trend5m: trend,
    trend15m: trend,
    trend1h: trend,
  };
}

const MIN_ADX = 20;

async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 50) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data (need ≥50 candles)' };
    }
    const ind = instance.calculateIndicators(data.closes);
    if (!ind || typeof ind.rsi !== "number" || typeof ind.macd !== "number" || typeof ind.ema20 !== "number" || typeof ind.ema50 !== "number" || typeof ind.atr !== "number") {
      return { signal: "HOLD", confidence: 0, reason: "Invalid indicator values" };
    }
    if (!ind) {
      return { signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' };
    }

    const extra = computeExtraIndicators(
      data.closes,
      data.highs || [],
      data.lows || [],
      data.volumes || []
    );
    const currentPrice = price || data.price || ind.currentPrice;

    const adx = ind.adx || 25;
    if (adx < MIN_ADX) {
      return {
        signal: 'HOLD',
        confidence: 40,
        reason: `Weak trend (ADX ${adx.toFixed(1)} < ${MIN_ADX}). Market is ranging.`,
      };
    }

    const { bullish, bearish } = extra;

    const prompt = `You are an institutional-grade cryptocurrency trading analyst specializing in Binance spot and futures markets.

Your objective is to maximize risk-adjusted returns, not the number of trades.

Analyze the following market data:

Market: ${symbol}
Current Price: $${currentPrice}

Technical Indicators
- RSI(14): ${ind.rsi.toFixed(2)}
- MACD: ${ind.macd.toFixed(4)}
- EMA20: ${extra.ema20.toFixed(2)}
- EMA50: ${extra.ema50.toFixed(2)}
- EMA200: ${extra.ema200.toFixed(2)}
- ATR(14): ${ind.atr.toFixed(4)}
- ADX: ${adx.toFixed(2)}
- Bollinger Upper: ${ind.bbUpper.toFixed(2)}
- Bollinger Lower: ${ind.bbLower.toFixed(2)}
- Volume: ${extra.currentVolume}
- Average Volume: ${extra.avgVolume}

Market Structure
- Trend: ${extra.trend}
- Support: $${extra.support.toFixed(2)}
- Resistance: $${extra.resistance.toFixed(2)}
- Recent High: $${extra.high.toFixed(2)}
- Recent Low: $${extra.low.toFixed(2)}

Multi-Timeframe
- 1m Trend: ${extra.trend1m}
- 5m Trend: ${extra.trend5m}
- 15m Trend: ${extra.trend15m}
- 1h Trend: ${extra.trend1h}

Risk Rules
- Never recommend a trade with Risk:Reward below 1:2.
- Reject trades that move directly into support or resistance.
- Reject trades with conflicting multi-timeframe trends.
- A BUY requires at least five bullish confirmations. A SELL requires at least five bearish confirmations.
  Indicators include RSI, MACD, EMA20, EMA50, EMA200, ADX, ATR, Bollinger Bands, Volume, Support/Resistance, Trend.
- Do not recommend trades against the higher timeframe trend.
- Return HOLD if fewer than five confirmations agree.
- Prefer trading with the dominant trend.
- Consider volatility before setting stop-loss.
- If confidence is below 75%, return HOLD.

Evaluate:

1. Trend strength
2. Momentum
3. Volatility
4. Volume confirmation
5. Indicator agreement
6. Breakout or reversal probability
7. Risk versus reward
8. Probability of success

Return ONLY valid JSON.

{
  "signal":"BUY|SELL|HOLD",
  "confidence":0,
  "trend":"Bullish|Bearish|Sideways",
  "market_regime":"Trending|Ranging|High Volatility",
  "entry_price":0,
  "stop_loss":0,
  "take_profit":0,
  "risk_reward":"1:2.5",
  "expected_move_percent":0,
  "trade_duration":"Scalp|Intraday|Swing",
  "reason":"Detailed explanation using all indicators.",
  "pros":[
    "...",
    "...",
    "..."
  ],
  "cons":[
    "...",
    "...",
    "..."
  ],
  "indicator_scores":{
    "RSI":0,
    "MACD":0,
    "EMA":0,
    "ADX":0,
    "Volume":0,
    "Trend":0,
    "SupportResistance":0
  }
}

Do not invent missing information.
If the provided data is insufficient, explain why and return HOLD.
Return only JSON with no markdown or additional text.`;

    let result;
    try {
      result = await queryNvidiaModel(prompt);
    } catch (error) {
      console.error('[AI] All NVIDIA attempts failed:', error.message);
      return { signal: 'HOLD', confidence: 0, reason: 'AI model unavailable' };
    }

    if (!result.success) {
      return { signal: 'HOLD', confidence: 0, reason: 'AI model error' };
    }

    let ai = result.data;

    const confidence = Math.max(0, Math.min(100, Number(ai.confidence) || 0));

    const resistanceDistance = Math.abs(extra.resistance - currentPrice) / currentPrice;
    const supportDistance = Math.abs(currentPrice - extra.support) / currentPrice;

    if (ai.signal === 'BUY' && resistanceDistance < 0.01) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' Too close to resistance.';
    }
    if (ai.signal === 'SELL' && supportDistance < 0.01) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' Too close to support.';
    }

    if (confidence < 75) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' (confidence below 75%)';
    }

    return {
      signal: ai.signal || 'HOLD',
      confidence: confidence,
      trend: ai.trend || 'Sideways',
      market_regime: ai.market_regime || 'Ranging',
      entry_price: ai.entry_price || currentPrice,
      stop_loss: ai.stop_loss || 0,
      take_profit: ai.take_profit || 0,
      risk_reward: ai.risk_reward || '1:1',
      expected_move_percent: ai.expected_move_percent || 0,
      trade_duration: ai.trade_duration || 'Intraday',
      reason: ai.reason || 'No reason provided',
      pros: ai.pros || [],
      cons: ai.cons || [],
      indicator_scores: ai.indicator_scores || {},
      data: {
        price: currentPrice,
        rsi: ind.rsi,
        macd: ind.macd,
        ema20: extra.ema20,
        ema50: extra.ema50,
        ema200: extra.ema200,
        atr: ind.atr,
        adx: adx,
        volumeRatio: extra.volumeRatio,
        highVolume: extra.highVolume,
      },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message };
  }
}

router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';

  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const result = await getAIAnalysis(email, symbol, null, null);
    res.json(result);
  } catch (error) {
    console.error('[AI] Endpoint error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

router.get('/market-data', async (req, res) => {
  let { symbol = 'BTCUSDT' } = req.query;
  symbol = symbol.replace(/\//g, '');
  try {
    const data = await instance.getAnalysisData(symbol);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, getAIAnalysis };
// Override computeExtraIndicators with safe fallback
