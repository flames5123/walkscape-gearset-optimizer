#!/usr/bin/env python3
"""
Generate favicon / home-screen PNGs from the pixel-art favicon.svg.

The source SVG (assets/icons/favicon.svg) is a 40x40 pixel-art grid rendered
with shape-rendering="crispEdges": every <path> is a set of 1px-tall horizontal
runs of the form `M<x> <y>h<n>` painted in a single stroke color. That makes it
trivial to parse into a pixel grid and rasterize with nearest-neighbor scaling,
which keeps the pixels crisp at every output size -- no external rasterizer
(cairosvg / rsvg / inkscape / sharp) required.

Outputs (into assets/icons/), matching the <link>/manifest references in
ui/static/index.html and ui/static/manifest.json:
    favicon-16.png       16x16
    favicon-32.png       32x32
    apple-touch-icon.png 180x180  (opaque bg -- iOS composites transparency onto black)
    favicon-192.png      192x192
    favicon-512.png      512x512

All icons are rendered onto an opaque background (#060c0f, the app background)
so the Apple touch icon and maskable PWA icons never show black corners.
"""

import re
import struct
import zlib
from pathlib import Path

GRID = 40                      # source SVG is 40x40
BG = (0x06, 0x0c, 0x0f)        # app background, opaque
SIZES = {
    "favicon-16": 16,
    "favicon-32": 32,
    "apple-touch-icon": 180,
    "favicon-192": 192,
    "favicon-512": 512,
}

_PATH_RE = re.compile(r'stroke="(#[0-9a-fA-F]{6})"\s+d="([^"]*)"')
_RUN_RE = re.compile(r'M(\d+) (-?\d+)h(\d+)')


def _hex(c: str):
    return (int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16))


def parse_grid(svg_text: str):
    """Return a GRID x GRID list of (r,g,b) pixels; None where unpainted."""
    px = [[None] * GRID for _ in range(GRID)]
    for color, d in _PATH_RE.findall(svg_text):
        rgb = _hex(color)
        for x, y, n in _RUN_RE.findall(d):
            x, y, n = int(x), int(y), int(n)
            if y < 0 or y >= GRID:
                continue
            for col in range(x, x + n):
                if 0 <= col < GRID:
                    px[y][col] = rgb
    return px


def write_png(path: Path, size: int, grid):
    """Nearest-neighbor scale the GRID x GRID pixel art to size x size, RGBA opaque."""
    raw = bytearray()
    for oy in range(size):
        sy = oy * GRID // size
        raw.append(0)  # filter type 0 (None) per scanline
        row = grid[sy]
        for ox in range(size):
            sx = ox * GRID // size
            r, g, b = row[sx] if row[sx] is not None else BG
            raw += bytes((r, g, b, 255))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def main():
    root = Path(__file__).resolve().parent.parent
    svg_path = root / "assets/icons/favicon.svg"
    out_dir = root / "assets/icons"
    grid = parse_grid(svg_path.read_text())

    painted = sum(1 for row in grid for p in row if p is not None)
    print(f"Parsed {svg_path} -> {painted} painted pixels in {GRID}x{GRID} grid")

    for name, size in SIZES.items():
        out = out_dir / f"{name}.png"
        write_png(out, size, grid)
        print(f"  wrote {out} ({size}x{size}, {out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
