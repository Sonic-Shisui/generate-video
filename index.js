const express = require("express");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const os = require("os");

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// dossiers pour vidéos et fichiers temporaires
const PUBLIC_DIR = path.join(__dirname, "public");
const VIDEO_DIR = path.join(PUBLIC_DIR, "videos");
const TMP_DIR = path.join(os.tmpdir(), "aniedit_tmp");

[PUBLIC_DIR, VIDEO_DIR, TMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: path.join(TMP_DIR, "uploads/") });

// helper : télécharger une image depuis une URL
async function downloadImageToFile(url, outPath) {
  const writer = fs.createWriteStream(outPath);
  const response = await axios.get(url, { responseType: "stream", timeout: 30000 });
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    let error = null;
    writer.on("error", err => { error = err; writer.close(); reject(err); });
    writer.on("close", () => { if (!error) resolve(outPath); });
  });
}

// helper : créer des frames depuis une image
async function createFramesFromImage(imgPath, framesDir, frameCount, width = 720, height = 720) {
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

  const metadata = await sharp(imgPath).metadata();

  for (let i = 0; i < frameCount; i++) {
    const zoom = 1 + 0.02 * Math.sin((i / frameCount) * Math.PI * 2);
    const offsetX = Math.round(((i / (frameCount - 1)) - 0.5) * metadata.width * 0.06);
    const offsetY = Math.round(((i / (frameCount - 1)) - 0.5) * metadata.height * 0.03);

    const cropW = Math.round(metadata.width / zoom);
    const cropH = Math.round(metadata.height / zoom);
    const left = Math.max(0, Math.min(metadata.width - cropW, Math.floor((metadata.width - cropW) / 2 + offsetX)));
    const top = Math.max(0, Math.min(metadata.height - cropH, Math.floor((metadata.height - cropH) / 2 + offsetY)));

    const hueShift = Math.round(5 * Math.sin((i / frameCount) * Math.PI * 2));

    const outFile = path.join(framesDir, `frame_${String(i).padStart(4, "0")}.png`);
    await sharp(imgPath)
      .extract({ left, top, width: cropW, height: cropH })
      .resize(width, height)
      .modulate({ hue: hueShift + 0, saturation: 1 + 0.02 * Math.cos((i / frameCount) * Math.PI * 2) })
      .toFile(outFile);
  }
}

// helper : assembler les frames en mp4
function assembleVideoFromFrames(framesPattern, fps, outputPath, promptText, duration) {
  return new Promise((resolve, reject) => {
    const fontfile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    const hasFont = fs.existsSync(fontfile);

    let command = ffmpeg()
      .addInput(framesPattern)
      .inputOptions([`-framerate ${fps}`])
      .outputOptions([
        `-c:v libx264`,
        `-pix_fmt yuv420p`,
        `-vf format=yuv420p`,
        `-movflags +faststart`,
        `-preset veryfast`,
      ])
      .duration(duration)
      .on("error", err => reject(err))
      .on("end", () => resolve(outputPath));

    if (promptText && promptText.trim().length > 0) {
      const safePrompt = promptText.replace(/[:'"]/g, "");
      const drawText = hasFont
        ? `drawtext=fontfile=${fontfile}:text='${safePrompt}':fontcolor=white@0.9:fontsize=28:box=1:boxcolor=0x00000099:boxborderw=5:x=(w-text_w)/2:y=h-(text_h*2)`
        : `drawtext=text='${safePrompt}':fontcolor=white@0.9:fontsize=28:box=1:boxcolor=0x00000099:boxborderw=5:x=(w-text_w)/2:y=h-(text_h*2)`;
      command = command.videoFilters(drawText);
    }

    command.save(outputPath);
  });
}

// endpoint principal
app.post("/aniedit", upload.single("image"), async (req, res) => {
  try {
    const { image_url, prompt } = req.body;
    let duration = parseFloat(req.body.duration || "5");
    if (isNaN(duration) || duration <= 0) duration = 5;
    if (duration > 30) duration = 30;

    const id = uuidv4();
    const tmpDir = path.join(TMP_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const inputImagePath = path.join(tmpDir, "input_image");
    if (req.file) {
      fs.renameSync(req.file.path, inputImagePath + path.extname(req.file.originalname || ".png"));
    } else if (image_url) {
      const ext = path.extname(new URL(image_url).pathname) || ".jpg";
      const dest = inputImagePath + ext;
      await downloadImageToFile(image_url, dest);
    } else {
      return res.status(400).json({ status: false, message: "image_url or uploaded image required" });
    }

    const savedImage = fs.readdirSync(tmpDir).find(f => f.startsWith("input_image"));
    if (!savedImage) throw new Error("Failed to save input image.");
    const savedImagePath = path.join(tmpDir, savedImage);

    const fps = 25;
    const frameCount = Math.max(1, Math.round(duration * fps));
    const framesDir = path.join(tmpDir, "frames");
    await createFramesFromImage(savedImagePath, framesDir, frameCount, 720, 720);

    const framesPattern = path.join(framesDir, "frame_%04d.png");
    const outVideoPath = path.join(VIDEO_DIR, `${id}.mp4`);

    await assembleVideoFromFrames(framesPattern, fps, outVideoPath, prompt || "", duration);

    setTimeout(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }, 10 * 1000);

    const videoUrl = `${req.protocol}://${req.get("host")}/videos/${id}.mp4`;
    return res.json({ status: true, message: "Video generated", video_url: videoUrl, id });
  } catch (err) {
    console.error("Error in /aniedit:", err);
    return res.status(500).json({ status: false, message: err.message || "Internal error" });
  }
});

// servir les vidéos
app.use("/videos", express.static(VIDEO_DIR));

// endpoint racine
app.get("/", (req, res) => {
  res.json({ status: true, message: "Aniedit minimal API running" });
});

const PORT = process.env.PORT || 20409;
app.listen(PORT, () => {
  console.log(`Aniedit server listening on port ${PORT}`);
});