#!/usr/bin/env python3
"""
Resolve job-board item ids to names/slugs/keywords via the WalkScape tools API,
caching the result in the `job_board_items` table.

Job goal/reward item ids are a mix of `item-<slug>-<uuid>` (slug derivable) and
bare `<uuid>` (reward chests + some goals). The tools API resolves any id to its
slug/name/type/keywords; we cache that so the Job Board page can show real
names and detect chests without hitting the tools API on every load.

Best-effort: if the tools-api key is missing or the API is unreachable, this
degrades to a no-op (the page falls back to the derivable slug / a cleaned id).
Run after each weekly ingest.
"""

import json
from typing import Any, Dict, List, Set

from ui.job_board_service import item_slug


def collect_item_ids(rows: List[Dict[str, Any]]) -> Set[str]:
    """Every distinct item id referenced by a set of job_board_jobs rows
    (goals, goal alternatives, and item rewards)."""
    ids: Set[str] = set()
    for row in rows:
        try:
            goals = json.loads(row.get("goals_json") or "[]")
            rewards = json.loads(row.get("rewards_json") or "[]")
        except Exception:
            continue
        for g in goals:
            if g.get("item", {}).get("id"):
                ids.add(g["item"]["id"])
            for a in (g.get("alternatives") or []):
                if a.get("item", {}).get("id"):
                    ids.add(a["item"]["id"])
        for r in rewards:
            if r.get("kind") == "item" and r.get("item", {}).get("id"):
                ids.add(r["item"]["id"])
    return ids


def resolve_items(db, rows: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Resolve + cache any not-yet-known item ids referenced by `rows`
    (defaults to the latest week's jobs). Returns a summary dict.

    Degrades to {status:'skipped'} when the tools-api client can't be built
    (no key) or errors — never raises into the caller (the weekly ingest).
    """
    if rows is None:
        rows = db.job_board_jobs_for_latest_week()
    wanted = collect_item_ids(rows)
    known = db.job_board_known_item_ids()
    todo = sorted(wanted - known)
    if not todo:
        return {"status": "ok", "resolved": 0, "unknown": 0, "total": len(wanted)}

    try:
        from util.scrapers.tools_api_client import ToolsAPIClient, PROD_BASE_URL
        client = ToolsAPIClient(base_url=PROD_BASE_URL)
    except Exception as e:
        return {"status": "skipped", "reason": f"no tools-api client: {e}",
                "resolved": 0, "unknown": len(todo), "total": len(wanted)}

    resolved, unresolved = [], 0
    for item_id in todo:
        try:
            d = client.get("items", item_id)
        except Exception:
            # Fall back to the derivable slug if the id carries one.
            slug = item_slug(item_id)
            resolved.append({"id": item_id, "slug": slug, "name": None, "type": None,
                             "quality": None, "keywords_json": "[]", "is_chest": False})
            unresolved += 1
            continue
        kw = d.get("keywords") or []
        resolved.append({
            "id": item_id,
            "slug": d.get("id") or item_slug(item_id),
            "name": d.get("name"),
            "type": d.get("type"),
            "quality": d.get("quality"),
            "keywords_json": json.dumps(kw, separators=(",", ":")),
            "is_chest": "chest" in kw or (d.get("type") == "container"),
        })

    written = db.job_board_upsert_items(resolved)
    return {"status": "ok", "resolved": written, "unknown": unresolved, "total": len(wanted)}


if __name__ == "__main__":  # pragma: no cover
    import argparse
    from ui.database import DatabaseManager
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="sessions.db")
    args = ap.parse_args()
    print(json.dumps(resolve_items(DatabaseManager(args.db)), indent=2))
