#!/usr/bin/env python3
"""Rebuild trayIcon.png (black cat) + dockIcon.png (padded desktop squircle).

Does NOT modify resources/icon.png — Desktop/Finder keep the original logo.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "resources"
MASTER = ROOT / "build" / "icon-master.png"
FALLBACK = RES / "icon.png"

TRAY_SIZE = 32
TRAY_SCALE = 0.44
DOCK_SCALE = 0.82


def knock_out_black(src: Image.Image) -> Image.Image:
    img = src.convert("RGBA").copy()
    w, h = img.size
    for seed in [
        (0, 0),
        (w - 1, 0),
        (0, h - 1),
        (w - 1, h - 1),
        (w // 2, 0),
        (0, h // 2),
        (w - 1, h // 2),
        (w // 2, h - 1),
    ]:
        ImageDraw.floodfill(img, seed, (0, 0, 0, 0), thresh=45)
    return img


def place(content: Image.Image, canvas_size: int, scale: float) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    target = max(1, int(canvas_size * scale))
    c = content.copy()
    c.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas.paste(c, ((canvas_size - c.width) // 2, (canvas_size - c.height) // 2), c)
    return canvas


def extract_black_character(src: Image.Image) -> Image.Image:
    knocked = knock_out_black(src)
    lavender_refs = [
        (219, 206, 251),
        (231, 222, 253),
        (188, 164, 249),
        (171, 141, 248),
        (227, 224, 243),
        (195, 175, 247),
    ]

    def dist(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])

    px = knocked.load()
    w, h = knocked.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 10:
                continue
            if min(dist((r, g, b), ref) for ref in lavender_refs) < 110:
                continue
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if luma > 140 and b >= g:
                continue
            if r > 140 and b > 150 and g > 120 and luma > 130:
                continue
            opx[x, y] = (255, 255, 255, a) if luma > 200 else (0, 0, 0, a)
    bbox = out.getbbox()
    if not bbox:
        raise SystemExit("failed to extract character")
    return out.crop(bbox)


def main() -> None:
    src_path = MASTER if MASTER.exists() else FALLBACK
    src = Image.open(src_path)

    tray = place(extract_black_character(src), TRAY_SIZE, TRAY_SCALE)
    tray.save(RES / "trayIcon.png", optimize=True)

    # Dock: desktop squircle with transparent margins (runtime dock.setIcon only)
    base = Image.open(FALLBACK)
    content = knock_out_black(base)
    bbox = content.getbbox()
    if not bbox:
        raise SystemExit("failed to prepare dock icon")
    dock = place(content.crop(bbox), 1024, DOCK_SCALE)
    dock.save(RES / "dockIcon.png", optimize=True)
    print(f"wrote trayIcon.png (black, scale {TRAY_SCALE}) and dockIcon.png (scale {DOCK_SCALE})")
    print("left resources/icon.png unchanged for Desktop/Finder")


if __name__ == "__main__":
    main()
