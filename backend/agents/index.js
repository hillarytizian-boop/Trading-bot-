/**
 * 30‑Agent Trading System for Binance
 * 
 * DISCLAIMER: This is for educational purposes only.
 * Trading involves risk. Do your own research.
 * Never trade with money you cannot afford to lose.
 */

const Binance = require('binance-api-node').default;
const OpenAI = require('openai');
const technical = require('technicalindicators');
const axios = require('axios');
const supabase = require('../db');

// ─── Clients ──────────────────────────────────────────────────────
const glmClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_GLM_API_KEY,
});
const deepseekClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_DEEPSEEK_API_KEY,
});

// ─── Helpers ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 1. MarketDataAgent ──────────────────────────────────────────
class MarketDataAgent {
  async run(symbol) {
    const client = Binance();
    try {
      const klines = await client.candles({ symbol, interval: '1m', limit: 100 });
      const trades = await client.trades({ symbol, limit: 100 });
      const ticker = await client.prices({ symbol });
      const price = parseFloat(ticker[symbol]);
      const prices = klines.map(k => parseFloat(k.close));
      const volumes = klines.map(k => parseFloat(k.volume));
      return { price, prices, volumes, trades, lastKline: klines[klines.length-1] };
    } catch (e) {
      console.error('MarketDataAgent error:', e);
      return null;
    }
  }
}

// ─── 2. TechnicalAnalysisAgent ──────────────────────────────────
class TechnicalAnalysisAgent {
  analyze(prices) {
    if (prices.length < 50) return null;
    const closes = prices;
    const high = prices.map(p => p * 1.001);
    const low = prices.map(p => p * 0.999);
    const rsi = technical.RSI.calculate({ values: closes, period: 14 });
    const macd = technical.MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
    const ema = technical.EMA.calculate({ values: closes, period: 20 });
    const sma = technical.SMA.calculate({ values: closes, period: 50 });
    const bollinger = technical.BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const atr = technical.ATR.calculate({ high, low, close: closes, period: 14 });
    const vwap = technical.VWAP.calculate({ high, low, close: closes, volume: prices.map(p => 1000) }); // mock volume
    const ichimoku = technical.IchimokuCloud.calculate({ high, low, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52 });
    const fib = technical.FibonacciRetracement.calculate({ high: Math.max(...closes), low: Math.min(...closes) });
    const current = {
      rsi: rsi[rsi.length-1],
      macd: macd[macd.length-1],
      ema: ema[ema.length-1],
      sma: sma[sma.length-1],
      bollinger: bollinger[bollinger.length-1],
      atr: atr[atr.length-1] || 0,
      vwap: vwap[vwap.length-1],
      ichimoku: ichimoku[ichimoku.length-1],
      fib,
    };
    return current;
  }
}

// ─── 3. NewsAgent ──────────────────────────────────────────────────
class NewsAgent {
  async fetchNews() {
    try {
      const res = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&feeds=cointelegraph,coindesk,decrypt,newsbtc,bloomberg');
      if (res.data.Data && res.data.Data.length) {
        return res.data.Data.slice(0, 10).map(a => a.title).join('. ');
      }
      return 'No significant news';
    } catch (e) {
      console.error('NewsAgent error:', e);
      return 'News unavailable';
    }
  }
}

// ─── 4. SentimentAgent ────────────────────────────────────────────
class SentimentAgent {
  async analyze(news, fearGreed) {
    const prompt = `Given news: ${news}. Fear & Greed Index: ${fearGreed}. Rate overall market sentiment as BULLISH, BEARISH, or NEUTRAL with confidence 0-100. Respond JSON: {"sentiment":"BULLISH","confidence":75}`;
    try {
      const completion = await glmClient.chat.completions.create({
        model: 'z-ai/glm-5.2',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 100,
      });
      const content = completion.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { sentiment: 'NEUTRAL', confidence: 50 };
    } catch (e) {
      return { sentiment: 'NEUTRAL', confidence: 50 };
    }
  }
}

// ─── 5. OnChainAgent ──────────────────────────────────────────────
class OnChainAgent {
  async analyze(symbol) {
    // Mock – in production use Glassnode/Coinglass
    return { exchangeInflow: 'low', outflow: 'high', minerActivity: 'normal' };
  }
}

// ─── 6. OrderBookAgent ────────────────────────────────────────────
class OrderBookAgent {
  analyze(orderBook) {
    if (!orderBook) return { imbalance: 'neutral', bidDepth: 0, askDepth: 0 };
    const bids = orderBook.bids.slice(0, 10).reduce((a, b) => a + parseFloat(b[1]), 0);
    const asks = orderBook.asks.slice(0, 10).reduce((a, b) => a + parseFloat(b[1]), 0);
    const imbalance = bids > asks ? 'bullish' : bids < asks ? 'bearish' : 'neutral';
    return { imbalance, bidDepth: bids, askDepth: asks };
  }
}

// ─── 7. WhaleAgent ────────────────────────────────────────────────
class WhaleAgent {
  analyze(trades) {
    const largeTrades = trades.filter(t => parseFloat(t.quantity) > 10);
    const buyWhale = largeTrades.filter(t => t.isBuyerMaker === false).length;
    const sellWhale = largeTrades.filter(t => t.isBuyerMaker === true).length;
    return { buyWhale, sellWhale, totalLarge: largeTrades.length };
  }
}

// ─── 8. VolumeAgent ───────────────────────────────────────────────
class VolumeAgent {
  analyze(volumes) {
    if (volumes.length < 20) return { surge: false, avgVolume: 0 };
    const avg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const current = volumes[volumes.length-1];
    const surge = current > avg * 1.5;
    return { surge, avgVolume: avg, currentVolume: current };
  }
}

// ─── 9. VolatilityAgent ──────────────────────────────────────────
class VolatilityAgent {
  analyze(atr, currentPrice) {
    const volPct = atr / currentPrice * 100;
    let regime = 'normal';
    if (volPct > 3) regime = 'high';
    else if (volPct < 1) regime = 'low';
    return { volPct, regime };
  }
}

// ─── 10. MacroAgent ──────────────────────────────────────────────
class MacroAgent {
  async analyze() {
    // In production, fetch from FRED, Yahoo Finance, etc.
    return { interestRate: '4.5%', cpi: '3.2%', dollarIndex: 104.5 };
  }
}

// ─── 11. BullResearchAgent ──────────────────────────────────────
async function runBullResearch(tech, sentiment, news, macro) {
  const prompt = `Tech: ${JSON.stringify(tech)}, Sentiment: ${sentiment.sentiment}, News: ${news}, Macro: ${JSON.stringify(macro)}. Make the strongest case for BUYING. (max 150 words)`;
  const completion = await deepseekClient.chat.completions.create({
    model: 'deepseek-ai/deepseek-v4-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  });
  return completion.choices[0].message.content;
}

// ─── 12. BearResearchAgent ──────────────────────────────────────
async function runBearResearch(tech, sentiment, news, macro) {
  const prompt = `Tech: ${JSON.stringify(tech)}, Sentiment: ${sentiment.sentiment}, News: ${news}, Macro: ${JSON.stringify(macro)}. Make the strongest case for SELLING. (max 150 words)`;
  const completion = await deepseekClient.chat.completions.create({
    model: 'deepseek-ai/deepseek-v4-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  });
  return completion.choices[0].message.content;
}

// ─── 13. ResearchManagerAgent ──────────────────────────────────
async function runResearchManager(bull, bear) {
  const prompt = `Bull: ${bull}\nBear: ${bear}\n\nSummarise and give a bias (BULLISH/BEARISH/NEUTRAL) with confidence. JSON: {"bias":"BULLISH","confidence":75,"summary":"..."}`;
  const completion = await glmClient.chat.completions.create({
    model: 'z-ai/glm-5.2',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 200,
  });
  const content = completion.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { bias: 'NEUTRAL', confidence: 50, summary: 'No clear bias' };
}

// ─── 14. StrategyAgent ──────────────────────────────────────────
class StrategyAgent {
  select(regime) {
    if (regime === 'trending') return 'trend_following';
    if (regime === 'weak_trend') return 'swing';
    if (regime === 'ranging') return 'mean_reversion';
    return 'scalping';
  }
}

// ─── 15. RiskManagerAgent ────────────────────────────────────────
class RiskManagerAgent {
  calculate(price, balance, atr, maxRisk = 0.02) {
    const riskAmount = balance * maxRisk;
    const sl = price - atr * 2.5;
    const tp = price + atr * 5;
    const quantity = riskAmount / (price - sl);
    return { riskAmount, sl, tp, quantity, riskPerTrade: maxRisk };
  }
}

// ─── 16. PortfolioManagerAgent ──────────────────────────────────
class PortfolioManagerAgent {
  async getPositions(email) {
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .eq('status', 'open');
    return data || [];
  }
}

// ─── 17. MemoryAgent ────────────────────────────────────────────
class MemoryAgent {
  async getLastTrades(email, limit = 10) {
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .order('opened_at', { ascending: false })
      .limit(limit);
    return data || [];
  }
}

// ─── 18. LearningAgent ──────────────────────────────────────────
class LearningAgent {
  analyze(trades) {
    if (trades.length === 0) return null;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const winRate = wins.length / trades.length;
    const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / (wins.length || 1);
    const avgLoss = losses.reduce((s, t) => s + t.pnl, 0) / (losses.length || 1);
    return { winRate, avgWin, avgLoss, totalTrades: trades.length };
  }
}

// ─── 19. TraderAgent ────────────────────────────────────────────
async function runTraderAgent(finalInputs) {
  const { price, technical, sentiment, orderBook, whale, volume, volatility, research, strategy, risk, learning, news, bullCase, bearCase } = finalInputs;
  const prompt = `You are the TraderAgent. Decide BUY/SELL/HOLD for BTC/USDT at ${price}.
Technicals: RSI=${technical.rsi}, MACD=${JSON.stringify(technical.macd)}, EMA=${technical.ema}, Bollinger=${JSON.stringify(technical.bollinger)}, ATR=${technical.atr}
Sentiment: ${sentiment.sentiment} (${sentiment.confidence}%)
Order Book: ${orderBook.imbalance}
Whale: Buy=${whale.buyWhale}, Sell=${whale.sellWhale}
Volume: ${volume.surge ? 'Surge' : 'Normal'}
Volatility: ${volatility.regime} (${volatility.volPct.toFixed(2)}%)
Research Bias: ${research.bias} (${research.confidence}%)
Strategy: ${strategy}
Risk: Max loss $${risk.riskAmount.toFixed(2)}, SL=${risk.sl.toFixed(2)}, TP=${risk.tp.toFixed(2)}
Learning Win Rate: ${learning?.winRate?.toFixed(2) || 'N/A'}

Output JSON: {"signal":"BUY","confidence":75,"reason":"..."}`;

  const completion = await deepseekClient.chat.completions.create({
    model: 'deepseek-ai/deepseek-v4-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 200,
  });
  const content = completion.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { signal: 'HOLD', confidence: 50, reason: 'Parse error' };
}

// ─── 20. ExecutionAgent ──────────────────────────────────────────
class ExecutionAgent {
  constructor(client) { this.client = client; }
  async placeOrder(symbol, side, quantity, orderType = 'MARKET') {
    try {
      const order = await this.client.order({ symbol, side, type: orderType, quantity });
      return order;
    } catch (e) {
      console.error('ExecutionAgent error:', e);
      return null;
    }
  }
  async cancelOrder(symbol, orderId) {
    try { return await this.client.cancelOrder({ symbol, orderId }); } catch (e) { return null; }
  }
  async getOpenOrders(symbol) {
    try { return await this.client.openOrders({ symbol }); } catch (e) { return []; }
  }
}

// ─── 21. StrategyResearchAgent ──────────────────────────────────
class StrategyResearchAgent {
  async research(regime, volatility) {
    const prompt = `Market regime: ${regime}, volatility: ${volatility}. Recommend a trading strategy and explain why. Return JSON: {"strategy":"trend_following","reason":"..."}`;
    const completion = await glmClient.chat.completions.create({
      model: 'z-ai/glm-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 150,
    });
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { strategy: 'scalping', reason: 'Default' };
  }
}

// ─── 22. BacktestingAgent ──────────────────────────────────────
class BacktestingAgent {
  async backtest(symbol, strategy, startDate, endDate) {
    // Simplified – in production, fetch historical data and simulate
    return { totalReturn: 0.05, winRate: 0.6, maxDrawdown: 0.1 };
  }
}

// ─── 23. StrategyEvaluationAgent ──────────────────────────────
class StrategyEvaluationAgent {
  evaluate(backtestResults) {
    const score = (backtestResults.totalReturn * 0.5 + backtestResults.winRate * 0.3 - backtestResults.maxDrawdown * 0.2);
    return { score, recommendation: score > 0.1 ? 'use' : 'improve' };
  }
}

// ─── 24. MarketRegimeAgent ──────────────────────────────────────
class MarketRegimeAgent {
  detect(priceHistory) {
    if (priceHistory.length < 20) return 'unknown';
    const recent = priceHistory.slice(-20);
    const diffs = [];
    for (let i = 1; i < recent.length; i++) diffs.push(recent[i] - recent[i-1]);
    const avgMove = diffs.reduce((a,b) => a + Math.abs(b), 0) / diffs.length;
    const netMove = recent[recent.length-1] - recent[0];
    const trendStrength = Math.abs(netMove) / avgMove;
    if (trendStrength > 2.5) return 'trending';
    if (trendStrength > 1.5) return 'weak_trend';
    return 'ranging';
  }
}

// ─── 25. ReflectionAgent ────────────────────────────────────────
class ReflectionAgent {
  async reflect(trades) {
    const recent = trades.slice(0, 5);
    const prompt = `Given the last ${recent.length} trades: ${JSON.stringify(recent)}. What could we have done better? Provide 2-3 key lessons.`;
    const completion = await glmClient.chat.completions.create({
      model: 'z-ai/glm-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });
    return completion.choices[0].message.content;
  }
}

// ─── 26. KnowledgeAgent ──────────────────────────────────────────
class KnowledgeAgent {
  async getKnowledge(topic) {
    // Could be a vector DB lookup; for now, returns a static fact.
    const facts = {
      'btc': 'Bitcoin is the largest cryptocurrency by market cap.',
      'ethereum': 'Ethereum is the leading smart contract platform.',
    };
    return facts[topic] || 'No knowledge available.';
  }
}

// ─── 27. PerformanceAnalyticsAgent ──────────────────────────────
class PerformanceAnalyticsAgent {
  analyze(trades) {
    if (trades.length === 0) return null;
    const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const winRate = wins.length / trades.length;
    const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / (wins.length || 1);
    const avgLoss = losses.reduce((s, t) => s + t.pnl, 0) / (losses.length || 1);
    const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
    return { totalPnl, winRate, avgWin, avgLoss, profitFactor, totalTrades: trades.length };
  }
}

// ─── 28. SimulationAgent ────────────────────────────────────────
class SimulationAgent {
  async simulate(initialBalance, strategy, marketData) {
    // Mock simulation – in production, run a full backtest
    return { finalBalance: initialBalance * 1.05, trades: 10, winRate: 0.6 };
  }
}

// ─── 29. StrategyGeneratorAgent ──────────────────────────────────
class StrategyGeneratorAgent {
  async generate(regime, volatility, performance) {
    const prompt = `Based on regime: ${regime}, volatility: ${volatility}, performance: ${JSON.stringify(performance)}, generate a new trading strategy. Return JSON with name, entry/exit rules, risk management.`;
    const completion = await deepseekClient.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 400,
    });
    return completion.choices[0].message.content;
  }
}

// ─── 30. OrchestratorAgent ──────────────────────────────────────
class OrchestratorAgent {
  constructor(email, symbol) {
    this.email = email;
    this.symbol = symbol;
    this.results = {};
  }

  async run() {
    // 1. MarketData
    const marketData = new MarketDataAgent();
    const data = await marketData.run(this.symbol);
    if (!data) return { error: 'MarketDataAgent failed' };
    this.results.marketData = data;

    const { price, prices, trades, volumes } = data;

    // 2. Technical Analysis
    const techAgent = new TechnicalAnalysisAgent();
    const technical = techAgent.analyze(prices);
    this.results.technical = technical;

    // 3. News
    const newsAgent = new NewsAgent();
    const news = await newsAgent.fetchNews();
    this.results.news = news;

    // 4. Sentiment
    const sentimentAgent = new SentimentAgent();
    const fearGreed = 50; // can fetch from external API
    const sentiment = await sentimentAgent.analyze(news, fearGreed);
    this.results.sentiment = sentiment;

    // 5. OnChain
    const onChainAgent = new OnChainAgent();
    const onChain = await onChainAgent.analyze(this.symbol);
    this.results.onChain = onChain;

    // 6. OrderBook (mock)
    const orderBookAgent = new OrderBookAgent();
    const orderBook = orderBookAgent.analyze(null); // would pass real orderbook
    this.results.orderBook = orderBook;

    // 7. Whale
    const whaleAgent = new WhaleAgent();
    const whale = whaleAgent.analyze(trades);
    this.results.whale = whale;

    // 8. Volume
    const volumeAgent = new VolumeAgent();
    const volume = volumeAgent.analyze(volumes);
    this.results.volume = volume;

    // 9. Volatility
    const volAgent = new VolatilityAgent();
    const volatility = volAgent.analyze(technical.atr || 0, price);
    this.results.volatility = volatility;

    // 10. Macro
    const macroAgent = new MacroAgent();
    const macro = await macroAgent.analyze();
    this.results.macro = macro;

    // 11-12. Bull/Bear Research (parallel)
    const [bullCase, bearCase] = await Promise.all([
      runBullResearch(technical, sentiment, news, macro),
      runBearResearch(technical, sentiment, news, macro),
    ]);
    this.results.bullCase = bullCase;
    this.results.bearCase = bearCase;

    // 13. Research Manager
    const research = await runResearchManager(bullCase, bearCase);
    this.results.research = research;

    // 14. Strategy
    const strategyAgent = new StrategyAgent();
    const strategy = strategyAgent.select(volatility.regime);
    this.results.strategy = strategy;

    // 15. Risk Manager
    const userSettings = await supabase.from('users').select('paper_balance').eq('email', this.email).single();
    const balance = userSettings.data?.paper_balance || 1000;
    const riskManager = new RiskManagerAgent();
    const risk = riskManager.calculate(price, balance, technical.atr || 100);
    this.results.risk = risk;

    // 16. Portfolio
    const portfolioAgent = new PortfolioManagerAgent();
    const positions = await portfolioAgent.getPositions(this.email);
    this.results.positions = positions;

    // 17. Memory
    const memoryAgent = new MemoryAgent();
    const lastTrades = await memoryAgent.getLastTrades(this.email);
    this.results.lastTrades = lastTrades;

    // 18. Learning
    const learningAgent = new LearningAgent();
    const learning = learningAgent.analyze(lastTrades);
    this.results.learning = learning;

    // 21. Strategy Research
    const strategyResearchAgent = new StrategyResearchAgent();
    const strategyResearch = await strategyResearchAgent.research(volatility.regime, volatility.volPct);
    this.results.strategyResearch = strategyResearch;

    // 24. Market Regime
    const regimeAgent = new MarketRegimeAgent();
    const regime = regimeAgent.detect(prices);
    this.results.regime = regime;

    // 25. Reflection
    const reflectionAgent = new ReflectionAgent();
    const reflection = await reflectionAgent.reflect(lastTrades);
    this.results.reflection = reflection;

    // 27. Performance Analytics
    const perfAgent = new PerformanceAnalyticsAgent();
    const performance = perfAgent.analyze(lastTrades);
    this.results.performance = performance;

    // 19. TraderAgent (final decision)
    const finalInputs = {
      price,
      technical,
      sentiment,
      orderBook,
      whale,
      volume,
      volatility,
      research,
      strategy,
      risk,
      learning,
      news,
      bullCase,
      bearCase,
    };
    const finalDecision = await runTraderAgent(finalInputs);
    this.results.finalDecision = finalDecision;

    // 20. ExecutionAgent (not used directly, but available)
    // 22, 23, 26, 28, 29 are optional and can be called on demand.

    return this.results;
  }
}

// ─── Main exported function ──────────────────────────────────────
async function runFullSystem(email, symbol) {
  const orchestrator = new OrchestratorAgent(email, symbol);
  const result = await orchestrator.run();
  return result;
}

module.exports = { runFullSystem };
