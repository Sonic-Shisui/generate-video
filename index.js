const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '20mb' })); 

const OPENAI_KEY = "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";
if (!OPENAI_KEY) {
  console.warn('⚠️ Warning: OPENAI_API_KEY not set in environment variables.');
}

app.get('/', (req, res) => res.send('AniEdit API (OpenAI Sora) — up'));

// ✅ GET /aniedit simple pour éviter "Cannot GET"
app.get('/aniedit', (req, res) => {
  res.json({
    status: "ready",
    message: "Use POST /aniedit to generate a video."
  });
});

/**
 * Endpoint /aniedit
 * Query params or JSON body:
 *  - image_url (string)  <-- optional but recommended
 *  - prompt (string)     <-- required
 *  - duration (int)      <-- seconds (optional, default 5)
 */
app.post('/aniedit', async (req, res) => {
  try {
    const image_url = req.body.image_url || req.query.image_url;
    const promptRaw = req.body.prompt || req.query.prompt;
    const duration = parseInt(req.body.duration || req.query.duration || '5', 10);

    if (!promptRaw || promptRaw.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Missing prompt parameter.' });
    }

    const prompt = image_url
      ? `Animate the subject in this photo: ${image_url}\nInstructions: ${promptRaw}\nDuration: ${duration}s`
      : `Generate a short ${duration}s video: ${promptRaw}`;

    const openaiPayload = {
      model: 'sora-2', 
      prompt: prompt,
      // resolution, duration_seconds, etc. peuvent être ajoutés selon besoin
    };

    const createResp = await axios.post(
      'https://api.openai.com/v1/videos',
      openaiPayload,
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );

    const createData = createResp.data || {};

    if (createData.video_url) {
      return res.json({
        status: 'done',
        video_url: createData.video_url,
        meta: createData
      });
    }

    if (createData.id || createData.job) {
      return res.json({
        status: 'processing',
        job: createData,
        message: 'Video generation started. Poll /aniedit/status?job_id=... to get result'
      });
    }

    return res.json({ status: 'unknown', raw: createData });

  } catch (err) {
    console.error('Error calling OpenAI videos endpoint:', err?.response?.data || err.message || err);
    const apiMsg = err?.response?.data || null;
    return res.status(500).json({
      status: 'failed',
      error: apiMsg || err.message
    });
  }
});

/**
 * Optional: status poll endpoint if OpenAI returned a job id
 */
app.get('/aniedit/status', async (req, res) => {
  try {
    const jobId = req.query.job_id || req.query.id;
    if (!jobId) return res.status(400).json({ status: 'error', message: 'Missing job_id' });

    const statusResp = await axios.get(`https://api.openai.com/v1/videos/${jobId}`, {
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
      timeout: 60000
    });

    return res.json({ status: 'ok', job: statusResp.data });
  } catch (err) {
    console.error('Status check error:', err?.response?.data || err.message || err);
    return res.status(500).json({
      status: 'failed',
      error: err?.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AniEdit API listening on ${PORT}`));