const axios = require('axios');
const crypto = require('crypto');

class BinanceService {
  constructor(apiKey, secretKey, useTestnet = false) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseURL = useTestnet 
      ? 'https://testnet.binance.vision/api/v3'
      : 'https://api.binance.com/api/v3';
    this.futuresURL = useTestnet
      ? 'https://testnet.binancefuture.com/fapi/v1'
      : 'https://fapi.binance.com/fapi/v1';
  }

  sign(params = {}) {
    const timestamp = Date.now();
    const queryString = Object.entries({ ...params, timestamp })
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const signature = crypto.createHmac('sha256', this.secretKey).update(queryString).digest('hex');
    return `${queryString}&signature=${signature}`;
  }

  async request(method, endpoint, params = {}, isFutures = false) {
    const base = isFutures ? this.futuresURL : this.baseURL;
    const signed = method === 'GET' ? this.sign(params) : '';
    const url = `${base}${endpoint}?${signed}`;
    const headers = { 'X-MBX-APIKEY': this.apiKey, 'Content-Type': 'application/json' };
    const res = await axios({ method, url, headers, data: method === 'POST' ? params : undefined, timeout: 10000 });
    return res.data;
  }

  async getAccountInfo() { return this.request('GET', '/account'); }
  async getBalance() { const acc = await this.getAccountInfo(); return acc.balances.filter(b => parseFloat(b.free) > 0); }
  async getPrice(symbol) { const res = await this.request('GET', '/ticker/price', { symbol }); return parseFloat(res.price); }
  async getOpenOrders(symbol) { return this.request('GET', '/openOrders', { symbol }); }
  async getAllOpenOrders() { return this.request('GET', '/openOrders'); }
  async getOrderHistory(symbol) { return this.request('GET', '/allOrders', { symbol }); }
  async getTrades(symbol) { return this.request('GET', '/myTrades', { symbol }); }
  async marketBuy(symbol, quantity) { return this.request('POST', '/order', { symbol, side: 'BUY', type: 'MARKET', quantity }); }
  async marketSell(symbol, quantity) { return this.request('POST', '/order', { symbol, side: 'SELL', type: 'MARKET', quantity }); }
  async limitBuy(symbol, quantity, price) { return this.request('POST', '/order', { symbol, side: 'BUY', type: 'LIMIT', quantity, price, timeInForce: 'GTC' }); }
  async limitSell(symbol, quantity, price) { return this.request('POST', '/order', { symbol, side: 'SELL', type: 'LIMIT', quantity, price, timeInForce: 'GTC' }); }
  async futuresAccountInfo() { return this.request('GET', '/account', {}, true); }
  async futuresBalance() { const acc = await this.futuresAccountInfo(); return acc.assets.filter(a => parseFloat(a.walletBalance) > 0); }
  async futuresMarketBuy(symbol, quantity, leverage = 1) { await this.request('POST', '/leverage', { symbol, leverage }, true); return this.request('POST', '/order', { symbol, side: 'BUY', type: 'MARKET', quantity }, true); }
  async futuresMarketSell(symbol, quantity, leverage = 1) { await this.request('POST', '/leverage', { symbol, leverage }, true); return this.request('POST', '/order', { symbol, side: 'SELL', type: 'MARKET', quantity }, true); }
  async getFuturesPositions() { return this.request('GET', '/positionRisk', {}, true); }
  async getKlines(symbol, interval = '15m', limit = 100) { return this.request('GET', '/klines', { symbol, interval, limit }); }
}

module.exports = BinanceService;
