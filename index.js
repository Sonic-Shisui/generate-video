const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Nouvelle API de remplacement
const API_BASE = "https://xsaim8x-xxx-api.onrender.com/api/auto";

app.get("/", (req, res) => {
    res.json({
        message: "API Proxy de téléchargement vidéo opérationnelle",
        endpoints: {
            info: "/api/info?url=...",
            download: "/api/download?url=..."
        },
        service: "xsaim8x-xxx-api"
    });
});

app.get("/api/info", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ success: false, error: "URL manquante" });

        const response = await axios.get(API_BASE, {
            params: { url },
            timeout: 20000
        });

        const data = response.data;
        if (data && (data.high_quality || data.low_quality)) {
            res.json({
                success: true,
                title: data.title || "Sans titre",
                high_quality: data.high_quality,
                low_quality: data.low_quality
            });
        } else {
            res.status(400).json({ success: false, error: "Impossible de récupérer les informations" });
        }
    } catch (error) {
        console.error("Erreur /api/info:", error.message);
        res.status(500).json({ success: false, error: "Erreur serveur ou service tiers indisponible" });
    }
});

app.get("/api/download", async (req, res) => {
    try {
        const { url, quality } = req.query;
        if (!url) return res.status(400).json({ success: false, error: "URL manquante" });

        const response = await axios.get(API_BASE, {
            params: { url },
            timeout: 20000
        });

        const data = response.data;
        const downloadUrl = (quality === 'low' ? data.low_quality : data.high_quality) || data.high_quality || data.low_quality;

        if (!downloadUrl) {
            return res.status(400).json({ success: false, error: "Aucun lien de téléchargement trouvé" });
        }

        res.redirect(downloadUrl);
    } catch (error) {
        console.error("Erreur /api/download:", error.message);
        res.status(500).json({ success: false, error: "Erreur serveur ou service tiers indisponible" });
    }
});

module.exports = app;