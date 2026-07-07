const express = require('express');
const cors = require('cors');
const path = require('path');

// Import route modules – wrap each in try/catch to avoid crash if a file is missing
let authRoutes, binanceRoutes, aiRoutes, botRoutes, adminRoutes, tradeRoutes, agentRoutes;

try { authRoutes = require('./routes/auth'); } catch(e) { authRoutes = (req,res) => res.status(501).json({error:'Auth not implemented'}); }
try { binanceRoutes = require('./routes/binance'); } catch(e) { binanceRoutes = (req,res) => res.status(501).json({error:'Binance not implemented'}); }
try { aiRoutes = require('./routes/ai'); } catch(e) { aiRoutes = (req,res) => res.status(501).json({error:'AI not implemented'}); }
try { botRoutes = require('./routes/bot'); } catch(e) { botRoutes = (req,res) => res.status(501).json({error:'Bot not implemented'}); }
try { adminRoutes = require('./routes/admin'); } catch(e) { adminRoutes = (req,res) => res.status(501).json({error:'Admin not implemented'}); }
try { tradeRoutes = require('./routes/trades'); } catch(e) { tradeRoutes = (req,res) => res.status(501).json({error:'Trades not implemented'}); }
try { agentRoutes = require('./routes/agent'); } catch(e) { agentRoutes = (req,res) => res.status(501).json({error:'Agent not implemented'}); }

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Mount routes – each is guaranteed to be a function (either the real router or a fallback)
app.use('/api/auth', authRoutes);
app.use('/api/binance', binanceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/agent', agentRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Serve static frontend
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

// Catch-all for SPA
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
