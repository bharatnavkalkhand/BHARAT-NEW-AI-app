# Bharat-AI Pocket Engine

Full-stack AI story-to-video studio featuring deterministic WebGL shader backgrounds, 3D GLB + 2.5D layered character animation with biome walking paths and side-profile poses, timed Devanagari/English captions, broadcast overlays, and a multi-shot FFmpeg H.264/AAC pipeline (`-17 LUFS`).

---

## 1. Package the Project for Colab / Kaggle

Use `scripts/export_to_colab.py` from the project root to create a clean `.tar.gz` archive (automatically excluding `node_modules`, `dist`, `.git`, `.env`, and temp workspaces):

```bash
python3 scripts/export_to_colab.py
```

Custom output path or extra exclusions:

```bash
python3 scripts/export_to_colab.py \
  --output bharat-ai-pocket-engine-colab.tar.gz \
  --config colab_kaggle_gpu/scenes_config.json
```

---

## 2. How the GPU Render Pipeline Uses `gpuBatchBridge.ts`

Headless cloud GPU rendering connects Python orchestration (`colab_kaggle_gpu/gpu_render.py`) directly to the app's WebGL/Three.js stage (`src/engine/gpuBatchBridge.ts`):

1. `colab_kaggle_gpu/gpu_render.py` starts the Express + Vite server (`npx tsx server.ts`) on a local port and opens `http://127.0.0.1:<port>/?gpuExport=1` in headless Chromium (Playwright with ANGLE Vulkan GPU, falling back cleanly to ANGLE SwiftShader if Vulkan is unavailable).
2. In `src/App.tsx`, `?gpuExport=1` mounts `<GpuExportStage />`, which binds `mountGpuBatchBridge(canvas)` from `src/engine/gpuBatchBridge.ts` to `window.__BHARAT_GPU_RENDER__`.
3. `gpu_render.py` initializes `window.__BHARAT_GPU_RENDER__.init(payload)` with `scenes`, `cast`, `format` (`PORTRAIT_3_4` `720x960`, `REEL_9_16` `720x1280`, `CINEMA_16_9` `1280x720`), `framing`, `gestureBoost`, and `overlayConfig`, preloading actor front/side-profile portraits, dress cutouts, and GLB rigs.
4. For each frame at `--fps` (default `60`), Python calls `window.__BHARAT_GPU_RENDER__.renderStep(sceneIndex, progress, timeSec, audioAmp, visemeWidth)`, which invokes `ThreeGlbStageRenderer.renderFrame` + `WebGlSceneRenderer.renderFrame` (respecting `poseSide`, `walkingDestination`, and `overlayConfig`) and captures each canvas frame.
5. `gpu_render.py` synthesizes or reuses `48 kHz` stereo narration normalized to `-17 LUFS`, burns Devanagari `.ass` captions (`fonts-noto-core`), and muxes the final MP4 with NVIDIA `h264_nvenc` (or `libx264` High fallback).

---

## 3. Running in Google Colab

1. Open [Google Colab](https://colab.research.google.com/) and select **Runtime → Change runtime type → T4 GPU**.
2. Upload `bharat-ai-pocket-engine-colab.tar.gz` into `/content/` (or open `colab_kaggle_gpu/Bharat_AI_GPU_Studio.ipynb`).
3. Run the following cell to install system dependencies, extract the archive, and run the 60 FPS GPU pipeline via `gpuBatchBridge.ts`:

```python
!nvidia-smi
!apt-get update -qq && apt-get install -y -qq curl ffmpeg fonts-noto-core fonts-noto-extra libegl1 libgl1 libvulkan1 mesa-vulkan-drivers > /dev/null
!curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null && apt-get install -y -qq nodejs > /dev/null
!pip install -q playwright edge-tts && playwright install chromium

from pathlib import Path
app_dir = Path('/content/bharat_ai_studio')
app_dir.mkdir(parents=True, exist_ok=True)
!tar -xzf /content/bharat-ai-pocket-engine-colab.tar.gz -C /content/bharat_ai_studio
%cd /content/bharat_ai_studio
!npm install --silent

!python colab_kaggle_gpu/gpu_render.py \
  --config colab_kaggle_gpu/scenes_config.json \
  --output bharat_ai_gpu_60fps.mp4 \
  --fps 60 \
  --gesture-boost 1.45

from IPython.display import Video, display
display(Video('bharat_ai_gpu_60fps.mp4', embed=True, width=420))
```

*(Note: Ensure `colab_kaggle_gpu/scenes_config.json` contains at least one scene—export it from the **Colab GPU** tab in the app or pass your own `--config` JSON.)*

---

## 4. Running in Kaggle

1. Create a new Kaggle Notebook with **Accelerator → GPU T4 x2** (or **P100**) and **Internet → On**.
2. Upload `bharat-ai-pocket-engine-colab.tar.gz` via **+ Input → Upload** as a Kaggle dataset.
3. Extract from `/kaggle/input/...` into `/kaggle/working/bharat_ai_studio` and run the same pipeline:

```python
!apt-get update -qq && apt-get install -y -qq curl ffmpeg fonts-noto-core fonts-noto-extra libegl1 libgl1 libvulkan1 mesa-vulkan-drivers > /dev/null
!curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null && apt-get install -y -qq nodejs > /dev/null
!pip install -q playwright edge-tts && playwright install chromium

import glob
from pathlib import Path

archives = glob.glob('/kaggle/input/**/*.tar.gz', recursive=True)
assert archives, 'Attach bharat-ai-pocket-engine-colab.tar.gz as a Kaggle Input first!'

app_dir = Path('/kaggle/working/bharat_ai_studio')
app_dir.mkdir(parents=True, exist_ok=True)
!tar -xzf "{archives[0]}" -C /kaggle/working/bharat_ai_studio
%cd /kaggle/working/bharat_ai_studio
!npm install --silent

!python colab_kaggle_gpu/gpu_render.py \
  --config colab_kaggle_gpu/scenes_config.json \
  --output /kaggle/working/bharat_ai_gpu_60fps.mp4 \
  --fps 60 \
  --gesture-boost 1.45
```

---

## 5. Optional: Run the Full Live Web App on Colab / Kaggle

To use the interactive studio UI (story editor, AI Director, Gemini TTS, live stage preview) inside Colab or Kaggle:

```bash
npm install
npm run build
GEMINI_API_KEY="YOUR_API_KEY" NODE_ENV=production PORT=3000 DISABLE_HMR=true npx tsx server.ts
```

- **Google Colab**: expose port `3000` in a Python cell via `from google.colab import output; output.serve_kernel_port_as_window(3000)`.
- **Kaggle**: expose port `3000` via `cloudflared tunnel --url http://127.0.0.1:3000`.
