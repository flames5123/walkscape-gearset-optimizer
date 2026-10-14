#!/usr/bin/env python3
"""Fetch item icons from the tools API and convert them to SVG.

The tools API serves item icons as base64 PNG data-URIs via a batch endpoint:

    POST /icons/batch  {"iconPaths": ["assets/icons/items/gear/feet/foo.png", ...]}
    -> {"assets/icons/items/gear/feet/foo.png": "data:image/png;base64,iVBORw0...", ...}

For every item in the cache we resolve its destination SVG at
``assets/icons/items/<category>/<item_id>.svg`` (the convention the frontend
uses — filenames are item ids, not the API icon-path basename). Missing SVGs are
fetched in batches, base64-decoded, and converted to SVG with the pixel-exact
"bonez" converter (util/scrapers/png_to_svg.png_bytes_to_svg). Existing files are
skipped unless ``rescrape=True`` so a normal run only pulls the new items' icons.

This runs as a step in ingest_all_from_tools_api (after item hydration, before
emit) so a --no-cache scrape self-heals new-item icons.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from util.scrapers.tools_api_client import ToolsAPIClient  # noqa: E402
from util.scrapers.png_to_svg import png_bytes_to_svg  # noqa: E402

# item.type (+ gearType) -> local assets/icons/items/<category>/ dir.
# Mirrors the shard predicate in ingest_items_from_tools_api.
_CATEGORY_DIRS = {
    'material': 'materials',
    'consumable': 'consumables',
    'collectible': 'collectibles',
    'container': 'containers',
    'currency': 'currencies',
    'egg': 'pet_eggs',
}
_BATCH = 100


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _category_dir(detail: Dict[str, Any]) -> Optional[str]:
    """Return the local icon subdir for an item, or None to skip (pets have
    their own icon flow; loot items with no gearType have no gear icon)."""
    t = detail.get('type')
    if t in _CATEGORY_DIRS:
        return _CATEGORY_DIRS[t]
    if t in ('crafted', 'loot') and detail.get('gearType'):
        return 'equipment'
    return None


def _load_item_details(client: ToolsAPIClient, use_cache: bool) -> Dict[str, Dict[str, Any]]:
    items = client.list('items', use_cache=use_cache)
    out: Dict[str, Dict[str, Any]] = {}
    for it in items:
        iid = it.get('id')
        if not iid:
            continue
        try:
            out[iid] = client.get('items', iid, use_cache=use_cache)
        except Exception as e:  # noqa: BLE001
            print(f'    [skip] items/{iid}: {e}', file=sys.stderr)
    return out


def _load_cache_dir(entity: str) -> Dict[str, Dict[str, Any]]:
    """Read all cached detail JSONs for an entity dir (skips _list.json)."""
    out: Dict[str, Dict[str, Any]] = {}
    base = _repo_root() / 'util' / 'cache' / 'tools_api_cache' / entity
    if not base.is_dir():
        return out
    for f in base.glob('*.json'):
        if f.name == '_list.json':
            continue
        try:
            d = json.loads(f.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            continue
        if isinstance(d, dict) and d.get('id'):
            out[d['id']] = d
    return out


def _add_dest(to_fetch: Dict[str, List[Path]], icon: str, dest: Path,
              rescrape: bool) -> int:
    if dest.exists() and not rescrape:
        return 0
    to_fetch.setdefault(icon, []).append(dest)
    return 1


def _collect_item_icons(root: Path, details: Dict[str, Dict[str, Any]],
                        rescrape: bool, to_fetch: Dict[str, List[Path]]) -> int:
    # Items are written under BOTH the id-named file and the name-slug file
    # (name.lower().replace(' ','_'), apostrophes preserved) because the
    # frontend requests by name-slug while many committed files are id-named.
    icons_dir = root / 'assets' / 'icons' / 'items'
    n = 0
    for iid, d in details.items():
        cat = _category_dir(d)
        icon = d.get('icon')
        name = d.get('name')
        if not cat or not icon:
            continue
        dests = [icons_dir / cat / f'{iid}.svg']
        if name:
            ns = name.lower().replace(' ', '_')
            if ns and ns != iid:
                dests.append(icons_dir / cat / f'{ns}.svg')
        for p in dests:
            n += _add_dest(to_fetch, icon, p, rescrape)
    return n


def _collect_ability_icons(root: Path, rescrape: bool,
                           to_fetch: Dict[str, List[Path]]) -> int:
    # Frontend loads /assets/icons/abilities/${ability.icon}.svg where
    # ability.icon == the icon-path basename (e.g. golden_frog_ability).
    n = 0
    for _aid, d in _load_cache_dir('abilities').items():
        icon = d.get('icon')
        if not icon:
            continue
        base = os.path.splitext(os.path.basename(icon))[0]
        n += _add_dest(to_fetch, icon,
                       root / 'assets' / 'icons' / 'abilities' / f'{base}.svg', rescrape)
    return n


def _collect_location_icons(root: Path, rescrape: bool,
                            to_fetch: Dict[str, List[Path]]) -> int:
    # LocationInfo.icon_name == '<terrain-basename>_icon.svg'; the frontend
    # loads /assets/icons/locations/${location.icon_name}. Terrain icons are
    # shared across many locations (dedup happens naturally via to_fetch).
    n = 0
    for _lid, d in _load_cache_dir('locations').items():
        icon = d.get('icon')
        if not icon:
            continue
        base = os.path.splitext(os.path.basename(icon))[0]
        n += _add_dest(to_fetch, icon,
                       root / 'assets' / 'icons' / 'locations' / f'{base}_icon.svg', rescrape)
    return n


def _activity_skill(d: Dict[str, Any]) -> Optional[str]:
    for r in d.get('requirements') or []:
        if r.get('type') == 'skillLevel':
            s = (r.get('requirement') or {}).get('skill')
            if s:
                return str(s).lower()
    rel = d.get('relatedSkillsList') or []
    if rel:
        r0 = rel[0]
        return str(r0.get('id') if isinstance(r0, dict) else r0).lower()
    return None


def _collect_activity_icons(root: Path, rescrape: bool,
                            to_fetch: Dict[str, List[Path]]) -> int:
    # Activity icons live at /assets/icons/activities/<skill>/<activity_id>.svg
    # (matches the committed layout, e.g. hunting/bear_hunting.svg).
    n = 0
    for aid, d in _load_cache_dir('activities').items():
        icon = d.get('icon')
        if not icon:
            continue
        skill = _activity_skill(d)
        if not skill:
            continue  # no skill subdir to place it under
        n += _add_dest(to_fetch, icon,
                       root / 'assets' / 'icons' / 'activities' / skill / f'{aid}.svg', rescrape)
    return n


def _collect_pet_icons(root: Path, rescrape: bool,
                       to_fetch: Dict[str, List[Path]]) -> int:
    # Pets carry no top-level `icon`; their sprites live in
    # looks[].sprites[{stage, sprite}] (+ rareLooks[]). The frontend loads
    # /assets/icons/items/pets/<species>_<stage>_<variant>.svg with variant in
    # normal/light/dark/rare (see pet-utils.js getPetIconPath). Map the
    # non-rare looks to normal/light/dark by order and rareLooks -> rare
    # (best-effort; the exact light/dark labelling isn't published by the API).
    # 'normal' also gets a compat file <species>_<stage>.svg (matches the
    # legacy scraper's backward-compatible copies).
    petdir = root / 'assets' / 'icons' / 'items' / 'pets'
    order = ['normal', 'light', 'dark']
    n = 0
    for pid, d in _load_cache_dir('pets').items():
        variant_looks: List[Tuple[str, Dict[str, Any]]] = []
        for i, look in enumerate(d.get('looks') or []):
            if i < len(order):
                variant_looks.append((order[i], look))
        for look in d.get('rareLooks') or []:
            variant_looks.append(('rare', look))
        for variant, look in variant_looks:
            for sp in look.get('sprites') or []:
                stage = sp.get('stage')
                sprite = sp.get('sprite')
                if not stage or not sprite:
                    continue
                n += _add_dest(to_fetch, sprite, petdir / f'{pid}_{stage}_{variant}.svg', rescrape)
                if variant == 'normal':
                    n += _add_dest(to_fetch, sprite, petdir / f'{pid}_{stage}.svg', rescrape)
    return n


def _batch_convert(client: ToolsAPIClient, to_fetch: Dict[str, List[Path]]) -> int:
    """POST /icons/batch for all icon paths, decode base64 PNG, convert to SVG,
    and write to every mapped destination. Returns count written."""
    icon_paths = list(to_fetch.keys())
    written = 0
    for start in range(0, len(icon_paths), _BATCH):
        chunk = icon_paths[start:start + _BATCH]
        data = client._post_request('/icons/batch', {'iconPaths': chunk})  # noqa: SLF001
        if not isinstance(data, dict):
            print(f'    [warn] unexpected /icons/batch response: {type(data).__name__}',
                  file=sys.stderr)
            continue
        for icon_path, data_uri in data.items():
            if not isinstance(data_uri, str) or ',' not in data_uri:
                print(f'    [warn] no data for {icon_path}', file=sys.stderr)
                continue
            try:
                png_bytes = base64.b64decode(data_uri.split(',', 1)[1])
                svg = png_bytes_to_svg(png_bytes)
            except Exception as e:  # noqa: BLE001
                print(f'    [warn] convert failed for {icon_path}: {e}', file=sys.stderr)
                continue
            for dest in to_fetch.get(icon_path, []):
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(svg, encoding='utf-8')
                written += 1
    return written


def run(client: ToolsAPIClient, *, use_cache: bool = True, rescrape: bool = False) -> int:
    """Fetch + convert missing icons for items, abilities, locations, and
    activities. Returns the number of SVG files written."""
    root = _repo_root()
    details = _load_item_details(client, use_cache)
    to_fetch: Dict[str, List[Path]] = {}
    ni = _collect_item_icons(root, details, rescrape, to_fetch)
    na = _collect_ability_icons(root, rescrape, to_fetch)
    nl = _collect_location_icons(root, rescrape, to_fetch)
    nv = _collect_activity_icons(root, rescrape, to_fetch)
    npet = _collect_pet_icons(root, rescrape, to_fetch)
    print(f'  [icons] to fetch: items={ni} abilities={na} locations={nl} '
          f'activities={nv} pets={npet} ({len(to_fetch)} unique icon paths)')
    if not to_fetch:
        return 0
    written = _batch_convert(client, to_fetch)
    print(f'  [icons] wrote {written} SVG icon(s)')
    return written


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--no-cache', action='store_true', help='Bypass disk cache')
    p.add_argument('--prod', action='store_true', help='Use production endpoint')
    p.add_argument('--rescrape', action='store_true',
                   help='Re-convert even if the destination SVG already exists')
    args = p.parse_args()
    base = ('https://tools-api.dev.walkscape.app' if args.prod
            else 'https://tools-api-dev.dev.walkscape.app')
    client = ToolsAPIClient(base_url=base)
    run(client, use_cache=not args.no_cache, rescrape=args.rescrape)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
