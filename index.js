const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Nouveau service fiable (testé)
const API_BASE = "https://co.wuk.sh/api/json";

app.get("/", (req, res) => {
    res.json({
        message: "API Proxy de téléchargement vidéo opérationnelle",
        endpoints: {
            info: "/api/info?url=...",
            download: "/api/download?url=..."
        },
        service: "co.wuk.sh"
    });
});

app.get("/api/info", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ success: false, error: "URL manquante" });
        }

        const response = await axios.get(API_BASE, {
            params: { url },
            timeout: 15000
        });

        const data = response.data;

        if (data && data.status === "success") {
            res.json({
                success: true,
                title: data.title,
                duration: data.duration,
                thumbnail: data.thumbnail,
                formats: data.formats || [],
                platform: data.platform
            });
        } else {
            res.status(400).json({ success: false, error: data.message || "Impossible de récupérer les informations" });
        }
    } catch (error) {
        console.error("Erreur /api/info:", error.message);
        res.status(500).json({ success: false, error: "Erreur serveur ou service tiers indisponible" });
    }
});

app.get("/api/download", async (req, res) => {
    try {
        const { url, formatId } = req.query;
        if (!url) {
            return res.status(400).json({ success: false, error: "URL manquante" });
        }

        // Récupérer d'abord les informations pour obtenir le lien de téléchargement
        const infoResponse = await axios.get(API_BASE, {
            params: { url },
            timeout: 15000
        });

        const data = infoResponse.data;
        if (!data || data.status !== "success") {
            return res.status(400).json({ success: false, error: data.message || "Impossible d'obtenir le lien" });
        }

        // Chercher le format demandé ou le meilleur disponible
        let downloadUrl = null;
        if (data.formats && data.formats.length > 0) {
            const format = formatId 
                ? data.formats.find(f => f.format_id === formatId)
                : data.formats[0];
            if (format) downloadUrl = format.url;
        }
        
        if (!downloadUrl) {
            downloadUrl = data.url; // fallback
        }

        if (!downloadUrl) {
            return res.status(400).json({ success: false, error: "Aucun lien de téléchargement trouvé" });
        }

        // Redirection vers le lien direct
        res.redirect(downloadUrl);
    } catch (error) {
        console.error("Erreur /api/download:", error.message);
        res.status(500).json({ success: false, error: "Erreur serveur ou service tiers indisponible" });
    }
});

module.exports = app;