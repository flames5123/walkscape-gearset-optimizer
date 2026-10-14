#!/usr/bin/env python3
"""
Merge locations + routes that exist in the WalkScape *tools API* but are missing
from the community map data (map.walkscape.app), into the local map JSON that the
Travel Config page renders:

    ui/static/assets/map/data/locations.json   (the "Locations" group)
    ui/static/assets/map/data/routes.json       (route markers)

Why: new game locations (e.g. Blackwater Lake in Wallisia, Cactus Canyon in
Wrentmark) land in the tools API before the community map adds them. The tools
API carries `locationPosition` on /locations/id/<slug> and `pathPoints` on
/routes/id/<id>, in the SAME coordinate space as the map — but as [x, y], while
the map JSON stores [row, col]. So map = [p[1], p[0]] (verified against Kallaheim:
map [408,619] <-> API [619,408]).

Idempotent: a location/route is only added if not already present (matched by
name). Safe to re-run after each game update to pick up newly-added locations.

Usage:
    python3 -m util.scrapers.merge_tools_api_map_locations            # add all missing
    python3 -m util.scrapers.merge_tools_api_map_locations --dry-run  # preview only
"""

import argparse
import json
import os
import uuid
from pathlib import Path

from util.scrapers.tools_api_client import ToolsAPIClient, PROD_BASE_URL

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MAP_DATA = REPO_ROOT / "ui" / "static" / "assets" / "map" / "data"
LOCATIONS_JSON = MAP_DATA / "locations.json"
ROUTES_JSON = MAP_DATA / "routes.json"
ICONS_DIR = REPO_ROOT / "assets" / "icons" / "locations"

# tools-API faction id -> map faction id
FACTION_REMAP = {
    "empire_of_wallisia": "wallisia",
}

# tools-API terrainModifier i18n keys -> readable strings matching the map's
# existing "Requires ..." convention.
TERRAIN_I18N = {
    "terrainmodifiers.singulars.requiresability.navigatedesert.name":
        "Requires Navigate Desert",
}


def _swap(p):
    """tools-API [x, y] -> map [row, col]."""
    return [p[1], p[0]]


def _icon_base(icon_field):
    """'assets/icons/locations/coast_green.png' -> 'coast_green'."""
    if not icon_field:
        return "castle_white"
    return os.path.basename(str(icon_field)).replace(".png", "")


def _humanize_terrain(mods):
    out = []
    for m in mods or []:
        out.append(TERRAIN_I18N.get(m, m))
    return out


def _route_terrain(route_detail):
    """Flatten the tools-API route `options[].terrainModifiers` i18n keys."""
    mods = []
    for opt in route_detail.get("options", []) or []:
        for m in opt.get("terrainModifiers", []) or []:
            if m not in mods:
                mods.append(m)
    return _humanize_terrain(mods)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--base-url", default=PROD_BASE_URL)
    args = ap.parse_args()

    client = ToolsAPIClient(base_url=args.base_url)

    locs = json.loads(LOCATIONS_JSON.read_text())
    routes = json.loads(ROUTES_JSON.read_text())
    loc_group = next(g for g in locs if g.get("name") == "Locations")

    existing_loc_names = {m["name"] for m in loc_group["markers"]}
    existing_route_names = {m["name"] for g in routes for m in g.get("markers", [])}
    # slug -> map location name, for routes we may add
    slug_to_name = {}

    api_locs = client._request("/locations/")
    api_loc_ids = [l["id"] if isinstance(l, dict) else l for l in api_locs]

    added_locs, added_routes, missing_icons = [], [], []

    # -- Locations --
    for slug in api_loc_ids:
        detail = client._request(f"/locations/id/{slug}")
        name = detail.get("name")
        slug_to_name[slug] = name
        if not name or name in existing_loc_names:
            continue
        pos = detail.get("locationPosition")
        if not pos:
            print(f"  ! {slug}: no locationPosition, skipping")
            continue
        faction = FACTION_REMAP.get(detail.get("faction"), detail.get("faction"))
        icon_base = _icon_base(detail.get("icon"))
        if not (ICONS_DIR / f"{icon_base}_icon.svg").exists():
            missing_icons.append(f"{icon_base}_icon.svg ({name})")
        marker = {
            "id": str(uuid.uuid4()),
            "name": name,
            "faction": faction,
            "wikiUrl": f"https://wiki.walkscape.app/wiki/{name.replace(' ', '_')}",
            "coords": _swap(pos),
            "icon": {"url": f"locations/{icon_base}.png"},
            "activities": [],
            "services": [],
            "buildings": [],
        }
        loc_group["markers"].append(marker)
        existing_loc_names.add(name)
        added_locs.append(f"{name} [{faction}] coords={marker['coords']}")

    # -- Routes touching at least one now-known location, missing from the map --
    routes_group = routes[0]
    api_routes = client._request("/routes/")
    for r in api_routes:
        name = r.get("name")
        if not name or name in existing_route_names:
            continue
        endpoints = r.get("locations", [])
        ep_names = [slug_to_name.get(s, s) for s in endpoints]
        # Only add if both endpoints are locations the map knows about.
        if not all(n in existing_loc_names for n in ep_names):
            continue
        # Only add routes that involve a location we just added (avoid pulling in
        # unrelated map-missing routes between pre-existing locations).
        if not any(n in [a.split(" [")[0] for a in added_locs] for n in ep_names):
            continue
        detail = client._request(f"/routes/id/{r['id']}")
        pathpoints = [_swap(p) for p in detail.get("pathPoints", []) or []]
        coords = pathpoints[len(pathpoints) // 2] if pathpoints else _swap(
            client._request(f"/locations/id/{endpoints[0]}").get("locationPosition", [0, 0]))
        # faction: use the endpoint faction (same-region routes)
        first_marker = next(m for m in loc_group["markers"] if m["name"] == ep_names[0])
        faction = first_marker["faction"]
        marker = {
            "id": f"route-{endpoints[0]}-{endpoints[1]}-{uuid.uuid4()}",
            "name": name,
            "faction": faction,
            "coords": coords,
            "distance": detail.get("distance", 0),
            "pathpoints": pathpoints,
            "terrainModifiers": _route_terrain(detail),
        }
        routes_group["markers"].append(marker)
        existing_route_names.add(name)
        added_routes.append(f"{name} [{faction}] dist={marker['distance']} "
                             f"reqs={marker['terrainModifiers']} pts={len(pathpoints)}")

    print("\n=== Locations added ===")
    for a in added_locs:
        print(" +", a)
    print("=== Routes added ===")
    for a in added_routes:
        print(" +", a)
    if missing_icons:
        print("=== Missing icon SVGs (marker will hide icon via onerror) ===")
        for m in missing_icons:
            print(" !", m)

    if args.dry_run:
        print("\n[dry-run] no files written")
        return
    if added_locs or added_routes:
        LOCATIONS_JSON.write_text(json.dumps(locs, indent=2))
        ROUTES_JSON.write_text(json.dumps(routes, indent=2))
        print(f"\nWrote {LOCATIONS_JSON.relative_to(REPO_ROOT)} "
              f"and {ROUTES_JSON.relative_to(REPO_ROOT)}")
    else:
        print("\nNothing to add — map JSON already up to date.")


if __name__ == "__main__":
    main()
