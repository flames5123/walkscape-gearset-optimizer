#!/usr/bin/env python3
"""
Combine light_source.svg (bulb outline only) with locations.svg (castle).
Both at 1x1 pixel size on a 40x40 canvas.

The bulb is 20x20 native. To fit 40x40, we double the coordinates
but keep each pixel as 1x1 — this makes the bulb outline thinner
(1px lines instead of 2px blocks), matching the castle's pixel density.
"""

import re
from pathlib import Path
from collections import defaultdict


def parse_pixel_svg(svg_text):
    """Parse pixel-art SVG into (x, y, color) list."""
    pixels = []
    for match in re.finditer(r'<path stroke="([^"]+)" d="([^"]+)"', svg_text):
        color = match.group(1)
        d_attr = match.group(2)
        segments = re.split(r'M', d_attr)
        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue
            m = re.match(r'(\d+)\s+(-?\d+)(?:h(\d+))?', seg)
            if m:
                x = int(m.group(1))
                y = int(m.group(2))
                w = int(m.group(3)) if m.group(3) else 1
                for dx in range(w):
                    pixels.append((x + dx, y, color))
    return pixels


# Read sources
light_pixels = parse_pixel_svg(Path('testicons/light_source.svg').read_text())
castle_pixels = parse_pixel_svg(Path('testicons/locations.svg').read_text())

# Bulb only: y <= 10 (glass portion, no screw base)
bulb_pixels = [(x, y, c) for (x, y, c) in light_pixels if y <= 10]

# Remap bulb to 40x40: multiply coords by 2 (but each pixel stays 1x1)
# This spreads the bulb shape across the 40x40 canvas with gaps
# To fill the gaps, we duplicate each pixel at (2x, 2y), (2x+1, 2y), (2x, 2y+1), (2x+1, 2y+1)
# Wait — that's scaling again. 
#
# The real issue: bulb is 20x20 pixels, castle is 40x40 pixels.
# If we want uniform 1x1 pixels, we need them on the same grid.
# Option: use 40x40 canvas, DON'T scale the bulb, just offset it.
# The bulb will be small (20x20) in the corner of a 40x40 canvas.
# OR: use 40x40 canvas, place bulb centered (offset +10,+10) at native size.
# The bulb glass is ~10x9 pixels, it'll be tiny.
#
# Better option: forget about matching pixel sizes exactly.
# Use the castle at native 40x40 and draw a CUSTOM bulb outline 
# around it at 40x40 resolution using 1px strokes.

# Let's draw a bulb outline at 40x40 that wraps around the castle.
# The bulb shape: rounded top, narrowing to a neck at bottom.

# Custom bulb outline at 40x40 (1px border)
bulb_outline = []
bulb_color = "#1a1932"  # dark outline from original

# Top arc
bulb_outline += [(x, 0, bulb_color) for x in range(12, 28)]  # top flat
bulb_outline += [(x, 1, bulb_color) for x in range(9, 12)]   # top-left curve
bulb_outline += [(x, 1, bulb_color) for x in range(28, 31)]  # top-right curve
bulb_outline += [(x, 2, bulb_color) for x in range(7, 9)]
bulb_outline += [(x, 2, bulb_color) for x in range(31, 33)]
bulb_outline += [(x, 3, bulb_color) for x in range(5, 7)]
bulb_outline += [(x, 3, bulb_color) for x in range(33, 35)]
bulb_outline += [(x, 4, bulb_color) for x in range(4, 5)]
bulb_outline += [(x, 4, bulb_color) for x in range(35, 36)]
bulb_outline += [(x, 5, bulb_color) for x in range(3, 4)]
bulb_outline += [(x, 5, bulb_color) for x in range(36, 37)]
# Sides — bulge outward in the middle for a rounder shape
# Top section (y:6-9): sides at x:2, x:37
for y in range(6, 10):
    bulb_outline.append((1, y, bulb_color))
    bulb_outline.append((38, y, bulb_color))
# Middle bulge (y:10-18): sides at x:0, x:39 (widest)
for y in range(10, 19):
    bulb_outline.append((0, y, bulb_color))
    bulb_outline.append((39, y, bulb_color))
# Lower section (y:19-22): back to x:1, x:38
for y in range(19, 23):
    bulb_outline.append((1, y, bulb_color))
    bulb_outline.append((38, y, bulb_color))
# Narrowing toward neck (y:23-25)
for y in range(23, 26):
    bulb_outline.append((2, y, bulb_color))
    bulb_outline.append((37, y, bulb_color))
# Bottom narrowing
bulb_outline += [(x, 26, bulb_color) for x in range(3, 5)]
bulb_outline += [(x, 26, bulb_color) for x in range(35, 37)]
bulb_outline += [(x, 27, bulb_color) for x in range(5, 7)]
bulb_outline += [(x, 27, bulb_color) for x in range(33, 35)]
bulb_outline += [(x, 28, bulb_color) for x in range(7, 9)]
bulb_outline += [(x, 28, bulb_color) for x in range(31, 33)]
# Neck
for y in range(29, 37):
    bulb_outline.append((9, y, bulb_color))
    bulb_outline.append((30, y, bulb_color))
# Bottom cap
bulb_outline += [(x, 37, bulb_color) for x in range(10, 30)]

# Bulb glass fill (inside the outline, light blue)
glass_color = "#faff5bff"
glass_fill = []
# Fill rows based on outline shape
fill_ranges = {
    0: (12, 28), 1: (9, 31), 2: (7, 33), 3: (5, 35),
    4: (4, 36), 5: (3, 37),
}
for y in range(6, 10):
    fill_ranges[y] = (2, 38)
for y in range(10, 19):
    fill_ranges[y] = (1, 39)
for y in range(19, 23):
    fill_ranges[y] = (2, 38)
for y in range(23, 26):
    fill_ranges[y] = (3, 37)
fill_ranges[26] = (3, 37)
fill_ranges[27] = (5, 35)
fill_ranges[28] = (7, 33)
for y in range(29, 37):
    fill_ranges[y] = (9, 31)

for y, (x_start, x_end) in fill_ranges.items():
    for x in range(x_start, x_end):
        glass_fill.append((x, y, glass_color))

# White highlight on glass (top-left area)
highlight_color = "#ffffff"
highlights = []
for x in range(10, 20):
    highlights.append((x, 3, highlight_color))
for x in range(7, 15):
    highlights.append((x, 4, highlight_color))
for x in range(5, 12):
    highlights.append((x, 5, highlight_color))
for x in range(4, 10):
    highlights.append((x, 6, highlight_color))
for x in range(3, 8):
    for y in range(7, 12):
        highlights.append((x, y, highlight_color))

# Screw base (gray stripes at neck)
screw1 = "#657392"
screw2 = "#92a1b9"
for y in range(29, 37):
    color = screw1 if y % 2 == 1 else screw2
    for x in range(10, 30):
        glass_fill.append((x, y, color))

# Castle: scale to 75% and center
scale = 0.67
castle_w = 40
castle_h = 40
new_w = int(castle_w * scale)  # 30
new_h = int(castle_h * scale)  # 30
offset_x = (40 - new_w) // 2  # 5
offset_y = (40 - new_h) // 2 - 6  # shifted up more

# Scale castle pixels by 0.75 — round coords, skip duplicates
castle_scaled = set()
for (x, y, c) in castle_pixels:
    nx = int(round(x * scale)) + offset_x
    ny = int(round(y * scale)) + offset_y
    if 0 <= nx < 40 and 0 <= ny < 40:
        castle_scaled.add((nx, ny, c))

# Build set of coordinates that are inside the bulb glass area
inside_bulb = set()
for y, (x_start, x_end) in fill_ranges.items():
    for x in range(x_start, x_end):
        inside_bulb.add((x, y))

# Clip castle to only pixels inside the bulb
castle_placed = [(x, y, c) for (x, y, c) in castle_scaled if (x, y) in inside_bulb]

# Build pixel map: glass fill → highlights → outline (bulb layer)
# Castle goes in a separate group with opacity
# IMPORTANT: fill layer must be COMPLETE (not removed by castle)
bulb_pixels = {}

for (x, y, c) in glass_fill:
    if 0 <= x < 40 and 0 <= y < 40:
        bulb_pixels[(x, y)] = c

for (x, y, c) in highlights:
    if 0 <= x < 40 and 0 <= y < 40:
        bulb_pixels[(x, y)] = c

for (x, y, c) in bulb_outline:
    if 0 <= x < 40 and 0 <= y < 40:
        bulb_pixels[(x, y)] = c

# Castle pixels separate (for opacity group)
castle_map = {}
for (x, y, c) in castle_placed:
    if 0 <= x < 40 and 0 <= y < 40:
        castle_map[(x, y)] = c

# DON'T remove fill pixels under castle — keep bulb layer complete
# The castle renders on top with opacity, so the fill shows through

bulb_combined = [(x, y, c) for (x, y), c in sorted(bulb_pixels.items())]
castle_combined = [(x, y, c) for (x, y), c in sorted(castle_map.items())]
print(f"Bulb layer: {len(bulb_combined)} pixels")
print(f"Castle layer: {len(castle_combined)} pixels")
print(f"Total: {len(bulb_combined) + len(castle_combined)} pixels")

# Helper to build path elements from pixel list
def build_paths(pixels):
    by_color = defaultdict(lambda: defaultdict(list))
    for (x, y, c) in pixels:
        by_color[c][y].append(x)
    
    path_lines = []
    for color in sorted(by_color.keys()):
        rows = by_color[color]
        segments = []
        for y in sorted(rows.keys()):
            xs = sorted(rows[y])
            i = 0
            while i < len(xs):
                start = xs[i]
                length = 1
                while i + length < len(xs) and xs[i + length] == start + length:
                    length += 1
                segments.append(f"M{start} {y}h{length}")
                i += length
        path_lines.append(f'<path stroke="{color}" d="{"".join(segments)}" />')
    return path_lines

# Write SVG with castle in opacity group
lines = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -0.5 40 40" shape-rendering="crispEdges">']
lines.extend(build_paths(bulb_combined))
lines.append('<g opacity="0.8">')
lines.extend(build_paths(castle_combined))
lines.append('</g>')
lines.append('</svg>')
output = Path('testicons/combined_favicon.svg')
output.write_text('\n'.join(lines))
print(f"Written to {output}")
