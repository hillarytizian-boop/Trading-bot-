const WebSocket = require('ws');
const HttpsProxyAgent = require('https-proxy-agent');

// ─── Proxy configuration ──────────────────────────────────────────
const PROXY_URL = 'http://qsbykpgrqjh5:n0gsca0jpuzio8h@209.50.183.159:3129';
const agent = new HttpsProxyAgent(PROXY_URL);

class MarketData {
  constructor() {
    this.streams = new Map();
    this.subscriptions = new Set();
    this._started = false;
  }

  subscribe(symbol = 'BTCUSDT') {
    symbol = symbol.toUpperCase();
    if (this.streams.has(symbol)) return;
    if (this.subscriptions.has(symbol)) return;
    this.subscriptions.add(symbol);

    const state = {
      price: 0,
      bid: 0,
      ask: 0,
      candles: [],
      connected: false,
      ws: null,
      reconnectTimer: null,
    };

    const connect = () => {
      const wsOptions = {
        agent: agent,  // ⬅️ Proxy for WebSocket
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      };

      const ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`,
        wsOptions
      );

      ws.on('open', () => {
        state.connected = true;
        console.log(`[WS] ${symbol} connected via proxy`);
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (!msg.k) return;
          const k = msg.k;
          state.price = Number(k.c);
          const candle = {
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
            timestamp: k.t,
          };
          const last = state.candles[state.candles.length - 1];
          if (last && last.timestamp === k.t) {
            state.candles[state.candles.length - 1] = candle;
          } else {
            state.candles.push(candle);
          }
          if (state.candles.length > 200) state.candles.shift();
        } catch (e) {
          // ignore
        }
      });

      ws.on('close', () => {
        state.connected = false;
        console.log(`[WS] ${symbol} disconnected, reconnecting in 3s...`);
        state.ws = null;
        state.reconnectTimer = setTimeout(() => {
          this.subscriptions.delete(symbol);
          this.streams.delete(symbol);
          this.subscribe(symbol);
        }, 3000);
      });

      ws.on('error', (err) => {
        console.error(`[WS] ${symbol} error:`, err.message);
      });

      state.ws = ws;
      this.streams.set(symbol, state);
    };

    connect();
  }

  getPrice(symbol = 'BTCUSDT') {
    symbol = symbol.toUpperCase();
    const state = this.streams.get(symbol);
    if (state && state.connected && state.price) {
      return state.price;
    }
    return null;
  }

  getCandles(symbol = 'BTCUSDT', count = 50) {
    symbol = symbol.toUpperCase();
    const state = this.streams.get(symbol);
    if (state && state.candles.length > 0) {
      return state.candles.slice(-count).map(c => c.close);
    }
    return [];
  }

  getAnalysisData(symbol = 'BTCUSDT') {
    symbol = symbol.toUpperCase();
    const price = this.getPrice(symbol);
    const closes = this.getCandles(symbol);
    return {
      symbol,
      price: price || 0,
      closes: closes,
    };
  }

  start(symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']) {
    if (this._started) return;
    this._started = true;
    for (const sym of symbols) {
      this.subscribe(sym);
    }
    console.log(`[WS] Started subscriptions for ${symbols.join(', ')} via proxy`);
  }
}

module.exports = new MarketData();
