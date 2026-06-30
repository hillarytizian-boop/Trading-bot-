const express = require('express');
const auth = require('../middleware/auth');
const BinanceService = require('../services/BinanceService');
const router = express.Router();

router.get('/account', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.binanceApiKey || !user.binanceSecretKey) return res.status(400).json({ error: 'Binance API keys not configured' });
    const binance = new BinanceService(user.binanceApiKey, user.binanceSecretKey);
    const account = await binance.getAccountInfo();
    res.json(account);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/balance', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.binanceApiKey || !user.binanceSecretKey) return res.status(400).json({ error: 'Binance API keys not configured' });
    const binance = new BinanceService(user.binanceApiKey, user.binanceSecretKey);
    const balances = await binance.getBalance();
    res.json(balances);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/price/:symbol', async (req, res) => {
  try {
    const binance = new BinanceService('', '');
    const price = await binance.getPrice(req.params.symbol);
    res.json({ symbol: req.params.symbol, price });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/orders', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.binanceApiKey || !user.binanceSecretKey) return res.status(400).json({ error: 'Binance API keys not configured' });
    const binance = new BinanceService(user.binanceApiKey, user.binanceSecretKey);
    const orders = await binance.getAllOpenOrders();
    res.json(orders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/positions', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.binanceApiKey || !user.binanceSecretKey) return res.status(400).json({ error: 'Binance API keys not configured' });
    const binance = new BinanceService(user.binanceApiKey, user.binanceSecretKey);
    const positions = await binance.getFuturesPositions();
    res.json(positions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.binanceApiKey || !user.binanceSecretKey) return res.status(400).json({ error: 'Binance API keys not configured' });
    const binance = new BinanceService(user.binanceApiKey, user.binanceSecretKey);
    const history = await binance.getTrades(req.query.symbol || 'BTCUSDT');
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
