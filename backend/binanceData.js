const Binance = require('binance-api-node').default;
const supabase = require('./db');

class BinanceDataFetcher {
  constructor() {
    this.client = Binance();
    this.symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
    this.priceCache = {};
    this.historyCache = {};
    this.lastUpdate = {};
  }

  // ─── Fetch current price ──────────────────────────────────────────
  async getPrice(symbol = 'BTCUSDT') {
    try {
      const ticker = await this.client.prices({ symbol });
      const price = parseFloat(ticker[symbol]);
      this.priceCache[symbol] = price;
      this.lastUpdate[symbol] = Date.now();
      return price;
    } catch (error) {
      console.error(`[Binance] Price fetch error for ${symbol}:`, error.message);
      return this.priceCache[symbol] || null;
    }
  }

  // ─── Fetch candle history ─────────────────────────────────────────
  async getCandles(symbol = 'BTCUSDT', interval = '1m', limit = 50) {
    try {
      const candles = await this.client.candles({ symbol, interval, limit });
      const closes = candles.map(c => parseFloat(c.close));
      const volumes = candles.map(c => parseFloat(c.volume));
      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      const timestamps = candles.map(c => c.openTime);
      this.historyCache[symbol] = { closes, volumes, highs, lows, timestamps };
      return this.historyCache[symbol];
    } catch (error) {
      console.error(`[Binance] Candles fetch error for ${symbol}:`, error.message);
      return this.historyCache[symbol] || null;
    }
  }

  // ─── Get all price data for analysis ──────────────────────────────
  async getAnalysisData(symbol = 'BTCUSDT') {
    const price = await this.getPrice(symbol);
    const history = await this.getCandles(symbol);
    return {
      symbol,
      price,
      closes: history?.closes || [],
      volumes: history?.volumes || [],
      highs: history?.highs || [],
      lows: history?.lows || [],
      timestamps: history?.timestamps || [],
    };
  }

  // ─── Calculate technical indicators ──────────────────────────────
  calculateIndicators(closes) {
    if (!closes || closes.length < 14) return null;
    // RSI
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff >= 0) gains += diff;
      else losses += -diff;
    }
    const avgGain = gains / (closes.length - 1);
    const avgLoss = losses / (closes.length - 1);
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    // MACD
    const ema12 = closes.slice(-12).reduce((a,b) => a+b, 0) / Math.min(12, closes.length);
    const ema26 = closes.slice(-26).reduce((a,b) => a+b, 0) / Math.min(26, closes.length);
    const macd = ema12 - ema26;
    // EMA20 and EMA50
    const ema20 = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
    const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / Math.min(50, closes.length);
    // ATR
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
    // Bollinger Bands
    const sma = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, closes.length);
    const std = Math.sqrt(closes.slice(-20).reduce((a,b) => a + Math.pow(b - sma, 2), 0) / Math.min(20, closes.length));
    const bbUpper = sma + 2 * std;
    const bbLower = sma - 2 * std;
    // VWAP (simplified)
    const typical = closes.map((c, i) => (c + (closes[i] || c) + (closes[i] || c)) / 3);
    const vwap = typical.reduce((a,b) => a+b, 0) / typical.length;
    // ADX (simplified)
    let adx = 25;
    return {
      rsi,
      macd,
      ema20,
      ema50,
      atr,
      bbUpper,
      bbLower,
      vwap,
      adx,
      currentPrice: closes[closes.length-1],
    };
  }

  // ─── Format data for AI prompt ────────────────────────────────────
  formatForAI(data) {
    const ind = this.calculateIndicators(data.closes);
    if (!ind) return null;
    return {
      symbol: data.symbol,
      price: data.price || ind.currentPrice,
      indicators: {
        rsi: ind.rsi,
        macd: ind.macd,
        ema20: ind.ema20,
        ema50: ind.ema50,
        atr: ind.atr,
        bbUpper: ind.bbUpper,
        bbLower: ind.bbLower,
        vwap: ind.vwap,
        adx: ind.adx,
      },
      closes: data.closes,
    };
  }
}

// ─── Singleton instance ─────────────────────────────────────────────
const instance = new BinanceDataFetcher();

// ─── Periodic update function ──────────────────────────────────────
async function updateAllPrices() {
  for (const symbol of instance.symbols) {
    try {
      await instance.getPrice(symbol);
      await instance.getCandles(symbol);
    } catch (e) {
      console.error(`[Binance] Update error for ${symbol}:`, e.message);
    }
  }
}

// ─── Start periodic updates (every 60 seconds) ────────────────────
if (process.env.NODE_ENV !== 'test') {
  setInterval(updateAllPrices, 60000);
  // Initial update
  setTimeout(updateAllPrices, 1000);
}

module.exports = { BinanceDataFetcher, instance, updateAllPrices };
