-- Item-id -> name/slug cache for the Job Board page (ui/job_board_items.py).
--
-- Job goal/reward item ids come in two forms: `item-<slug>-<uuid>` (slug
-- derivable) and bare `<uuid>` (reward chests + some goals — slug NOT derivable).
-- The tools API (GET /items/id/<id>) resolves any id to its slug/name/type/
-- keywords; we cache that here so the page can show real names + detect chests
-- without hitting the tools API on every page load. Populated best-effort by
-- the weekly scraper after each ingest.
--
-- Also created inline in database.py::_init_db_with_conn and registered in
-- pg_schema.sql for the Postgres backend.

CREATE TABLE IF NOT EXISTS job_board_items (
    id TEXT PRIMARY KEY,          -- the API item id (bare uuid or item-<slug>-<uuid>)
    slug TEXT,                    -- tools-API id == catalog slug
    name TEXT,
    type TEXT,
    quality TEXT,
    keywords_json TEXT,
    is_chest INTEGER DEFAULT 0,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
