#!/usr/bin/env python3
"""
Convert favicon SVG to PNG at multiple sizes for mobile home screen icons.
Uses cairosvg if available, otherwise falls back to Pillow with svglib.
"""

import subprocess
import sys
from pathlib import Path


def convert_with_cairosvg(svg_path, png_path, size):
    """Convert SVG to PNG using cairosvg."""
    import cairosvg
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(png_path),
        output_width=size,
        output_height=size,
        background_color='#060c0f'  # Match app background
    )


def convert_with_rsvg(svg_path, png_path, size):
    """Convert SVG to PNG using rsvg-convert (librsvg)."""
    result = subprocess.run(
        ['rsvg-convert', '-w', str(size), '-h', str(size),
         '-b', '#060c0f', '-o', str(png_path), str(svg_path)],
        capture_output=True, text=True
    )
    return result.returncode == 0


def convert_with_inkscape(svg_path, png_path, size):
    """Convert SVG to PNG using Inkscape CLI."""
    result = subprocess.run(
        ['inkscape', str(svg_path), '--export-type=png',
         f'--export-filename={png_path}',
         f'--export-width={size}', f'--export-height={size}',
         '--export-background=#060c0f'],
        capture_output=True, text=True
    )
    return result.returncode == 0


def main():
    svg_path = Path('assets/icons/favicon.svg')
    if not svg_path.exists():
        print(f"SVG not found: {svg_path}")
        sys.exit(1)

    sizes = {
        'favicon-16': 16,
        'favicon-32': 32,
        'favicon-192': 192,
        'apple-touch-icon': 180,
        'favicon-512': 512,
    }

    output_dir = Path('assets/icons')
    output_dir.mkdir(parents=True, exist_ok=True)

    # Try conversion methods in order
    for name, size in sizes.items():
        png_path = output_dir / f'{name}.png'
        print(f"Converting {name} ({size}x{size})...")

        try:
            convert_with_cairosvg(svg_path, png_path, size)
            print(f"  ✓ {png_path} (cairosvg)")
            continue
        except ImportError:
            pass
        except Exception as e:
            print(f"  cairosvg failed: {e}")

        if convert_with_rsvg(svg_path, png_path, size):
            print(f"  ✓ {png_path} (rsvg)")
            continue

        if convert_with_inkscape(svg_path, png_path, size):
            print(f"  ✓ {png_path} (inkscape)")
            continue

        print(f"  ✗ No converter available for {name}")

    print("\nDone! Update index.html with PNG references.")


if __name__ == '__main__':
    main()
