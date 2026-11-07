#!/usr/bin/env python3
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCE_IMG = os.path.join(ROOT, 'resources', 'icon.png')

print(f"Reading base image from: {SOURCE_IMG}")
src = Image.open(SOURCE_IMG).convert('RGBA')
w, h = src.size

# 1. Generate smooth anti-aliased squircle mask
scale = 2
mask = Image.new('L', (w * scale, h * scale), 0)
draw = ImageDraw.Draw(mask)
radius = 200 * scale
draw.rounded_rectangle([0, 0, w * scale - 1, h * scale - 1], radius=radius, fill=255)
mask = mask.resize((w, h), Image.Resampling.LANCZOS)

# Create high-res 1024x1024 RGBA master
master = src.copy()
master.putalpha(mask)

# Save build master icons
build_dir = os.path.join(ROOT, 'build')
os.makedirs(build_dir, exist_ok=True)

master.save(os.path.join(build_dir, 'icon.png'), 'PNG')
master.save(os.path.join(build_dir, 'icon-master.png'), 'PNG')
master.save(os.path.join(ROOT, 'resources', 'dockIcon.png'), 'PNG')
# Also save updated resources/icon.png with RGBA channel
master.save(os.path.join(ROOT, 'resources', 'icon.png'), 'PNG')

# Multi-resolution Linux hicolor icons
icons_dir = os.path.join(build_dir, 'icons')
os.makedirs(icons_dir, exist_ok=True)

sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
for s in sizes:
    resized = master.resize((s, s), Image.Resampling.LANCZOS)
    resized.save(os.path.join(icons_dir, f"{s}x{s}.png"), 'PNG')
    if s == 256:
        # Also update renderer asset
        renderer_asset = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'app-icon.png')
        resized.save(renderer_asset, 'PNG')

# Windows .ico
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
master.save(os.path.join(build_dir, 'icon.ico'), format='ICO', sizes=ico_sizes)

# macOS .icns
try:
    master.save(os.path.join(build_dir, 'icon.icns'), format='ICNS')
except Exception as e:
    print(f"Notice: ICNS save returned: {e}")

print("Successfully generated all brand icon assets!")

