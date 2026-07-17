global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// ─── Models ──────────────────────────────────────────────────────
const RESEARCH_MODEL = 'deepseek-ai/deepseek-v4-flash';
const DECISION_MODEL = 'z-ai/glm-5.2';

// ─── News APIs ──────────────────────────────────────────────────
const BINANCE_NEWS_API = 'https://api.binance.com/bapi/composite/v1/public/marketing/symbolNews';
const CRYPTO_NEWS_API = 'https://cryptocurrency.cv/api/news';

// ─── Safe number helper ──────────────────────────────────────────
function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return isNaN(num) ? fallback : num;
}

// ─── Fetch Binance news for a specific symbol ──────────────────
async function fetchBinanceNews(symbol) {
  try {
    const cleanSymbol = symbol.replace('/', ''); // e.g., BTCUSDT
    const url = `${BINANCE_NEWS_API}?symbol=${cleanSymbol}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance news error: ${response.status}`);
    const data = await response.json();
    // Expected structure: { code: "000000", data: { articles: [...] } }
    if (data.code !== '000000') throw new Error(`Binance news API error: ${data.message || 'Unknown'}`);
    const articles = data.data?.articles || [];
    return articles.map(a => ({
      title: a.title || '',
      description: a.description || '',
      source: 'Binance',
      url: a.link || '',
      publishedAt: a.publishDate || new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('[Binance News] Failed to fetch:', error.message);
    return [];
  }
}

// ─── Fetch crypto news from cryptocurrency.cv ──────────────────
async function fetchCryptoNews(symbol) {
  try {
    const categories = {
      'BTCUSDT': 'bitcoin',
      'ETHUSDT': 'ethereum',
      'SOLUSDT': 'solana',
      'BNBUSDT': 'binancecoin',
    };
    const category = categories[symbol] || 'cryptocurrency';
    const url = `${CRYPTO_NEWS_API}?limit=10&category=${category}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Crypto news error: ${response.status}`);
    const data = await response.json();
    return data.articles || [];
  } catch (error) {
    console.warn('[Crypto News] Failed to fetch:', error.message);
    return [];
  }
}

// ─── Combine news with deduplication ───────────────────────────
async function fetchCombinedNews(symbol) {
  const [binanceNews, cryptoNews] = await Promise.all([
    fetchBinanceNews(symbol),
    fetchCryptoNews(symbol),
  ]);
  // Use titles to deduplicate (case‑insensitive)
  const seen = new Set();
  const all = [...binanceNews, ...cryptoNews];
  const unique = all.filter(item => {
    const key = (item.title || '').toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique;
}

// ─── Format news for prompt ──────────────────────────────────
function formatNewsForPrompt(articles) {
  if (!articles || articles.length === 0) {
    return 'No recent crypto news available.';
  }
  return articles.map((a, i) =>
    `${i+1}. ${a.title}\n   Source: ${a.source || 'Unknown'}\n   ${a.description || ''}\n   Published: ${a.publishedAt ? new Date(a.publishedAt).toLocaleString() : 'N/A'}`
  ).join('\n\n');
}

// ─── Helper: query a model with retries ────────────────────────
async function queryModel(model, messages, options = {}) {
  const defaultOpts = {
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 4096,
    stream: false,
    timeout: 20000,
  };
  const opts = { ...defaultOpts, ...options };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await nvidiaClient.chat.completions.create({
        model,
        messages,
        ...opts,
      });
      const choice = completion.choices[0];
      const content = choice.message?.content || '';
      return { success: true, content, reasoning: choice.message?.reasoning || null };
    } catch (error) {
      lastError = error;
      console.warn(`[AI] ${model} attempt ${attempt+1} failed:`, error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.error(`[AI] All attempts for ${model} failed:`, lastError?.message);
  return { success: false, error: lastError?.message || 'Unknown error' };
}

// ─── Main AI pipeline ──────────────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    // 1. Fetch market data
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data (need ≥20 candles)' };
    }

    // 2. Fetch combined news
    const newsArticles = await fetchCombinedNews(symbol);
    const newsText = formatNewsForPrompt(newsArticles);

    const ind = instance.calculateIndicators(data.closes);
    if (!ind) {
      return { signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' };
    }

    // Sanitize all values
    const rsi = safeNumber(ind.rsi);
    const macd = safeNumber(ind.macd);
    const ema20 = safeNumber(ind.ema20);
    const ema50 = safeNumber(ind.ema50);
    const ema200 = safeNumber(ind.ema200 || ema50);
    const atr = safeNumber(ind.atr);
    const bbUpper = safeNumber(ind.bbUpper);
    const bbLower = safeNumber(ind.bbLower);
    const currentPrice = price || data.price || ind.currentPrice || 0;
    const volume = data.volumes && data.volumes.length > 0 ? data.volumes[data.volumes.length-1] : 0;
    const avgVolume = data.volumes && data.volumes.length > 0 ? data.volumes.reduce((a,b) => a+b, 0) / data.volumes.length : 0;

    // ─── Step 1: DeepSeek Research (Technical + Combined News) ──
    const researchPrompt = `You are a senior market analyst. Perform a deep research on the following cryptocurrency market data and recent news (including Binance-specific news).

=== MARKET DATA ===
Symbol: ${symbol}
Current Price: $${currentPrice.toFixed(2)}

Technical Indicators:
- RSI(14): ${rsi.toFixed(2)}
- MACD: ${macd.toFixed(4)}
- EMA20: ${ema20.toFixed(2)}
- EMA50: ${ema50.toFixed(2)}
- EMA200: ${ema200.toFixed(2)}
- ATR(14): ${atr.toFixed(4)}
- Bollinger Upper: ${bbUpper.toFixed(2)}
- Bollinger Lower: ${bbLower.toFixed(2)}
- Volume: ${volume}
- Avg Volume: ${avgVolume.toFixed(2)}

Market Structure:
- Trend: ${currentPrice > ema20 && ema20 > ema50 && ema50 > ema200 ? 'Bullish' : currentPrice < ema20 && ema20 < ema50 && ema50 < ema200 ? 'Bearish' : 'Sideways'}
- Support: ${(Math.min(...data.closes) * 0.99).toFixed(2)}
- Resistance: ${(Math.max(...data.closes) * 1.01).toFixed(2)}

=== RECENT CRYPTO NEWS (Binance + General) ===
${newsText}

=== RESEARCH TASK ===
Provide a comprehensive research summary covering:
1. Trend strength and direction.
2. Momentum and overbought/oversold conditions.
3. Volatility and risk.
4. Volume analysis.
5. Key support/resistance levels.
6. How recent news events (especially Binance-related) may impact price.
7. Potential breakout or reversal scenarios.
8. Any other relevant observations.

Your summary should be detailed, objective, and actionable for a trading decision.`;

    const researchResult = await queryModel(RESEARCH_MODEL, [
      { role: 'user', content: researchPrompt }
    ], { temperature: 1.0, top_p: 0.95, max_tokens: 4096 });

    let researchSummary = '';
    let researchError = null;
    if (researchResult.success) {
      researchSummary = researchResult.content;
      console.log('[AI] DeepSeek research completed.');
    } else {
      researchError = researchResult.error;
      console.warn('[AI] DeepSeek research failed:', researchError);
    }

    // ─── Step 2: GLM Decision ──────────────────────────────────
    const decisionPrompt = `You are an institutional-grade cryptocurrency trading analyst. Based on the following research summary and raw market data, provide a final trading decision (BUY, SELL, or HOLD) with confidence score.

=== RESEARCH SUMMARY ===
${researchSummary || 'Research unavailable. Use only the raw data below.'}
=== END OF RESEARCH ===

=== RAW MARKET DATA ===
Symbol: ${symbol}
Price: $${currentPrice.toFixed(2)}
RSI: ${rsi.toFixed(2)}
MACD: ${macd.toFixed(4)}
EMA20: ${ema20.toFixed(2)}
EMA50: ${ema50.toFixed(2)}
EMA200: ${ema200.toFixed(2)}
ATR: ${atr.toFixed(4)}
Bollinger Upper: ${bbUpper.toFixed(2)}
Bollinger Lower: ${bbLower.toFixed(2)}
Volume: ${volume}
Avg Volume: ${avgVolume.toFixed(2)}
Support: ${(Math.min(...data.closes) * 0.99).toFixed(2)}
Resistance: ${(Math.max(...data.closes) * 1.01).toFixed(2)}
Recent News: ${newsArticles.length} articles (including Binance news)

=== RISK RULES ===
- Never recommend a trade with Risk:Reward below 1:2.
- Reject trades that move directly into support or resistance.
- Require at least three independent confirmations.
- Prefer trading with the dominant trend.
- If confidence is below 75%, return HOLD.

Return ONLY valid JSON:
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
  "reason":"Detailed explanation using all data.",
  "pros":["...","...","..."],
  "cons":["...","...","..."],
  "indicator_scores":{
    "RSI":0,
    "MACD":0,
    "EMA":0,
    "ADX":0,
    "Volume":0,
    "Trend":0,
    "SupportResistance":0
  }
}`;

    const decisionResult = await queryModel(DECISION_MODEL, [
      { role: 'user', content: decisionPrompt }
    ], { temperature: 0.4, top_p: 0.9, max_tokens: 1024 });

    if (!decisionResult.success) {
      return {
        signal: 'HOLD',
        confidence: 0,
        reason: `GLM decision failed: ${decisionResult.error || 'Unknown'}`,
      };
    }

    // ─── Parse GLM response ──────────────────────────────────────
    let ai;
    try {
      const jsonMatch = decisionResult.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      ai = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return {
        signal: 'HOLD',
        confidence: 0,
        reason: `Failed to parse GLM response: ${e.message}`,
      };
    }

    const confidence = Math.max(0, Math.min(100, Number(ai.confidence) || 0));

    // ─── Reject if too close to S/R ──────────────────────────────
    const support = Math.min(...data.closes) * 0.99;
    const resistance = Math.max(...data.closes) * 1.01;
    if (ai.signal === 'BUY' && Math.abs(resistance - currentPrice) / currentPrice < 0.01) {
      ai.signal = 'HOLD';
      ai.reason = (ai.reason || '') + ' Too close to resistance.';
    }
    if (ai.signal === 'SELL' && Math.abs(currentPrice - support) / currentPrice < 0.01) {
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
      entry_price: safeNumber(ai.entry_price, currentPrice),
      stop_loss: safeNumber(ai.stop_loss, 0),
      take_profit: safeNumber(ai.take_profit, 0),
      risk_reward: ai.risk_reward || '1:1',
      expected_move_percent: safeNumber(ai.expected_move_percent, 0),
      trade_duration: ai.trade_duration || 'Intraday',
      reason: ai.reason || 'No reason provided',
      pros: Array.isArray(ai.pros) ? ai.pros : [],
      cons: Array.isArray(ai.cons) ? ai.cons : [],
      indicator_scores: ai.indicator_scores || {},
      news_articles: newsArticles,      // Binance + crypto news combined
      research_summary: researchSummary || null,
      research_error: researchError,
      reasoning: decisionResult.reasoning || null,
      data: {
        price: currentPrice,
        rsi,
        macd,
        ema20,
        ema50,
        ema200,
        atr,
      },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message };
  }
}

// ─── HTTP endpoints ──────────────────────────────────────────────
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
