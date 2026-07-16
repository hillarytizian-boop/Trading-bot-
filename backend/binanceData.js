const fetch = require('node-fetch');

class DataFetcher {
  constructor() {
    this.symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
    this.priceCache = {};
    this.historyCache = {};
    // CoinGecko symbol mapping
    this.coingeckoIds = {
      'BTCUSDT': 'bitcoin',
      'ETHUSDT': 'ethereum',
      'BNBUSDT': 'binancecoin',
      'SOLUSDT': 'solana'
    };
  }

  // ─── Binance endpoints (try these first) ──────────────────────────
  async _binanceFetch(url) {
    const endpoints = [
      'https://api.binance.com',
      'https://api1.binance.com',
      'https://api2.binance.com',
      'https://api3.binance.com',
    ];
    for (const base of endpoints) {
      try {
        const res = await fetch(base + url, { timeout: 5000 });
        if (res.ok) {
          const data = await res.json();
          return data;
        }
      } catch (e) {
        // ignore and try next
      }
    }
    throw new Error('All Binance endpoints failed');
  }

  // ─── CoinGecko fallback ──────────────────────────────────────────
  async _coingeckoFetch(symbol) {
    const id = this.coingeckoIds[symbol];
    if (!id) throw new Error(`No CoinGecko ID for ${symbol}`);
    // Get current price
    const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
    const priceRes = await fetch(priceUrl);
    const priceData = await priceRes.json();
    const price = priceData[id]?.usd;
    if (!price) throw new Error('Price not found');

    // Get historical data (5-min candles, last 50)
    const now = Math.floor(Date.now() / 1000);
    const from = now - 50 * 300; // 50 candles * 5 minutes
    const histUrl = `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${now}`;
    const histRes = await fetch(histUrl);
    const histData = await histRes.json();
    if (!histData.prices || histData.prices.length === 0) throw new Error('No historical data');
    // CoinGecko returns [timestamp, price] arrays – we need closes (use the price)
    const closes = histData.prices.map(p => p[1]);
    // Trim to last 50
    const trimmed = closes.slice(-50);
    return { price, closes: trimmed };
  }

  async getPrice(symbol = 'BTCUSDT') {
    try {
      // Try Binance first
      const data = await this._binanceFetch(`/api/v3/ticker/price?symbol=${symbol}`);
      const price = parseFloat(data.price);
      this.priceCache[symbol] = price;
      return price;
    } catch (e) {
      console.warn(`[Data] Binance price failed for ${symbol}, using CoinGecko`);
      try {
        const { price } = await this._coingeckoFetch(symbol);
        this.priceCache[symbol] = price;
        return price;
      } catch (err) {
        console.error(`[Data] CoinGecko price failed for ${symbol}:`, err.message);
        return this.priceCache[symbol] || null;
      }
    }
  }

  async getCandles(symbol = 'BTCUSDT', interval = '5m', limit = 50) {
    try {
      // Try Binance for candles (uses 1m, but if it fails we fallback)
      const data = await this._binanceFetch(`/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
      if (Array.isArray(data) && data.length > 0) {
        const closes = data.map(c => parseFloat(c[4]));
        this.historyCache[symbol] = { closes };
        return this.historyCache[symbol];
      }
      throw new Error('Binance candles invalid');
    } catch (e) {
      console.warn(`[Data] Binance candles failed for ${symbol}, using CoinGecko (5-min)`);
      try {
        const { closes } = await this._coingeckoFetch(symbol);
        this.historyCache[symbol] = { closes };
        return this.historyCache[symbol];
      } catch (err) {
        console.error(`[Data] CoinGecko candles failed for ${symbol}:`, err.message);
        return this.historyCache[symbol] || null;
      }
    }
  }

  async getAnalysisData(symbol = 'BTCUSDT') {
    const price = await this.getPrice(symbol);
    const history = await this.getCandles(symbol);
    return {
      symbol,
      price,
      closes: history?.closes || [],
    };
  }

  // ─── Indicator calculations (unchanged) ──────────────────────────
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

const instance = new DataFetcher();

async function updateAllPrices() {
  for (const symbol of instance.symbols) {
    try {
      await instance.getPrice(symbol);
      await instance.getCandles(symbol);
    } catch (e) {
      // ignore
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(updateAllPrices, 60000);
  setTimeout(updateAllPrices, 1000);
}

module.exports = { DataFetcher, instance, updateAllPrices };
