const BinanceService = require('./BinanceService');
const AIService = require('./AIService');
const User = require('../models/User');
const Trade = require('../models/Trade');
const { v4: uuidv4 } = require('uuid');

class TradingEngine {
  constructor() { this.bots = new Map(); }
  async startForUser(userId) {
    const user = await User.findByPk(userId);
    if (!user || !user.binanceApiKey || !user.binanceSecretKey) return { success: false, msg: 'No Binance API keys' };
    if (this.bots.has(userId)) return { success: false, msg: 'Already running' };
    const binance = new BinanceService(user.binanceApiKey, user.binanceSecretKey);
    const bot = { binance, running: true, lastTrade: 0, cooldown: 30000 };
    this.bots.set(userId, bot);
    this.runCycle(userId);
    return { success: true, msg: 'Binance trading engine started' };
  }
  stopForUser(userId) {
    const bot = this.bots.get(userId);
    if (bot) { clearTimeout(bot.timer); this.bots.delete(userId); }
  }
  async runCycle(userId) {
    const bot = this.bots.get(userId);
    if (!bot || !bot.running) return;
    try { await this.executeTrade(userId, bot); } catch (e) { console.error('Cycle error:', e.message); }
    bot.timer = setTimeout(() => this.runCycle(userId), 30000);
  }
  async executeTrade(userId, bot) {
    const user = await User.findByPk(userId);
    if (!user) return;
    const settings = user.botSettings || {};
    const symbol = settings.market || 'BTCUSDT';
    const amount = settings.tradeAmount || 2;
    const now = Date.now();
    if (now - bot.lastTrade < bot.cooldown) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const { Op } = require('sequelize');
    const tradesToday = await Trade.count({ where: { userId, openedAt: { [Op.gte]: today } } });
    if (tradesToday >= (settings.maxTradesPerDay || 20)) return;
    const lossesToday = await Trade.sum('profitLoss', { where: { userId, openedAt: { [Op.gte]: today }, result: 'LOSS' } }) || 0;
    if (Math.abs(lossesToday) >= (settings.maxDailyLoss || 10)) return;
    bot.lastTrade = now;
    const price = await bot.binance.getPrice(symbol);
    const klines = await bot.binance.getKlines(symbol, '15m', 50);
    const closes = klines.map(k => parseFloat(k[4]));
    const rsi = calculateRSI(closes, 14);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const macd = calculateMACD(closes);
    const ai = await AIService.analyzeMarket({ symbol, price, rsi, ema20, ema50, macd, volume: klines[klines.length-1]?.[5], trend: price > ema20 ? 'up' : 'down' });
    if (ai.signal === 'HOLD' || ai.confidence < 60) return;
    const io = require('../server').io;
    if (ai.signal === 'BUY') {
      await bot.binance.marketBuy(symbol, amount / price);
    } else {
      const balances = await bot.binance.getBalance();
      const asset = symbol.replace('USDT', '');
      const bal = balances.find(b => b.asset === asset);
      if (bal && parseFloat(bal.free) > 0) await bot.binance.marketSell(symbol, parseFloat(bal.free));
    }
    const trade = await Trade.create({ id: uuidv4(), userId, symbol, signal: ai.signal, amount, entryPrice: price, result: 'PENDING', aiConfidence: ai.confidence, aiReason: ai.reason, riskScore: ai.risk, contractId: 'BNB-' + Date.now() });
    io.to(userId).emit('trade_update', trade.toJSON());
  }
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calculateMACD(closes) {
  if (closes.length < 26) return 0;
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  return ema12 - ema26;
}

module.exports = new TradingEngine();
