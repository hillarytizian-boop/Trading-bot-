const fetch = require('node-fetch');
const marketData = require('./marketData');

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

  // ─── Get price: WebSocket first, fallback to REST ──────────────
  async getPrice(symbol = 'BTCUSDT') {
    symbol = symbol.replace('/', '');
    // Try WebSocket first
    const wsPrice = marketData.getPrice(symbol);
    if (wsPrice !== null && wsPrice > 0) {
      this.priceCache[symbol] = wsPrice;
      return wsPrice;
    }
    // Fallback: REST
    try {
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
      const res = await fetch(url);
      const data = await res.json();
      const price = parseFloat(data.price);
      if (price > 0) {
        this.priceCache[symbol] = price;
        return price;
      }
    } catch (e) {
      console.warn(`[Binance] REST price fallback failed: ${e.message}`);
    }
    return this.priceCache[symbol] || 0;
  }

  // ─── Get candles: WebSocket first, fallback to REST ──────────────
  async getCandles(symbol = 'BTCUSDT', interval = '1m', limit = 50) {
    symbol = symbol.replace('/', '');
    // Try WebSocket
    const wsCandles = marketData.getCandles(symbol);
    if (wsCandles && wsCandles.length >= limit) {
      // We have enough candles from WebSocket
      return wsCandles.slice(-limit);
    }
    // Fallback to REST (Binance)
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`;
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const closes = data.map(c => parseFloat(c[4]));
        return closes;
      }
    } catch (e) {
      console.warn(`[Binance] REST candles fallback failed: ${e.message}`);
    }
    // If still nothing, return whatever we have
    return wsCandles || [];
  }

  // ─── Get analysis data ──────────────────────────────────────────
  async getAnalysisData(symbol = 'BTCUSDT') {
    symbol = symbol.replace('/', '');
    const price = await this.getPrice(symbol);
    const closes = await this.getCandles(symbol);
    return {
      symbol,
      price,
      closes,
    };
  }

  // ─── Indicators (unchanged) ──────────────────────────────────────
  calculateIndicators(closes) {
    if (!closes || closes.length < 14) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff >= 0) gains += diff;
      else losses += -diff;
    }
    const avgGain = gains / (closes.length - 1);
    const avgLoss = losses / (closes.length - 1);
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    const ema12 = closes.slice(-12).reduce((a,b) => a+b, 0) / Math.min(12, closes.length);
    const ema26 = closes.slice(-26).reduce((a,b) => a+b, 0) / Math.min(26, closes.length);
    const macd = ema12 - ema26;
    const ema20 = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
    const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / Math.min(50, closes.length);
    let atr = 0;
    if (closes.length > 14) {
      let trSum = 0;
      for (let i = 1; i < closes.length; i++) {
        const high = closes[i] * 1.001;
        const low = closes[i] * 0.999;
        const prevClose = closes[i-1];
        trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      }
      atr = trSum / (closes.length - 1);
    }
    const sma = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
    const std = Math.sqrt(closes.slice(-20).reduce((a,b) => a + Math.pow(b - sma, 2), 0) / Math.min(20, closes.length));
    const bbUpper = sma + 2 * std;
    const bbLower = sma - 2 * std;
    const typical = closes.map((c, i) => (c + (closes[i] || c) + (closes[i] || c)) / 3);
    const vwap = typical.reduce((a,b) => a+b, 0) / typical.length;
    return {
      rsi,
      macd,
      ema20,
      ema50,
      atr,
      bbUpper,
      bbLower,
      vwap,
      adx: 25,
      currentPrice: closes[closes.length-1],
    };
  }
}

const instance = new DataFetcher();
module.exports = { DataFetcher, instance };
