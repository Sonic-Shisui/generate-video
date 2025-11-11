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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// dossier statique pour servir vidéos
const PUBLIC_DIR = path.join(__dirname, "public");
const VIDEO_DIR = path.join(PUBLIC_DIR, "videos");
const TMP_DIR = path.join(os.tmpdir(), "aniedit_tmp");

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR);
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const upload = multer({ dest: path.join(TMP_DIR, "uploads/") });

// helper : download image from URL -> local path
async function downloadImageToFile(url, outPath) {
  const writer = fs.createWriteStream(outPath);
  const response = await axios.get(url, { responseType: "stream", timeout: 30000 });
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    let error = null;
    writer.on("error", err => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on("close", () => {
      if (!error) resolve(outPath);
    });
  });
}

// helper : create frames by applying small transforms
async function createFramesFromImage(imgPath, framesDir, frameCount, width = 720, height = 720) {
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

  const metadata = await sharp(imgPath).metadata();
  // base scale to ensure we can crop/zoom without upscaling too much
  const base = sharp(imgPath);

  for (let i = 0; i < frameCount; i++) {
    // small zoom factor oscillation between 1.00 and 1.10
    const zoom = 1 + 0.02 * Math.sin((i / frameCount) * Math.PI * 2);
    // pan offsets
    const offsetX = Math.round(((i / (frameCount - 1)) - 0.5) * metadata.width * 0.06);
    const offsetY = Math.round(((i / (frameCount - 1)) - 0.5) * metadata.height * 0.03);

    // compute crop region centered with zoom and offsets
    const cropW = Math.round(metadata.width / zoom);
    const cropH = Math.round(metadata.height / zoom);
    const left = Math.max(0, Math.min(metadata.width - cropW, Math.floor((metadata.width - cropW) / 2 + offsetX)));
    const top = Math.max(0, Math.min(metadata.height - cropH, Math.floor((metadata.height - cropH) / 2 + offsetY)));

    // subtle color shift: vary tint slightly
    const hueShift = Math.round(5 * Math.sin((i / frameCount) * Math.PI * 2));

    const outFile = path.join(framesDir, `frame_${String(i).padStart(4, "0")}.png`);
    await sharp(imgPath)
      .extract({ left, top, width: cropW, height: cropH })
      .resize(width, height)
      .modulate({ hue: hueShift + 0, saturation: 1 + 0.02 * Math.cos((i / frameCount) * Math.PI * 2) })
      .toFile(outFile);
  }
  return;
}

// helper : assemble frames into mp4 with ffmpeg and overlay prompt text
function assembleVideoFromFrames(framesPattern, fps, outputPath, promptText, duration) {
  return new Promise((resolve, reject) => {
    // font path: rely on system font; user can change path if needed
    const fontfile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; // common on linux
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
      .on("error", function (err) {
        reject(err);
      })
      .on("end", function () {
        resolve(outputPath);
      });

    // overlay text if provided
    if (promptText && promptText.trim().length > 0) {
      // build drawtext filter
      // sanitize prompt to avoid special ffmpeg filter characters
      const safePrompt = promptText.replace(/[:'"]/g, "");
      const drawText = hasFont
        ? `drawtext=fontfile=${fontfile}:text='${safePrompt}':fontcolor=white@0.9:fontsize=28:box=1:boxcolor=0x00000099:boxborderw=5:x=(w-text_w)/2:y=h-(text_h*2)`
        : `drawtext=text='${safePrompt}':fontcolor=white@0.9:fontsize=28:box=1:boxcolor=0x00000099:boxborderw=5:x=(w-text_w)/2:y=h-(text_h*2)`;
      command = command.videoFilters(drawText);
    }

    command.save(outputPath);
  });
}

// API endpoint
app.post("/editvideo", upload.single("image"), async (req, res) => {
  try {
    const { image_url, prompt } = req.body;
    let duration = parseFloat(req.body.duration || "5");
    if (isNaN(duration) || duration <= 0) duration = 5;
    // limit duration
    if (duration > 30) duration = 30;

    // prepare temp files
    const id = uuidv4();
    const tmpDir = path.join(TMP_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const inputImagePath = path.join(tmpDir, "input_image");
    if (req.file) {
      // user uploaded image file
      fs.renameSync(req.file.path, inputImagePath + path.extname(req.file.originalname || ".png"));
    } else if (image_url) {
      // download the image
      const ext = path.extname(new URL(image_url).pathname) || ".jpg";
      const dest = inputImagePath + ext;
      await downloadImageToFile(image_url, dest);
    } else {
      return res.status(400).json({ status: false, message: "image_url or uploaded image required" });
    }

    // find the actual image file saved
    const savedImage = fs.readdirSync(tmpDir).find(f => f.startsWith("input_image"));
    if (!savedImage) throw new Error("Failed to save input image.");
    const savedImagePath = path.join(tmpDir, savedImage);

    // compute frames
    const fps = 25;
    const frameCount = Math.max(1, Math.round(duration * fps));
    const framesDir = path.join(tmpDir, "frames");
    await createFramesFromImage(savedImagePath, framesDir, frameCount, 720, 720);

    // pattern for ffmpeg (use PNG frames)
    const framesPattern = path.join(framesDir, "frame_%04d.png");
    const outVideoPath = path.join(VIDEO_DIR, `${id}.mp4`);

    await assembleVideoFromFrames(framesPattern, fps, outVideoPath, prompt || "", duration);

    // remove tmp dir (async)
    setTimeout(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {}
    }, 10 * 1000);

    const videoUrl = `${req.protocol}://${req.get("host")}/videos/${id}.mp4`;
    return res.json({ status: true, message: "Video generated", video_url: videoUrl, id });
  } catch (err) {
    console.error("Error in /aniedit:", err);
    return res.status(500).json({ status: false, message: err.message || "Internal error" });
  }
});

// serve videos
app.use("/videos", express.static(VIDEO_DIR));

// root
app.get("/", (req, res) => {
  res.json({ status: true, message: "Aniedit minimal API running" });
});

const PORT = process.env.PORT || 20409;
app.listen(PORT, () => {
  console.log(`Aniedit server listening on port ${PORT}`);
});
