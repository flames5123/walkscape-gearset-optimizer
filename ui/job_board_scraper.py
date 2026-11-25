#!/usr/bin/env python3
"""
Weekly WalkScape job-board scraper.

Pulls the current week's job boards from the WalkScape Public API
(https://api.web.walkscape.app/public/v1) and upserts every job into the
``job_board_jobs`` table. One job id is stable and unique across all weeks, so
the ingest is INSERT-OR-IGNORE idempotent: re-running mid-scrape, after a
container reset, or from a second blue/green instance only ever adds jobs that
are not already stored and skips the rest.

Scheduling (driven by ``_job_board_scrape_loop`` in app.py):
  * Jobs refresh weekly on Monday 00:00 UTC. Week 0 began 2024-01-01 (a Monday).
  * After a full-success ingest of the running week, the loop records that week
    as done and sleeps until the next Monday boundary (it stops retrying).
  * A failed ingest leaves no success marker, so the loop retries on a short
    interval until it succeeds.

Cache discipline (per the API's Caching section): the running week's jobs carry
``Cache-Control: max-age=300`` and an ``ETag``. We store the ETag after a
full-success ingest and send it back as ``If-None-Match``; a ``304 Not Modified``
means the data is unchanged and is treated as an (idempotent) success. The loop
never polls faster than the cache window because after success it sleeps to the
next week boundary.

Standalone use (for local validation):
    python3 -m ui.job_board_scraper            # scrape current week into sessions.db
    python3 -m ui.job_board_scraper --db /tmp/x.db --force
"""

import json
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

# ── API ──────────────────────────────────────────────────────────────────────
API_BASE = "https://api.web.walkscape.app/public/v1"
_TIMEOUT = 30
# The API rejects the default "Python-urllib/x.y" UA on some edges; use a named
# one, matching the trading federation client's convention.
_USER_AGENT = "walkscape-optimizer-jobboard/1.0 (+https://walkscape.flamesandvoltiply.com)"

# Week 0 began 2024-01-01 00:00 UTC (a Monday); every week is Mon 00:00 -> Mon 00:00.
_WEEK0_START = datetime(2024, 1, 1, tzinfo=timezone.utc)
_WEEK_SECONDS = 7 * 24 * 3600

# ── Board name resolution ─────────────────────────────────────────────────────
# Proper display names, keyed by the tools-API job-board id
# (https://tools-api.dev.walkscape.app/job_boards/). These are stable game data.
BOARD_NAMES: Dict[str, str] = {
    "azurazera_job_board": "Azurazera job board",
    "blackspell_harbour_job_board": "Blackspell Harbour job board",
    "everhaven_combined_job_board": "Everhaven combined job board",
    "granfiddich_job_board": "Granfiddich job board",
    "halfling_campgrounds_job_board": "Halfling Campgrounds job board",
    "herberts_job_board": "Herbert's job board",
    "kallaheim_job_board": "Kallaheim job board",
    "vastalume_job_board": "Vastalume job board",
}

# Some game-data board_ids are bare UUIDs with no embedded slug — map explicitly.
_BARE_BOARD_IDS: Dict[str, str] = {
    "1cb05d71-0033-4222-8bc8-f4cf8436e2c3": "halfling_campgrounds_job_board",
    "521b90e7-0974-4ce0-94d6-71b841afe5f5": "everhaven_combined_job_board",
}

# A few embedded slugs differ from the tools-API id — alias them.
_SLUG_ALIASES: Dict[str, str] = {
    "blackspell_port_job_board": "blackspell_harbour_job_board",
    "tutorial_area": "herberts_job_board",
}


def _derive_slug(board_id: str) -> Optional[str]:
    """Pull the board slug out of a ``jobboard-<slug>-<uuid>`` game-data id.

    Strips the ``jobboard-`` prefix and the trailing ``-<8-4-4-4-12>`` UUID,
    leaving the slug (e.g. ``jobboard-granfiddich_job_board-4b94...`` ->
    ``granfiddich_job_board``). Returns None if the shape doesn't match.
    """
    if not board_id.startswith("jobboard-"):
        return None
    rest = board_id[len("jobboard-"):]
    parts = rest.split("-")
    # A trailing UUID is 5 dash-separated segments; drop them if present.
    if len(parts) >= 6:
        slug = "-".join(parts[:-5])
    else:
        slug = rest
    return slug or None


def resolve_board(board_id: str) -> Tuple[Optional[str], Optional[str]]:
    """(slug, proper_name) for a game-data board_id, or (None/slug, None) if
    the board is unknown. Never raises — an unmapped board still ingests, just
    without a display name."""
    slug: Optional[str] = None
    if board_id in _BARE_BOARD_IDS:
        slug = _BARE_BOARD_IDS[board_id]
    else:
        derived = _derive_slug(board_id)
        if derived:
            slug = _SLUG_ALIASES.get(derived, derived)
    name = BOARD_NAMES.get(slug) if slug else None
    return slug, name


# ── Week-index / boundary helpers ─────────────────────────────────────────────
def current_week_index(now: Optional[datetime] = None) -> int:
    """The running week index, computed from the clock (week 0 = 2024-01-01)."""
    now = now or datetime.now(timezone.utc)
    return int((now - _WEEK0_START).total_seconds() // _WEEK_SECONDS)


def seconds_until_next_week_boundary(now: Optional[datetime] = None) -> float:
    """Seconds until the next Monday 00:00 UTC (always >= 1)."""
    now = now or datetime.now(timezone.utc)
    start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    monday_this = start_today - timedelta(days=now.weekday())
    next_monday = monday_this + timedelta(days=7)
    return max(1.0, (next_monday - now).total_seconds())


# ── HTTP ───────────────────────────────────────────────────────────────────────
def _get(path: str, etag: Optional[str] = None) -> Tuple[int, Optional[Dict[str, Any]], Optional[str]]:
    """GET {API_BASE}{path}. Returns (status, json_or_None, etag).

    Sends If-None-Match when an etag is supplied; a 304 returns
    (304, None, etag). Raises urllib errors only for unexpected transport
    failures; a clean 404 is returned as (404, body, None) so callers can
    distinguish "week not published" from a real error.
    """
    url = API_BASE + path
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", _USER_AGENT)
    req.add_header("Accept", "application/json")
    if etag:
        req.add_header("If-None-Match", etag)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            new_etag = resp.headers.get("ETag")
            raw = resp.read()
            body = json.loads(raw.decode("utf-8")) if raw else None
            return resp.getcode(), body, new_etag
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, None, etag
        # Read the error body (standard WalkScape error envelope) for the log.
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = None
        return e.code, body, None


# ── Scrape ─────────────────────────────────────────────────────────────────────
def scrape_current_week(db, force: bool = False) -> Dict[str, Any]:
    """Ingest the running week's job boards into ``job_board_jobs`` (idempotent).

    Returns a summary dict:
        {status, week_index, jobs_seen, jobs_inserted, jobs_skipped,
         boards_seen, unresolved_boards, error}
    status is one of: 'success', 'already_done', 'unchanged', 'failure'.

    On full success it stores the response ETag and marks the week done so the
    scheduler stops retrying. Any failure records an ingest row with the error
    and leaves the success marker untouched so the scheduler retries.
    """
    clock_idx = current_week_index()

    # Cheap short-circuit: already fully ingested this week -> no HTTP for the
    # jobs. Still (best-effort) resolve any item ids whose names aren't cached
    # yet, so a week ingested before the resolver existed still gets names.
    if not force and db.job_board_week_succeeded(clock_idx):
        items_resolved = 0
        try:
            from ui import job_board_items as _jbi
            items_resolved = (_jbi.resolve_items(db) or {}).get("resolved", 0)
        except Exception:
            pass
        return {"status": "already_done", "week_index": clock_idx,
                "jobs_seen": 0, "jobs_inserted": 0, "jobs_skipped": 0,
                "boards_seen": 0, "unresolved_boards": [], "items_resolved": items_resolved,
                "error": None}

    ingest_id = db.job_board_start_ingest(clock_idx)
    try:
        etag = None if force else db.job_board_get_meta("current_etag")
        status, body, new_etag = _get("/jobs/weeks/current", etag=etag)

        if status == 304:
            # Unchanged since our last full-success pull -> idempotent success.
            db.job_board_mark_week_succeeded(clock_idx)
            try:
                from ui import job_board_items as _jbi
                _jbi.resolve_items(db)
            except Exception:
                pass
            summary = {"status": "unchanged", "week_index": clock_idx,
                       "jobs_seen": 0, "jobs_inserted": 0, "jobs_skipped": 0,
                       "boards_seen": 0, "unresolved_boards": [], "error": None}
            db.job_board_finish_ingest(ingest_id, "success", summary)
            return summary

        if status != 200 or not isinstance(body, dict):
            detail = None
            if isinstance(body, dict):
                detail = (body.get("error") or {}).get("error_message")
            err = f"HTTP {status}" + (f": {detail}" if detail else "")
            summary = {"status": "failure", "week_index": clock_idx,
                       "jobs_seen": 0, "jobs_inserted": 0, "jobs_skipped": 0,
                       "boards_seen": 0, "unresolved_boards": [], "error": err}
            db.job_board_finish_ingest(ingest_id, "failure", summary)
            return summary

        week_index = int(body.get("week_index", clock_idx))
        jobs = body.get("jobs") or []
        rows: List[Dict[str, Any]] = []
        boards = set()
        unresolved = set()
        for j in jobs:
            board_id = j.get("board_id")
            boards.add(board_id)
            slug, name = resolve_board(board_id or "")
            if not name:
                unresolved.add(board_id)
            rows.append({
                "id": j.get("id"),
                "week_index": week_index,
                "board_id": board_id,
                "board_slug": slug,
                "board_name": name,
                "slot": j.get("slot"),
                "difficulty_id": j.get("difficulty_id"),
                "special_id": j.get("special_id"),
                "bonus": 1 if j.get("bonus") else 0,
                "required_level": j.get("required_level"),
                "expires_at": j.get("expires_at"),
                "goals_json": json.dumps(j.get("goals") or [], separators=(",", ":")),
                "rewards_json": json.dumps(j.get("rewards") or [], separators=(",", ":")),
            })

        inserted, skipped = db.job_board_upsert_jobs(rows)

        # Store the ETag + mark the week done only AFTER a clean full insert, so
        # a later 304 can only mean a prior full success.
        if new_etag:
            db.job_board_set_meta("current_etag", new_etag)
        db.job_board_mark_week_succeeded(week_index)

        # Best-effort: resolve any new item ids -> names/slugs for the page.
        items_resolved = 0
        try:
            from ui import job_board_items as _jbi
            items_resolved = (_jbi.resolve_items(db, rows=None) or {}).get("resolved", 0)
        except Exception:
            pass

        summary = {"status": "success", "week_index": week_index,
                   "jobs_seen": len(rows), "jobs_inserted": inserted,
                   "jobs_skipped": skipped, "boards_seen": len(boards),
                   "unresolved_boards": sorted(b for b in unresolved if b),
                   "items_resolved": items_resolved,
                   "error": None}
        db.job_board_finish_ingest(ingest_id, "success", summary)
        return summary
    except Exception as e:  # transport / parse / DB error -> retryable failure
        import traceback
        summary = {"status": "failure", "week_index": clock_idx,
                   "jobs_seen": 0, "jobs_inserted": 0, "jobs_skipped": 0,
                   "boards_seen": 0, "unresolved_boards": [],
                   "error": f"{type(e).__name__}: {e}"}
        try:
            db.job_board_finish_ingest(ingest_id, "failure", summary,
                                       traceback_text=traceback.format_exc())
        except Exception:
            pass
        return summary


if __name__ == "__main__":  # pragma: no cover - manual/local validation
    import argparse
    from ui.database import DatabaseManager

    ap = argparse.ArgumentParser(description="Scrape the current WalkScape job-board week.")
    ap.add_argument("--db", default="sessions.db", help="SQLite path (default sessions.db)")
    ap.add_argument("--force", action="store_true", help="Ignore the success marker + ETag and re-fetch")
    args = ap.parse_args()

    _db = DatabaseManager(args.db)
    print(json.dumps(scrape_current_week(_db, force=args.force), indent=2))
