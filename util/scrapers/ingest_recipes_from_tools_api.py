#!/usr/bin/env python3
"""Ingest recipes from the tools API.

Recipes used to be scraped from the wiki (util/scrapers/scrape_recipes.py).
That path is superseded: the tools API exposes a full `/recipes` endpoint
(list + per-recipe detail) whose shape ``old_shape_emitters.emit_recipes``
already consumes via ``load_all_details('recipes')``.

This module hydrates every recipe's detail JSON into the tools-API cache
(util/cache/tools_api_cache/recipes/). It does NOT write recipes.py itself
— the emit step (emit_recipes, run during ingest_all's final phase)
regenerates recipes.py from the freshly-cached detail.

Run as part of the master driver:

    python3 util/scrapers/ingest_all_from_tools_api.py --prod

or standalone:

    python3 util/scrapers/ingest_recipes_from_tools_api.py --prod
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from util.scrapers.tools_api_client import (  # noqa: E402
    DEV_BASE_URL,
    PROD_BASE_URL,
    ToolsAPIClient,
)


def run(client: ToolsAPIClient, *, use_cache: bool = True) -> int:
    """Hydrate every recipe's detail JSON into the tools-API cache.

    Returns the number of recipes successfully hydrated.
    """
    recipes = client.list('recipes', use_cache=use_cache)
    print(f'  [recipes            ] hydrating {len(recipes)} recipes …')
    hydrated = 0
    for r in recipes:
        rid = r.get('id')
        if not rid:
            continue
        try:
            client.get('recipes', rid, use_cache=use_cache)
            hydrated += 1
        except Exception as e:  # noqa: BLE001 - report and continue
            print(f'    [skip] recipes/{rid}: {e}', file=sys.stderr)
    print(f'  [recipes            ] {hydrated} recipes cached '
          f'→ recipes.py (emitted in final step)')
    return hydrated


if __name__ == '__main__':
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--no-cache', action='store_true',
                   help='Bypass cache reads (still writes fresh cache)')
    p.add_argument('--prod', action='store_true',
                   help='Use production endpoint instead of dev')
    args = p.parse_args()

    c = ToolsAPIClient(base_url=PROD_BASE_URL if args.prod else DEV_BASE_URL)
    run(c, use_cache=not args.no_cache)
