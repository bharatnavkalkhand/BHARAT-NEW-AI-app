#!/usr/bin/env python3
"""
Bharat-AI Pocket Engine — Kaggle / Google Colab 60 FPS GPU Video Renderer
-----------------------------------------------------------------------
Drives the WebGL + Three.js talking-avatar stage deterministically at 60 FPS
using Chromium GPU acceleration (Vulkan/EGL with SwiftShader fallback),
supports PORTRAIT_3_4 (720x960), REEL_9_16 (720x1280), and CINEMA_16_9 (1280x720),
burns timed Devanagari/Latin ASS captions, normalizes audio to -17 LUFS,
and encodes via FFmpeg NVENC (NVIDIA GPU) with automatic libx264 High fallback.

Usage:
  python colab_kaggle_gpu/gpu_render.py \
      --config colab_kaggle_gpu/scenes_config.json \
      --output bharat_ai_gpu_60fps.mp4 \
      --fps 60 \
      --gesture-boost 1.45
"""

import argparse
import asyncio
import base64
import json
import math
import os
import shutil
import signal
import subprocess
import time
import urllib.request
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parent.parent

ASPECT_DIMS: Dict[str, Tuple[int, int]] = {
    "PORTRAIT_3_4": (720, 960),
    "REEL_9_16": (720, 1280),
    "CINEMA_16_9": (1280, 720),
}


def has_nvidia_nvenc() -> bool:
    if not shutil.which("ffmpeg"):
        return False
    try:
        out = subprocess.check_output(
            ["ffmpeg", "-hide_banner", "-encoders"],
            stderr=subprocess.STDOUT,
            text=True,
        )
        if "h264_nvenc" not in out:
            return False
        probe = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=256x256:d=0.1",
                "-c:v",
                "h264_nvenc",
                "-f",
                "null",
                "-",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return probe.returncode == 0
    except Exception:
        return False


def wait_for_server(url: str, timeout_sec: float = 45.0) -> None:
    start = time.time()
    while time.time() - start < timeout_sec:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if resp.status < 500:
                    return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for local engine server at {url}")


def start_local_server(port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["DISABLE_HMR"] = "true"
    proc = subprocess.Popen(
        ["npx", "tsx", "server.ts"],
        cwd=str(ROOT_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    wait_for_server(f"http://127.0.0.1:{port}/api/health", timeout_sec=60.0)
    return proc


def format_ass_time(sec: float) -> str:
    safe = max(0.0, sec)
    cs = int(round(safe * 100))
    hrs = cs // 360000
    rem = cs % 360000
    mins = rem // 6000
    rem %= 6000
    secs = rem // 100
    hundredths = rem % 100
    return f"{hrs}:{mins:02d}:{secs:02d}.{hundredths:02d}"


def escape_ass_text(line: str) -> str:
    return (
        line.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .strip()
    )


def build_ass_subtitles(
    scenes: List[Dict[str, Any]],
    width: int,
    height: int,
    overlay_enabled: bool,
    ass_path: Path,
) -> bool:
    font_size = max(24, round(height * 0.032))
    margin_bottom = round(height * (0.185 if overlay_enabled else 0.055))
    margin_lower_third = round(height * 0.24)
    margin_top = round(height * 0.14)
    margin_side = max(36, round(width * 0.06))

    header = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "ScaledBorderAndShadow: yes",
            "WrapStyle: 1",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Bottom,{ 'Noto Sans Devanagari' },{font_size},&H00FFFFFF,&H00FFFFFF,&H00120B07,&H96060910,1,0,0,0,100,100,0,0,3,2,0,2,{margin_side},{margin_side},{margin_bottom},1",
            f"Style: LowerThird,Noto Sans Devanagari,{font_size},&H00FFFFFF,&H00FFFFFF,&H00120B07,&H96060910,1,0,0,0,100,100,0,0,3,2,0,2,{margin_side},{margin_side},{margin_lower_third},1",
            f"Style: Top,Noto Sans Devanagari,{font_size},&H00FFFFFF,&H00FFFFFF,&H00120B07,&H96060910,1,0,0,0,100,100,0,0,3,2,0,8,{margin_side},{margin_side},{margin_top},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )

    events: List[str] = []
    cursor_sec = 0.0
    for scene in scenes:
        dur_sec = max(1.5, float(scene.get("durationMs", 3500)) / 1000.0)
        pos = str(scene.get("captionPosition", "bottom"))
        if pos != "hidden":
            style = "Top" if pos == "top" else "LowerThird" if pos == "lower_third" else "Bottom"
            cues = scene.get("captionCues") or []
            if cues:
                for cue in cues:
                    lines = [escape_ass_text(str(l)) for l in (cue.get("lines") or []) if str(l).strip()]
                    if not lines:
                        continue
                    s_t = cursor_sec + float(cue.get("startSec", 0.0))
                    e_t = cursor_sec + min(dur_sec, float(cue.get("endSec", dur_sec)))
                    if e_t <= s_t + 0.05:
                        continue
                    joined_lines = "\\N".join(lines)
                    events.append(
                        f"Dialogue: 0,{format_ass_time(s_t)},{format_ass_time(e_t)},{style},,0,0,0,,{joined_lines}"
                    )
            else:
                text = str(scene.get("captionText") or scene.get("dialogue") or "").strip()
                if text:
                    events.append(
                        f"Dialogue: 0,{format_ass_time(cursor_sec)},{format_ass_time(cursor_sec + dur_sec)},{style},,0,0,0,,{escape_ass_text(text)}"
                    )
        cursor_sec += dur_sec

    if not events:
        return False

    ass_path.write_text(header + "\n" + "\n".join(events) + "\n", encoding="utf-8")
    return True


async def synthesize_scene_audio(
    scenes: List[Dict[str, Any]],
    cast: List[Dict[str, Any]],
    language: str,
    work_dir: Path,
) -> Optional[Path]:
    """Builds 48kHz stereo narration track from Gemini TTS base64 or edge-tts, loudnormed to -17 LUFS."""
    try:
        import edge_tts  # type: ignore
    except ImportError:
        edge_tts = None

    cast_map = {a["id"]: a for a in cast}
    segment_paths: List[Path] = []

    for idx, scene in enumerate(scenes):
        duration_sec = max(1.5, float(scene.get("durationMs", 3500)) / 1000.0)
        actor = cast_map.get(scene.get("actorId", ""), cast[0] if cast else {})
        is_female = bool(actor.get("isFemale", False))
        speech_rate = float(actor.get("speechRate", 0.95))
        dialogue = str(scene.get("dialogue", "")).strip()
        seg_wav = work_dir / f"scene_{idx:03d}.wav"

        tts_ok = False

        # 1. Prefer pre-synthesized Gemini TTS base64 saved in scenes_config.json
        b64_audio = scene.get("voiceAudioBase64")
        if isinstance(b64_audio, str) and len(b64_audio) > 32:
            raw_ext = "wav"
            mime = str(scene.get("voiceAudioMime", "")).lower()
            if "mpeg" in mime or "mp3" in mime:
                raw_ext = "mp3"
            elif "webm" in mime:
                raw_ext = "webm"
            elif "mp4" in mime or "m4a" in mime:
                raw_ext = "m4a"
            raw_in = work_dir / f"scene_{idx:03d}_in.{raw_ext}"
            try:
                raw_in.write_bytes(base64.b64decode(b64_audio))
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-i",
                        str(raw_in),
                        "-af",
                        f"aresample=48000,apad=whole_dur={duration_sec:.3f}",
                        "-t",
                        f"{duration_sec:.3f}",
                        "-ar",
                        "48000",
                        "-ac",
                        "2",
                        "-c:a",
                        "pcm_s16le",
                        str(seg_wav),
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                tts_ok = seg_wav.exists()
            except Exception:
                tts_ok = False

        # 2. Otherwise synthesize via edge-tts
        if not tts_ok and edge_tts is not None and dialogue:
            if language.startswith("hi"):
                voice = "hi-IN-SwaraNeural" if is_female else "hi-IN-MadhurNeural"
            else:
                voice = "en-IN-NeerjaNeural" if is_female else "en-IN-PrabhatNeural"
            rate_pct = int(round((speech_rate - 1.0) * 100))
            rate_str = f"{rate_pct:+d}%"
            raw_mp3 = work_dir / f"scene_{idx:03d}.mp3"
            try:
                communicate = edge_tts.Communicate(dialogue, voice=voice, rate=rate_str)
                await communicate.save(str(raw_mp3))
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-i",
                        str(raw_mp3),
                        "-af",
                        f"aresample=48000,apad=whole_dur={duration_sec:.3f}",
                        "-t",
                        f"{duration_sec:.3f}",
                        "-ar",
                        "48000",
                        "-ac",
                        "2",
                        "-c:a",
                        "pcm_s16le",
                        str(seg_wav),
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                tts_ok = seg_wav.exists()
            except Exception:
                tts_ok = False

        # 3. Ambient harmonic bed fallback
        if not tts_ok:
            sr = 48000
            n_frames = int(round(duration_sec * sr))
            with wave.open(str(seg_wav), "wb") as wf:
                wf.setnchannels(2)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                buf = bytearray()
                for n in range(n_frames):
                    t = n / sr
                    val = 0.035 * math.sin(2 * math.pi * 110.0 * t) + 0.02 * math.sin(
                        2 * math.pi * 165.0 * t
                    )
                    sample = max(-32767, min(32767, int(val * 32767)))
                    buf.extend(sample.to_bytes(2, "little", signed=True) * 2)
                wf.writeframes(bytes(buf))

        segment_paths.append(seg_wav)

    if not segment_paths:
        return None

    concat_list = work_dir / "audio_concat.txt"
    concat_list.write_text(
        "\n".join(f"file '{p.resolve()}'" for p in segment_paths),
        encoding="utf-8",
    )
    raw_master = work_dir / "master_audio_raw.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(raw_master),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    norm_master = work_dir / "master_audio_norm.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(raw_master),
            "-af",
            "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,loudnorm=I=-17:LRA=7:TP=-1.5",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(norm_master),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return norm_master


async def launch_webgl_browser(playwright_ctx: Any) -> Any:
    gpu_profiles = [
        (
            "ANGLE Vulkan GPU",
            [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--enable-webgl",
                "--ignore-gpu-blocklist",
                "--use-gl=angle",
                "--use-angle=vulkan",
                "--enable-features=Vulkan",
            ],
        ),
        (
            "ANGLE SwiftShader WebGL",
            [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--enable-webgl",
                "--ignore-gpu-blocklist",
                "--use-gl=angle",
                "--use-angle=swiftshader",
            ],
        ),
    ]
    last_err: Optional[Exception] = None
    for label, args in gpu_profiles:
        try:
            browser = await playwright_ctx.chromium.launch(headless=True, args=args)
            print(f"  Chromium backend active: {label}")
            return browser
        except Exception as err:
            last_err = err
            print(f"  {label} unavailable ({err}); trying fallback...")
    raise RuntimeError(f"Failed to launch Chromium WebGL renderer: {last_err}")


async def render_gpu_video(
    config_path: Path,
    output_path: Path,
    fps: int,
    gesture_boost: float,
    port: int,
) -> None:
    from playwright.async_api import async_playwright  # type: ignore

    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    scenes: List[Dict[str, Any]] = cfg.get("scenes", [])
    cast: List[Dict[str, Any]] = cfg.get("cast", [])
    fmt = cfg.get("format", "REEL_9_16")
    framing = cfg.get("framing", "FULL_BODY")
    language = cfg.get("language", "hi-IN")
    overlay_config = cfg.get("overlayConfig")

    if not scenes:
        raise ValueError("No scenes found in scenes_config.json")

    width, height = ASPECT_DIMS.get(fmt, (720, 1280))
    work_dir = Path("/tmp/bharat_ai_gpu_render")
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = work_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Synthesizing scene audio ({len(scenes)} scenes @ 48kHz / -17 LUFS)...")
    master_wav = await synthesize_scene_audio(scenes, cast, language, work_dir)

    ass_path = work_dir / "captions.ass"
    overlay_enabled = bool(isinstance(overlay_config, dict) and overlay_config.get("enabled", False))
    has_ass = build_ass_subtitles(scenes, width, height, overlay_enabled, ass_path)

    print(f"[2/4] Starting Bharat-AI engine server on port {port}...")
    server_proc = start_local_server(port)

    try:
        use_nvenc = has_nvidia_nvenc()
        print(
            f"[3/4] Launching GPU Chromium renderer "
            f"({width}x{height} @ {fps} FPS · gestureBoost={gesture_boost:.2f}x · "
            f"encoder={'h264_nvenc' if use_nvenc else 'libx264'})..."
        )

        async with async_playwright() as p:
            browser = await launch_webgl_browser(p)
            page = await browser.new_page(viewport={"width": width, "height": height})
            await page.goto(
                f"http://127.0.0.1:{port}/?gpuExport=1",
                wait_until="networkidle",
                timeout=60000,
            )
            await page.wait_for_function(
                "() => Boolean(window.__BHARAT_GPU_RENDER__)",
                timeout=30000,
            )

            init_payload: Dict[str, Any] = {
                "scenes": scenes,
                "cast": cast,
                "format": fmt,
                "framing": framing,
                "gestureBoost": gesture_boost,
            }
            if overlay_config is not None:
                init_payload["overlayConfig"] = overlay_config

            await page.evaluate(
                """async (payload) => {
                    await window.__BHARAT_GPU_RENDER__.init(payload);
                }""",
                init_payload,
            )

            canvas_loc = page.locator("#gpu-export-canvas")
            global_frame = 0
            global_time_sec = 0.0
            dt = 1.0 / fps

            for s_idx, scene in enumerate(scenes):
                dur_ms = max(1500, int(scene.get("durationMs", 3500)))
                total_scene_frames = max(1, int(round((dur_ms / 1000.0) * fps)))
                env = scene.get("lipSyncEnvelope") or [0.2]
                vis = scene.get("visemeWidths") or [0.95]

                for f_idx in range(total_scene_frames):
                    progress = f_idx / max(1, total_scene_frames - 1)
                    exact_30 = progress * (dur_ms / 1000.0) * 30.0
                    i0 = min(len(env) - 1, int(math.floor(exact_30)))
                    i1 = min(len(env) - 1, i0 + 1)
                    frac = exact_30 - math.floor(exact_30)
                    amp = env[i0] * (1.0 - frac) + env[i1] * frac

                    w0 = vis[min(len(vis) - 1, i0)]
                    w1 = vis[min(len(vis) - 1, i1)]
                    vis_w = w0 * (1.0 - frac) + w1 * frac

                    await page.evaluate(
                        """(args) => {
                            window.__BHARAT_GPU_RENDER__.renderStep(
                                args.sceneIndex,
                                args.progress,
                                args.timeSec,
                                args.audioAmp,
                                args.visemeWidth
                            );
                        }""",
                        {
                            "sceneIndex": s_idx,
                            "progress": progress,
                            "timeSec": global_time_sec,
                            "audioAmp": amp,
                            "visemeWidth": vis_w,
                        },
                    )
                    frame_path = frames_dir / f"frame_{global_frame:06d}.jpg"
                    await canvas_loc.screenshot(
                        path=str(frame_path),
                        type="jpeg",
                        quality=95,
                    )
                    global_frame += 1
                    global_time_sec += dt

                print(f"  Rendered scene {s_idx + 1}/{len(scenes)} ({total_scene_frames} frames)")

            await page.evaluate("() => window.__BHARAT_GPU_RENDER__.dispose()")
            await browser.close()

        print(f"[4/4] Encoding {global_frame} frames to {output_path}...")
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-framerate",
            str(fps),
            "-i",
            str(frames_dir / "frame_%06d.jpg"),
        ]
        if master_wav and master_wav.exists():
            ffmpeg_cmd.extend(["-i", str(master_wav), "-shortest"])

        vf_filters: List[str] = [f"fps={fps}", "format=yuv420p"]
        if has_ass and ass_path.exists():
            escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:")
            vf_filters.insert(0, f"ass={escaped_ass}")

        ffmpeg_cmd.extend(["-vf", ",".join(vf_filters)])

        if use_nvenc:
            ffmpeg_cmd.extend(
                [
                    "-c:v",
                    "h264_nvenc",
                    "-profile:v",
                    "high",
                    "-preset",
                    "p5",
                    "-cq",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-r",
                    str(fps),
                ]
            )
        else:
            ffmpeg_cmd.extend(
                [
                    "-c:v",
                    "libx264",
                    "-profile:v",
                    "high",
                    "-preset",
                    "medium",
                    "-crf",
                    "16",
                    "-pix_fmt",
                    "yuv420p",
                    "-r",
                    str(fps),
                ]
            )

        if master_wav and master_wav.exists():
            ffmpeg_cmd.extend(["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"])

        ffmpeg_cmd.extend(["-movflags", "+faststart", str(output_path)])
        subprocess.run(ffmpeg_cmd, check=True)
        print(f"Done! GPU video saved to: {output_path.resolve()}")

    finally:
        if server_proc.poll() is None:
            server_proc.send_signal(signal.SIGTERM)
            try:
                server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server_proc.kill()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bharat-AI 60 FPS GPU Video Renderer")
    parser.add_argument(
        "--config",
        type=Path,
        default=ROOT_DIR / "colab_kaggle_gpu" / "scenes_config.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("bharat_ai_gpu_60fps.mp4"),
    )
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--gesture-boost", type=float, default=1.45)
    parser.add_argument("--port", type=int, default=3010)
    args = parser.parse_args()

    asyncio.run(
        render_gpu_video(
            config_path=args.config,
            output_path=args.output,
            fps=args.fps,
            gesture_boost=args.gesture_boost,
            port=args.port,
        )
    )


if __name__ == "__main__":
    main()
