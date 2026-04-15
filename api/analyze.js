const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function convertContentForGemini(system, content) {
  const parts = [];
  parts.push({ text: system });

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (
        (block.type === 'document' || block.type === 'image') &&
        block.source?.type === 'base64'
      ) {
        parts.push({
          inlineData: {
            mimeType: block.source.media_type,
            data: block.source.data,
          },
        });
      }
    }
  } else if (typeof content === 'string') {
    parts.push({ text: content });
  }

  return parts;
}

// Parse Gemini 429 error for retryDelay hint (e.g., "retryDelay":"37s")
function parseRetryDelay(err) {
  try {
    const msg = err.message || '';
    const match = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/);
    if (match) return parseInt(match[1], 10) * 1000;
  } catch (e) {}
  return null;
}

async function callWithRetry(system, content, maxRetries = 5) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.2,
    },
  });

  const parts = convertContentForGemini(system, content);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(parts);
      const raw = result.response.text();
      return raw.replace(/```json/g, '').replace(/```/g, '').trim();
    } catch (err) {
      const is429 =
        err.status === 429 ||
        /429|rate|quota|exceed/i.test(err.message || '');

      if (is429 && attempt < maxRetries - 1) {
        // Use server-suggested delay if available, else exponential backoff
        const suggested = parseRetryDelay(err);
        const backoff = Math.min(Math.pow(2, attempt) * 5000, 60000);
        const wait = suggested || backoff;
        console.log(
          `Rate limited. Retry ${attempt + 1}/${maxRetries} in ${wait / 1000}s`
        );
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
    const { system, content } = req.body;

    if (!system || !content) {
      return res.status(400).json({ error: 'Missing system or content' });
    }

    const result = await callWithRetry(system, content);
    res.status(200).json({ result });
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    console.error('Gemini API error:', message);
    res.status(status).json({ error: message });
  }
};
