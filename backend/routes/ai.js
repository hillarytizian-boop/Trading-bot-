global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const RESEARCH_MODEL = 'deepseek-ai/deepseek-v4-flash';
const DECISION_MODEL = 'z-ai/glm-5.2';

// ─── Helper: fetch with timeout ──────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeout = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// ─── Safe number ──────────────────────────────────────────────────
function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ─── Fetch Binance news ──────────────────────────────────────────
async function fetchBinanceNews(symbol) {
  try {
    const cleanSymbol = symbol.replace('/', '');
    const url = `https://api.binance.com/bapi/composite/v1/public/marketing/symbolNews?symbol=${cleanSymbol}`;
    const response = await fetchWithTimeout(url, {}, 3000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== '000000') throw new Error(`API error: ${data.message || 'Unknown'}`);
    const articles = data.data?.articles || [];
    return articles.map(a => ({
      title: a.title || '',
      description: a.description || '',
      source: 'Binance',
      url: a.link || '',
      publishedAt: a.publishDate || new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('[Binance News] Failed:', error.message);
    return [];
  }
}

// ─── Fetch Alpha Vantage news ────────────────────────────────────
async function fetchAlphaVantageNews(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.warn('[Alpha Vantage] API key missing');
    return [];
  }
  try {
    // Map symbol to ticker (e.g., BTCUSDT -> BTC)
    const tickerMap = {
      'BTCUSDT': 'BTC',
      'ETHUSDT': 'ETH',
      'SOLUSDT': 'SOL',
      'BNBUSDT': 'BNB',
    };
    const ticker = tickerMap[symbol] || 'CRYPTO';
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${apiKey}&limit=10`;
    const response = await fetchWithTimeout(url, {}, 5000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.feed || !Array.isArray(data.feed)) throw new Error('Invalid response format');
    return data.feed.map(a => ({
      title: a.title || '',
      description: a.summary || '',
      source: a.source || 'Alpha Vantage',
      url: a.url || '',
      publishedAt: a.time_published || new Date().toISOString(),
      sentiment: a.overall_sentiment_score || 0,
    }));
  } catch (error) {
    console.warn('[Alpha Vantage News] Failed:', error.message);
    return [];
  }
}

// ─── Combine news ──────────────────────────────────────────────────
async function fetchAllNews(symbol) {
  const [binance, alpha] = await Promise.allSettled([
    fetchBinanceNews(symbol),
    fetchAlphaVantageNews(symbol),
  ]);
  const all = [];
  if (binance.status === 'fulfilled') all.push(...binance.value);
  if (alpha.status === 'fulfilled') all.push(...alpha.value);
  // Deduplicate by title
  const seen = new Set();
  return all.filter(item => {
    const key = (item.title || '').toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main AI pipeline ──────────────────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data (need ≥20 candles)' };
    }

    const ind = instance.calculateIndicators(data.closes);
    if (!ind) {
      return { signal: 'HOLD', confidence: 0, reason: 'Indicator calculation failed' };
    }

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

    // ─── Fetch combined news ──────────────────────────────────────
    const newsArticles = await fetchAllNews(symbol);
    const newsText = newsArticles.length
      ? newsArticles.map((a, i) => `${i+1}. ${a.title} (${a.source})`).join('\n')
      : 'No news available.';

    // ─── Step 1: DeepSeek Research ──────────────────────────────
    const researchPrompt = `You are a senior market analyst. Research the following data and recent news.

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
News: ${newsText}

Provide a comprehensive summary covering technical outlook, sentiment, and any news impact. Be detailed.`;

    const research = await nvidiaClient.chat.completions.create({
      model: RESEARCH_MODEL,
      messages: [{ role: 'user', content: researchPrompt }],
      temperature: 1.0,
      top_p: 0.95,
      max_tokens: 4096,
      timeout: 20000,
    });
    const researchSummary = research.choices[0].message.content || 'Research unavailable.';

    // ─── Step 2: GLM Decision ──────────────────────────────────
    const decisionPrompt = `You are a professional crypto trader. Based on the research summary and raw data, make a final decision.

Research summary:
${researchSummary}

Raw data:
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
News count: ${newsArticles.length}

Return JSON: {"signal":"BUY|SELL|HOLD","confidence":0,"reason":"..."}
Confidence must be 75+ to trade.`;

    const decision = await nvidiaClient.chat.completions.create({
      model: DECISION_MODEL,
      messages: [{ role: 'user', content: decisionPrompt }],
      temperature: 0.4,
      max_tokens: 500,
      timeout: 15000,
    });

    const content = decision.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON returned from GLM');
    const result = JSON.parse(match[0]);

    const confidence = Math.min(100, Math.max(0, Number(result.confidence) || 0));
    let signal = result.signal || 'HOLD';
    if (confidence < 75) signal = 'HOLD';

    return {
      signal,
      confidence,
      trend: result.trend || 'Sideways',
      market_regime: result.market_regime || 'Ranging',
      entry_price: safeNumber(result.entry_price, currentPrice),
      stop_loss: safeNumber(result.stop_loss, 0),
      take_profit: safeNumber(result.take_profit, 0),
      risk_reward: result.risk_reward || '1:1',
      expected_move_percent: safeNumber(result.expected_move_percent, 0),
      trade_duration: result.trade_duration || 'Intraday',
      reason: result.reason || 'No reason',
      pros: result.pros || [],
      cons: result.cons || [],
      indicator_scores: result.indicator_scores || {},
      news_articles: newsArticles,
      research_summary: researchSummary,
      data: { price: currentPrice, rsi, macd, ema20, ema50, ema200, atr },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    // No fallback – return HOLD with error
    return { signal: 'HOLD', confidence: 0, reason: `AI error: ${error.message}` };
  }
}

// ─── HTTP endpoints ──────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (!email) return res.status(400).json({ error: 'Email required' });

  // 30‑second global timeout (longer for two model calls)
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Analysis timeout')), 30000)
  );
  try {
    const result = await Promise.race([
      getAIAnalysis(email, symbol, null, null),
      timeoutPromise,
    ]);
    res.json(result);
  } catch (error) {
    console.error('[AI] Route error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Timeout or error' });
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
