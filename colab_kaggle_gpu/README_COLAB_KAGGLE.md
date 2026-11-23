# Bharat-AI Pocket Engine — Google Colab & Kaggle Guide

Move the entire **Bharat-AI Pocket Engine** app (React + WebGL shader + 3D GLB + FFmpeg + AI Director + Colab GPU Renderer) into **Google Colab** or **Kaggle** in two ways:

1. **Run the Full Interactive Web App** on port `3000` (inside Colab Preview or Kaggle via Cloudflare Tunnel).
2. **Render Ultra-Smooth 60 FPS MP4 Films** on cloud GPUs (`T4` / `P100`) with boosted dual-hand gestures, walking paths & side-profile character poses, Devanagari ASS captions, `-17 LUFS` audio, and NVIDIA `h264_nvenc` hardware encoding.

---

## Option A — Notebook Migration (Recommended)
1. Open the **Colab GPU** tab inside Bharat-AI Pocket Engine.
2. Click **Download Full App & Colab Pack (.zip)** and **Download Notebook (.ipynb)**.
3. **Google Colab**:
   - Open `Bharat_AI_GPU_Studio.ipynb` in Colab.
   - Set **Runtime → Change runtime type → T4 GPU**.
   - Upload `bharat-ai-pocket-engine-colab-gpu.zip` into `/content/` (or run Cell 2 to upload via picker).
4. **Kaggle**:
   - Create a new Notebook, turn **Internet: On**, and set **Accelerator: GPU T4 x2** (or **P100**).
   - Click **+ Input → Upload** and upload `bharat-ai-pocket-engine-colab-gpu.zip` as a dataset.
   - Import `Bharat_AI_GPU_Studio.ipynb` (`File → Import Notebook`).
5. Run Cells 1–2 to install Node 22, FFmpeg, Noto Devanagari fonts, Chromium Playwright, and npm packages.
6. Set `RUN_WEB_APP = True` in Cell 3 to open the live web studio UI, OR run Cells 4–6 to render `bharat_ai_gpu_60fps.mp4`.

---

## Option B — CLI Commands Inside Any Colab / Kaggle Terminal
### 1. Run Headless 60 FPS GPU Renderer
```bash
apt-get update -qq && apt-get install -y -qq ffmpeg fonts-noto-core fonts-noto-extra
pip install playwright edge-tts
playwright install chromium
npm install
python colab_kaggle_gpu/gpu_render.py \
  --config colab_kaggle_gpu/scenes_config.json \
  --output bharat_ai_gpu_60fps.mp4 \
  --fps 60 \
  --gesture-boost 1.45
```

### 2. Run Full Live Web App Server
```bash
npm install
npm run build
GEMINI_API_KEY="your_key_here" NODE_ENV=production PORT=3000 DISABLE_HMR=true npx tsx server.ts
```
