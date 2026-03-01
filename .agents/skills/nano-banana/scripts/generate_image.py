#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate and edit images using Google's Gemini image generation API.

Supports Nano Banana 2 (gemini-3.1-flash-image-preview, default) and
legacy Nano Banana Pro (gemini-3-pro-image-preview, deprecated 9 Mar 2026).

Usage:
    uv run generate_image.py --prompt "description" --filename "out.png" [options]
"""

import argparse
import os
import sys
from pathlib import Path

MODEL_MAP: dict[str, str] = {
    "nano-banana-2": "gemini-3.1-flash-image-preview",
    "nano-banana-pro": "gemini-3-pro-image-preview",  # deprecated 9 Mar 2026
}

ASPECT_RATIOS = [
    "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1",
    "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
]

MAX_REFERENCE_IMAGES = 14


def get_api_key(provided_key: str | None) -> str | None:
    """Get API key from argument first, then environment."""
    if provided_key:
        return provided_key
    return os.environ.get("GEMINI_API_KEY")


def auto_detect_resolution(width: int, height: int) -> str:
    """Map input image dimensions to an appropriate output resolution."""
    max_dim = max(width, height)
    if max_dim >= 3000:
        return "4K"
    if max_dim >= 1500:
        return "2K"
    if max_dim >= 800:
        return "1K"
    return "0.5K"


def main():
    parser = argparse.ArgumentParser(
        description="Generate/edit images using Google Gemini (Nano Banana)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description or editing instructions",
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., sunset-mountains.png)",
    )
    parser.add_argument(
        "--input-image", "-i",
        action="append",
        default=[],
        help="Input image path for editing/reference (repeat up to 14 times)",
    )
    parser.add_argument(
        "--model", "-m",
        choices=list(MODEL_MAP),
        default="nano-banana-2",
        help="Model: nano-banana-2 (default) or nano-banana-pro (deprecated 9 Mar 2026)",
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=["0.5K", "1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 0.5K, 1K (default), 2K, or 4K",
    )
    parser.add_argument(
        "--aspect-ratio", "-a",
        choices=ASPECT_RATIOS,
        default=None,
        help="Output aspect ratio (e.g., 16:9, 9:16, 1:1). Default: API decides.",
    )
    parser.add_argument(
        "--thinking",
        choices=["minimal", "high"],
        default=None,
        help="Thinking level for complex prompts (Nano Banana 2 only)",
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (overrides GEMINI_API_KEY env var)",
    )

    args = parser.parse_args()

    # Validate reference image count
    if len(args.input_image) > MAX_REFERENCE_IMAGES:
        print(f"Error: Maximum {MAX_REFERENCE_IMAGES} reference images supported.", file=sys.stderr)
        sys.exit(1)

    # Get API key
    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: No API key provided.", file=sys.stderr)
        print("Please either:", file=sys.stderr)
        print("  1. Provide --api-key argument", file=sys.stderr)
        print("  2. Set GEMINI_API_KEY environment variable", file=sys.stderr)
        sys.exit(1)

    # Import here after checking API key to avoid slow import on error
    from google import genai
    from google.genai import types
    from PIL import Image as PILImage

    # Resolve model
    model_id = MODEL_MAP[args.model]

    # Initialise client
    client = genai.Client(api_key=api_key)

    # Set up output path
    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Load input images
    input_images: list[PILImage.Image] = []
    output_resolution = args.resolution
    for image_path in args.input_image:
        try:
            img = PILImage.open(image_path)
            input_images.append(img)
            print(f"Loaded input image: {image_path}")
        except Exception as e:
            print(f"Error loading input image '{image_path}': {e}", file=sys.stderr)
            sys.exit(1)

    # Auto-detect resolution from first input image if user didn't set it
    if input_images and args.resolution == "1K":
        width, height = input_images[0].size
        output_resolution = auto_detect_resolution(width, height)
        print(f"Auto-detected resolution: {output_resolution} (from input {width}x{height})")

    # Build contents (images first if editing, prompt only if generating)
    if input_images:
        contents: str | list[PILImage.Image | str] = [*input_images, args.prompt]
        print(f"Editing image with resolution {output_resolution}...")
    else:
        contents = args.prompt
        print(f"Generating image with resolution {output_resolution}...")

    # Build config dynamically
    image_config_kwargs: dict[str, str] = {"image_size": output_resolution}
    if args.aspect_ratio:
        image_config_kwargs["aspect_ratio"] = args.aspect_ratio

    config_kwargs: dict[str, object] = {
        "response_modalities": ["TEXT", "IMAGE"],
        "image_config": types.ImageConfig(**image_config_kwargs),
    }

    if args.thinking and model_id == MODEL_MAP["nano-banana-2"]:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_level=args.thinking,
            include_thoughts=True,
        )

    try:
        response = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=types.GenerateContentConfig(**config_kwargs),
        )

        # Process response and convert to PNG
        image_saved = False
        for part in response.parts:
            if hasattr(part, "thought") and part.thought:
                print(f"Thinking: {part.text}")
            elif part.text is not None:
                print(f"Model response: {part.text}")
            elif part.inline_data is not None:
                # Convert inline data to PIL Image and save as PNG
                from io import BytesIO

                # inline_data.data is already bytes, not base64
                image_data = part.inline_data.data
                if isinstance(image_data, str):
                    import base64
                    image_data = base64.b64decode(image_data)

                image = PILImage.open(BytesIO(image_data))

                # Ensure RGB mode for PNG
                if image.mode == "RGBA":
                    rgb_image = PILImage.new("RGB", image.size, (255, 255, 255))
                    rgb_image.paste(image, mask=image.split()[3])
                    rgb_image.save(str(output_path), "PNG")
                elif image.mode == "RGB":
                    image.save(str(output_path), "PNG")
                else:
                    image.convert("RGB").save(str(output_path), "PNG")
                image_saved = True

        if image_saved:
            full_path = output_path.resolve()
            print(f"\nImage saved: {full_path}")
        else:
            print("Error: No image was generated in the response.", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"Error generating image: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
