const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Configuration - À MODIFIER avec votre propre clé API si vous utilisez un service payant
const API_CONFIG = {
  // Service gratuit (limité) - vous pouvez changer l'URL si besoin
  baseURL: "https://ytdl-api.vercel.app", // Exemple d'API publique (peut être instable)
  // Si vous avez une clé RapidAPI, décommentez et utilisez :
  // rapidApiKey: process.env.RAPIDAPI_KEY,
  // rapidApiHost: "youtube-mp36.p.rapidapi.com"
};

/**
 * Endpoint pour obtenir les informations d'une vidéo
 * GET /api/info?url=...
 */
app.get("/api/info", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: "URL manquante" });
    }

    // Exemple avec une API publique gratuite (ytdl-api)
    const response = await axios.get(`${API_CONFIG.baseURL}/api/info`, {
      params: { url }
    });

    if (response.data && response.data.success !== false) {
      res.json({
        success: true,
        title: response.data.title,
        duration: response.data.duration,
        thumbnail: response.data.thumbnail,
        formats: response.data.formats || []
      });
    } else {
      res.status(400).json({ success: false, error: "Impossible de récupérer les informations" });
    }
  } catch (error) {
    console.error("Erreur /api/info:", error.message);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

/**
 * Endpoint pour obtenir le lien de téléchargement direct
 * GET /api/download?url=...&formatId=...
 */
app.get("/api/download", async (req, res) => {
  try {
    const { url, formatId } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: "URL manquante" });
    }

    // Construction de l'URL de téléchargement vers l'API tierce
    const downloadUrl = `${API_CONFIG.baseURL}/api/download`;
    
    // Redirection vers l'URL de téléchargement directe fournie par le service
    // (cela évite de faire transiter le fichier par Vercel, ce qui contourne la limite de 4.5 Mo)
    const response = await axios.get(downloadUrl, {
      params: { url, format: formatId || "mp4" },
      maxRedirects: 0,
      validateStatus: (status) => status === 302 || status === 200
    });

    if (response.status === 302 && response.headers.location) {
      // Redirection vers le vrai lien de téléchargement
      res.redirect(response.headers.location);
    } else if (response.data && response.data.url) {
      // Certaines API renvoient directement l'URL
      res.redirect(response.data.url);
    } else {
      res.status(400).json({ success: false, error: "Impossible d'obtenir le lien de téléchargement" });
    }
  } catch (error) {
    console.error("Erreur /api/download:", error.message);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// Route de test
app.get("/", (req, res) => {
  res.json({
    message: "API Proxy de téléchargement vidéo opérationnelle",
    endpoints: {
      info: "/api/info?url=...",
      download: "/api/download?url=...&formatId=..."
    },
    note: "Cette API nécessite un service tiers fonctionnel. Ajustez API_CONFIG.baseURL si besoin."
  });
});

// Pour Vercel, il faut exporter l'application Express
module.exports = app;