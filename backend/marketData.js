const WebSocket = require('ws');

class MarketData {
  constructor() {
    this.streams = new Map();
    this.subscriptions = new Set();
    this._started = false;
  }

  // ─── Subscribe to a symbol ──────────────────────────────────────
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
      const ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`
      );

      ws.on('open', () => {
        state.connected = true;
        console.log(`[WS] ${symbol} connected`);
        // Clear reconnect timer if any
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
          // Use 1m candle data
          const candle = {
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
            timestamp: k.t,
          };
          // Update the last candle or push new one
          const last = state.candles[state.candles.length - 1];
          if (last && last.timestamp === k.t) {
            // Replace with latest
            state.candles[state.candles.length - 1] = candle;
          } else {
            state.candles.push(candle);
          }
          // Keep last 200 candles
          if (state.candles.length > 200) state.candles.shift();
        } catch (e) {
          // ignore parse errors
        }
      });

      ws.on('close', () => {
        state.connected = false;
        console.log(`[WS] ${symbol} disconnected, reconnecting in 3s...`);
        state.ws = null;
        // Attempt to reconnect after 3 seconds
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

  // ─── Get current price ──────────────────────────────────────────
  getPrice(symbol = 'BTCUSDT') {
    symbol = symbol.toUpperCase();
    const state = this.streams.get(symbol);
    if (state && state.connected && state.price) {
      return state.price;
    }
    return null;
  }

  // ─── Get candle history ──────────────────────────────────────────
  getCandles(symbol = 'BTCUSDT', count = 50) {
    symbol = symbol.toUpperCase();
    const state = this.streams.get(symbol);
    if (state && state.candles.length > 0) {
      // Return the last 'count' candles, as close prices
      const closes = state.candles.slice(-count).map(c => c.close);
      return closes;
    }
    return [];
  }

  // ─── Get full analysis data (same interface as old binanceData) ──
  getAnalysisData(symbol = 'BTCUSDT') {
    symbol = symbol.toUpperCase();
    const price = this.getPrice(symbol);
    const closes = this.getCandles(symbol);
    return {
      symbol,
      price: price || 0,
      closes: closes,
      // We don't have highs/lows from 1m kline aggregated, but we can approximate
      // For simplicity, we'll just return closes and price.
    };
  }

  // ─── Start all subscriptions ────────────────────────────────────
  start(symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']) {
    if (this._started) return;
    this._started = true;
    for (const sym of symbols) {
      this.subscribe(sym);
    }
    console.log(`[WS] Started subscriptions for ${symbols.join(', ')}`);
  }
}

module.exports = new MarketData();
