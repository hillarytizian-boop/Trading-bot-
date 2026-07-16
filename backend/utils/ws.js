const WebSocket = require('ws');

class BinanceWebSocket {
  constructor(symbol, callback) {
    this.symbol = symbol.toLowerCase();
    this.callback = callback;
    this.ws = null;
    this.reconnectTimer = null;
    this.connect();
  }

  connect() {
    const stream = `${this.symbol}usdt@trade`;
    this.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.p) {
          const price = parseFloat(parsed.p);
          this.callback({ price, time: parsed.T });
        }
      } catch (e) {}
    });
    this.ws.on('close', () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });
    this.ws.on('error', () => {});
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

module.exports = BinanceWebSocket;
