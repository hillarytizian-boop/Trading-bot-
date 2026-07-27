const WebSocket = require('ws');

// Unset proxy settings in Node process to prevent 407 Proxy Errors on Render
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;

class MarketDataService {
  constructor() {
    this.connections = {};
    // Base public stream URL for Binance Spot
    this.baseUrl = 'wss://stream.binance.com:9443/ws';
  }

  start(symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']) {
    symbols.forEach((symbol) => this.connectSymbol(symbol.toLowerCase()));
  }

  connectSymbol(symbol) {
    if (this.connections[symbol]) return;

    const streamUrl = `${this.baseUrl}/${symbol}@ticker`;
    console.log(`[WS] Connecting to ${streamUrl}...`);

    // Force direct connection (no proxy)
    const ws = new WebSocket(streamUrl, {
      agent: false // Prevents picking up ambient HTTP/HTTPS proxy agents
    });

    ws.on('open', () => {
      console.log(`[WS] Successfully connected to ${symbol.toUpperCase()}`);
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data);
        // Process ticker data
      } catch (err) {
        console.error(`[WS] ${symbol.toUpperCase()} parse error:`, err.message);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] ${symbol.toUpperCase()} error:`, err.message);
    });

    ws.on('close', () => {
      console.log(`[WS] ${symbol.toUpperCase()} disconnected, reconnecting in 5s...`);
      delete this.connections[symbol];
      setTimeout(() => this.connectSymbol(symbol), 5000);
    });

    this.connections[symbol] = ws;
  }
}

module.exports = new MarketDataService();
