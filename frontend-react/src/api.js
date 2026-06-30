import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export const connectBinance = async (apiKey, secretKey) => {
  const res = await axios.post(`${API_URL}/api/binance/connect`, {
    apiKey,
    secretKey,
  });
  return res.data;
};

export const getBalance = async () => {
  const res = await axios.get(`${API_URL}/api/binance/balance`);
  return res.data;
};

export const startTrade = async (payload) => {
  const res = await axios.post(`${API_URL}/api/binance/trade/start`, payload);
  return res.data;
};

export const stopTrade = async () => {
  const res = await axios.post(`${API_URL}/api/binance/trade/stop`);
  return res.data;
};

export const getMarketPrice = async (symbol) => {
  const res = await axios.get(`${API_URL}/api/binance/price/${symbol}`);
  return res.data;
};

export const getOpenOrders = async () => {
  const res = await axios.get(`${API_URL}/api/binance/orders`);
  return res.data;
};
