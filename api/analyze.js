const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function callWithRetry(system, content, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content }],
      });
      const raw = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return raw.replace(/```json/g, '').replace(/```/g, '').trim();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries - 1) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || '30', 10);
        const wait = Math.min(retryAfter * 1000, 60000);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { system, content, extract } = req.body;

    if (!system || !content) {
      return res.status(400).json({ error: 'Missing system or content' });
    }

    const result = await callWithRetry(system, content);
    res.status(200).json({ result });
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    res.status(status).json({ error: message });
  }
};
