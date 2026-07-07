const router = require('express').Router();
const OpenAI = require('openai');

// Initialize client
const client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Models to query
const MODELS = [
  'z-ai/glm-5.1',
  'deepseek-ai/deepseek-v4-pro',
  'moonshotai/kimi-k2.6',
];

// Helper to query a single model
async function queryModel(model, prompt) {
  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 1,
    top_p: 1,
    max_tokens: 16384,
    stream: false,
  };
  if (model === 'deepseek-ai/deepseek-v4-pro') {
    params.extra_body = { chat_template_kwargs: { thinking: false } };
  }
  try {
    const completion = await client.chat.completions.create(params);
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined && parsed.reason) {
        return { model, success: true, data: parsed };
      }
    }
    // fallback
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200),
      }
    };
  } catch (error) {
    console.warn(`Model ${model} failed:`, error.message);
    return { model, success: false, error: error.message };
  }
}

// Exported analysis function – used by both the route and the agent
async function analyze({ market, price, indicators }) {
  const prompt = `You are a professional crypto trading analyst.
Given the following data for ${market || 'BTC/USDT'}:
- Current price: ${price || 'unknown'}
- RSI: ${indicators?.rsi || 'N/A'}
- EMA: ${indicators?.ema || 'N/A'}
- MACD: ${indicators?.macd || 'N/A'}

Provide a trading signal (BUY, SELL, or HOLD) with a confidence percentage (0-100) and a brief reason (max 50 words).
Respond ONLY with valid JSON in this exact format:
{"signal": "BUY", "confidence": 85, "reason": "Bullish breakout above resistance."}`;

  const promises = MODELS.map(model => queryModel(model, prompt));
  const results = await Promise.allSettled(promises);
  const successful = results
    .filter(r => r.status === 'fulfilled' && r.value.success)
    .map(r => r.value.data);

  if (successful.length === 0) {
    throw new Error('All AI models failed to respond');
  }

  // Majority vote
  const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
  successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
  const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
  const avgConfidence = Math.round(successful.reduce((sum, d) => sum + d.confidence, 0) / successful.length);
  const reasons = successful.map(d => d.reason);
  const breakdown = successful.map((d, i) => ({
    model: MODELS[i] || 'unknown',
    signal: d.signal,
    confidence: d.confidence,
    reason: d.reason,
  }));

  return {
    signal: finalSignal,
    confidence: avgConfidence,
    reason: `Consensus from ${successful.length} models. ${reasons.join(' ')}`,
    breakdown,
  };
}

// Express route handler – uses the exported function
router.post('/analyze', async (req, res) => {
  try {
    const result = await analyze(req.body);
    res.json(result);
  } catch (error) {
    console.error('Multi-model analysis error:', error);
    res.status(500).json({ error: 'AI service error', details: error.message });
  }
});

module.exports = { router, analyze };
