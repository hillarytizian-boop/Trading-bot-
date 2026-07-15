const router = require('express').Router();
const OpenAI = require('openai');

// ─── NVIDIA API client ──────────────────────────────────────────
const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODELS = [
  'deepseek-ai/deepseek-v4-pro',
  'z-ai/glm-5.2',
];

async function queryNvidiaModel(model, prompt) {
  try {
    const completion = await nvidiaClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 256,
      stream: false,
    });
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined) {
        return { model, success: true, data: parsed };
      }
    }
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200) || 'Analysis complete',
      },
    };
  } catch (error) {
    console.error(`Model ${model} failed:`, error.message);
    return { model, success: false, error: error.message };
  }
}

router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const rsi = indicators?.rsi ?? 50;
  const macd = indicators?.macd ?? 0;
  const ema = indicators?.ema ?? price;

  const prompt = `You are a professional crypto trading analyst.

Current BTC/USDT price: $${price}
RSI: ${rsi}
EMA: ${ema}
MACD: ${macd}

Provide a trading signal (BUY, SELL, or HOLD) with:
- confidence (0-100)
- brief reason (max 30 words)

Respond ONLY with valid JSON:
{"signal":"BUY","confidence":85,"reason":"RSI oversold"}`;

  try {
    console.log('[AI] NVIDIA AI analysing...');
    const results = await Promise.allSettled(
      MODELS.map(model => queryNvidiaModel(model, prompt))
    );
    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value.data);

    if (successful.length === 0) {
      return res.json({ signal: 'HOLD', confidence: 30, reason: 'NVIDIA unavailable' });
    }

    const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
    successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
    const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
    const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);
    const reasons = successful.map(d => d.reason);

    res.json({
      signal: finalSignal,
      confidence: avgConfidence,
      reason: `NVIDIA AI: ${reasons.join(' ')}`,
      breakdown: successful.map((d, i) => ({
        model: MODELS[i] || 'unknown',
        signal: d.signal,
        confidence: d.confidence,
        reason: d.reason,
      })),
    });
  } catch (error) {
    console.error('[AI] Error:', error.message);
    res.json({ signal: 'HOLD', confidence: 30, reason: 'AI error: ' + error.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    await nvidiaClient.chat.completions.create({
      model: 'deepseek-ai/deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 10,
    });
    res.json({ nvidia: 'connected', models: MODELS });
  } catch (error) {
    res.json({ nvidia: 'error', message: error.message });
  }
});

module.exports = router;
