// Uploads a single file to Gemini File API and returns the file URI.
// Called once per file from the browser; keeps each request under Vercel's
// 4.5 MB body limit.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { base64, mimeType, displayName } = req.body;
    if (!base64 || !mimeType) {
      return res.status(400).json({ error: 'Missing base64 or mimeType' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const buffer = Buffer.from(base64, 'base64');
    const numBytes = buffer.length;

    // 1. Start resumable upload session
    const startRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(numBytes),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file: { display_name: displayName || 'document' },
        }),
      }
    );

    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(`Upload start failed: ${startRes.status} ${errText}`);
    }

    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      throw new Error('No upload URL returned from Gemini');
    }

    // 2. Upload the file bytes and finalize
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(numBytes),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload failed: ${uploadRes.status} ${errText}`);
    }

    const result = await uploadRes.json();
    const file = result.file;
    if (!file?.uri) throw new Error('No file URI returned');

    res.status(200).json({
      fileUri: file.uri,
      mimeType: file.mimeType || mimeType,
      name: file.name,
      state: file.state,
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
