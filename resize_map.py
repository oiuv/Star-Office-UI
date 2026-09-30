#!/usr/bin/env python3
"""Resize office map by short-edge scaling, preserving its aspect ratio.

Usage: python resize_map.py input.png [output.png] [--short-edge 720]
"""

import argparse
from pathlib import Path
from PIL import Image

def resize_map(input_path, output_path, target_short_edge=600):
    im = Image.open(input_path)
    original_width, original_height = im.size
    
    # Determine which is the SHORT edge
    if original_width < original_height:
        short_edge, long_edge = original_width, original_height
        is_width_short = True
    else:
        short_edge, long_edge = original_height, original_width
        is_width_short = False
    
    # Calculate scale based on SHORT edge
    scale = target_short_edge / short_edge
    
    # Compute new dimensions
    if is_width_short:
        new_width = target_short_edge
        new_height = int(long_edge * scale)
    else:
        new_width = int(long_edge * scale)
        new_height = target_short_edge
    
    # Resize (use LANCZOS for high quality)
    im_resized = im.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    im_resized.save(output_path)
    print(f"Resized map saved: {output_path}")
    print(f"Original size: {original_width}x{original_height}")
    print(f"Resized size: {new_width}x{new_height}")
    print(f"Short edge scale: {scale:.2f}x")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_path", type=Path, help="Source map image")
    parser.add_argument("output_path", type=Path, nargs="?",
                        default=Path(__file__).resolve().parent / "frontend" / "office_bg.png",
                        help="Output image (default: frontend/office_bg.png in this project)")
    parser.add_argument("--short-edge", type=int, default=720, help="Target short edge in pixels")
    args = parser.parse_args()
    if args.short_edge <= 0:
        parser.error("--short-edge must be greater than zero")
    resize_map(args.input_path, args.output_path, target_short_edge=args.short_edge)
