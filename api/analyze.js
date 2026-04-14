const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function convertContentForGemini(system, content) {
  // Convert Anthropic-style content blocks to Gemini format
  const parts = [];

  // Add system prompt as first text part
  parts.push({ text: system });

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'document' && block.source?.type === 'base64') {
        parts.push({
          inlineData: {
            mimeType: block.source.media_type,
            data: block.source.data,
          },
        });
      } else if (block.type === 'image' && block.source?.type === 'base64') {
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

async function callWithRetry(system, content, maxRetries = 3) {
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
      if (err.status === 429 && attempt < maxRetries - 1) {
        const wait = Math.pow(2, attempt + 1) * 5000; // 10s, 20s, 40s
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
