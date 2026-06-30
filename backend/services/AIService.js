const axios = require('axios');
const AI_ENDPOINT = 'https://apis.prexzyvilla.site/ai/gpt-5';

function buildPrompt(data) {
  return `Analyze this Binance market data and return ONLY valid JSON.

Allowed signals: BUY | SELL | HOLD

Return:
{
"signal":"BUY|SELL|HOLD",
"confidence":0-100,
"risk":"LOW|MEDIUM|HIGH",
"market_state":"",
"best_trade_option":"",
"reason":"Detailed explanation"
}

Market Data:
Symbol: ${data.symbol}
Price: ${data.price}
RSI: ${data.rsi || 50}
EMA20: ${data.ema20 || data.price}
EMA50: ${data.ema50 || data.price}
MACD: ${data.macd || 0}
Volume: ${data.volume || 'N/A'}
Trend: ${data.trend || 'neutral'}

Do not return markdown. Do not return code blocks. Return only JSON.`;
}

module.exports = {
  analyzeMarket: async (marketData) => {
    try {
      const prompt = buildPrompt(marketData);
      const response = await axios.post(AI_ENDPOINT, { prompt, max_tokens: 500, temperature: 0.3 }, { timeout: 20000 });
      const text = response.data?.text || response.data?.response || response.data?.choices?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.signal && ['BUY','SELL','HOLD'].includes(parsed.signal.toUpperCase())) {
          return { signal: parsed.signal.toUpperCase(), confidence: parsed.confidence || 50, risk: (parsed.risk || 'MEDIUM').toUpperCase(), market_state: parsed.market_state || '', best_trade_option: parsed.best_trade_option || '', reason: parsed.reason || 'AI analysis complete', indicators: marketData };
        }
      }
      return fallbackAnalysis(marketData);
    } catch (err) {
      console.log('AI endpoint error, using fallback:', err.message);
      return fallbackAnalysis(marketData);
    }
  }
};

function fallbackAnalysis(data) {
  const rsi = data.rsi || 50; const price = data.price || 0; const ema20 = data.ema20 || price; const ema50 = data.ema50 || price;
  let signal = 'HOLD', confidence = 50, risk = 'MEDIUM'; const reasons = [];
  if (rsi > 70) { signal = 'SELL'; confidence += 20; reasons.push('RSI overbought'); }
  else if (rsi < 30) { signal = 'BUY'; confidence += 20; reasons.push('RSI oversold'); }
  else { reasons.push('RSI neutral'); }
  if (ema20 > ema50) { if (signal === 'HOLD') signal = 'BUY'; confidence += 10; reasons.push('EMA20 above EMA50'); }
  else { if (signal === 'HOLD') signal = 'SELL'; confidence += 10; reasons.push('EMA20 below EMA50'); }
  if (parseFloat(data.macd || 0) > 0) { confidence += 10; reasons.push('MACD positive'); }
  else { confidence -= 5; reasons.push('MACD negative'); }
  confidence = Math.max(10, Math.min(95, confidence));
  if (confidence < 40) { signal = 'HOLD'; reasons.push('Low confidence'); }
  if (Math.abs(rsi - 50) > 25) risk = 'HIGH'; else if (Math.abs(rsi - 50) > 15) risk = 'MEDIUM'; else risk = 'LOW';
  return { signal, confidence, risk, market_state: signal === 'BUY' ? 'Bullish' : signal === 'SELL' ? 'Bearish' : 'Neutral', best_trade_option: signal === 'BUY' ? 'Spot Buy' : signal === 'SELL' ? 'Spot Sell' : 'None', reason: reasons.join('. '), indicators: data };
}
