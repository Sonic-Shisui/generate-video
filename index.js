const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '20mb' })); 

const OPENAI_KEY = "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";
if (!OPENAI_KEY) {
  console.warn('⚠️ Warning: OPENAI_API_KEY not set in environment variables.');
}
app.get('/', (req, res) => res.send('AniEdit API (OpenAI Sora) — up'));

/**
 * Endpoint /aniedit
 * Query params or JSON body:
 *  - image_url (string)  <-- optional but recommended (we reference it in the prompt)
 *  - prompt (string)     <-- required
 *  - duration (int)      <-- seconds (optional, default 5)
 *
 * Returns a JSON { status: 'processing'|'failed'|'done', video_url?: string, job?: ... }
 *
 * NOTE: the exact OpenAI video API parameters can evolve. Here we call POST /v1/videos
 * with model "sora-2" (adjust to available model in your account).
 */
app.post('/aniedit', async (req, res) => {
  try {
    const image_url = req.body.image_url || req.query.image_url;
    const promptRaw = req.body.prompt || req.query.prompt;
    const duration = parseInt(req.body.duration || req.query.duration || '5', 10);

    if (!promptRaw || promptRaw.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Missing prompt parameter.' });
    }

    // Build prompt for Sora — include the image URL as a reference inside the prompt text
    // (Sora supports image inputs; depending on your account you may prefer multipart upload)
    const prompt = image_url
      ? `Animate the subject in this photo: ${image_url}\nInstructions: ${promptRaw}\nDuration: ${duration}s`
      : `Generate a short ${duration}s video: ${promptRaw}`;

    // Prepare payload for OpenAI video endpoint
    const openaiPayload = {
      model: 'sora-2',            // change if your account uses another model (e.g., sora-2-pro)
      prompt: prompt,
      // optional: resolution, fps, format. Keep them if you want defaults.
      // resolution: '720x1280',
      // duration_seconds: duration,
      // NOTE: parameter names may vary between OpenAI releases. If your account requires other keys,
      // check https://platform.openai.com/docs/guides/video-generation.
    };

    // Create generation job
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

    // Many video endpoints return either a direct video_url or an async job id.
    // We try to return what we get back to the caller.
    const createData = createResp.data || {};
    // If API returns video_url directly:
    if (createData.video_url) {
      return res.json({
        status: 'done',
        video_url: createData.video_url,
        meta: createData
      });
    }

    // If API returns an id/job, return it and instruct caller to poll
    if (createData.id || createData.job) {
      return res.json({
        status: 'processing',
        job: createData,
        message: 'Video generation started. Poll /aniedit/status?job_id=... to get result'
      });
    }

    // Otherwise return raw response for debugging
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
 * This implementation expects the OpenAI API to expose a /v1/videos/{id} or similar.
 * If your account uses a different route, adapt accordingly.
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
