const OPENAI_KEY = "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";

export default async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'POST') {
    try {
      const data = req.method === 'POST' ? req.body : req.query;
      const image_url = data.image_url;
      const promptRaw = data.prompt;
      const duration = parseInt(data.duration || '5', 10);

      if (!promptRaw || promptRaw.trim().length === 0) {
        return res.status(400).json({ status: 'error', message: 'Missing prompt parameter.' });
      }

      const prompt = image_url
        ? `Animate the subject in this photo: ${image_url}\nInstructions: ${promptRaw}\nDuration: ${duration}s`
        : `Generate a short ${duration}s video: ${promptRaw}`;

      const openaiPayload = {
        model: 'sora-2',
        prompt: prompt
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
        return res.status(200).json({
          status: 'done',
          video_url: createData.video_url,
          meta: createData
        });
      }

      if (createData.id || createData.job) {
        return res.status(200).json({
          status: 'processing',
          job: createData,
          message: 'Video generation started. Poll /api/aniedit/status?job_id=... to get result'
        });
      }

      return res.status(200).json({ status: 'unknown', raw: createData });

    } catch (err) {
      console.error('Error calling OpenAI videos endpoint:', err?.response?.data || err.message || err);
      const apiMsg = err?.response?.data || null;
      return res.status(500).json({
        status: 'failed',
        error: apiMsg || err.message
      });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ status: 'error', message: `Method ${req.method} not allowed` });
  }
}