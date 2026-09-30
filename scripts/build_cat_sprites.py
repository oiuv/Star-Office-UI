#!/usr/bin/env python3
"""Slice AI-generated keyframes into the office's existing sprite grids.

Only crops, resizes and packs existing artwork; no drawing or retouching.
Run from any directory: python scripts/build_cat_sprites.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art" / "star-cat"
# The generator's content rows do not exactly match equal-sized cell rows.
ROW_EDGES = (0, 340, 640, 930, 1254)
SHEETS = (
    ("star-idle-v5.png", 256, 8, 6, 192,
     [0]*16 + [1]*16 + [2]*2 + [3]*14),
    ("star-working-spritesheet-grid.webp", 300, 8, 5, 220,
     [0]*8 + [1]*8 + [3]*8 + [1]*8 + [2]*2 + [0]*4),
    ("sync-animation-v3-grid.webp", 256, 7, 7, 224,
     [None] + [0]*12 + [1]*12 + [2]*12 + [3]*11 + [None]),
    ("error-bug-spritesheet-grid.webp", 220, 8, 9, 174,
     [0]*18 + [1]*18 + [2]*18 + [3]*18),
)


def build():
    atlas = Image.open(SOURCE / "source-atlas.png").convert("RGBA")
    if atlas.size != (1254, 1254):
        raise ValueError(f"Unexpected source atlas size: {atlas.size}")
    empty_bed = Image.open(SOURCE / "empty-bed.png").convert("RGBA")
    for row, (name, cell, cols, rows, size, sequence) in enumerate(SHEETS):
        frames = [atlas.crop((round(col * atlas.width / 4), ROW_EDGES[row],
                             round((col + 1) * atlas.width / 4), ROW_EDGES[row + 1]))
                  for col in range(4)]
        # Shared crop/scale keeps furniture fixed instead of jittering per frame.
        boxes = [frame.getchannel("A").point(lambda a: 255 if a >= 16 else 0).getbbox()
                 for frame in frames]
        union = (min(b[0] for b in boxes), min(b[1] for b in boxes),
                 max(b[2] for b in boxes), max(b[3] for b in boxes))
        scale = min(size / (union[2]-union[0]), size / (union[3]-union[1]))
        fitted = []
        for frame in frames:
            image = frame.crop(union)
            image = image.resize((round(image.width*scale), round(image.height*scale)),
                                 Image.Resampling.NEAREST)
            fitted.append(image)
        sheet = Image.new("RGBA", (cell*cols, cell*rows), (0,0,0,0))
        for index, pose in enumerate(sequence):
            image = empty_bed if pose is None else fitted[pose]
            x = index % cols * cell + (cell-image.width)//2
            y = index // cols * cell + (cell-image.height)//2
            sheet.paste(image, (x,y))
        out = ROOT / "frontend" / name
        if out.suffix == ".webp":
            sheet.save(out, lossless=True, exact=True, method=6)
        else:
            sheet.save(out, optimize=True)
        print(f"{name}: {sheet.width}x{sheet.height}, {len(sequence)} frames")


if __name__ == "__main__":
    build()
