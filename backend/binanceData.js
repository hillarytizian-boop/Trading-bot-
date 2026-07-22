const fetch = require('node-fetch');
const marketData = require('./marketData');
const { RSI, MACD, SMA, EMA } = require('technicalindicators');

class DataFetcher {
  constructor() {
    this.symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
    this.priceCache = {};
    this.historyCache = {};
    this.coingeckoIds = {
      'BTCUSDT': 'bitcoin',
      'ETHUSDT': 'ethereum',
      'BNBUSDT': 'binancecoin',
      'SOLUSDT': 'solana'
    };
  }

  async getPrice(symbol = 'BTCUSDT') {
    // existing implementation – keep it
    // ... (copy from your current binanceData.js)
  }

  async getCandles(symbol = 'BTCUSDT', interval = '1m', limit = 50) {
    // existing implementation – keep it
    // ...
  }

  async getAnalysisData(symbol = 'BTCUSDT') {
    // existing implementation – keep it
    // ...
  }

  // ─── NEW: Full analysis with indicators ──────────────────────────
  async getFullAnalysis(symbol = 'BTCUSDT', limit = 100) {
    const closes = await this.getCandles(symbol, '1h', limit);
    if (!closes || closes.length < 50) {
      throw new Error('Not enough data for indicators');
    }

    const currentPrice = closes[closes.length - 1];

    // Compute indicators
    const rsi = RSI.calculate({ values: closes, period: 14 }).at(-1) || 50;
    const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
    const macdLast = macd.at(-1);
    const sma20 = SMA.calculate({ values: closes, period: 20 }).at(-1);
    const sma50 = SMA.calculate({ values: closes, period: 50 }).at(-1);
    const ema20 = EMA.calculate({ values: closes, period: 20 }).at(-1);
    const ema50 = EMA.calculate({ values: closes, period: 50 }).at(-1);

    return {
      symbol,
      currentPrice,
      rsi: Math.round(rsi),
      macd: macdLast ? {
        macd: macdLast.MACD,
        signal: macdLast.signal,
        histogram: macdLast.histogram
      } : null,
      sma20,
      sma50,
      ema20,
      ema50,
      closes,
    };
  }

  // ─── Existing calculateIndicators (keep for compatibility) ───────
  calculateIndicators(closes) {
    // ... existing code ...
  }
}

const instance = new DataFetcher();
module.exports = { DataFetcher, instance };
