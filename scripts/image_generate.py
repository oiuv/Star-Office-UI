#!/usr/bin/env python3
"""Generate or edit images using an OpenAI-compatible Image API."""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from image_client import DEFAULT_BASE_URL, DEFAULT_MODEL, generate_image

def main():
    parser = argparse.ArgumentParser(description="Generate an image via an OpenAI-compatible endpoint")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", default=os.getenv("AI_IMAGE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--base-url", default=os.getenv("AI_BASE_URL") or os.getenv("OPENAI_BASE_URL") or DEFAULT_BASE_URL)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--reference-image", default="")
    parser.add_argument("--mode", choices=("edit", "generate"), default="edit")
    parser.add_argument("--speed-mode", choices=("fast", "quality"), default="quality")
    args = parser.parse_args()
    config = {"api_key": os.getenv("OPENAI_API_KEY", ""), "model": args.model,
              "base_url": args.base_url, "image_mode": args.mode}
    image = generate_image(config, args.prompt, args.reference_image, args.speed_mode)
    target = Path(args.out_dir) / "generated_0.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(image)
    print(json.dumps({"files": [str(target)]}))
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
