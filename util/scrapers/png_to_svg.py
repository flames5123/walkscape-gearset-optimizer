#!/usr/bin/env python3
"""
PNG -> SVG converter replicating shshaw's "Pixels to Svg" CodePen output
(https://codepen.io/shshaw/pen/XbxvNj) — the same pen used to build the
existing pet icons (see the <metadata> line in assets/icons/items/pets/*_new.svg).

Output format (byte-identical to the pen):
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -0.5 W H" shape-rendering="crispEdges">
  <metadata>Made with Pixels to Svg https://codepen.io/shshaw/pen/XbxvNj</metadata>
  <path stroke="#rrggbb" d="M{x} {y}h{run}..." />
  ...
  </svg>

Rules (verified by round-tripping the committed gecko SVGs byte-for-byte — see
tests/test_png_to_svg_bonez.py):
  * one <path> per colour, in first-seen row-major order
  * each colour's `d` is its maximal horizontal runs, "M{x} {y}h{len}"
  * lowercase 6-digit hex; fully-transparent (alpha == 0) pixels are skipped
  * native pixel dimensions become the viewBox (no rescaling)

Usage:
  python util/scrapers/png_to_svg.py <src.png> <dst.svg>
  python util/scrapers/png_to_svg.py validate     # round-trip committed gecko SVGs
"""
import re
import sys
import glob

META = 'Made with Pixels to Svg https://codepen.io/shshaw/pen/XbxvNj'


def encode_svg(grid, w, h):
    """grid[(x, y)] = '#rrggbb' (or absent for transparent). Returns the SVG string."""
    order = []
    runs = {}
    for y in range(h):
        x = 0
        while x < w:
            c = grid.get((x, y))
            if c is None:
                x += 1
                continue
            start = x
            while x < w and grid.get((x, y)) == c:
                x += 1
            if c not in runs:
                runs[c] = []
                order.append(c)
            runs[c].append(f"M{start} {y}h{x - start}")
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -0.5 {w} {h}" shape-rendering="crispEdges">',
        f'<metadata>{META}</metadata>',
    ]
    for c in order:
        lines.append(f'<path stroke="{c}" d="{"".join(runs[c])}" />')
    lines.append('</svg>')
    return '\n'.join(lines)


def image_to_grid(img):
    """PIL Image -> (grid, w, h). Skips alpha==0; emits lowercase #rrggbb."""
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    grid = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            grid[(x, y)] = '#%02x%02x%02x' % (r, g, b)
    return grid, w, h


def png_bytes_to_svg(png_bytes):
    from PIL import Image
    import io
    grid, w, h = image_to_grid(Image.open(io.BytesIO(png_bytes)))
    return encode_svg(grid, w, h)


def png_to_svg(src_path, dst_path):
    from PIL import Image
    grid, w, h = image_to_grid(Image.open(src_path))
    svg = encode_svg(grid, w, h)
    with open(dst_path, 'w') as f:
        f.write(svg)
    return svg


def svg_to_grid(txt):
    """Parse a pen-format SVG back into (grid, w, h). Used only for validation."""
    m = re.search(r'viewBox="0 -0\.5 (\d+) (\d+)"', txt)
    w, h = int(m.group(1)), int(m.group(2))
    grid = {}
    for pm in re.finditer(r'<path stroke="(#[0-9a-fA-F]+)" d="([^"]*)"', txt):
        color, d = pm.group(1), pm.group(2)
        for run in re.finditer(r'M(\d+) (\d+)h(\d+)', d):
            x, y, ln = int(run.group(1)), int(run.group(2)), int(run.group(3))
            for i in range(ln):
                grid[(x + i, y)] = color
    return grid, w, h


def _validate():
    files = sorted(glob.glob('assets/icons/items/pets/gecko_*_new.svg'))
    ok = 0
    for f in files:
        orig = open(f).read()
        grid, w, h = svg_to_grid(orig)
        if encode_svg(grid, w, h).rstrip('\n') == orig.rstrip('\n'):
            ok += 1
        else:
            print(f"MISMATCH {f}")
    print(f"{ok}/{len(files)} byte-identical")
    return ok == len(files)


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == 'validate':
        sys.exit(0 if _validate() else 1)
    if len(sys.argv) == 3:
        png_to_svg(sys.argv[1], sys.argv[2])
        print(f"wrote {sys.argv[2]}")
    else:
        print(__doc__)
        sys.exit(2)
