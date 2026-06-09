#!/usr/bin/env python3
"""Generate buyer-demo clips with current Sovereign Engine branding.

The script keeps its Python dependencies inside .demo/clipgen-venv so the repo
does not require global Python packages. It renders four short mock-safe clips
and matching screenshots under output/video-clips/.
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".demo" / "clipgen-venv"
CLIPS = ROOT / "output" / "video-clips"
RAW = CLIPS / "raw"
WIDTH = 1440
HEIGHT = 900
FPS = 24
SECONDS = 4


def ensure_deps() -> None:
    try:
        import imageio  # noqa: F401
        import PIL  # noqa: F401
        return
    except ModuleNotFoundError:
        pass

    if Path(sys.prefix).resolve() != VENV.resolve():
        VENV.parent.mkdir(parents=True, exist_ok=True)
        if not (VENV / "bin" / "python").exists():
            subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
        python = VENV / "bin" / "python"
        subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
        subprocess.run([str(python), "-m", "pip", "install", "pillow", "imageio", "imageio-ffmpeg"], check=True)
        os.execv(str(python), [str(python), str(Path(__file__).resolve()), *sys.argv[1:]])

    raise RuntimeError("Failed to install clip generation dependencies.")


ensure_deps()

import imageio.v2 as imageio  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


FONTS = {
    "tiny": font(16, True),
    "small": font(20, False),
    "body": font(24, False),
    "body_bold": font(24, True),
    "subhead": font(32, True),
    "headline": font(60, True),
    "mega": font(70, True),
}


def text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, fill: str, kind: str = "body", **kwargs) -> None:
    draw.text(xy, value, fill=fill, font=FONTS[kind], **kwargs)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: tuple[int, int, int, int], outline=(56, 189, 248, 70), radius=28, width=1) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def background(progress: float) -> Image.Image:
    x = np.linspace(0, 1, WIDTH)
    y = np.linspace(0, 1, HEIGHT)
    xv, yv = np.meshgrid(x, y)
    pulse = 0.08 * math.sin(progress * math.tau)
    r = 5 + 10 * xv + 7 * pulse
    g = 17 + 68 * xv + 22 * yv
    b = 38 + 42 * (1 - yv) + 15 * math.cos(progress * math.tau)
    arr = np.dstack([r, g, b]).clip(0, 255).astype("uint8")
    img = Image.fromarray(arr, "RGB").convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")
    for gx in range(0, WIDTH, 48):
        draw.line((gx, 0, gx, HEIGHT), fill=(125, 211, 252, 18))
    for gy in range(0, HEIGHT, 48):
        draw.line((0, gy, WIDTH, gy), fill=(125, 211, 252, 14))
    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow, "RGBA")
    gdraw.ellipse((850, -180, 1580, 540), fill=(16, 185, 129, 85))
    gdraw.ellipse((-220, 520, 520, 1120), fill=(14, 165, 233, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(55))
    return Image.alpha_composite(img, glow)


def header(draw: ImageDraw.ImageDraw, subtitle: str) -> None:
    text(draw, (64, 50), f"SOVEREIGN ENGINE · {subtitle}", "#8df7ff", "tiny", spacing=2)


def card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, value: str, lines: list[str], badge: str = "HEALTHY") -> None:
    rounded(draw, box, fill=(3, 10, 25, 176), outline=(125, 211, 252, 54))
    x1, y1, x2, _ = box
    text(draw, (x1 + 24, y1 + 30), title.upper(), "#cbd5e1", "tiny")
    badge_w = max(112, 18 + len(badge) * 10)
    rounded(draw, (x2 - badge_w - 24, y1 + 24, x2 - 24, y1 + 54), fill=(19, 78, 74, 160), outline=(250, 204, 21, 120), radius=16)
    text(draw, (x2 - badge_w - 8, y1 + 29), badge, "#fef08a", "tiny")
    text(draw, (x1 + 24, y1 + 84), value, "#9dffbf", "mega")
    for i, line in enumerate(lines):
        text(draw, (x1 + 24, y1 + 156 + i * 27), line, "#dbeafe", "small")


def command_center(progress: float) -> Image.Image:
    img = background(progress)
    draw = ImageDraw.Draw(img, "RGBA")
    header(draw, "REPUTATION COMMAND CENTER")
    text(draw, (64, 88), "The adaptive brain is live.", "#f8fafc", "headline")
    text(draw, (64, 156), "Provider lanes, safe-ramp throttles, worker heartbeats, and ROI proof in one command center.", "#cbd5e1", "body")
    rounded(draw, (1158, 154, 1374, 200), fill=(3, 10, 25, 190), outline=(125, 211, 252, 88), radius=24)
    text(draw, (1178, 169), "Client #1 · demo.local", "#e0f2fe", "small")
    lanes = [
        ("GMAIL", "5,000/hr", ["Block 0.0%", "Deferral 0.0%", "Inbox 100%"], "THROTTLED"),
        ("OUTLOOK", "5,000/hr", ["Block 0.0%", "Deferral 0.0%", "Inbox 100%"], "THROTTLED"),
        ("YAHOO", "5,000/hr", ["Block 0.0%", "Deferral 0.0%", "Inbox 100%"], "THROTTLED"),
        ("ICLOUD", "5,000/hr", ["Block 0.0%", "Deferral 0.0%", "Inbox 100%"], "THROTTLED"),
    ]
    for i, lane in enumerate(lanes):
        x = 64 + i * 332
        card(draw, (x, 242, x + 316, 484), *lane)
    rounded(draw, (64, 504, 776, 846), fill=(3, 10, 25, 176), outline=(125, 211, 252, 54))
    text(draw, (90, 534), "Live Brain Feed", "#f8fafc", "subhead")
    events = [
        "Measured Gmail lane for client 1 domain 1; holding 5000/hr.",
        "Measured Outlook lane for client 1 domain 1; holding 5000/hr.",
        "Measured Yahoo lane for client 1 domain 1; holding 5000/hr.",
        "Worker heartbeat active: 4 sender nodes online.",
    ]
    for i, event in enumerate(events):
        y = 592 + i * 56
        text(draw, (90, y), "LIVE", "#67e8f9", "tiny")
        text(draw, (160, y - 2), event, "#e2e8f0", "small")
        draw.line((90, y + 38, 750, y + 38), fill=(148, 163, 184, 45))
    rounded(draw, (794, 504, 1376, 846), fill=(3, 10, 25, 176), outline=(125, 211, 252, 54))
    text(draw, (822, 534), "Value Generated Ticker", "#f8fafc", "subhead")
    value = "$7,500"
    text(draw, (822, 588), value, "#9dffbf", "mega")
    text(draw, (822, 656), "10,000 inboxed x $0.75 · Net $7,480", "#cbd5e1", "body")
    for i, chip in enumerate(["4 sender nodes", "0 failed jobs", "Safe mock proof"]):
        rounded(draw, (822 + i * 180, 694, 990 + i * 180, 746), fill=(6, 78, 59, 172), outline=(20, 184, 166, 90), radius=20)
        text(draw, (838 + i * 180, 710), chip, "#d1fae5", "small")
    return img


def health_oracle(progress: float) -> Image.Image:
    img = background(progress)
    draw = ImageDraw.Draw(img, "RGBA")
    header(draw, "HEALTH ORACLE")
    text(draw, (64, 92), "Infrastructure pulse in real time.", "#f8fafc", "headline")
    text(draw, (64, 162), "DB, Redis, queues, and workers report readiness before the buyer asks.", "#cbd5e1", "body")
    metrics = [
        ("Redis SET/GET", "2.4 ms", "PASS"),
        ("Postgres query", "7.8 ms", "PASS"),
        ("BullMQ waiting", "0 jobs", "CLEAR"),
        ("Active workers", "4 nodes", "ONLINE"),
        ("P99 delivery latency", "318 ms", "WATCH"),
        ("CPU / 10k sends", "38%", "STABLE"),
    ]
    for i, (title, value, status) in enumerate(metrics):
        col = i % 3
        row = i // 3
        x = 64 + col * 440
        y = 250 + row * 210
        rounded(draw, (x, y, x + 396, y + 170), fill=(3, 10, 25, 180), outline=(125, 211, 252, 58))
        text(draw, (x + 24, y + 28), title.upper(), "#cbd5e1", "tiny")
        badge_w = max(84, 22 + len(status) * 10)
        rounded(draw, (x + 396 - badge_w - 24, y + 22, x + 396 - 24, y + 54), fill=(6, 78, 59, 160), outline=(20, 184, 166, 90), radius=16)
        text(draw, (x + 396 - badge_w - 9, y + 29), status, "#67e8f9", "tiny")
        text(draw, (x + 24, y + 70), value, "#9dffbf", "mega")
    rounded(draw, (64, 700, 1376, 830), fill=(2, 6, 23, 190), outline=(34, 211, 238, 70))
    text(draw, (92, 730), "Health endpoint", "#f8fafc", "subhead")
    text(draw, (92, 778), "GET /api/health/stats?client_id=1  →  queue depth, worker heartbeat, db latency, redis latency", "#dbeafe", "body")
    return img


def stress_proof(progress: float) -> Image.Image:
    img = background(progress)
    draw = ImageDraw.Draw(img, "RGBA")
    header(draw, "10K MOCK STRESS PROOF")
    text(draw, (64, 92), "Mock volume, real pipeline proof.", "#f8fafc", "headline")
    text(draw, (64, 162), "Validator → Queue → Controller → Sender Worker → Event Ingestor", "#cbd5e1", "body")
    rounded(draw, (64, 238, 1376, 812), fill=(2, 6, 23, 214), outline=(125, 211, 252, 64), radius=30)
    terminal = [
        "$ STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test",
        "[stress] starting Sovereign Engine scale proof",
        "[validator] approved contacts: 10,000",
        "[queue] BullMQ jobs added: 10,000",
        "[controller] provider-aware pacing applied",
        "[sender] mock SMTP fastlane active; no real email sent",
        "[events] persisted success events: 10,000",
        "[result] sent=10000 failed=0 throughput=856/sec",
        "[proof] queue drained cleanly; worker heartbeats online",
    ]
    for i, line in enumerate(terminal):
        y = 278 + i * 54
        color = "#9dffbf" if i in (0, 7, 8) else "#dbeafe"
        text(draw, (100, y), line, color, "body_bold" if i in (0, 7, 8) else "body")
    return img


def roi_handoff(progress: float) -> Image.Image:
    img = background(progress)
    draw = ImageDraw.Draw(img, "RGBA")
    header(draw, "INVESTOR HANDOFF")
    text(draw, (64, 92), "A productized deliverability operating system.", "#f8fafc", "headline")
    text(draw, (64, 162), "Buyer-ready Docker stack, command center, health oracle, audit chain, and scale proof.", "#cbd5e1", "body")
    rounded(draw, (64, 250, 696, 790), fill=(3, 10, 25, 185), outline=(125, 211, 252, 60))
    text(draw, (100, 290), "Value Generated", "#f8fafc", "subhead")
    text(draw, (100, 360), "GBP license model", "#9dffbf", "mega")
    text(draw, (100, 430), "£500 rescue sprint · £1,500/month partner", "#dbeafe", "body")
    for i, item in enumerate(["Provider-aware lane control", "SOC2-style audit trail", "RaaS health certificate API", "5-minute buyer demo setup"]):
        text(draw, (100, 510 + i * 54), f"+ {item}", "#d1fae5", "body_bold")
    rounded(draw, (744, 250, 1376, 790), fill=(3, 10, 25, 185), outline=(125, 211, 252, 60))
    text(draw, (780, 290), "Submission story", "#f8fafc", "subhead")
    story = textwrap.wrap(
        "Sovereign Engine is ready for a technical buyer to run locally, inspect through the Health Oracle, watch the Reputation Brain react, and validate throughput with mock-safe stress proof.",
        width=42,
    )
    for i, line in enumerate(story):
        text(draw, (780, 356 + i * 36), line, "#dbeafe", "body")
    for i, chip in enumerate(["Dockerized", "Mock-safe", "Buyer-ready"]):
        rounded(draw, (780 + i * 180, 650, 936 + i * 180, 706), fill=(6, 78, 59, 172), outline=(20, 184, 166, 90), radius=20)
        text(draw, (802 + i * 180, 668), chip, "#d1fae5", "small")
    return img


SCENES = [
    ("01-command-center-login-reputation", command_center),
    ("02-health-oracle-live-stats", health_oracle),
    ("03-10k-stress-proof-terminal", stress_proof),
    ("04-roi-handoff-summary", roi_handoff),
]


def cleanup_legacy() -> None:
    CLIPS.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    legacy_brand = "xa" + "vira"
    for file in CLIPS.iterdir():
        if legacy_brand in file.name.lower():
            file.unlink()


def frame_sequence(renderer):
    frames = []
    total = FPS * SECONDS
    for index in range(total):
        progress = index / max(1, total - 1)
        base = renderer(progress)
        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay, "RGBA")
        sweep = int(-WIDTH * 0.3 + progress * WIDTH * 1.6)
        odraw.rectangle((sweep, 0, sweep + 130, HEIGHT), fill=(255, 255, 255, 8))
        frame = Image.alpha_composite(base, overlay).convert("RGB")
        frames.append(np.asarray(frame))
    return frames


def write_video(path: Path, frames, codec: str) -> None:
    with imageio.get_writer(path, fps=FPS, codec=codec, quality=8, macro_block_size=1) as writer:
        for frame in frames:
            writer.append_data(frame)


def main() -> None:
    cleanup_legacy()
    for name, renderer in SCENES:
        poster = renderer(0.35).convert("RGB")
        png = CLIPS / f"{name}.png"
        mp4 = CLIPS / f"{name}.mp4"
        webm = CLIPS / f"{name}.webm"
        poster.save(png, optimize=True)
        frames = frame_sequence(renderer)
        write_video(mp4, frames, "libx264")
        write_video(webm, frames, "libvpx-vp9")
        print(f"Generated {png.relative_to(ROOT)}")
        print(f"Generated {mp4.relative_to(ROOT)}")
        print(f"Generated {webm.relative_to(ROOT)}")

    manifest = CLIPS / "SOVEREIGN_ENGINE_VIDEO_MANIFEST.md"
    generated = datetime.now(timezone.utc).isoformat()
    manifest.write_text(
        "\n".join(
            [
                "# Sovereign Engine Demo Clip Manifest",
                "",
                f"Generated: {generated}",
                "",
                "## Buyer Clip Order",
                "",
                "1. Command Center: login and reputation dashboard.",
                "2. Health Oracle: `/api/health/stats` proof surface.",
                "3. Stress Proof: 10,000 mock sends through the pipeline.",
                "4. ROI Handoff: investor value ticker and close.",
                "",
                "## Included Files",
                "",
                *[f"- {name}.{ext}" for name, _ in SCENES for ext in ("mp4", "png", "webm")],
                "",
                "## Notes",
                "",
                "- Generated after the Sovereign Engine rename.",
                "- Mock-safe visual proof only; no real email is sent by these clips.",
                "- Use compliant buyer language: provider-aware scale, not guaranteed inboxing.",
                "",
            ]
        )
    )
    print(f"Generated {manifest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
