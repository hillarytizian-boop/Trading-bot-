const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  binanceApiKey: { type: DataTypes.STRING, defaultValue: null },
  binanceSecretKey: { type: DataTypes.STRING, defaultValue: null },
  derivToken: { type: DataTypes.STRING, defaultValue: null },
  role: { type: DataTypes.ENUM('user', 'admin'), defaultValue: 'user' },
  botSettings: { type: DataTypes.JSONB, defaultValue: { tradeAmount: 10, maxDailyLoss: 10, maxTradesPerDay: 30, riskLevel: 'Medium', market: 'BTCUSDT', autoCompound: false } },
  balance: { type: DataTypes.FLOAT, defaultValue: 1000 },
  dailyPnL: { type: DataTypes.FLOAT, defaultValue: 0 },
  totalTrades: { type: DataTypes.INTEGER, defaultValue: 0 },
  winningTrades: { type: DataTypes.INTEGER, defaultValue: 0 },
}, { timestamps: false, hooks: { beforeCreate: async (u) => { u.password = await bcrypt.hash(u.password, 12); } } });

User.prototype.comparePassword = async function (candidate) {
  return await bcrypt.compare(candidate, this.password);
};

module.exports = User;
