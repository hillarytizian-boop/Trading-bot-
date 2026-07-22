const fetch = require('node-fetch');
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

  // ─── Get price from CoinGecko (always works) ────────────────────
  async getPrice(symbol = 'BTCUSDT') {
    const id = this.coingeckoIds[symbol] || 'bitcoin';
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
      const res = await fetch(url);
      const data = await res.json();
      const price = data[id]?.usd;
      if (price) {
        this.priceCache[symbol] = price;
        return price;
      }
    } catch (e) {
      console.warn('[CoinGecko] Price error:', e.message);
    }
    return this.priceCache[symbol] || 0;
  }

  // ─── Get candles from CoinGecko (5‑minute bars) ──────────────────
  async getCandles(symbol = 'BTCUSDT', limit = 50) {
    const id = this.coingeckoIds[symbol] || 'bitcoin';
    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - limit * 300; // 5 minutes per candle
      const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${now}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.prices && data.prices.length > 0) {
        const closes = data.prices.map(p => p[1]).slice(-limit);
        this.historyCache[symbol] = { closes };
        return closes;
      }
    } catch (e) {
      console.warn('[CoinGecko] Candles error:', e.message);
    }
    return this.historyCache[symbol]?.closes || [];
  }

  // ─── Analysis data for frontend ──────────────────────────────────
  async getAnalysisData(symbol = 'BTCUSDT') {
    const price = await this.getPrice(symbol);
    const closes = await this.getCandles(symbol, 50);
    return {
      symbol,
      price,
      closes,
    };
  }

  // ─── Full analysis with indicators (for AI) ──────────────────────
  async getFullAnalysis(symbol = 'BTCUSDT', limit = 100) {
    const closes = await this.getCandles(symbol, limit);
    if (closes.length < 50) {
      throw new Error('Not enough data');
    }
    const currentPrice = closes[closes.length - 1];
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
      macd: macdLast ? { macd: macdLast.MACD, signal: macdLast.signal, histogram: macdLast.histogram } : null,
      sma20,
      sma50,
      ema20,
      ema50,
      closes,
    };
  }

  // ─── Simple indicators (for backward compatibility) ──────────────
  calculateIndicators(closes) {
    // keep existing implementation or reuse getFullAnalysis
    return this.getFullAnalysis('BTCUSDT', closes.length);
  }
}

const instance = new DataFetcher();
module.exports = { DataFetcher, instance };
