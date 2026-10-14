-- Fastest Craft results storage (.kiro/specs/fastest-craft/, R6 / design §3.2).
--
-- One row per (session, crafted item, material variant, quality). Stores the
-- base-node gearset, the full per-one steps/craft, the "with banked materials"
-- step count, and the material-offset breakdown + owned-count snapshot used to
-- compute it (so the banked value can be recomputed cheaply on page load when
-- the owned counts for that item's materials change — without re-solving).
--
-- The table is also created inline in database.py::_init_db_with_conn via the
-- same idempotent DDL, so it exists for in-memory/test DBs that don't run this
-- migration file. This file is the authoritative registration.

CREATE TABLE IF NOT EXISTS fastest_craft_results (
    session_uuid TEXT NOT NULL,
    item_ref TEXT NOT NULL,
    variant TEXT NOT NULL,                -- 'normal' | 'fine'
    quality TEXT NOT NULL,                -- Normal..Eternal
    base_gearset_export TEXT,
    total_steps_per_craft REAL,
    with_banked_steps REAL,
    root_self_steps REAL,                 -- irreducible final-craft steps (banked floor)
    child_quantities_json TEXT,
    material_offsets_json TEXT,           -- {ref: {needed, cum}} for banked recompute
    needed_owned_counts_json TEXT,        -- owned snapshot (this item's materials) used for banked
    subtree_scope_keys_json TEXT,         -- reused goals-report scope keys (porting + stale)
    last_computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_uuid, item_ref, variant, quality)
);
