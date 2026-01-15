const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const REPLICATE_API_TOKEN = "r8_FdL5cfS2Y1yEnUiMjyD1218SU7T6EBr3aVAGr";
app.post('/api/animate', async (req, res) => {
    const { imageUrl, prompt, key } = req.body;
    if (key !== "fadil_boss_dev_uchiha") {
        return res.status(403).json({ error: "Clé API invalide" });
    }

    try {
      
        const response = await axios.post(
            "https://api.replicate.com/v1/predictions",
            {
                version: "3f0c27844a34730438ec6f27ee855428669e403d6f108f906560965d6c8b939e",
                input: {
                    input_image: imageUrl,
                    video_length: "14_frames_with_svd_xt",
                    motion_bucket_id: 127
                }
            },
            {
                headers: {
                    Authorization: `Token ${REPLICATE_API_TOKEN}`,
                    "Content-Type": "application/json",
                }
            }
        );

        const predictionId = response.data.id;
      
        res.json({ 
            status: "processing", 
            prediction_id: predictionId,
            message: "La vidéo est en cours de création..." 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erreur lors du lancement de la génération" });
    }
});
app.get('/api/check/:id', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.replicate.com/v1/predictions/${req.params.id}`,
            { headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` } }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Erreur de vérification" });
    }
});

app.listen(3000, () => console.log("API Cyber-Video lancée sur le port 3000"));
