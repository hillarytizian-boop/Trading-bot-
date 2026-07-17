global.WebSocket = require('ws');

const router = require('express').Router();
const OpenAI = require('openai');
const { instance } = require('../binanceData');

// ─── Safe initialization ──────────────────────────────────────────
let nvidiaClient;
try {
  nvidiaClient = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  });
} catch (e) {
  console.error('OpenAI init error:', e.message);
}

const RESEARCH_MODEL = 'deepseek-ai/deepseek-v4-flash';
const DECISION_MODEL = 'z-ai/glm-5.2';

// ─── fetch with timeout ──────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeout = 2000) {
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

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

async function fetchBinanceNews(symbol) {
  try {
    const cleanSymbol = symbol.replace('/', '');
    const url = `https://api.binance.com/bapi/composite/v1/public/marketing/symbolNews?symbol=${cleanSymbol}`;
    const response = await fetchWithTimeout(url, {}, 2000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== '000000') throw new Error(`API error`);
    return (data.data?.articles || []).map(a => ({ title: a.title || '', description: a.description || '', source: 'Binance' }));
  } catch (e) {
    console.warn('[Binance News] Failed:', e.message);
    return [];
  }
}

async function fetchAlphaVantageNews(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return [];
  try {
    const tickerMap = { 'BTCUSDT': 'BTC', 'ETHUSDT': 'ETH', 'SOLUSDT': 'SOL', 'BNBUSDT': 'BNB' };
    const ticker = tickerMap[symbol] || 'CRYPTO';
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${apiKey}&limit=5`;
    const response = await fetchWithTimeout(url, {}, 2000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.feed) return [];
    return data.feed.map(a => ({ title: a.title || '', description: a.summary || '', source: a.source || 'Alpha Vantage' }));
  } catch (e) {
    console.warn('[Alpha Vantage News] Failed:', e.message);
    return [];
  }
}

async function fetchAllNews(symbol) {
  const [binance, alpha] = await Promise.allSettled([
    fetchBinanceNews(symbol),
    fetchAlphaVantageNews(symbol),
  ]);
  const all = [];
  if (binance.status === 'fulfilled') all.push(...binance.value);
  if (alpha.status === 'fulfilled') all.push(...alpha.value);
  const seen = new Set();
  return all.filter(item => {
    const key = (item.title || '').toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main analysis – everything wrapped in try/catch ──────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data' };
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
    const volume = data.volumes?.[data.volumes.length-1] || 0;
    const avgVolume = data.volumes ? data.volumes.reduce((a,b) => a+b, 0) / data.volumes.length : 0;

    const newsArticles = await fetchAllNews(symbol);
    const newsText = newsArticles.length
      ? newsArticles.map((a, i) => `${i+1}. ${a.title} (${a.source})`).join('\n')
      : 'No news available.';

    // ─── DeepSeek ──────────────────────────────────────────────────
    const researchPrompt = `Analyze market data and news for ${symbol}.
Price: $${currentPrice.toFixed(2)}
RSI: ${rsi.toFixed(2)}, MACD: ${macd.toFixed(4)}
EMA20: ${ema20.toFixed(2)}, EMA50: ${ema50.toFixed(2)}, EMA200: ${ema200.toFixed(2)}
ATR: ${atr.toFixed(4)}, BB Upper: ${bbUpper.toFixed(2)}, BB Lower: ${bbLower.toFixed(2)}
Volume: ${volume}, Avg Vol: ${avgVolume.toFixed(2)}
Support: ${(Math.min(...data.closes) * 0.99).toFixed(2)}, Resistance: ${(Math.max(...data.closes) * 1.01).toFixed(2)}
News: ${newsText}
Provide a concise summary of trend, momentum, sentiment, and a recommended stance (BUY/SELL/HOLD) with reason.`;

    let researchSummary = '';
    if (nvidiaClient) {
      try {
        const research = await nvidiaClient.chat.completions.create({
          model: RESEARCH_MODEL,
          messages: [{ role: 'user', content: researchPrompt }],
          temperature: 1.0,
          top_p: 0.95,
          max_tokens: 1024,
          timeout: 10000,
        });
        researchSummary = research.choices[0].message.content || 'Research unavailable.';
      } catch (e) {
        console.warn('[DeepSeek] Failed:', e.message);
        researchSummary = 'Research unavailable due to error.';
      }
    } else {
      researchSummary = 'NVIDIA client not initialized.';
    }

    // ─── GLM Decision ──────────────────────────────────────────────
    let signal = 'HOLD';
    let confidence = 0;
    let reason = 'No decision from GLM';
    if (nvidiaClient) {
      try {
        const decisionPrompt = `Based on research, decide:\nResearch: ${researchSummary}\nReturn JSON: {"signal":"BUY|SELL|HOLD","confidence":0,"reason":"..."}`;
        const decision = await nvidiaClient.chat.completions.create({
          model: DECISION_MODEL,
          messages: [{ role: 'user', content: decisionPrompt }],
          temperature: 0.4,
          max_tokens: 300,
          timeout: 10000,
        });
        const content = decision.choices[0].message.content;
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const result = JSON.parse(match[0]);
          signal = result.signal || 'HOLD';
          confidence = Math.min(100, Math.max(0, Number(result.confidence) || 0));
          reason = result.reason || 'No reason';
          if (confidence < 75) signal = 'HOLD';
        } else {
          throw new Error('No JSON');
        }
      } catch (e) {
        console.warn('[GLM] Failed:', e.message);
        reason = 'GLM error';
      }
    }

    return {
      signal,
      confidence,
      trend: 'Sideways',
      market_regime: 'Ranging',
      entry_price: currentPrice,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: '1:1',
      expected_move_percent: 0,
      trade_duration: 'Intraday',
      reason,
      pros: [],
      cons: [],
      indicator_scores: {},
      news_articles: newsArticles,
      research_summary: researchSummary,
      data: { price: currentPrice, rsi, macd, ema20, ema50, ema200, atr },
    };
  } catch (error) {
    console.error('[AI] Fatal error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: `Internal error: ${error.message}` };
  }
}

// ─── Route with domain isolation ──────────────────────────────────
router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (!email) return res.status(400).json({ error: 'Email required' });

  // 15‑second timeout
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000));
  try {
    const result = await Promise.race([getAIAnalysis(email, symbol, null, null), timeout]);
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
