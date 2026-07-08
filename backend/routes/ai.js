const router = require('express').Router();
const OpenAI = require('openai');

const client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Single confirmed model
const MODEL = 'z-ai/glm-5.2';

router.post('/analyze', async (req, res) => {
  const { market, price, indicators } = req.body;
  if (!price) return res.status(400).json({ error: 'Price required' });

  const prompt = `You are a crypto analyst. BTC/USDT price ${price}, RSI ${indicators?.rsi || 'N/A'}, EMA ${indicators?.ema || 'N/A'}, MACD ${indicators?.macd || 'N/A'}. Signal (BUY/SELL/HOLD) with confidence 0-100 and reason (max 20 words). Respond ONLY JSON: {"signal":"BUY","confidence":85,"reason":"..."}`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
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
      return res.json({
        signal: parsed.signal || 'HOLD',
        confidence: parsed.confidence || 50,
        reason: parsed.reason || 'Analysis complete',
      });
    }
    // fallback
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    res.json({
      signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
      confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
      reason: content.slice(0, 200) || 'Analysis complete',
    });
  } catch (error) {
    console.error('AI error:', error);
    res.status(500).json({ error: 'AI service error', details: error.message });
  }
});

module.exports = router;
