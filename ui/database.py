#!/usr/bin/env python3
"""
SQLite database manager for session persistence.

Manages user sessions with separate character_config and ui_config storage.
Each session is identified by a UUID and stores:
- character_config: Imported game export data (skills, items, reputation)
- ui_config: User preferences (hidden items, quality selections, custom stats)
"""

import json
import math
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any


def _utc_now() -> str:
    """Get current UTC time as ISO string with Z suffix for JavaScript compatibility."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def _sanitize_for_json(obj):
    """Recursively replace float('inf'), float('-inf'), and float('nan') with None.
    
    Python's json.dumps allows these by default, but they produce non-standard
    JSON tokens (Infinity, -Infinity, NaN) that fail when FastAPI serializes
    responses with allow_nan=False (the JSON spec default).
    """
    if isinstance(obj, float):
        if math.isinf(obj) or math.isnan(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    return obj


def _coin_num(x):
    """Normalize a coin value for price signals / aggregation while supporting
    decimals (partner may federate fractional coin prices). Rounds to 2 decimal
    places; returns an int when the result is integral so whole-coin prices stay
    ints (no 5 -> 5.0 noise), else a float. Non-numeric input passes through.
    """
    try:
        v = round(float(x), 2)
    except (TypeError, ValueError):
        return x
    return int(v) if v == int(v) else v


class DatabaseManager:
    """Manages SQLite database for session persistence."""
    
    def __init__(self, db_path: str = "sessions.db"):
        """Initialize database manager.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = db_path
        self._persistent_conn = None
        
        # For in-memory databases, keep connection open
        # Use check_same_thread=False for async/multi-threaded environments
        if db_path == ":memory:":
            self._persistent_conn = sqlite3.connect(db_path, check_same_thread=False)
            self._init_db_with_conn(self._persistent_conn)
        else:
            self._init_db()
    
    def _init_db(self):
        """Create sessions table if not exists (for file-based databases)."""
        conn = sqlite3.connect(self.db_path, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        self._init_db_with_conn(conn)
        conn.close()
    
    def _init_db_with_conn(self, conn):
        """Create sessions and gear_sets tables using provided connection."""
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                uuid TEXT PRIMARY KEY,
                character_config TEXT,
                ui_config TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Gear sets table for storing saved gear configurations
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS gear_sets (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                slots_json TEXT NOT NULL,
                export_string TEXT,
                is_optimized INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
                UNIQUE(session_uuid, name)
            )
        """)

        # Fastest Craft results (.kiro/specs/fastest-craft/, R6). One row per
        # (session, crafted item, material variant, quality). See the migration
        # ui/migrations/*_create_fastest_craft_results.sql for the authoritative
        # DDL; created inline too so in-memory/test DBs always have it.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS fastest_craft_results (
                session_uuid TEXT NOT NULL,
                item_ref TEXT NOT NULL,
                variant TEXT NOT NULL,
                quality TEXT NOT NULL,
                base_gearset_export TEXT,
                total_steps_per_craft REAL,
                with_banked_steps REAL,
                root_self_steps REAL,
                child_quantities_json TEXT,
                material_offsets_json TEXT,
                needed_owned_counts_json TEXT,
                subtree_scope_keys_json TEXT,
                base_dominance_bitmap TEXT,
                base_scope_json TEXT,
                last_computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (session_uuid, item_ref, variant, quality)
            )
        """)

        # Add columns if they don't exist (migrations)
        try:
            cursor.execute("ALTER TABLE gear_sets ADD COLUMN is_optimized INTEGER DEFAULT 0")
        except:
            pass  # Column already exists
        
        try:
            cursor.execute("ALTER TABLE gear_sets ADD COLUMN export_string TEXT")
        except:
            pass  # Column already exists
        
        try:
            cursor.execute("ALTER TABLE gear_sets ADD COLUMN suggest_dismissed INTEGER DEFAULT 0")
        except:
            pass  # Column already exists
        
        # Bug reports table for user-submitted issues
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS optimization_presets (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                preset_type TEXT NOT NULL,
                sorting_json TEXT NOT NULL,
                include_consumables INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
                UNIQUE(session_uuid, name, preset_type)
            )
        """)
        
        # Bug reports table for user-submitted issues
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bug_reports (
                id TEXT PRIMARY KEY,
                original_session_uuid TEXT NOT NULL,
                snapshot_session_uuid TEXT NOT NULL,
                description TEXT NOT NULL,
                app_version TEXT NOT NULL,
                browser_info TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                screenshots_json TEXT,
                reviewed BOOLEAN DEFAULT 0,
                reviewed_at TIMESTAMP,
                reviewed_by TEXT,
                notes TEXT,
                server_logs TEXT,
                FOREIGN KEY (original_session_uuid) REFERENCES sessions(uuid),
                FOREIGN KEY (snapshot_session_uuid) REFERENCES sessions(uuid)
            )
        """)

        # Bug report notes (ticket-style comment chain on a bug report).
        # Append-only timeline. Replies allowed via parent_note_id self-FK.
        # Author is a self-reported string (e.g. 'meshclaw', 'jwbail').
        # thread_title lets an agent identify its own thread when replying
        # to itself in a future session.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bug_report_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id TEXT NOT NULL,
                parent_note_id INTEGER,
                author TEXT NOT NULL,
                thread_title TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (report_id) REFERENCES bug_reports(id),
                FOREIGN KEY (parent_note_id) REFERENCES bug_report_notes(id)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_report_notes_report
            ON bug_report_notes(report_id, created_at)
        """)

        # Per-device local-optimization speed benchmark samples. Append-only;
        # one row per benchmark run (auto on first load, or manual via the
        # settings button). Used to calibrate the "your device is faster than
        # the server" threshold against real device data.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS local_speed_benchmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid TEXT,
                count INTEGER NOT NULL,
                run_ms REAL,
                boot_ms REAL,
                faster BOOLEAN,
                threshold INTEGER,
                user_agent TEXT,
                source TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_local_speed_benchmarks_created
            ON local_speed_benchmarks(created_at)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_report_notes_parent
            ON bug_report_notes(parent_note_id)
        """)

        # API access audit table for tracking usage
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS api_access_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_agent TEXT,
                ip_address TEXT,
                FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
            )
        """)
        
        # Create index for faster queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_access_session 
            ON api_access_audit(session_uuid)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_access_timestamp 
            ON api_access_audit(timestamp)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_access_endpoint 
            ON api_access_audit(endpoint)
        """)
        
        # Debug sessions table for remote debug mode toggling
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS debug_sessions (
                session_uuid TEXT PRIMARY KEY,
                enabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                enabled_by TEXT NOT NULL
            )
        """)
        
        # Broadcasts table for admin broadcast messages
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS broadcasts (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL,
                active BOOLEAN DEFAULT 1
            )
        """)
        
        # Broadcast dismissals table for per-session dismissal tracking
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS broadcast_dismissals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                broadcast_id TEXT NOT NULL,
                session_uuid TEXT NOT NULL,
                dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(broadcast_id, session_uuid)
            )
        """)
        
        # Feature flags table for per-session feature access
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feature_flags (
                session_uuid TEXT NOT NULL,
                feature TEXT NOT NULL,
                enabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                enabled_by TEXT NOT NULL,
                PRIMARY KEY (session_uuid, feature)
            )
        """)

        # ── Trading feature (FAC-gated: trading) — shared multi-user marketplace. ──
        # Ownership is keyed on the PRIVATE session_uuid (read only from the caller's
        # cookie, never emitted). Only in_game_name + display_name are exposed to other
        # users/partners. object_id = "{origin_site}:{local_id}"; txn_id = unix-epoch ms.
        # identity (game export key, not a name-slug), quality (game variant tokens),
        # and added per-row versioning + a monotonic txn counter. The feature was still
        # behind the FAC with only throwaway test data, so we WIPE the trading tables
        # once (bump TRADING_SCHEMA_VERSION) instead of migrating.
        TRADING_SCHEMA_VERSION = "2"
        cursor.execute("CREATE TABLE IF NOT EXISTS trading_meta (key TEXT PRIMARY KEY, value TEXT)")
        cursor.execute("SELECT value FROM trading_meta WHERE key = 'schema_version'")
        _tsv = cursor.fetchone()
        if (_tsv[0] if _tsv else None) != TRADING_SCHEMA_VERSION:
            for _t in ("listings", "wishlist_entries", "trade_messages",
                       "wishlist_match_alerts", "trade_blocks", "entry_links",
                       "trade_history", "ignored_bank_warnings", "federation_cursor",
                       "federation_peers", "federation_inbox", "federation_objects",
                       "traders", "trading_seq"):
                cursor.execute(f"DROP TABLE IF EXISTS {_t}")
            cursor.execute(
                "INSERT OR REPLACE INTO trading_meta (key, value) VALUES ('schema_version', ?)",
                (TRADING_SCHEMA_VERSION,))
        # Monotonic per-site transaction counter — replaces the ms-timestamp txn_id
        # (two writes in the same ms collided; a late commit got skipped by since=).
        cursor.execute("CREATE TABLE IF NOT EXISTS trading_seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL)")
        cursor.execute("INSERT OR IGNORE INTO trading_seq (name, value) VALUES ('txn', 0)")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS traders (
                session_uuid       TEXT PRIMARY KEY,
                in_game_name       TEXT NOT NULL,
                display_name       TEXT NOT NULL,
                contact_prefs_json TEXT NOT NULL DEFAULT '[]',
                auto_renew INTEGER NOT NULL DEFAULT 0,
                share_inventory INTEGER NOT NULL DEFAULT 0,
                created_at REAL, updated_at REAL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_traders_name ON traders(in_game_name, updated_at DESC)"
        )
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS listings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin_site TEXT NOT NULL DEFAULT 'flames',
                trader_uuid TEXT NOT NULL,
                item_slug TEXT NOT NULL, item_type TEXT NOT NULL, item_quality TEXT NOT NULL,
                qty INTEGER NOT NULL DEFAULT 1,
                price_coins NUMERIC,
                trade_for_json TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                closed_for_json TEXT,
                notify INTEGER NOT NULL DEFAULT 0,
                obo INTEGER NOT NULL DEFAULT 0,
                accept_wishlist INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                expires_at REAL,
                version INTEGER NOT NULL DEFAULT 1,
                txn_id INTEGER NOT NULL, created_at REAL, updated_at REAL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_listings_item ON listings(item_slug, item_type, status)"
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_listings_txn ON listings(txn_id)")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS wishlist_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin_site TEXT NOT NULL DEFAULT 'flames',
                trader_uuid TEXT NOT NULL,
                item_slug TEXT NOT NULL, item_type TEXT NOT NULL,
                quality_rule TEXT NOT NULL DEFAULT 'exact',
                quality_floor TEXT NOT NULL DEFAULT '',
                max_coins NUMERIC, trade_for_json TEXT,
                notify_match INTEGER NOT NULL DEFAULT 0,
                qty INTEGER NOT NULL DEFAULT 1,
                note TEXT,
                expires_at REAL,
                version INTEGER NOT NULL DEFAULT 1,
                txn_id INTEGER NOT NULL, created_at REAL, updated_at REAL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_wishlist_item ON wishlist_entries(item_slug)"
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wishlist_txn ON wishlist_entries(txn_id)")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trade_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin_site TEXT NOT NULL DEFAULT 'flames',
                thread_key TEXT NOT NULL,
                from_name TEXT NOT NULL, to_name TEXT NOT NULL,
                from_uuid TEXT, to_uuid TEXT,
                about_object_id TEXT,
                body TEXT NOT NULL,
                txn_id INTEGER NOT NULL, read_at REAL, created_at REAL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_to ON trade_messages(to_uuid, read_at)"
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_txn ON trade_messages(txn_id)")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS wishlist_match_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trader_uuid TEXT NOT NULL, wishlist_id INTEGER NOT NULL,
                matched_object_id TEXT NOT NULL,
                txn_id INTEGER NOT NULL, read_at REAL, created_at REAL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_alerts_trader ON wishlist_match_alerts(trader_uuid, read_at)"
        )
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe "
            "ON wishlist_match_alerts(wishlist_id, matched_object_id)"
        )
        # Reverse direction: a LISTING owner is alerted when a new matching wishlist
        # is posted. Surfaced on My Listings (not the inbox).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS listing_match_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trader_uuid TEXT NOT NULL, listing_id INTEGER NOT NULL,
                matched_object_id TEXT NOT NULL,
                txn_id INTEGER NOT NULL, read_at REAL, created_at REAL
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_listing_alerts_trader ON listing_match_alerts(trader_uuid, read_at)"
        )
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_alerts_dedupe "
            "ON listing_match_alerts(listing_id, matched_object_id)"
        )
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trade_blocks (
                blocker_uuid TEXT NOT NULL,
                blocked_name TEXT NOT NULL,
                created_at REAL,
                PRIMARY KEY (blocker_uuid, blocked_name)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS entry_links (
                listing_object_id TEXT NOT NULL, wishlist_object_id TEXT NOT NULL,
                created_by_uuid TEXT NOT NULL, created_at REAL,
                PRIMARY KEY (listing_object_id, wishlist_object_id)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trade_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin_site TEXT NOT NULL DEFAULT 'flames',
                items_json TEXT NOT NULL,
                sold_for_json TEXT NOT NULL,
                party_a_name TEXT NOT NULL, party_b_name TEXT NOT NULL,
                linked_object_ids_json TEXT,
                txn_id INTEGER NOT NULL, created_at REAL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_history_txn ON trade_history(txn_id)")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ignored_bank_warnings (
                session_uuid TEXT NOT NULL, item_slug TEXT NOT NULL,
                PRIMARY KEY (session_uuid, item_slug)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS federation_cursor (
                partner_site TEXT PRIMARY KEY,
                last_txn_id INTEGER NOT NULL DEFAULT 0,
                pushed_txn_id INTEGER NOT NULL DEFAULT 0
            )
        """)
        # `out_token`/`base_url` are what we present/where we push (push TBD).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS federation_peers (
                site TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                out_token TEXT,
                base_url TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at REAL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fedpeers_token ON federation_peers(token)")
        # UNIQUE(source_site, object_id, version) dedupes replays (contract point 3).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS federation_inbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_site TEXT NOT NULL,
                object_id TEXT,
                version INTEGER,
                txn_id INTEGER,
                kind TEXT,
                payload_json TEXT NOT NULL,
                applied INTEGER NOT NULL DEFAULT 0,
                received_at REAL,
                UNIQUE(source_site, object_id, version)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fedinbox_src ON federation_inbox(source_site, received_at)")
        # ((object_id, version) dedupe); a 'deleted'/'removed'/'closed' status drops it.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS federation_objects (
                object_id TEXT PRIMARY KEY,
                source_site TEXT NOT NULL,
                kind TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                txn_id INTEGER,
                trader_id TEXT, trader_name TEXT, display_name TEXT,
                item_slug TEXT, item_type TEXT, item_quality TEXT,
                qty INTEGER, price_coins NUMERIC, trade_for_json TEXT, note TEXT,
                quality_rule TEXT, quality_floor TEXT, max_coins NUMERIC,
                status TEXT NOT NULL DEFAULT 'open', expires_at REAL,
                raw_json TEXT, updated_at REAL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fedobj_kind ON federation_objects(kind, status, item_slug)")
        # timestamps, OK/Error status, and the clickable failures list. Pruned to
        # the most recent rows per site on insert so it never grows unbounded.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS federation_sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site TEXT NOT NULL,
                phase TEXT NOT NULL,            -- 'push' | 'pull'
                ok INTEGER NOT NULL,            -- 1 success, 0 failure
                count INTEGER NOT NULL DEFAULT 0,  -- rows pushed/pulled
                detail TEXT,                    -- error text (failures only)
                created_at REAL NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fedsynclog_site ON federation_sync_log(site, created_at DESC)")
        # Trading migrations — idempotent ALTERs for DBs created before these
        # columns existed (SQLite raises if the column is already present).
        for _alter in (
            "ALTER TABLE listings ADD COLUMN obo INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE listings ADD COLUMN accept_wishlist INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE listings ADD COLUMN note TEXT",
            "ALTER TABLE listings ADD COLUMN expires_at REAL",
            "ALTER TABLE wishlist_entries ADD COLUMN expires_at REAL",
            "ALTER TABLE wishlist_entries ADD COLUMN qty INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE wishlist_entries ADD COLUMN note TEXT",
            "ALTER TABLE wishlist_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
            "ALTER TABLE traders ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE traders ADD COLUMN share_inventory INTEGER NOT NULL DEFAULT 0",
            # to_trader_id  = recipient's "site:account" (routes outbound to the
            "ALTER TABLE trade_messages ADD COLUMN fed_object_id TEXT",
            "ALTER TABLE trade_messages ADD COLUMN to_trader_id TEXT",
            "ALTER TABLE trade_messages ADD COLUMN from_trader_id TEXT",
            "ALTER TABLE federation_objects ADD COLUMN negotiable INTEGER NOT NULL DEFAULT 0",
            # row per site carries inbound token, outbound token, base_url, and
            # the pull/push txn cursors used as the `since` value, plus a
            # human-visible last-synced timestamp.
            "ALTER TABLE federation_peers ADD COLUMN last_pull_txn INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE federation_peers ADD COLUMN last_push_txn INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE federation_peers ADD COLUMN last_synced_at REAL",
            # Fastest Craft base-node dominance recompute (Phase 4 gap): store the
            # base/final-craft gearset dominance bitmap + its exact scope so a
            # base-node-only gear change (not reflected in any gather-leaf
            # target_items scope) still flags the row stale. Scope is stored and
            # reused verbatim on recompute so only the character's gear can move
            # the bitmap (no false-positive badge storm).
            "ALTER TABLE fastest_craft_results ADD COLUMN base_dominance_bitmap TEXT",
            "ALTER TABLE fastest_craft_results ADD COLUMN base_scope_json TEXT",
        ):
            try:
                cursor.execute(_alter)
            except Exception:
                pass
        try:
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_fedobj "
                           "ON trade_messages(origin_site, fed_object_id)")
        except Exception:
            pass
        # Backfill expiry for pre-existing listings (created_at + 7 days).
        try:
            cursor.execute(
                "UPDATE listings SET expires_at = created_at + 604800 "
                "WHERE expires_at IS NULL AND created_at IS NOT NULL"
            )
        except Exception:
            pass
        try:
            cursor.execute(
                "UPDATE wishlist_entries SET expires_at = created_at + 604800 "
                "WHERE expires_at IS NULL AND created_at IS NOT NULL"
            )
        except Exception:
            pass

        # Walkdle daily-puzzle attempts (see ui/migrations/*_create_daily_puzzle_attempts.sql).
        # One row per (session_uuid, puzzle_date, mode); state_json holds guesses + solved flag.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_puzzle_attempts (
                session_uuid TEXT NOT NULL,
                puzzle_date  TEXT NOT NULL,
                mode         TEXT NOT NULL,
                state_json   TEXT NOT NULL DEFAULT '{}',
                created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (session_uuid, puzzle_date, mode)
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_walkdle_session ON daily_puzzle_attempts(session_uuid)"
        )

        # Walkdle item availability: the first UTC date each guessable item was
        # seen. Lets the daily-target schedule pin each day to the items that
        # existed then, so adding items never reshuffles past days. Tiny
        # (one row per item, append-only); the per-day target is recomputed on
        # the fly, not stored.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS walkdle_item_first_seen (
                item_id    TEXT PRIMARY KEY,
                first_seen TEXT NOT NULL
            )
        """)

        # Notepad feature (FAC-gated): server-side multi-note rich-text notes.
        # One row per note; content_json holds the Quill Delta (entity links
        # live inside as custom embeds). title is derived server-side from the
        # first non-empty line. See .kiro/NOTEPAD_SPEC.md.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT 'Untitled',
                content_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_session_updated "
            "ON notes(session_uuid, updated_at DESC)"
        )
        # Remembers which note a session had selected so reopening the notepad
        # returns to the same note.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notepad_state (
                session_uuid TEXT PRIMARY KEY,
                selected_note_id TEXT,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Targeted broadcasts — announcements visible only to specific sessions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS targeted_broadcasts (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                session_uuids TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL,
                active BOOLEAN DEFAULT 1
            )
        """)
        
        # Session groups — named collections of session UUIDs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS session_groups (
                name TEXT PRIMARY KEY,
                session_uuids TEXT NOT NULL DEFAULT '[]',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL
            )
        """)
        
        # Active optimizations — survives uvicorn reloads
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_optimizations (
                session_uuid TEXT PRIMARY KEY,
                opt_type TEXT NOT NULL,
                opt_id TEXT NOT NULL,
                pid INTEGER,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Doc comments — inline review comments on spec documents
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS doc_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL,
                selected_text TEXT NOT NULL,
                comment TEXT NOT NULL,
                line_num INTEGER,
                section TEXT,
                full_line TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_doc_comments_doc ON doc_comments(doc_id)")
        
        conn.commit()
    
    def _get_connection(self):
        """Get database connection (reuse for in-memory, create new for file-based).
        
        Uses WAL journal mode and a 5-second busy timeout to reduce
        'database is locked' errors under concurrent access.
        """
        if self._persistent_conn:
            return self._persistent_conn
        conn = sqlite3.connect(self.db_path, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    # XP table for skill level calculation (matches walkscape_constants.py)
    _LEVEL_XP = [
        0, 83, 174, 276, 388, 512, 650, 801, 969, 1154,
        1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973, 4470,
        5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031, 13363,
        14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648, 37224,
        41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721, 101333,
        111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886, 273742,
        302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051, 737627,
        814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808, 1986068,
        2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295, 5346332,
        5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431,
    ]

    @staticmethod
    def _xp_to_level(xp: int) -> int:
        """Convert XP to skill level."""
        for level, required_xp in enumerate(DatabaseManager._LEVEL_XP, start=1):
            if xp < required_xp:
                return level - 1
        return 99

    @staticmethod
    def _xp_equate(level: float) -> int:
        """XP equation for character level."""
        return int(level + 300 * (2 ** (level / 7)))

    @staticmethod
    def _character_level_from_steps(steps: int) -> int:
        """Calculate character level from total steps."""
        char_level = 1
        while char_level < 999:
            xp = 0.0
            for i in range(1, char_level + 2):
                xp += DatabaseManager._xp_equate(float(i))
            required_xp = int(xp / 4) * 4.6
            if steps < required_xp:
                break
            char_level += 1
        return char_level

    def get_session(self, session_uuid: str) -> Optional[Dict[str, Any]]:
        """Retrieve session data by UUID.
        
        Args:
            session_uuid: Session UUID to retrieve
            
        Returns:
            Dictionary with uuid, character_config, ui_config, last_updated
            or None if session doesn't exist
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # all_items_raw / inventory_value are added by migrations that may not
        # have run yet (e.g. a fresh or in-memory DB). Fall back to the base
        # columns if they're absent; the row[4]/row[5] guards below then omit
        # them from the result.
        try:
            cursor.execute("""
                SELECT uuid, character_config, ui_config, last_updated, all_items_raw, inventory_value
                FROM sessions
                WHERE uuid = ?
            """, (session_uuid,))
        except sqlite3.OperationalError:
            cursor.execute("""
                SELECT uuid, character_config, ui_config, last_updated
                FROM sessions
                WHERE uuid = ?
            """, (session_uuid,))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        result = {
            'uuid': row[0],
            'character_config': json.loads(row[1]) if row[1] else None,
            'ui_config': json.loads(row[2]) if row[2] else {},
            'last_updated': row[3]
        }
        # Include all_items_raw only if column exists (migration may not have run yet)
        try:
            result['all_items_raw'] = row[4]
        except IndexError:
            pass
        try:
            result['inventory_value'] = row[5]
        except IndexError:
            pass
        return result
    
    def create_session(self, session_uuid: str) -> Dict[str, Any]:
        """Create a new session with empty configs.
        
        Args:
            session_uuid: UUID for the new session
            
        Returns:
            Dictionary with uuid, character_config (None), ui_config (empty dict)
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Create empty ui_config
        ui_config = {}
        
        cursor.execute("""
            INSERT INTO sessions (uuid, character_config, ui_config, last_updated)
            VALUES (?, NULL, ?, ?)
        """, (session_uuid, json.dumps(ui_config), _utc_now()))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return {
            'uuid': session_uuid,
            'character_config': None,
            'ui_config': ui_config,
            'last_updated': _utc_now()
        }
    
    def update_character_config(self, session_uuid: str, config: Dict[str, Any]):
        """Update character_config for a session.
        
        Args:
            session_uuid: Session UUID to update
            config: Character configuration dictionary
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE sessions
            SET character_config = ?, last_updated = ?
            WHERE uuid = ?
        """, (json.dumps(config), _utc_now(), session_uuid))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
    def update_inventory_value(self, session_uuid: str, value: int):
        """Update the inventory_value column for a session.

        Args:
            session_uuid: Session UUID to update
            value: Total coin value of all owned items
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE sessions
            SET inventory_value = ?
            WHERE uuid = ?
        """, (value, session_uuid))

        conn.commit()

        if not self._persistent_conn:
            conn.close()
    def update_all_items_raw(self, session_uuid: str, all_items_raw: dict):
        """Store the full inventory with quantities (backend-only, not sent to frontend).

        Args:
            session_uuid: Session UUID to update
            all_items_raw: Dict of {export_name: quantity}
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE sessions
            SET all_items_raw = ?
            WHERE uuid = ?
        """, (json.dumps(all_items_raw), session_uuid))

        conn.commit()

        if not self._persistent_conn:
            conn.close()
    
    def update_ui_config(self, session_uuid: str, config: Dict[str, Any]):
        """Update ui_config for a session.
        
        Args:
            session_uuid: Session UUID to update
            config: UI configuration dictionary
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE sessions
            SET ui_config = ?, last_updated = ?
            WHERE uuid = ?
        """, (json.dumps(config), _utc_now(), session_uuid))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
    
    def update_config_path(self, session_uuid: str, path: Any, value: Any):
        """Update a specific path in the configuration.
        
        Supports nested paths like "items.TRAVELERS_KIT.has" or "skills.mining".
        Automatically determines whether to update character_config or ui_config
        based on the path prefix.
        
        Args:
            session_uuid: Session UUID to update
            path: Dot-separated path (e.g., "items.TRAVELERS_KIT.has")
            value: Value to set at the path
        """
        # Get current session
        session = self.get_session(session_uuid)
        if not session:
            return
        
        # Determine which config to update based on path
        # ui_config paths: ui.*, items.*.hide, quality_overrides.*
        # character_config paths: skills.*, reputation.*, items.*.has, achievement_points, coins
        
        parts = list(path) if isinstance(path, list) else path.split('.')
        
        # Determine target config and adjust path
        if parts[0] == 'ui':
            config = session['ui_config']
            config_type = 'ui'
            # Skip the 'ui' prefix since we're already in ui_config
            parts = parts[1:]
        elif len(parts) >= 3 and parts[0] == 'items' and parts[2] == 'hide':
            config = session['ui_config']
            config_type = 'ui'
        elif parts[0] == 'quality_overrides':
            config = session['ui_config']
            config_type = 'ui'
        elif parts[0] == 'custom_stats':
            config = session['ui_config']
            config_type = 'ui'
        else:
            config = session['character_config']
            if config is None:
                config = {}
            config_type = 'character'
        
        # Navigate to the parent of the target path
        current = config
        for i, part in enumerate(parts[:-1]):
            if part not in current:
                current[part] = {}
            current = current[part]
        
        # Set the value
        current[parts[-1]] = value
        
        # Update the appropriate config
        if config_type == 'ui':
            self.update_ui_config(session_uuid, config)
        else:
            self.update_character_config(session_uuid, config)

    # ========================================================================
    # GEAR SET CRUD METHODS
    # ========================================================================

    def get_gear_sets(self, session_uuid: str, limit: Optional[int] = None, offset: int = 0) -> list:
        """Get gear sets for a session.

        Args:
            session_uuid: Session UUID to get gear sets for
            limit: When provided, limit the result to the N most-recently-updated
                gear sets. None returns all rows (legacy behavior).
            offset: Skip this many rows at the start of the ordered list.
                Only useful with `limit`.

        Returns:
            List of gear set dictionaries with id, name, slots_json, is_optimized, timestamps
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        if limit is not None and limit > 0:
            cursor.execute("""
                SELECT id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at, suggest_dismissed
                FROM gear_sets
                WHERE session_uuid = ?
                ORDER BY updated_at DESC
                LIMIT ? OFFSET ?
            """, (session_uuid, limit, offset))
        else:
            cursor.execute("""
                SELECT id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at, suggest_dismissed
                FROM gear_sets
                WHERE session_uuid = ?
                ORDER BY updated_at DESC
            """, (session_uuid,))
        
        rows = cursor.fetchall()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        gear_sets = []
        for row in rows:
            slots = json.loads(row[3]) if row[3] else {}
            gear_sets.append({
                'id': row[0],
                'session_uuid': row[1],
                'name': row[2],
                'slots_json': _sanitize_for_json(slots),
                'export_string': row[4],
                'is_optimized': bool(row[5]),
                'created_at': row[6],
                'updated_at': row[7],
                'suggest_dismissed': bool(row[8]) if len(row) > 8 else False
            })
        
        return gear_sets

    def count_gear_sets(self, session_uuid: str) -> int:
        """Count gear sets for a session. Cheaper than get_gear_sets when the
        caller only needs a total to decide whether to render a "Load all"
        button alongside a paginated/limited list.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM gear_sets WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return int(row[0]) if row and row[0] is not None else 0

    def get_gear_set(self, session_uuid: str, gear_set_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific gear set by ID.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to retrieve
            
        Returns:
            Gear set dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, name, slots_json, created_at, updated_at
            FROM gear_sets
            WHERE id = ? AND session_uuid = ?
        """, (gear_set_id, session_uuid))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'slots_json': _sanitize_for_json(json.loads(row[3])) if row[3] else {},
            'created_at': row[4],
            'updated_at': row[5]
        }

    def get_gear_set_by_name(self, session_uuid: str, name: str) -> Optional[Dict[str, Any]]:
        """Get a gear set by name for a session.
        
        Args:
            session_uuid: Session UUID
            name: Gear set name
            
        Returns:
            Gear set dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, name, slots_json, created_at, updated_at
            FROM gear_sets
            WHERE session_uuid = ? AND name = ?
        """, (session_uuid, name))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'slots_json': _sanitize_for_json(json.loads(row[3])) if row[3] else {},
            'created_at': row[4],
            'updated_at': row[5]
        }

    def create_gear_set(self, session_uuid: str, name: str, slots_json: Dict[str, Any], is_optimized: bool = False, export_string: str = None) -> Dict[str, Any]:
        """Create a new gear set.
        
        Args:
            session_uuid: Session UUID
            name: Gear set name (must be unique per session)
            slots_json: Dictionary of slot configurations
            is_optimized: Whether this gearset was generated by optimization
            export_string: Optional gearset export string (for optimized gearsets)
            
        Returns:
            Created gear set dictionary
            
        Raises:
            ValueError: If a gear set with this name already exists
        """
        # Check for duplicate name
        existing = self.get_gear_set_by_name(session_uuid, name)
        if existing:
            raise ValueError(f"A gear set with name '{name}' already exists")
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        gear_set_id = str(uuid.uuid4())
        now = _utc_now()
        
        cursor.execute("""
            INSERT INTO gear_sets (id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (gear_set_id, session_uuid, name, json.dumps(_sanitize_for_json(slots_json)), export_string, 1 if is_optimized else 0, now, now))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return {
            'id': gear_set_id,
            'session_uuid': session_uuid,
            'name': name,
            'slots_json': slots_json,
            'export_string': export_string,
            'is_optimized': is_optimized,
            'created_at': now,
            'updated_at': now
        }

    def update_gear_set(self, session_uuid: str, gear_set_id: str, 
                        name: Optional[str] = None, 
                        slots_json: Optional[Dict[str, Any]] = None,
                        export_string: Optional[str] = None,
                        is_optimized: Optional[bool] = None) -> Optional[Dict[str, Any]]:
        """Update an existing gear set.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to update
            name: New name (optional)
            slots_json: New slot configuration (optional)
            export_string: New export string (optional)
            is_optimized: New is_optimized flag (optional)
            
        Returns:
            Updated gear set dictionary or None if not found
            
        Raises:
            ValueError: If new name conflicts with existing gear set
        """
        # Get existing gear set
        existing = self.get_gear_set(session_uuid, gear_set_id)
        if not existing:
            return None
        
        # Check for name conflict if name is being changed
        if name and name != existing['name']:
            conflict = self.get_gear_set_by_name(session_uuid, name)
            if conflict:
                raise ValueError(f"A gear set with name '{name}' already exists")
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Build update query
        updates = []
        params = []
        
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        
        if slots_json is not None:
            updates.append("slots_json = ?")
            params.append(json.dumps(_sanitize_for_json(slots_json)))
        
        if export_string is not None:
            updates.append("export_string = ?")
            params.append(export_string)
        
        if is_optimized is not None:
            updates.append("is_optimized = ?")
            params.append(1 if is_optimized else 0)
        
        updates.append("updated_at = ?")
        now = _utc_now()
        params.append(now)
        
        params.extend([gear_set_id, session_uuid])
        
        cursor.execute(f"""
            UPDATE gear_sets
            SET {', '.join(updates)}
            WHERE id = ? AND session_uuid = ?
        """, params)
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        # Return updated gear set
        return self.get_gear_set(session_uuid, gear_set_id)

    def set_gear_set_suggest_dismissed(self, session_uuid: str, gear_set_id: str, dismissed: int):
        """Set the suggest_dismissed flag for a gear set.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to update
            dismissed: 1 to dismiss, 0 to un-dismiss
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE gear_sets
            SET suggest_dismissed = ?
            WHERE id = ? AND session_uuid = ?
        """, (dismissed, gear_set_id, session_uuid))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def save_gear_set(self, session_uuid: str, name: str, slots_json: Dict[str, Any], 
                      gear_set_id: Optional[str] = None, is_optimized: bool = False, export_string: str = None) -> Dict[str, Any]:
        """Save or update a gear set (upsert operation).
        
        If gear_set_id is provided and exists, updates that gear set.
        If name matches an existing gear set, updates that gear set.
        Otherwise, creates a new gear set.
        
        Args:
            session_uuid: Session UUID
            name: Gear set name
            slots_json: Dictionary of slot configurations
            gear_set_id: Optional gear set ID for updates
            is_optimized: Whether this gearset was generated by optimization
            
        Returns:
            Saved gear set dictionary
        """
        # If ID provided, try to update by ID
        if gear_set_id:
            existing = self.get_gear_set(session_uuid, gear_set_id)
            if existing:
                return self.update_gear_set(session_uuid, gear_set_id, name=name, slots_json=slots_json)
        
        # Check if name exists
        existing_by_name = self.get_gear_set_by_name(session_uuid, name)
        if existing_by_name:
            return self.update_gear_set(session_uuid, existing_by_name['id'], slots_json=slots_json, export_string=export_string, is_optimized=is_optimized if is_optimized else None)
        
        # Create new
        return self.create_gear_set(session_uuid, name, slots_json, is_optimized=is_optimized, export_string=export_string)

    def delete_gear_set(self, session_uuid: str, gear_set_id: str) -> bool:
        """Delete a gear set.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to delete
            
        Returns:
            True if deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            DELETE FROM gear_sets
            WHERE id = ? AND session_uuid = ?
        """, (gear_set_id, session_uuid))
        
        deleted = cursor.rowcount > 0
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return deleted

    def bulk_delete_gear_sets(self, session_uuid: str, gear_set_ids: list) -> int:
        """Delete multiple gear sets in a single transaction.
        Only deletes gear sets belonging to the specified session.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_ids: List of gear set IDs to delete
            
        Returns:
            Count of deleted rows
        """
        if not gear_set_ids:
            return 0
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        placeholders = ','.join('?' for _ in gear_set_ids)
        params = [session_uuid] + list(gear_set_ids)
        
        cursor.execute(f"""
            DELETE FROM gear_sets
            WHERE session_uuid = ? AND id IN ({placeholders})
        """, params)
        
        deleted_count = cursor.rowcount
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return deleted_count

    # ========================================================================
    # TRAVEL CONFIG METHODS
    # ========================================================================

    def get_travel_config(self, session_uuid: str) -> Optional[Dict[str, Any]]:
        """Get the Travel_Config_Store for a session.

        Args:
            session_uuid: Session UUID

        Returns:
            Parsed config dict, or None if no config exists yet
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT config_json FROM travel_config WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()

        if not self._persistent_conn:
            conn.close()

        if row is None:
            return None
        return json.loads(row[0])

    def save_travel_config(self, session_uuid: str, config_json: Dict[str, Any]) -> None:
        """Upsert the Travel_Config_Store for a session.

        Args:
            session_uuid: Session UUID
            config_json: Full Travel_Config_Store dict to persist
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO travel_config (session_uuid, config_json, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(session_uuid) DO UPDATE SET
                config_json = excluded.config_json,
                updated_at  = excluded.updated_at
        """, (session_uuid, json.dumps(config_json)))

        conn.commit()

        if not self._persistent_conn:
            conn.close()

    def get_travel_gearsets(self, session_uuid: str) -> list:
        """Get all travel gearsets for a session (gear_sets rows with is_travel=1).

        Args:
            session_uuid: Session UUID

        Returns:
            List of dicts with id, name, export_string, travel_route_ids, travel_region
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, export_string, travel_route_ids, travel_region,
                   created_at, updated_at
            FROM gear_sets
            WHERE session_uuid = ? AND is_travel = 1
            ORDER BY updated_at DESC
        """, (session_uuid,))

        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        result = []
        for row in rows:
            result.append({
                'id': row[0],
                'name': row[1],
                'export_string': row[2],
                'travel_route_ids': json.loads(row[3]) if row[3] else [],
                'travel_region': row[4],
                'created_at': row[5],
                'updated_at': row[6],
            })
        return result

    # ========================================================================
    # ACTIVE OPTIMIZATION TRACKING (survives uvicorn reloads)
    # ========================================================================

    def start_optimization(self, session_uuid: str, opt_type: str, opt_id: str, pid: int = None):
        """Mark an optimization as active for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO active_optimizations (session_uuid, opt_type, opt_id, pid, started_at)
            VALUES (?, ?, ?, ?, ?)
        """, (session_uuid, opt_type, opt_id, pid, _utc_now()))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def finish_optimization(self, session_uuid: str, exit_code: int = 0):
        """Remove the active optimization record and log to history."""
        conn = self._get_connection()
        cursor = conn.cursor()
        # Read current record before deleting so we can compute duration
        cursor.execute(
            "SELECT opt_type, opt_id, started_at FROM active_optimizations WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if row:
            opt_type, opt_id, started_at = row
            duration_ms = None
            if started_at:
                try:
                    from datetime import datetime, timezone
                    if isinstance(started_at, str):
                        started = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                    else:
                        started = started_at
                    if started.tzinfo is None:
                        started = started.replace(tzinfo=timezone.utc)
                    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
                except Exception:
                    pass
            try:
                cursor.execute("""
                    INSERT INTO optimization_history (session_uuid, opt_type, opt_id, duration_ms, exit_code)
                    VALUES (?, ?, ?, ?, ?)
                """, (session_uuid, opt_type, opt_id, duration_ms, exit_code))
            except Exception:
                pass  # Don't fail if history table doesn't exist yet
        cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def has_optimized_gearset_since(self, session_uuid: str, since_iso: str) -> bool:
        """Check whether an optimized gearset has been saved (or updated) for
        this session at or after the given ISO-8601 UTC timestamp.

        Used by the SSE endpoint to verify that a 'done' wakeup corresponds
        to an actual save by THIS click's worker, not a stale signal from a
        previously-running watcher thread that was still alive when a new
        optimization started.

        Compares both `created_at` and `updated_at` so that re-saved
        (named-collision overwrite) gearsets count as fresh — `save_gear_set`
        upserts by name and only `updated_at` advances on collision.

        Args:
            session_uuid: Session UUID
            since_iso: ISO-8601 UTC timestamp string from `_utc_now()`
                (format: 'YYYY-MM-DDTHH:MM:SS.fffZ'). Compared as a string;
                the format is monotonic so lexical compare is correct.

        Returns:
            True if any optimized gearset for this session has
            created_at >= since_iso OR updated_at >= since_iso.
        """
        if not since_iso:
            return False
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 1 FROM gear_sets
            WHERE session_uuid = ?
              AND is_optimized = 1
              AND (created_at >= ? OR updated_at >= ?)
            LIMIT 1
            """,
            (session_uuid, since_iso, since_iso),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row is not None

    def get_active_optimization_started_at(self, session_uuid: str) -> Optional[str]:
        """Return the started_at ISO timestamp for the session's active
        optimization, or None if no optimization is currently active.

        Used by the SSE endpoint to anchor the "save freshness" check at the
        moment THIS click was registered (POST endpoint pre-creates the row
        before the background task spawns the worker), so any existing
        gearsets from prior optimizations are excluded from the check.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT started_at FROM active_optimizations WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return row[0] if row[0] else None

    def is_optimization_active(self, session_uuid: str) -> bool:
        """Check if an optimization is currently running for a session.
        
        Also cleans up stale entries where the process is no longer running.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT pid, started_at FROM active_optimizations WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False

        pid, started_at = row

        # Check if the process is still alive
        if pid:
            import os
            import signal
            try:
                os.kill(pid, 0)  # Signal 0 = check existence, don't kill
            except OSError:
                # Process is dead — clean up stale record
                cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return False

        # Also clean up if started more than 3 minutes ago (safety net)
        from datetime import datetime, timezone
        try:
            if isinstance(started_at, str):
                started = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
            else:
                started = started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - started).total_seconds()
            if age > 180:  # 3 minutes
                cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return False
        except Exception:
            pass  # If we can't parse the timestamp, assume it's still running

        if not self._persistent_conn:
            conn.close()
        return True

    def cleanup_stale_optimizations(self):
        """Remove all stale optimization records (dead processes or too old)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT session_uuid, pid FROM active_optimizations")
        rows = cursor.fetchall()
        for session_uuid, pid in rows:
            if pid:
                import os
                try:
                    os.kill(pid, 0)
                except OSError:
                    cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
        # Also clean up anything older than 3 minutes
        cursor.execute("""
            DELETE FROM active_optimizations 
            WHERE started_at < datetime('now', '-3 minutes')
        """)
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    # ========================================================================
    # OPTIMIZATION PRESET CRUD METHODS
    # ========================================================================

    def get_optimization_presets(self, session_uuid: str, preset_type: str) -> list:
        """Get all optimization presets for a session and type.
        
        Args:
            session_uuid: Session UUID
            preset_type: 'activity' or 'recipe'
            
        Returns:
            List of preset dictionaries
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at
            FROM optimization_presets
            WHERE session_uuid = ? AND preset_type = ?
            ORDER BY updated_at DESC
        """, (session_uuid, preset_type))
        
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        
        return [{
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'preset_type': row[3],
            'sorting': json.loads(row[4]) if row[4] else [],
            'include_consumables': bool(row[5]),
            'created_at': row[6],
            'updated_at': row[7]
        } for row in rows]

    def save_optimization_preset(self, session_uuid: str, name: str, preset_type: str,
                                  sorting: list, include_consumables: bool = False,
                                  preset_id: str = None) -> dict:
        """Save or update an optimization preset (upsert by name+type).
        
        Args:
            session_uuid: Session UUID
            name: Preset name
            preset_type: 'activity' or 'recipe'
            sorting: List of [metric_key, weight] tuples
            include_consumables: Whether to include consumables
            preset_id: Optional preset ID for updates
            
        Returns:
            Saved preset dictionary
            
        Raises:
            ValueError: If name conflicts
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        sorting_json = json.dumps(sorting)
        
        # If ID provided, update by ID
        if preset_id:
            cursor.execute("""
                SELECT id FROM optimization_presets WHERE id = ? AND session_uuid = ?
            """, (preset_id, session_uuid))
            if cursor.fetchone():
                # Check name conflict with other presets
                cursor.execute("""
                    SELECT id FROM optimization_presets
                    WHERE session_uuid = ? AND name = ? AND preset_type = ? AND id != ?
                """, (session_uuid, name, preset_type, preset_id))
                if cursor.fetchone():
                    if not self._persistent_conn:
                        conn.close()
                    raise ValueError(f"A preset with name '{name}' already exists")
                
                cursor.execute("""
                    UPDATE optimization_presets
                    SET name = ?, sorting_json = ?, include_consumables = ?, updated_at = ?
                    WHERE id = ? AND session_uuid = ?
                """, (name, sorting_json, 1 if include_consumables else 0, now, preset_id, session_uuid))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return self._get_preset_by_id(session_uuid, preset_id)
        
        # Check for existing by name+type
        cursor.execute("""
            SELECT id FROM optimization_presets
            WHERE session_uuid = ? AND name = ? AND preset_type = ?
        """, (session_uuid, name, preset_type))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing
            cursor.execute("""
                UPDATE optimization_presets
                SET sorting_json = ?, include_consumables = ?, updated_at = ?
                WHERE id = ? AND session_uuid = ?
            """, (sorting_json, 1 if include_consumables else 0, now, existing[0], session_uuid))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return self._get_preset_by_id(session_uuid, existing[0])
        
        # Create new
        new_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO optimization_presets (id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, preset_type, sorting_json, 1 if include_consumables else 0, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return self._get_preset_by_id(session_uuid, new_id)

    def _get_preset_by_id(self, session_uuid: str, preset_id: str) -> dict:
        """Get a single preset by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at
            FROM optimization_presets
            WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'id': row[0], 'session_uuid': row[1], 'name': row[2], 'preset_type': row[3],
            'sorting': json.loads(row[4]) if row[4] else [], 'include_consumables': bool(row[5]),
            'created_at': row[6], 'updated_at': row[7]
        }

    def delete_optimization_preset(self, session_uuid: str, preset_id: str) -> bool:
        """Delete an optimization preset.
        
        Returns:
            True if deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM optimization_presets WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # PINNED SAVES CRUD METHODS
    # ========================================================================

    def get_pinned_saves(self, session_uuid: str) -> list:
        """Get all pinned-save presets for a session, newest first.

        Args:
            session_uuid: Session UUID

        Returns:
            List of preset dictionaries, ordered by updated_at DESC.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, pin_paths_json, created_at, updated_at
            FROM pinned_saves
            WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'pin_paths': json.loads(row[3]) if row[3] else [],
            'created_at': row[4],
            'updated_at': row[5],
        } for row in rows]

    def save_pinned_save(self, session_uuid: str, name: str, pin_paths: list,
                         preset_id: str = None) -> dict:
        """Create or update a pinned-save preset.

        Upsert semantics mirror save_optimization_preset:
          1. If preset_id is provided AND owned by this session: update it.
             Reject on name clash with a different preset.
          2. Else if a preset with the same name already exists in this session:
             update that one in place.
          3. Else: insert a new row.

        Args:
            session_uuid: Session UUID.
            name: Preset name (1..60 chars after trim).
            pin_paths: JSON-serializable list of Pin Path descriptors.
            preset_id: Optional preset ID for targeted updates.

        Returns:
            The saved preset dictionary.

        Raises:
            ValueError: If name is empty, too long, pin_paths is not a list,
                        or a rename would collide with another preset's name.
        """
        name = (name or '').strip()
        if not name:
            raise ValueError('Preset name cannot be empty')
        if len(name) > 60:
            raise ValueError('Preset name must be at most 60 characters')
        if not isinstance(pin_paths, list):
            raise ValueError('pin_paths must be a list')

        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        pin_paths_json = json.dumps(pin_paths)

        # Path 1: targeted update by id.
        if preset_id:
            cursor.execute(
                "SELECT id FROM pinned_saves WHERE id = ? AND session_uuid = ?",
                (preset_id, session_uuid),
            )
            if cursor.fetchone():
                cursor.execute(
                    """SELECT id FROM pinned_saves
                       WHERE session_uuid = ? AND name = ? AND id != ?""",
                    (session_uuid, name, preset_id),
                )
                if cursor.fetchone():
                    if not self._persistent_conn:
                        conn.close()
                    raise ValueError(f'A preset named "{name}" already exists')
                cursor.execute(
                    """UPDATE pinned_saves
                       SET name = ?, pin_paths_json = ?, updated_at = ?
                       WHERE id = ? AND session_uuid = ?""",
                    (name, pin_paths_json, now, preset_id, session_uuid),
                )
                conn.commit()
                result = self.get_pinned_save_by_id(session_uuid, preset_id)
                if not self._persistent_conn:
                    conn.close()
                return result

        # Path 2: upsert by (session_uuid, name).
        cursor.execute(
            "SELECT id FROM pinned_saves WHERE session_uuid = ? AND name = ?",
            (session_uuid, name),
        )
        existing = cursor.fetchone()
        if existing:
            eid = existing[0]
            cursor.execute(
                """UPDATE pinned_saves
                   SET pin_paths_json = ?, updated_at = ?
                   WHERE id = ? AND session_uuid = ?""",
                (pin_paths_json, now, eid, session_uuid),
            )
            conn.commit()
            result = self.get_pinned_save_by_id(session_uuid, eid)
            if not self._persistent_conn:
                conn.close()
            return result

        # Path 3: insert new.
        new_id = str(uuid.uuid4())
        cursor.execute(
            """INSERT INTO pinned_saves
               (id, session_uuid, name, pin_paths_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (new_id, session_uuid, name, pin_paths_json, now, now),
        )
        conn.commit()
        result = self.get_pinned_save_by_id(session_uuid, new_id)
        if not self._persistent_conn:
            conn.close()
        return result

    def get_pinned_save_by_id(self, session_uuid: str, preset_id: str) -> dict:
        """Get a single pinned-save preset by id.

        Returns None if the preset does not exist or belongs to a different session.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, session_uuid, name, pin_paths_json, created_at, updated_at
               FROM pinned_saves WHERE id = ? AND session_uuid = ?""",
            (preset_id, session_uuid),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'pin_paths': json.loads(row[3]) if row[3] else [],
            'created_at': row[4],
            'updated_at': row[5],
        }

    def delete_pinned_save(self, session_uuid: str, preset_id: str) -> bool:
        """Delete a pinned-save preset.

        Returns:
            True if a row was deleted, False if no matching preset was found.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM pinned_saves WHERE id = ? AND session_uuid = ?",
            (preset_id, session_uuid),
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # COLOR THEME PRESET CRUD METHODS
    # ========================================================================

    def get_color_theme_presets(self, session_uuid: str) -> list:
        """Get all color theme presets for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, line_colors, custom_colors, created_at, updated_at
            FROM color_theme_presets
            WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{
            'id': row[0], 'name': row[1],
            'lineColors': row[2],
            'customColors': json.loads(row[3]) if row[3] else None,
            'created_at': row[4], 'updated_at': row[5],
        } for row in rows]

    def save_color_theme_preset(self, session_uuid: str, name: str,
                                 line_colors: str, custom_colors,
                                 preset_id: str = None) -> dict:
        """Save or update a color theme preset (upsert by name or id)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        custom_json = json.dumps(custom_colors) if custom_colors else None

        if preset_id:
            cursor.execute("""
                SELECT id FROM color_theme_presets WHERE id = ? AND session_uuid = ?
            """, (preset_id, session_uuid))
            if cursor.fetchone():
                cursor.execute("""
                    UPDATE color_theme_presets
                    SET name = ?, line_colors = ?, custom_colors = ?, updated_at = ?
                    WHERE id = ? AND session_uuid = ?
                """, (name, line_colors, custom_json, now, preset_id, session_uuid))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return self._get_color_preset_by_id(session_uuid, preset_id)

        # Upsert by name
        cursor.execute("""
            SELECT id FROM color_theme_presets WHERE session_uuid = ? AND name = ?
        """, (session_uuid, name))
        existing = cursor.fetchone()
        if existing:
            cursor.execute("""
                UPDATE color_theme_presets
                SET line_colors = ?, custom_colors = ?, updated_at = ?
                WHERE id = ? AND session_uuid = ?
            """, (line_colors, custom_json, now, existing[0], session_uuid))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return self._get_color_preset_by_id(session_uuid, existing[0])

        new_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO color_theme_presets (id, session_uuid, name, line_colors, custom_colors, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, line_colors, custom_json, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return self._get_color_preset_by_id(session_uuid, new_id)

    def _get_color_preset_by_id(self, session_uuid: str, preset_id: str) -> dict:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, line_colors, custom_colors, created_at, updated_at
            FROM color_theme_presets WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'id': row[0], 'name': row[1],
            'lineColors': row[2],
            'customColors': json.loads(row[3]) if row[3] else None,
            'created_at': row[4], 'updated_at': row[5],
        }

    def delete_color_theme_preset(self, session_uuid: str, preset_id: str) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM color_theme_presets WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # BUG REPORT CRUD METHODS
    # ========================================================================

    def record_local_speed_benchmark(self, session_uuid, count, run_ms=None,
                                     boot_ms=None, faster=None, threshold=None,
                                     user_agent=None, source=None):
        """Append a local-speed benchmark sample. Best-effort; never raises.

        Defensively creates the table if a running DB predates it.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_speed_benchmarks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_uuid TEXT,
                    count INTEGER NOT NULL,
                    run_ms REAL,
                    boot_ms REAL,
                    faster BOOLEAN,
                    threshold INTEGER,
                    user_agent TEXT,
                    source TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                INSERT INTO local_speed_benchmarks
                    (session_uuid, count, run_ms, boot_ms, faster, threshold, user_agent, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_uuid, int(count), run_ms, boot_ms,
                1 if faster else 0, threshold, user_agent, source, _utc_now()
            ))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return True
        except Exception:
            return False

    def create_bug_report(self, original_session_uuid: str, snapshot_session_uuid: str,
                          description: str, app_version: str, browser_info: str,
                          screenshots_json: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a new bug report.
        
        Args:
            original_session_uuid: Original session UUID
            snapshot_session_uuid: Snapshot session UUID (frozen state)
            description: User's description of the issue
            app_version: Application version
            browser_info: Browser information
            screenshots_json: Dictionary of tab -> base64 screenshot data
            
        Returns:
            Created bug report dictionary
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        report_id = str(uuid.uuid4())
        now = _utc_now()
        
        cursor.execute("""
            INSERT INTO bug_reports (
                id, original_session_uuid, snapshot_session_uuid, description,
                app_version, browser_info, timestamp, screenshots_json, reviewed
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (
            report_id, original_session_uuid, snapshot_session_uuid, description,
            app_version, browser_info, now, 
            json.dumps(screenshots_json) if screenshots_json else None
        ))
        
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return {
            'id': report_id,
            'original_session_uuid': original_session_uuid,
            'snapshot_session_uuid': snapshot_session_uuid,
            'description': description,
            'app_version': app_version,
            'browser_info': browser_info,
            'timestamp': now,
            'screenshots_json': screenshots_json,
            'reviewed': False,
            'reviewed_at': None,
            'reviewed_by': None,
            'notes': None
        }

    def get_bug_reports(self, reviewed: Optional[bool] = None) -> list:
        """Get all bug reports, optionally filtered by reviewed status.
        
        Args:
            reviewed: If True, only reviewed reports. If False, only unreviewed. If None, all reports.
            
        Returns:
            List of bug report dictionaries
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        if reviewed is None:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid, description,
                       app_version, browser_info, timestamp, screenshots_json,
                       reviewed, reviewed_at, reviewed_by, notes
                FROM bug_reports
                ORDER BY timestamp DESC
            """)
        else:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid, description,
                       app_version, browser_info, timestamp, screenshots_json,
                       reviewed, reviewed_at, reviewed_by, notes
                FROM bug_reports
                WHERE reviewed = ?
                ORDER BY timestamp DESC
            """, (1 if reviewed else 0,))
        
        rows = cursor.fetchall()
        
        if not self._persistent_conn:
            conn.close()
        
        reports = []
        for row in rows:
            reports.append({
                'id': row[0],
                'original_session_uuid': row[1],
                'snapshot_session_uuid': row[2],
                'description': row[3],
                'app_version': row[4],
                'browser_info': row[5],
                'timestamp': row[6],
                'screenshots_json': json.loads(row[7]) if row[7] else None,
                'reviewed': bool(row[8]),
                'reviewed_at': row[9],
                'reviewed_by': row[10],
                'notes': row[11]
            })
        
        return reports

    def get_bug_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific bug report by ID.
        
        Args:
            report_id: Bug report ID
            
        Returns:
            Bug report dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, original_session_uuid, snapshot_session_uuid, description,
                   app_version, browser_info, timestamp, screenshots_json,
                   reviewed, reviewed_at, reviewed_by, notes, server_logs
            FROM bug_reports
            WHERE id = ?
        """, (report_id,))
        
        row = cursor.fetchone()
        
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'id': row[0],
            'original_session_uuid': row[1],
            'snapshot_session_uuid': row[2],
            'description': row[3],
            'app_version': row[4],
            'browser_info': row[5],
            'timestamp': row[6],
            'screenshots_json': json.loads(row[7]) if row[7] else None,
            'reviewed': bool(row[8]),
            'reviewed_at': row[9],
            'reviewed_by': row[10],
            'notes': row[11],
            'server_logs': row[12]
        }

    def mark_report_reviewed(self, report_id: str, reviewed_by: str, notes: Optional[str] = None) -> bool:
        """Mark a bug report as reviewed.
        
        Args:
            report_id: Bug report ID
            reviewed_by: Name/identifier of reviewer
            notes: Optional review notes
            
        Returns:
            True if updated, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE bug_reports
            SET reviewed = 1, reviewed_at = ?, reviewed_by = ?, notes = ?,
                screenshots_json = NULL, server_logs = NULL
            WHERE id = ?
        """, (_utc_now(), reviewed_by, notes, report_id))
        
        updated = cursor.rowcount > 0
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return updated

    # ------------------------------------------------------------------
    # Bug report notes (ticket-style append-only comment chain)
    # ------------------------------------------------------------------

    def add_bug_report_note(
        self,
        report_id: str,
        author: str,
        content: str,
        thread_title: Optional[str] = None,
        parent_note_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Append a note (or threaded reply) to a bug report.

        Args:
            report_id: Bug report ID the note belongs to.
            author: Self-reported author string (e.g. 'meshclaw', 'jwbail').
            content: Markdown body of the note. Required, non-empty.
            thread_title: Optional short label so an agent can identify its
                own thread on a later visit. Replies inherit nothing
                automatically — pass it again if you want it on the reply.
            parent_note_id: If set, this note is a reply to that note.
                Must reference a note on the same report.

        Returns:
            The inserted note dict, or None if the report does not exist
            or the parent note is invalid.
        """
        if not content or not content.strip():
            return None
        if not author or not author.strip():
            return None
        conn = self._get_connection()
        cursor = conn.cursor()

        # Verify the report exists.
        cursor.execute("SELECT 1 FROM bug_reports WHERE id = ?", (report_id,))
        if not cursor.fetchone():
            if not self._persistent_conn:
                conn.close()
            return None

        # If a parent is provided, it must belong to the same report.
        if parent_note_id is not None:
            cursor.execute(
                "SELECT report_id FROM bug_report_notes WHERE id = ?",
                (parent_note_id,),
            )
            row = cursor.fetchone()
            if not row or row[0] != report_id:
                if not self._persistent_conn:
                    conn.close()
                return None

        now = _utc_now()
        cursor.execute(
            """
            INSERT INTO bug_report_notes
                (report_id, parent_note_id, author, thread_title, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (report_id, parent_note_id, author.strip(), (thread_title or None), content, now),
        )
        note_id = cursor.lastrowid
        conn.commit()

        if not self._persistent_conn:
            conn.close()

        return {
            'id': note_id,
            'report_id': report_id,
            'parent_note_id': parent_note_id,
            'author': author.strip(),
            'thread_title': thread_title or None,
            'content': content,
            'created_at': now,
        }

    def get_bug_report_notes(self, report_id: str) -> List[Dict[str, Any]]:
        """Return all notes for a bug report ordered chronologically (oldest first).

        Tree shape is up to the caller — this returns a flat list with
        parent_note_id so the UI can render replies under their parent.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, report_id, parent_note_id, author, thread_title, content, created_at
            FROM bug_report_notes
            WHERE report_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (report_id,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'id': r[0],
                'report_id': r[1],
                'parent_note_id': r[2],
                'author': r[3],
                'thread_title': r[4],
                'content': r[5],
                'created_at': r[6],
            }
            for r in rows
        ]

    def get_bug_report_note_counts(self, report_ids: List[str]) -> Dict[str, int]:
        """Batch-fetch note counts for many bug reports in a single query.

        Powers the unread-comment badge on the admin list view: the client
        compares this count to a localStorage-stored "last seen on detail
        page" count and shows the diff as a red badge.

        Returns a dict mapping report_id -> count. Reports with no notes
        are NOT in the dict (caller can default to 0).
        """
        if not report_ids:
            return {}
        conn = self._get_connection()
        cursor = conn.cursor()
        placeholders = ','.join('?' * len(report_ids))
        cursor.execute(
            f"""
            SELECT report_id, COUNT(*)
            FROM bug_report_notes
            WHERE report_id IN ({placeholders})
            GROUP BY report_id
            """,
            list(report_ids),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return {r[0]: r[1] for r in rows}

    def delete_session(self, session_uuid: str) -> bool:
        """Delete a session and all associated data (gear_sets, debug_sessions, etc).
        
        Args:
            session_uuid: Session UUID to delete
            
        Returns:
            True if session was deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Delete associated gear sets
        cursor.execute("DELETE FROM gear_sets WHERE session_uuid = ?", (session_uuid,))
        
        # Delete associated debug session entry if exists
        cursor.execute("DELETE FROM debug_sessions WHERE session_uuid = ?", (session_uuid,))
        
        # Delete associated broadcast dismissals
        cursor.execute("DELETE FROM broadcast_dismissals WHERE session_uuid = ?", (session_uuid,))
        
        # Delete associated stats report data (added 2026-05-22 with stale-detection feature)
        # Note: codebase doesn't use PRAGMA foreign_keys = ON, so FK CASCADE doesn't fire.
        # Explicit cleanup is required.
        self._reset_stats_report_data_with_cursor(cursor, session_uuid)

        # Clear active_debug_links row if this session was either side of a link.
        # When a bug-report is reviewed, the snapshot session is deleted via this
        # method — auto-clearing the link removes the swap-session nav button on
        # next main-site reload (per spec: "When the bug report is resolved
        # (snapshot is deleted), the button no longer appears on my main session").
        cursor.execute(
            "DELETE FROM active_debug_links "
            "WHERE main_session_uuid = ? OR snapshot_session_uuid = ?",
            (session_uuid, session_uuid),
        )

        # Delete the session itself
        cursor.execute("DELETE FROM sessions WHERE uuid = ?", (session_uuid,))
        deleted = cursor.rowcount > 0
        
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return deleted

    def _reset_stats_report_data_with_cursor(self, cursor, session_uuid: str) -> dict:
        """Internal: wipe all stats_report_* rows for a session using an existing cursor.
        
        Caller is responsible for commit + connection lifecycle. Used by both
        delete_session (full session deletion) and reset_stats_report_data
        (debug reset that preserves the session row).
        
        Returns counts of deleted rows per table for logging.
        """
        counts = {}
        for tbl in (
            'stats_report_results',
            'stats_report_gearsets',
            'stats_report_stale_scopes',
            'character_state_snapshot_cache',
            'stats_report_runs',
        ):
            cursor.execute(f"DELETE FROM {tbl} WHERE session_uuid = ?", (session_uuid,))
            counts[tbl] = cursor.rowcount
        return counts

    # ------------------------------------------------------------------
    # Active Debug Links (admin-managed bug-report snapshot ↔ main session)
    # ------------------------------------------------------------------
    def get_active_debug_link(self, main_session_uuid: str) -> Optional[Dict[str, Any]]:
        """Return the active debug link for a given main session, or None.

        Validates that the linked snapshot session still exists in `sessions`;
        if the snapshot row is gone (e.g. the bug-report was reviewed and its
        snapshot got hard-deleted between requests), the orphan link row is
        cleaned up here as a defensive belt-and-suspenders, and None returned.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT main_session_uuid, snapshot_session_uuid, bug_report_id, linked_at "
                "FROM active_debug_links WHERE main_session_uuid = ?",
                (main_session_uuid,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            link = dict(row) if hasattr(row, 'keys') else {
                'main_session_uuid': row[0],
                'snapshot_session_uuid': row[1],
                'bug_report_id': row[2],
                'linked_at': row[3],
            }
            # Defensive: if the snapshot session was deleted out from under us,
            # treat the link as gone and clean up.
            cursor.execute(
                "SELECT 1 FROM sessions WHERE uuid = ?",
                (link['snapshot_session_uuid'],),
            )
            if cursor.fetchone() is None:
                cursor.execute(
                    "DELETE FROM active_debug_links WHERE main_session_uuid = ?",
                    (main_session_uuid,),
                )
                conn.commit()
                return None
            return link
        finally:
            if not self._persistent_conn:
                conn.close()

    def set_active_debug_link(
        self,
        main_session_uuid: str,
        snapshot_session_uuid: str,
        bug_report_id: Optional[str] = None,
    ) -> None:
        """Create or replace the active debug link for a main session.

        Per spec: single active link at a time — POST replaces any existing
        row for the same main_session_uuid via INSERT OR REPLACE.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT OR REPLACE INTO active_debug_links "
                "(main_session_uuid, snapshot_session_uuid, bug_report_id, linked_at) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (main_session_uuid, snapshot_session_uuid, bug_report_id),
            )
            conn.commit()
        finally:
            if not self._persistent_conn:
                conn.close()

    def clear_active_debug_link(self, main_session_uuid: str) -> bool:
        """Delete the active debug link for a main session. Returns True if a row was removed."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM active_debug_links WHERE main_session_uuid = ?",
                (main_session_uuid,),
            )
            removed = cursor.rowcount > 0
            conn.commit()
            return removed
        finally:
            if not self._persistent_conn:
                conn.close()

    def is_bug_report_snapshot_session(self, session_uuid: str) -> bool:
        """Return True if session_uuid is the snapshot_session_uuid of any bug report.

        Used by the main-site nav to decide whether to show the green "swap
        back to main session" button. It shows on every bug-report snapshot
        session (so the admin is never stranded after delinking) and never on
        normal sessions. Independent of the active_debug_links table — a
        snapshot is identified by being referenced from bug_reports, not by
        being currently linked.
        """
        if not session_uuid:
            return False
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT 1 FROM bug_reports WHERE snapshot_session_uuid = ? LIMIT 1",
                (session_uuid,),
            )
            return cursor.fetchone() is not None
        finally:
            if not self._persistent_conn:
                conn.close()

    def reset_stats_report_data(self, session_uuid: str) -> dict:
        """Debug reset: wipe ALL stats_report_* rows for a session.
        
        Marks any running runs as failed first (so the worker subprocess
        will exit cleanly on its next progress write), then deletes:
        - stats_report_results (all category/subcategory rows)
        - stats_report_stale_scopes (cached stale-detector output)
        - character_state_snapshot_cache (prev-snapshot for diff)
        - stats_report_runs (run metadata, including the running one)
        
        The session row itself and all character data are untouched.
        
        Returns counts dict for logging.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Mark any running runs as failed first. This is mostly a courtesy
        # — we're about to delete all run rows anyway — but if the worker
        # subprocess is still alive it'll see status=failed on its next
        # progress write and exit. Defends against the worker re-creating
        # rows we just deleted, since stats_report_results has no FK to
        # the run.
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE session_uuid = ? AND status = 'running'
        """, (now, session_uuid))
        running_killed = cursor.rowcount
        
        counts = self._reset_stats_report_data_with_cursor(cursor, session_uuid)
        counts['running_runs_killed'] = running_killed
        
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    # Categories that own per-scope rows in the three category-scoped
    # stats_report tables. Used to validate a per-category reset request.
    STATS_REPORT_CATEGORIES = ('xp', 'new_items', 'chests', 'chests_recipes', 'coins', 'target_items')

    def reset_stats_report_category(self, session_uuid: str, category: str) -> dict:
        """Reset the saved goals-report data for a SINGLE category.

        Unlike reset_stats_report_data (which wipes every stats_report_*
        table for the session), this deletes only the rows belonging to
        one category from the three category-scoped tables:
        - stats_report_results        (the stored per-scope result rows)
        - stats_report_gearsets       (the stored gearsets for those rows)
        - stats_report_stale_scopes   (cached stale-detector output)

        It deliberately does NOT touch:
        - character_state_snapshot_cache: a session-level single blob the
          stale-detector diffs against for EVERY category. Wiping it would
          make all other categories look newly-changed on the next run.
        - stats_report_runs: a run spans multiple categories, so deleting
          run rows would disrupt unrelated categories from the same run.

        After this, the category has no stored results, so re-running just
        that category recomputes it fresh while every other category's
        cached results stay intact.

        Use case: one category's stored server result is stale/blank (the
        server cache diverged from a correct local recompute) and the user
        wants to clear ONLY that category without paying the cost of a full
        Emergency reset across everything.

        Returns a counts dict (rows deleted per table) for logging.
        Raises ValueError for an unknown category.
        """
        if category not in self.STATS_REPORT_CATEGORIES:
            raise ValueError(f'unknown stats_report category: {category!r}')
        conn = self._get_connection()
        cursor = conn.cursor()
        counts = {}
        for tbl in (
            'stats_report_results',
            'stats_report_gearsets',
            'stats_report_stale_scopes',
        ):
            cursor.execute(
                f"DELETE FROM {tbl} WHERE session_uuid = ? AND category = ?",
                (session_uuid, category),
            )
            counts[tbl] = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    def reset_stats_report_subcategory(self, session_uuid: str, category: str,
                                       scopes) -> dict:
        """Reset saved goals-report data for one or more SUBcategories within a
        category — a single skill ("Mining"), a chest ("Mining chest"), a
        new_items kind, a target-item group ("ore"), or a single target item
        ("copper ore") inside a group.

        Finer-grained sibling of reset_stats_report_category: where that clears
        an entire top-level section, this clears only the rows belonging to the
        given subgroup(s), leaving every other subgroup's cached results (and
        every other category) intact. Re-running recomputes just the cleared
        subgroup(s) fresh.

        ``scopes`` is a list of ``{'subcategory': str, 'leaf': Optional[str]}``:
          - ``subcategory``: the normalized subcategory key, matching how the
            worker derives it — skill/kind lowercased; chest name lowercased
            with spaces -> underscores; target-item group_slug.
          - ``leaf``: for target_items, the item_slug to narrow to a single item
            within the group; omit/None to clear the whole group.

        Deletes matching rows from all three category-scoped tables so both the
        display (stats_report_gearsets) and the stale detector
        (stats_report_results / stats_report_stale_scopes) forget the subgroup:

          * stats_report_gearsets     — display source. Matched category-aware
            on the OVERLOADED columns: skill_name for xp/coins/new_items and the
            target_items group, chest_name for chests/chests_recipes and the
            target_items item leaf.
          * stats_report_results      — stale-detector store. Matched on
            (category, subcategory[, source_name=leaf]).
          * stats_report_stale_scopes — stale-detector cache. Same key.

        Does NOT touch character_state_snapshot_cache or stats_report_runs (a
        run/snapshot spans the whole session), mirroring
        reset_stats_report_category.

        Returns a per-table counts dict for logging. Raises ValueError for an
        unknown category.
        """
        if category not in self.STATS_REPORT_CATEGORIES:
            raise ValueError(f'unknown stats_report category: {category!r}')
        conn = self._get_connection()
        cursor = conn.cursor()
        counts = {
            'stats_report_results': 0,
            'stats_report_gearsets': 0,
            'stats_report_stale_scopes': 0,
        }
        for scope in (scopes or []):
            sub = str((scope or {}).get('subcategory') or '').strip().lower()
            if not sub:
                continue
            leaf = (scope or {}).get('leaf')
            leaf = leaf.strip().lower() if isinstance(leaf, str) and leaf.strip() else None

            # --- stale-detector store + cache: keyed (category, subcategory
            #     [, source_name=leaf]) ---
            res_where = "session_uuid = ? AND category = ? AND lower(subcategory) = ?"
            res_params = [session_uuid, category, sub]
            if leaf is not None:
                res_where += " AND lower(source_name) = ?"
                res_params.append(leaf)
            for tbl in ('stats_report_results', 'stats_report_stale_scopes'):
                cursor.execute(f"DELETE FROM {tbl} WHERE {res_where}", tuple(res_params))
                counts[tbl] += cursor.rowcount

            # --- display source (stats_report_gearsets): category-aware match
            #     on the overloaded skill_name / chest_name columns ---
            if category in ('chests', 'chests_recipes'):
                gs_where = ("session_uuid = ? AND category = ? "
                            "AND lower(replace(chest_name, ' ', '_')) = ?")
                gs_params = [session_uuid, category, sub]
            elif category == 'target_items':
                gs_where = "session_uuid = ? AND category = ? AND lower(skill_name) = ?"
                gs_params = [session_uuid, category, sub]
                if leaf is not None:
                    gs_where += " AND lower(chest_name) = ?"
                    gs_params.append(leaf)
            else:  # xp / coins / new_items -> subcategory lives in skill_name
                gs_where = "session_uuid = ? AND category = ? AND lower(skill_name) = ?"
                gs_params = [session_uuid, category, sub]
            cursor.execute(
                f"DELETE FROM stats_report_gearsets WHERE {gs_where}",
                tuple(gs_params),
            )
            counts['stats_report_gearsets'] += cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    def prune_orphaned_stats_report_scopes(self, session_uuid: str, applicable_keys) -> dict:
        """Delete stored goals-report rows whose scope is no longer in the
        character's current applicable-source set.

        This is the symmetric complement of the stale-detector's
        "newly_unlocked" pass (applicable-but-not-stored). Nothing previously
        handled the inverse — stored-but-not-applicable — so a stored row
        whose scope key drifted OUT of the applicable set lingered forever.
        Two ways that happens, both observed in bug report 29d4b8ce:
          * a game-data LOCATION RENAME (e.g. blackspell_port ->
            blackspell_harbour): the source is still optimizable, but under a
            new location slug, so the old-slug row is orphaned; and
          * a scope the enumerator deliberately stopped emitting (the
            Bird nest / Coin pouch / Gem pouch "container" chests, and
            one-time exploration activities like "Venture into the hideout").

        Such an orphan still carries its OLD optimization_version, so
        detect_stale_scopes flags it `version_bump` on every check, painting a
        permanent red (!) the incremental run can NEVER clear: the rebuilt job
        derives the CURRENT scope key (the new location), which never matches
        the orphan's stored key, so the orphan is neither overwritten
        (INSERT OR REPLACE keys on the new location) nor deleted. Before this
        method the only escape was a full Emergency reset.

        `applicable_keys` is the set of (category, subcategory, source_name,
        location, service) tuples from
        util.stats_report.applicable_sources.enumerate_applicable_sources for
        the CURRENT character state (the SAME source of truth the stale
        detector uses for newly_unlocked). Any stored row whose key is absent
        from it is pruned from both scope-keyed tables:
        stats_report_results and stats_report_stale_scopes.

        SAFETY:
          - No-op when applicable_keys is empty/None. An empty applicable set
            almost always means the enumerator failed (import mid-flight,
            transient error) rather than "the character can optimize nothing";
            pruning against it would wipe every stored row. We refuse to act
            on an empty set.
          - Biases toward NOT deleting: a prune miss just leaves a stale
            badge, whereas an over-eager prune churns a valid row. Both
            self-correct anyway — a pruned-but-still-valid scope reappears via
            newly_unlocked and re-runs on the next optimize — but we prefer the
            quieter failure. Callers additionally wrap this in try/except.
          - stats_report_gearsets is NOT scope-keyed (it keys on
            run_id/activity/chest/skill), so it is intentionally left alone:
            a gearset row with no matching result row is never surfaced
            (results-v2 drives display) and is swept by a full reset.

        Returns a counts dict for logging.
        """
        if not applicable_keys:
            return {'pruned_results': 0, 'pruned_stale_scopes': 0,
                    'skipped_empty_applicable': True}
        applicable = set(applicable_keys)
        conn = self._get_connection()
        cursor = conn.cursor()
        # 2026-08-14 (jwbail): EXCLUDE target_items from this generic prune.
        # enumerate_applicable_sources emits target_items keys with
        # location="NONE" (the old v2 one-scope-per-item scheme), but the v3
        # write path stores target_items rows with location=<activity_slug>
        # (one row per (item, activity)). Those keys can NEVER be in
        # `applicable`, so this prune deleted EVERY target_items row on every
        # Optimize start -- wiping the just-completed rows before the resume
        # filter could read them, so resume always rebuilt all 818 as "new"
        # and never subtracted (TI-RESUME-DIAG showed stored=0 on re-Optimize).
        # target_items has its OWN correct v3 reconciliation
        # (prune_orphaned_target_items_results, called inside
        # _filter_target_items_jobs_to_stale), so it must not be touched here.
        cursor.execute(
            "SELECT category, subcategory, source_name, location, service "
            "FROM stats_report_results WHERE session_uuid = ? "
            "AND category != 'target_items'",
            (session_uuid,),
        )
        orphan_keys = [
            (c, s, src, loc, svc)
            for (c, s, src, loc, svc) in cursor.fetchall()
            if (c, s, src, loc, svc) not in applicable
        ]
        if not orphan_keys:
            if not self._persistent_conn:
                conn.close()
            return {'pruned_results': 0, 'pruned_stale_scopes': 0}
        where = ("session_uuid = ? AND category = ? AND subcategory = ? "
                 "AND source_name = ? AND location = ? AND service = ?")
        pruned_results = pruned_stale = 0
        for (c, s, src, loc, svc) in orphan_keys:
            params = (session_uuid, c, s, src, loc, svc)
            cursor.execute(f"DELETE FROM stats_report_stale_scopes WHERE {where}", params)
            pruned_stale += cursor.rowcount
            cursor.execute(f"DELETE FROM stats_report_results WHERE {where}", params)
            pruned_results += cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {
            'pruned_results': pruned_results,
            'pruned_stale_scopes': pruned_stale,
            'orphan_sample': orphan_keys[:8],
        }

    def get_degenerate_result_scopes(self, session_uuid: str):
        """Return the set of (category, source_name) scopes whose stored
        goals-report result has a degenerate metric (metric_value <= 0).

        A stored metric of 0 (or negative) is never a valid optimization
        outcome for any goals-report category: you can't farm a chest in
        0 steps, an XP activity can't yield 0 XP/step, etc. Such a row is
        a stuck artifact from a past transient compute failure. Because
        detect_stale_scopes only flags scopes when the CHARACTER changed,
        these rows are otherwise never recomputed and get served forever
        (the only prior escape was a manual reset).

        The worker's stale-only filter unions these scopes into its
        recompute set so a normal run self-heals them. Matching is on the
        coarse (category, source_name) pair rather than the full
        (category, subcategory, source, location, service) key so a small
        drift in the worker's location/service key derivation can't cause
        the heal to silently miss (recomputing a couple extra rows for the
        same source is harmless; serving a wrong 0 forever is not).

        Returns a set of (category, source_name) tuples.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT category, source_name FROM stats_report_results "
            "WHERE session_uuid = ? AND metric_value <= 0",
            (session_uuid,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return {(r[0], r[1]) for r in rows}

    def get_degenerate_result_scope_details(self, session_uuid: str):
        """Full scope dicts for stored goals-report results whose metric is
        degenerate (metric_value <= 0).

        Like get_degenerate_result_scopes, but returns the full
        (category, subcategory, source_name, location, service) for each
        stuck 0-row so the stale-check endpoint can badge the exact WTO chip
        and list the source under "newly unlocked" in the popover. These rows
        are also unioned into the worker's recompute set, so flagging them
        stale tells the user a normal re-run will heal them.

        Returns a list of dicts.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT category, subcategory, source_name, location, service "
            "FROM stats_report_results "
            "WHERE session_uuid = ? AND metric_value <= 0",
            (session_uuid,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'category': r[0],
                'subcategory': r[1],
                'source_name': r[2],
                'location': r[3],
                'service': r[4],
            }
            for r in rows
        ]

    def copy_stats_report_data(self, src_uuid: str, dst_uuid: str) -> dict:
        """Copy goals-report (stats_report_*) state from src to dst session.

        Used by snapshot + bug-report creation so the captured session
        reproduces the goals report exactly (results, stale-badge state, and
        the prev-snapshot used for stale diffing). Copies the session-keyed
        tables only:
          - stats_report_results            (the per-scope result rows)
          - stats_report_stale_scopes       (the (!) stale-badge state)
          - character_state_snapshot_cache  (prev snapshot for stale diffing)
          - stats_report_runs               (run metadata -- REQUIRED: the
            /api/stats-report/status endpoint reads the latest run row to
            decide whether to render the copied results. Without it the
            endpoint returns status=None and the frontend never renders the
            results we copied, so the goals report is blank on the snapshot.
            See bug report 162b543e.)
          - stats_report_gearsets           (the optimized gearset per scope --
            REQUIRED: the goals report loads gear rows via
            get_stats_report_results_latest_per_scope(session_uuid), so without
            them the chests/xp/coins rows show no gearset on the snapshot even
            though the run + result rows were copied. See bug report 162b543e.)

        stats_report_runs and stats_report_gearsets both carry a GLOBAL id PK,
        so they get dedicated copies below (NOT the generic loop -- INSERT OR
        REPLACE on the same id would clobber the SOURCE session's own rows).
        gearsets are copied with a regenerated id and their run_id remapped
        onto the freshly-generated run ids.

        Generic per-table copy: reads the live column list and rewrites
        session_uuid to dst, so it stays correct as schemas evolve.
        Returns rows-copied-per-table for logging.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        counts = {}
        run_id_map = {}  # old run id -> new run id, for gearset run_id remap
        for tbl in (
            'stats_report_results',
            'stats_report_stale_scopes',
            'character_state_snapshot_cache',
        ):
            try:
                cols = [r[1] for r in cursor.execute(f"PRAGMA table_info({tbl})").fetchall()]
                if not cols or 'session_uuid' not in cols:
                    continue
                # SELECT each column by name, except session_uuid which becomes
                # the dst literal (parameterized).
                select_terms = ", ".join("?" if c == 'session_uuid' else c for c in cols)
                cursor.execute(
                    f"INSERT OR REPLACE INTO {tbl} ({', '.join(cols)}) "
                    f"SELECT {select_terms} FROM {tbl} WHERE session_uuid = ?",
                    (dst_uuid, src_uuid),
                )
                counts[tbl] = cursor.rowcount
            except Exception as e:
                counts[tbl] = f'error: {e}'
        # stats_report_runs needs a DEDICATED copy: `id` is a GLOBAL primary
        # key, so the generic loop above (which preserves id verbatim) would
        # hit a UNIQUE collision. Regenerate id per row and rewrite
        # session_uuid -> dst. Required so /api/stats-report/status reports the
        # run as complete and the frontend renders the copied results rows.
        try:
            import uuid as _uuid
            run_cols = [r[1] for r in cursor.execute(
                "PRAGMA table_info(stats_report_runs)").fetchall()]
            if run_cols and 'session_uuid' in run_cols and 'id' in run_cols:
                placeholders = ", ".join("?" for _ in run_cols)
                src_rows = cursor.execute(
                    f"SELECT {', '.join(run_cols)} FROM stats_report_runs "
                    f"WHERE session_uuid = ?",
                    (src_uuid,),
                ).fetchall()
                id_idx = run_cols.index('id')
                n = 0
                for row in src_rows:
                    new_id = str(_uuid.uuid4())
                    run_id_map[row[id_idx]] = new_id
                    vals = [
                        new_id if c == 'id'
                        else (dst_uuid if c == 'session_uuid' else v)
                        for c, v in zip(run_cols, row)
                    ]
                    cursor.execute(
                        f"INSERT OR REPLACE INTO stats_report_runs "
                        f"({', '.join(run_cols)}) VALUES ({placeholders})",
                        vals,
                    )
                    n += 1
                counts['stats_report_runs'] = n
        except Exception as e:
            counts['stats_report_runs'] = f'error: {e}'

        # stats_report_gearsets ALSO carries a global id PK (plus a run_id FK).
        # The goals report loads gear rows for a session via
        # get_stats_report_results_latest_per_scope(session_uuid), so a snapshot
        # with no gearsets shows empty gear rows for chests/xp/coins even after
        # the run + result rows were copied (bug report 162b543e). Regenerate id
        # (a verbatim copy would clobber the source row via INSERT OR REPLACE),
        # rewrite session_uuid, and remap run_id onto the new run ids above.
        try:
            import uuid as _uuid
            gs_cols = [r[1] for r in cursor.execute(
                "PRAGMA table_info(stats_report_gearsets)").fetchall()]
            if gs_cols and 'session_uuid' in gs_cols and 'id' in gs_cols:
                placeholders = ", ".join("?" for _ in gs_cols)
                src_rows = cursor.execute(
                    f"SELECT {', '.join(gs_cols)} FROM stats_report_gearsets "
                    f"WHERE session_uuid = ?",
                    (src_uuid,),
                ).fetchall()
                n = 0
                for row in src_rows:
                    rowd = dict(zip(gs_cols, row))
                    vals = []
                    for c in gs_cols:
                        if c == 'id':
                            vals.append(str(_uuid.uuid4()))
                        elif c == 'session_uuid':
                            vals.append(dst_uuid)
                        elif c == 'run_id':
                            vals.append(run_id_map.get(rowd['run_id'], rowd['run_id']))
                        else:
                            vals.append(rowd[c])
                    cursor.execute(
                        f"INSERT OR REPLACE INTO stats_report_gearsets "
                        f"({', '.join(gs_cols)}) VALUES ({placeholders})",
                        vals,
                    )
                    n += 1
                counts['stats_report_gearsets'] = n
        except Exception as e:
            counts['stats_report_gearsets'] = f'error: {e}'
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    def cleanup_reviewed_bug_report_sessions(self) -> int:
        """Delete snapshot sessions for all reviewed bug reports.
        
        Returns:
            Number of snapshot sessions deleted
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Get all snapshot session UUIDs from reviewed bug reports
        cursor.execute("""
            SELECT snapshot_session_uuid FROM bug_reports WHERE reviewed = 1
        """)
        rows = cursor.fetchall()
        
        if not self._persistent_conn:
            conn.close()
        
        deleted_count = 0
        for row in rows:
            if self.delete_session(row[0]):
                deleted_count += 1
        
        return deleted_count

    # ========================================================================
    # API ACCESS AUDIT METHODS
    # ========================================================================

    def log_api_access(self, session_uuid: str, endpoint: str, method: str,
                       user_agent: Optional[str] = None, ip_address: Optional[str] = None,
                       response_time_ms: Optional[float] = None, status_code: Optional[int] = None):
        """Log an API access event.

        Args:
            session_uuid: Session UUID making the request
            endpoint: API endpoint accessed (e.g., '/api/catalog', '/api/session')
            method: HTTP method (GET, POST, PUT, DELETE)
            user_agent: User agent string (optional)
            ip_address: IP address (optional)
            response_time_ms: Response time in milliseconds (optional)
            status_code: HTTP status code (optional)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO api_access_audit (session_uuid, endpoint, method, user_agent, ip_address, timestamp, response_time_ms, status_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_uuid, endpoint, method, user_agent, ip_address, _utc_now(), response_time_ms, status_code))

        conn.commit()

        if not self._persistent_conn:
            conn.close()

    def get_api_access_stats(self, days: int = 7) -> Dict[str, Any]:
        """Get API access statistics for the last N days.
        
        Args:
            days: Number of days to look back (default: 7)
            
        Returns:
            Dictionary with statistics:
            - total_requests: Total number of requests
            - unique_sessions: Number of unique sessions
            - requests_by_endpoint: Dict of endpoint -> count
            - requests_by_day: Dict of date -> count
            - top_sessions: List of (session_uuid, count) tuples
        """
        from datetime import timedelta
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Calculate cutoff date using timedelta
        cutoff = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff = cutoff - timedelta(days=days)
        cutoff_str = cutoff.isoformat()
        
        # Total requests
        cursor.execute("""
            SELECT COUNT(*) FROM api_access_audit
            WHERE timestamp >= ?
        """, (cutoff_str,))
        total_requests = cursor.fetchone()[0]
        
        # Unique sessions
        cursor.execute("""
            SELECT COUNT(DISTINCT session_uuid) FROM api_access_audit
            WHERE timestamp >= ?
        """, (cutoff_str,))
        unique_sessions = cursor.fetchone()[0]
        
        # Requests by endpoint
        cursor.execute("""
            SELECT endpoint, COUNT(*) as count
            FROM api_access_audit
            WHERE timestamp >= ?
            GROUP BY endpoint
            ORDER BY count DESC
        """, (cutoff_str,))
        requests_by_endpoint = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Requests by day
        cursor.execute("""
            SELECT DATE(timestamp) as day, COUNT(*) as count
            FROM api_access_audit
            WHERE timestamp >= ?
            GROUP BY day
            ORDER BY day DESC
        """, (cutoff_str,))
        requests_by_day = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Top sessions
        cursor.execute("""
            SELECT session_uuid, COUNT(*) as count
            FROM api_access_audit
            WHERE timestamp >= ?
            GROUP BY session_uuid
            ORDER BY count DESC
            LIMIT 10
        """, (cutoff_str,))
        top_sessions = [(row[0], row[1]) for row in cursor.fetchall()]
        
        if not self._persistent_conn:
            conn.close()
        
        return {
            'total_requests': total_requests,
            'unique_sessions': unique_sessions,
            'requests_by_endpoint': requests_by_endpoint,
            'requests_by_day': requests_by_day,
            'top_sessions': top_sessions
        }

    def get_session_api_access(self, session_uuid: str, limit: int = 100) -> list:
        """Get API access history for a specific session.
        
        Args:
            session_uuid: Session UUID to query
            limit: Maximum number of records to return (default: 100)
            
        Returns:
            List of access log dictionaries
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, endpoint, method, timestamp, user_agent, ip_address
            FROM api_access_audit
            WHERE session_uuid = ?
            ORDER BY timestamp DESC
            LIMIT ?
        """, (session_uuid, limit))
        
        rows = cursor.fetchall()
        
        if not self._persistent_conn:
            conn.close()
        
        logs = []
        for row in rows:
            logs.append({
                'id': row[0],
                'session_uuid': row[1],
                'endpoint': row[2],
                'method': row[3],
                'timestamp': row[4],
                'user_agent': row[5],
                'ip_address': row[6]
            })
        
        return logs
    def list_characters(self, search: str = None, limit: int = 20, offset: int = 0) -> tuple:
        """List sessions with character names and UUIDs.

        Args:
            search: Optional character name search term (LIKE %search%)
            limit: Max results per page
            offset: Pagination offset

        Returns:
            Tuple of (list of dicts with uuid/name/last_updated, total_count)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Build query — filter to sessions that have a character_config with a name
        base_where = "WHERE character_config IS NOT NULL AND json_extract(character_config, '$.name') IS NOT NULL"
        params = []

        if search:
            base_where += " AND (json_extract(character_config, '$.name') LIKE ? OR uuid LIKE ?)"
            params.append(f'%{search}%')
            params.append(f'%{search}%')

        # Get total count
        cursor.execute(f"SELECT COUNT(*) FROM sessions {base_where}", params)
        total = cursor.fetchone()[0]

        # Get page of results
        cursor.execute(f"""
            SELECT uuid, character_config, last_updated
            FROM sessions
            {base_where}
            ORDER BY last_updated DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset])

        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        results = []
        for row in rows:
            try:
                config = json.loads(row[1]) if row[1] else {}
            except (json.JSONDecodeError, TypeError):
                config = {}

            # Calculate character level from steps
            steps = config.get('steps', 0)
            char_level = self._character_level_from_steps(steps)

            # Get skill levels (convert XP to levels)
            skills_xp = config.get('skills', {})
            skill_levels = {}
            for skill_name, xp in skills_xp.items():
                skill_levels[skill_name] = self._xp_to_level(xp)

            results.append({
                'uuid': row[0],
                'name': config.get('name', 'Unknown'),
                'steps': steps,
                'last_updated': row[2],
                'character_level': char_level,
                'skill_levels': skill_levels,
                'reputation': config.get('reputation', {}),
                'achievement_points': config.get('achievement_points', 0),
                'coins': config.get('coins', 0),
            })

        return results, total

    def get_session_statistics(self) -> Dict[str, Any]:
        """Get aggregate session statistics in a single call.

        Returns:
            Dict with:
                total_sessions: int
                sessions_with_characters: int
                total_gear_sets: int
                total_bug_reports: int
                unreviewed_bug_reports: int
                active_24h: int
                active_7d: int
                top_5_recent: list of {uuid, name, steps, last_updated}
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Total sessions
        cursor.execute("SELECT COUNT(*) FROM sessions")
        total_sessions = cursor.fetchone()[0]

        # Sessions with characters (non-null character_config with a name)
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE character_config IS NOT NULL
              AND json_extract(character_config, '$.name') IS NOT NULL
        """)
        sessions_with_characters = cursor.fetchone()[0]

        # Total gear sets
        cursor.execute("SELECT COUNT(*) FROM gear_sets")
        total_gear_sets = cursor.fetchone()[0]

        # Total bug reports
        cursor.execute("SELECT COUNT(*) FROM bug_reports")
        total_bug_reports = cursor.fetchone()[0]

        # Unreviewed bug reports
        cursor.execute("SELECT COUNT(*) FROM bug_reports WHERE reviewed = 0")
        unreviewed_bug_reports = cursor.fetchone()[0]

        # Sessions active in last 24 hours
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE last_updated >= datetime('now', '-1 day')
        """)
        active_24h = cursor.fetchone()[0]

        # Sessions active in last 7 days
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE last_updated >= datetime('now', '-7 days')
        """)
        active_7d = cursor.fetchone()[0]

        # Top 5 most recently active sessions with character names
        cursor.execute("""
            SELECT uuid, character_config, last_updated
            FROM sessions
            ORDER BY last_updated DESC
            LIMIT 5
        """)
        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        top_5_recent = []
        for row in rows:
            try:
                config = json.loads(row[1]) if row[1] else {}
            except (json.JSONDecodeError, TypeError):
                config = {}

            top_5_recent.append({
                'uuid': row[0],
                'name': config.get('name', None),
                'steps': config.get('steps', 0),
                'last_updated': row[2],
            })

        return {
            'total_sessions': total_sessions,
            'sessions_with_characters': sessions_with_characters,
            'total_gear_sets': total_gear_sets,
            'total_bug_reports': total_bug_reports,
            'unreviewed_bug_reports': unreviewed_bug_reports,
            'active_24h': active_24h,
            'active_7d': active_7d,
            'top_5_recent': top_5_recent,
        }

    def get_active_sessions(self, hours: int = 24, limit: int = 10, offset: int = 0) -> tuple:
        """Get sessions active within the given time window.

        Args:
            hours: Number of hours to look back
            limit: Max results per page
            offset: Pagination offset

        Returns:
            Tuple of (list of {uuid, name, steps, last_updated}, total_count)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        time_filter = f"-{hours} hours"

        # Get total count of active sessions
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE last_updated >= datetime('now', ?)
        """, (time_filter,))
        total = cursor.fetchone()[0]

        # Get page of results
        cursor.execute("""
            SELECT uuid, character_config, last_updated
            FROM sessions
            WHERE last_updated >= datetime('now', ?)
            ORDER BY last_updated DESC
            LIMIT ? OFFSET ?
        """, (time_filter, limit, offset))

        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        results = []
        for row in rows:
            try:
                config = json.loads(row[1]) if row[1] else {}
            except (json.JSONDecodeError, TypeError):
                config = {}

            results.append({
                'uuid': row[0],
                'name': config.get('name', None),
                'steps': config.get('steps', 0),
                'last_updated': row[2],
            })

        return results, total

    # ========================================================================
    # DEBUG SESSION METHODS
    # ========================================================================

    def enable_debug_session(self, session_uuid: str, enabled_by: str) -> bool:
        """Enable debug mode for a session.

        Validates that the session exists before inserting.

        Args:
            session_uuid: UUID of the session to enable debug for
            enabled_by: Discord username who enabled it

        Returns:
            True if debug was enabled, False if session doesn't exist
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Validate session exists
        cursor.execute("SELECT uuid FROM sessions WHERE uuid = ?", (session_uuid,))
        if not cursor.fetchone():
            if not self._persistent_conn:
                conn.close()
            return False

        cursor.execute("""
            INSERT OR REPLACE INTO debug_sessions (session_uuid, enabled_at, enabled_by)
            VALUES (?, CURRENT_TIMESTAMP, ?)
        """, (session_uuid, enabled_by))
        conn.commit()

        if not self._persistent_conn:
            conn.close()
        return True

    def disable_debug_session(self, session_uuid: str) -> bool:
        """Disable debug mode for a session.

        Args:
            session_uuid: UUID of the session to disable debug for

        Returns:
            True if a record was deleted, False if none existed
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "DELETE FROM debug_sessions WHERE session_uuid = ?",
            (session_uuid,)
        )
        deleted = cursor.rowcount > 0
        conn.commit()

        if not self._persistent_conn:
            conn.close()
        return deleted

    def is_debug_enabled(self, session_uuid: str) -> bool:
        """Check if debug mode is enabled for a session.

        Args:
            session_uuid: UUID of the session to check

        Returns:
            True if debug is enabled, False otherwise
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT 1 FROM debug_sessions WHERE session_uuid = ?",
            (session_uuid,)
        )
        result = cursor.fetchone() is not None

        if not self._persistent_conn:
            conn.close()
        return result

    def list_debug_sessions(self) -> list:
        """List all sessions with debug mode enabled.

        Returns:
            List of dicts with session_uuid, enabled_at, enabled_by
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT session_uuid, enabled_at, enabled_by
            FROM debug_sessions
            ORDER BY enabled_at DESC
        """)
        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        return [
            {
                'session_uuid': row[0],
                'enabled_at': row[1],
                'enabled_by': row[2],
            }
            for row in rows
        ]

    # ========================================================================
    # FEATURE FLAG METHODS
    # ========================================================================

    # Sessions that always have travel access (hardcoded for dev/testing)
    _TRAVEL_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have crafting tree access (hardcoded for dev/testing)
    _CRAFTING_TREE_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have generic activity/recipe access
    _GENERIC_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have non-owned alternatives access
    _NON_OWNED_ALTERNATIVES_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have April Fools access (early access / dev)
    _APRIL_FOOLS_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have stats report access (hardcoded for dev/testing)
    _STATS_REPORT_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have holistic LP mode access (hardcoded for dev/testing)
    _CRAFTING_TREE_LP_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have Pin Item access (hardcoded for dev/testing)
    _PIN_ITEM_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have Walkdle (daily puzzle) access (hardcoded for dev/testing)
    _WALKDLE_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions gated for the EXACT XP/step optimizer experiment (goals report)
    _EXACT_XP_OPTIMIZER_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions gated for the NEW (meet-in-the-middle) optimizer. Add tester
    # session UUIDs here to let them try the new optimizer in prod. NOTE: the
    # local/Pyodide path CANNOT read this DB, so the bundle-safe allowlist in
    # stats_report_worker._NEW_OPTIMIZER_SESSIONS is what actually enables it in
    # the browser -- keep the two sets in sync.
    _NEW_OPTIMIZER_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Achievement Tracker (FAC-gated; not released to all sessions yet).
    _ACHIEVEMENTS_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Item Upgrades Tracker (FAC-gated; not released to all sessions yet).
    _UPGRADES_TRACKER_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Fastest Craft optimized-goals-report category (FAC-gated during
    # development; not released to all sessions yet). See
    # .kiro/specs/fastest-craft/.
    _FASTEST_CRAFT_GOALS_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # ──────────────────────────────────────────────────────────────────────
    # Trading feature (FAC-gated: trading). Shared multi-user marketplace.
    # Ownership keyed on PRIVATE session_uuid (never emitted); outward identity
    # is in_game_name + display_name. object_id = "walkscape-opt:{prefix}{id}";
    # txn_id = unix-epoch ms. See .kiro/specs/trading/.
    # ──────────────────────────────────────────────────────────────────────

    _TRADING_ORIGIN = "flames"

    def _txn_id(self, cur) -> int:
        """Monotonic per-site transaction id. Increments the trading_seq counter
        on the caller's cursor so it shares that write's atomic commit — strictly
        increasing, collision-free (unlike the old ms timestamp), so a late commit
        can't be skipped by a `since=<txn_id>` federation backfill."""
        cur.execute("UPDATE trading_seq SET value = value + 1 WHERE name = 'txn'")
        cur.execute("SELECT value FROM trading_seq WHERE name = 'txn'")
        row = cur.fetchone()
        return int(row[0]) if row else int(time.time() * 1000)

    def get_or_create_trader(self, session_uuid: str, in_game_name: str = "", create: bool = True) -> Dict[str, Any]:
        """Return the caller's Trader, creating it on first use.

        display_name defaults to in_game_name on creation and is never
        overwritten by later imports; in_game_name is refreshed from the
        latest import. Keyed on the private session_uuid.
        """
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT session_uuid, in_game_name, display_name, contact_prefs_json, auto_renew, "
            "share_inventory FROM traders WHERE session_uuid = ?", (session_uuid,))
        row = cur.fetchone()
        now = time.time()
        if row is None:
            name = in_game_name or ""
            if not create and not name:
                # Read-only caller with no identity yet — do NOT persist an
                # identity-less trader. Those seed blank, unclickable Browse
                # rows (and duplicate records). Return a transient identity.
                result = {"session_uuid": session_uuid, "in_game_name": "",
                          "display_name": "", "contact_prefs": [], "auto_renew": False,
                          "share_inventory": False}
            else:
                cur.execute(
                    "INSERT INTO traders (session_uuid, in_game_name, display_name, "
                    "contact_prefs_json, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)",
                    (session_uuid, name, name, now, now))
                conn.commit()
                result = {"session_uuid": session_uuid, "in_game_name": name,
                          "display_name": name, "contact_prefs": [], "auto_renew": False,
                          "share_inventory": False}
        else:
            result = {"session_uuid": row[0], "in_game_name": row[1],
                      "display_name": row[2], "contact_prefs": json.loads(row[3] or "[]"),
                      "auto_renew": bool(row[4]), "share_inventory": bool(row[5])}
            # Refresh in_game_name + bump recency (used by name->session resolution).
            new_name = in_game_name or row[1]
            # Back-fill an EMPTY display_name once a name is known (a user who
            # opened trading before importing a named character got a blank
            # display_name; heal it). A non-empty custom display_name is kept.
            new_disp = row[2] if (row[2] or "").strip() else new_name
            cur.execute("UPDATE traders SET in_game_name = ?, display_name = ?, updated_at = ? WHERE session_uuid = ?",
                        (new_name, new_disp, now, session_uuid))
            conn.commit()
            result["in_game_name"] = new_name
            result["display_name"] = new_disp
        # trader_id = "{origin}:{account_id}". in_game_name stays a display label.
        result["account_id"] = session_uuid
        result["trader_id"] = f"{self._TRADING_ORIGIN}:{session_uuid}"
        if not self._persistent_conn:
            conn.close()
        return result

    def update_trader(self, session_uuid: str, display_name: Optional[str] = None,
                      contact_prefs: Optional[list] = None, auto_renew: Optional[bool] = None,
                      share_inventory: Optional[bool] = None) -> bool:
        sets, params = [], []
        if display_name is not None:
            sets.append("display_name = ?"); params.append(display_name)
        if contact_prefs is not None:
            sets.append("contact_prefs_json = ?"); params.append(json.dumps(contact_prefs))
        if auto_renew is not None:
            sets.append("auto_renew = ?"); params.append(1 if auto_renew else 0)
        if share_inventory is not None:
            sets.append("share_inventory = ?"); params.append(1 if share_inventory else 0)
        if not sets:
            return False
        sets.append("updated_at = ?"); params.append(time.time())
        params.append(session_uuid)
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(f"UPDATE traders SET {', '.join(sets)} WHERE session_uuid = ?", params)
        changed = cur.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def resolve_trader_by_name(self, in_game_name: str) -> Optional[str]:
        """Resolve an in_game_name to the most-recently-accessed session_uuid.

        Context-based disambiguation (thread / sell history) is layered on in
        ui/trading.py (task 5); this is the most-recent-session baseline.
        """
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT session_uuid FROM traders WHERE in_game_name = ? "
                    "ORDER BY updated_at DESC LIMIT 1", (in_game_name,))
        row = cur.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row[0] if row else None

    def resolve_trader_by_handle(self, handle: str) -> Optional[str]:
        """Resolve a PUBLIC HANDLE (the /u/<handle> slug) to a session_uuid.

        A handle is a trader's display_name when they set a unique one, else
        their in_game_name. Match display_name first (case-insensitive; handles
        are enforced unique at save time), then fall back to in_game_name."""
        if not handle or not handle.strip():
            return None
        h = handle.strip().lower()
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT session_uuid FROM traders WHERE lower(display_name) = ? "
                    "ORDER BY updated_at DESC LIMIT 1", (h,))
        row = cur.fetchone()
        if row is None:
            cur.execute("SELECT session_uuid FROM traders WHERE lower(in_game_name) = ? "
                        "ORDER BY updated_at DESC LIMIT 1", (h,))
            row = cur.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row[0] if row else None

    def display_name_available(self, name: str, exclude_uuid: Optional[str] = None) -> bool:
        """Is ``name`` free to use as a public display-name handle? Taken when
        ANOTHER trader already uses it as their display_name OR in_game_name
        (case-insensitive) — so a handle never collides with someone else's
        character-name handle. Empty/blank is always 'available' (clears the
        handle; the public profile then falls back to the character name)."""
        if not name or not name.strip():
            return True
        n = name.strip().lower()
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT 1 FROM traders WHERE (lower(display_name) = ? OR lower(in_game_name) = ?) "
                    "AND session_uuid != ? LIMIT 1", (n, n, exclude_uuid or ""))
        row = cur.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row is None

    # recognize as a quality). Only these item types carry a quality dimension;
    # everything else is always base ('').
    _FED_QUALITY_TYPES = ("crafted", "material", "consumable", "pet_egg", "egg")
    _FED_QUAL_TOKENS = {"common", "uncommon", "rare", "epic", "legendary", "ethereal", "fine"}
    _FED_WORD_TO_TOKEN = {"normal": "common", "good": "uncommon", "great": "rare",
                          "excellent": "epic", "perfect": "legendary", "eternal": "ethereal",
                          "fine": "fine"}

    def _fed_quality_token(self, quality, item_type) -> str:
        """Normalize a quality / wishlist-floor to the federation contract token.

        - An item type with no quality dimension is always base -> ''.
        - '', 'none', 'any' -> '' (base / no floor).
        - A display WORD ('normal','good',…) maps to its variant TOKEN
          ('common','uncommon',…); 'normal' is the first tier -> 'common'.
        - An already-canonical token passes through.
        This guarantees we never put the literal 'normal' on the wire."""
        q = str(quality or "").strip().lower()
        if (item_type or "") not in self._FED_QUALITY_TYPES:
            return ""
        if q in ("", "none", "any"):
            return ""
        if q in self._FED_QUAL_TOKENS:
            return q
        return self._FED_WORD_TO_TOKEN.get(q, "")

    def create_listing(self, session_uuid: str, item: Dict[str, str], qty: int = 1,
                       price_coins: Optional[int] = None, trade_for: Optional[list] = None,
                       notify: bool = False, obo: bool = False,
                       accept_wishlist: bool = False, note: Optional[str] = None) -> Dict[str, Any]:
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        expires = now + 604800  # listings expire after 7 days unless renewed
        cur.execute(
            "INSERT INTO listings (origin_site, trader_uuid, item_slug, item_type, item_quality, "
            "qty, price_coins, trade_for_json, status, notify, obo, accept_wishlist, note, expires_at, txn_id, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)",
            (self._TRADING_ORIGIN, session_uuid, item["slug"], item["type"],
             self._fed_quality_token(item.get("quality"), item.get("type")), qty, price_coins,
             json.dumps(trade_for) if trade_for else None, 1 if notify else 0,
             1 if obo else 0, 1 if accept_wishlist else 0,
             (note or None), expires, txn, now, now))
        listing_id = cur.lastrowid
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        object_id = f"{self._TRADING_ORIGIN}:L{listing_id}"
        # Fan out wishlist match-alerts to opted-in wishlisters (not the seller).
        self.generate_wishlist_alerts(item, price_coins, object_id, seller_uuid=session_uuid)
        return {"id": listing_id, "object_id": object_id, "txn_id": txn}

    def create_listings_batch(self, session_uuid: str, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Create many listings in a SINGLE transaction (fast bulk add).

        ``entries`` is a list of dicts, each with: item ({slug,type,quality}),
        qty, price_coins, trade_for, notify, obo, accept_wishlist, note. Every
        insert and its wishlist match-alerts share one connection + one commit,
        so a bulk duplicate-gear listing is one round trip instead of N."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        expires = now + 604800
        out: List[Dict[str, Any]] = []
        for e in entries:
            item = e["item"]
            txn = self._txn_id(cur)
            cur.execute(
                "INSERT INTO listings (origin_site, trader_uuid, item_slug, item_type, item_quality, "
                "qty, price_coins, trade_for_json, status, notify, obo, accept_wishlist, note, expires_at, txn_id, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)",
                (self._TRADING_ORIGIN, session_uuid, item["slug"], item["type"],
                 self._fed_quality_token(item.get("quality"), item.get("type")), int(e.get("qty") or 1), e.get("price_coins"),
                 json.dumps(e.get("trade_for")) if e.get("trade_for") else None,
                 1 if e.get("notify") else 0, 1 if e.get("obo") else 0,
                 1 if e.get("accept_wishlist") else 0, (e.get("note") or None), expires, txn, now, now))
            listing_id = cur.lastrowid
            object_id = f"{self._TRADING_ORIGIN}:L{listing_id}"
            # Reuse the open cursor so alerts share this one atomic commit.
            self.generate_wishlist_alerts(item, e.get("price_coins"), object_id,
                                          seller_uuid=session_uuid, cur=cur)
            out.append({"id": listing_id, "object_id": object_id, "txn_id": txn})
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return out

    def _queue_push(self, session_uuid, title, body, thread=None):
        """Queue a per-user push notification (DM / wishlist match). Drained by the
        app layer after the request so DB code stays transport-agnostic."""
        if not session_uuid:
            return
        if not hasattr(self, "_push_queue") or self._push_queue is None:
            self._push_queue = []
        self._push_queue.append({"session_uuid": session_uuid, "title": title, "body": body, "thread": thread})

    def drain_push_queue(self):
        """Return and clear queued push notifications."""
        q = getattr(self, "_push_queue", None) or []
        self._push_queue = []
        return q

    def generate_wishlist_alerts(self, item: Dict[str, Any], price_coins: Optional[int],
                                 matched_object_id: str, seller_uuid: Optional[str] = None,
                                 cur=None) -> int:
        """Create inbox match-alerts for every opted-in wishlist entry a (newly
        open) listing satisfies. A wishlist matches when: same item slug, the
        quality rule is satisfied (exact / this-or-better within the item's
        ladder), and — if the wishlist set a max_coins — the listing has a coin
        price within that cap. The wishlist owner's own listings never alert
        them. Deduped by (wishlist_id, matched_object_id), so one listing raises
        at most one alert per wishlist. Returns the number of alerts created.

        Pass ``cur`` to reuse an open transaction (the federation-apply path does
        this so it doesn't contend with its own uncommitted write); otherwise a
        private connection is opened and committed."""
        from ui.trading import quality_matches
        slug = item.get("slug")
        if not slug:
            return 0
        listing_quality = item.get("quality") or ""
        listing_type = item.get("type") or ""
        own_conn = cur is None
        if own_conn:
            conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute(
            "SELECT id, trader_uuid, quality_rule, quality_floor, max_coins, item_type "
            "FROM wishlist_entries WHERE item_slug = ? AND notify_match = 1 "
            "AND (expires_at IS NULL OR expires_at > ?)", (slug, now))
        rows = cur.fetchall()
        created = 0
        for (wid, wuuid, rule, floor, max_coins, witype) in rows:
            if seller_uuid and wuuid == seller_uuid:
                continue  # don't alert someone about their own listing
            ctype = witype or listing_type
            if not quality_matches(listing_quality, rule or "exact", floor or "", ctype):
                continue
            if max_coins is not None and (price_coins is None or price_coins > max_coins):
                continue
            txn = self._txn_id(cur)
            try:
                cur.execute(
                    "INSERT OR IGNORE INTO wishlist_match_alerts (trader_uuid, wishlist_id, "
                    "matched_object_id, txn_id, created_at) VALUES (?, ?, ?, ?, ?)",
                    (wuuid, wid, matched_object_id, txn, now))
                if cur.rowcount > 0:
                    created += 1
                    self._queue_push(wuuid, 'Wishlist match',
                                     f"A matching {str(slug).replace('_', ' ').title()} was just listed.")
            except Exception:
                pass
        if own_conn:
            conn.commit()
            if not self._persistent_conn:
                conn.close()
        return created

    def generate_listing_match_alerts(self, item: Dict[str, Any], max_coins: Optional[int],
                                      quality_rule: str, quality_floor: str,
                                      wisher_uuid: Optional[str] = None, cur=None,
                                      matched_object_id: Optional[str] = None) -> int:
        """Reverse of generate_wishlist_alerts: when a NEW wishlist entry is
        posted, notify every opted-in (notify=1) OPEN listing owner whose listing
        would satisfy that wishlist (same item, quality rule satisfied, and —
        if the wishlist set a max_coins — the listing's price within it). The
        wishlist owner's own listings never alert them. Persists an in-app
        listing-match alert per matching listing (surfaced on My Listings, NOT the
        inbox) and queues one push per owner. Returns matches found."""
        from ui.trading import quality_matches
        slug = item.get("slug")
        if not slug:
            return 0
        witype = item.get("type") or ""
        own_conn = cur is None
        if own_conn:
            conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute(
            "SELECT id, trader_uuid, item_quality, price_coins, item_type FROM listings "
            "WHERE item_slug = ? AND status = 'open' AND notify = 1 "
            "AND (expires_at IS NULL OR expires_at > ?)", (slug, now))
        rows = cur.fetchall()
        created = 0
        seen = set()
        for (lid, luuid, lq, lprice, ltype) in rows:
            if wisher_uuid and luuid == wisher_uuid:
                continue  # don't alert someone about their own listing
            ctype = ltype or witype
            if not quality_matches(lq or "", quality_rule or "exact", quality_floor or "", ctype):
                continue
            if max_coins is not None and (lprice is not None and lprice > max_coins):
                continue
            # Persist an in-app alert on this matching listing (deduped by
            # (listing_id, matched_object_id)).
            if matched_object_id:
                atxn = self._txn_id(cur)
                cur.execute(
                    "INSERT OR IGNORE INTO listing_match_alerts (trader_uuid, listing_id, "
                    "matched_object_id, txn_id, created_at) VALUES (?, ?, ?, ?, ?)",
                    (luuid, lid, matched_object_id, atxn, now))
            if luuid not in seen:  # at most one push per owner per wishlist
                seen.add(luuid)
                self._queue_push(luuid, 'Someone wants your listing',
                                 f"A buyer just wishlisted {str(slug).replace('_', ' ').title()} that you have listed.")
            created += 1
        if own_conn:
            conn.commit()
            if not self._persistent_conn:
                conn.close()
        return created

    def update_listing(self, session_uuid: str, listing_id: int, fields: Dict[str, Any]) -> bool:
        """Update an owned listing. Allowed: qty, price_coins, trade_for, notify, note,
        obo, accept_wishlist, item_quality."""
        allowed = {"qty", "price_coins", "notify", "obo", "accept_wishlist", "item_quality", "note"}
        sets, params = [], []
        for k in allowed:
            if k in fields:
                v = fields[k]
                if k in ("notify", "obo", "accept_wishlist"):
                    v = 1 if v else 0
                if k == "note":
                    v = (str(v) if v else None)
                sets.append(f"{k} = ?"); params.append(v)
        if "trade_for" in fields:
            sets.append("trade_for_json = ?")
            params.append(json.dumps(fields["trade_for"]) if fields["trade_for"] else None)
        if not sets:
            return False
        sets.append("updated_at = ?"); params.append(time.time())
        sets.append("version = version + 1")
        params.extend([listing_id, session_uuid])
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(f"UPDATE listings SET {', '.join(sets)} WHERE id = ? AND trader_uuid = ?", params)
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def update_wishlist_entry(self, session_uuid: str, wid: int, fields: Dict[str, Any]) -> bool:
        """Update an owned wishlist entry. Allowed: quality_rule, quality_floor,
        max_coins, qty, note, notify_match. Bumps version/txn so the change
        federates."""
        allowed = {"quality_rule", "quality_floor", "max_coins", "qty", "note", "notify_match"}
        sets, params = [], []
        for k in allowed:
            if k in fields:
                v = fields[k]
                if k == "notify_match":
                    v = 1 if v else 0
                if k == "note":
                    v = (str(v) if v else None)
                sets.append(f"{k} = ?"); params.append(v)
        if "trade_for" in fields:
            sets.append("trade_for_json = ?")
            params.append(json.dumps(fields["trade_for"]) if fields["trade_for"] else None)
        if not sets:
            return False
        conn = self._get_connection(); cur = conn.cursor()
        txn = self._txn_id(cur)
        sets.append("updated_at = ?"); params.append(time.time())
        sets.append("txn_id = ?"); params.append(txn)
        sets.append("version = version + 1")
        params.extend([wid, session_uuid])
        cur.execute(f"UPDATE wishlist_entries SET {', '.join(sets)} WHERE id = ? AND trader_uuid = ?", params)
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def renew_listing(self, session_uuid: str, listing_id: int) -> bool:
        """Reset an owned listing's expiry to 7 days out (and reopen if expired)."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute(
            "UPDATE listings SET expires_at = ?, status = 'open', updated_at = ?, version = version + 1 "
            "WHERE id = ? AND trader_uuid = ?",
            (now + 604800, now, listing_id, session_uuid))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def renew_all_listings(self, session_uuid: str) -> int:
        """Reset expiry to 7 days out for ALL of the caller's open listings. Returns
        the number renewed."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute(
            "UPDATE listings SET expires_at = ?, updated_at = ?, version = version + 1 "
            "WHERE trader_uuid = ? AND (status = 'open' OR status IS NULL)",
            (now + 604800, now, session_uuid))
        n = cur.rowcount; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def close_listing(self, session_uuid: str, listing_id: int,
                      sold_for: Optional[Dict[str, Any]] = None, sold_to: str = "",
                      status: str = "sold", qty_sold: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Close out an owned listing: mark it ``status`` (default 'sold'), stamp
        what it closed for, bump version/txn, and — when sold — append a
        trade_history row. The row is RETAINED (soft close), so the terminal
        change also federates to peers via local_changes_since.

        ``sold_for`` is {coins?: int, items?: [{slug,type,quality,qty}]} (coins
        and/or a trade; a no-coins trade is fine).

        ``qty_sold`` enables a PARTIAL sale: when it is < the listing's qty (and
        status is 'sold'), the listing's qty is reduced IN PLACE and left open
        instead of being closed — so the seller sells part of a stack without
        re-listing (which would re-fire wishlist match-alerts). A trade_history
        row is still recorded for the sold units. ``qty_sold`` is clamped to
        [1, qty]; None (or >= qty) means a full close. Returns the close summary
        (with ``partial``/``qty_sold``/``qty_remaining``), or None if the listing
        isn't owned by the caller / already closed."""
        status = (status or "sold").lower()
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT item_slug, item_type, item_quality, qty FROM listings "
                    "WHERE id = ? AND trader_uuid = ? AND status = 'open'",
                    (listing_id, session_uuid))
        row = cur.fetchone()
        if row is None:
            if not self._persistent_conn:
                conn.close()
            return None
        slug, itype, quality, qty = row
        now = time.time(); txn = self._txn_id(cur)
        # Partial sale: selling only part of a multi-qty listing. Reduce the
        # listing's qty IN PLACE (the row stays 'open') instead of closing + re-
        # listing, so wishlist watchers aren't re-alerted — create_listing is the
        # only local alert trigger, and a bare qty UPDATE never fans out match-
        # alerts. Only applies to a 'sold' close with qty_sold < qty.
        sold_qty = qty
        if status == "sold" and qty_sold is not None:
            try:
                sold_qty = max(1, min(int(qty_sold), qty))
            except (TypeError, ValueError):
                sold_qty = qty
        partial = status == "sold" and sold_qty < qty
        if partial:
            cur.execute(
                "UPDATE listings SET qty = ?, updated_at = ?, txn_id = ?, "
                "version = version + 1 WHERE id = ? AND trader_uuid = ?",
                (qty - sold_qty, now, txn, listing_id, session_uuid))
        else:
            cur.execute(
                "UPDATE listings SET status = ?, closed_for_json = ?, updated_at = ?, "
                "txn_id = ?, version = version + 1 WHERE id = ? AND trader_uuid = ?",
                (status, json.dumps(sold_for) if sold_for else None, now, txn,
                 listing_id, session_uuid))
        object_id = f"{self._TRADING_ORIGIN}:L{listing_id}"
        # Resolve any linked wishlist entries: record them on the history row so a
        # trade isn't double-counted, and fulfill the LOCAL ones so the buyer's
        # wishlist clears. (Remote linked wishlists just ride the history link.) A
        # PARTIAL sale leaves the listing open, so linked wishlists are NOT
        # fulfilled (the stack is still being sold).
        linked = self.links_for_object(object_id)
        linked_wishlists = [lk["wishlist_object_id"] for lk in linked]
        hid = None
        if status == "sold":
            if not partial:
                for woid in linked_wishlists:
                    self.fulfill_wishlist_entry(woid)
            seller = self.get_trader(session_uuid) or {}
            seller_name = seller.get("display_name") or seller.get("in_game_name") or ""
            items = [{"slug": slug, "type": itype, "quality": quality, "qty": sold_qty}]
            hist_links = [object_id] + ([] if partial else linked_wishlists)
            cur.execute("INSERT INTO trade_history (origin_site, items_json, sold_for_json, "
                        "party_a_name, party_b_name, linked_object_ids_json, txn_id, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (self._TRADING_ORIGIN, json.dumps(items), json.dumps(sold_for or {}),
                         seller_name, (sold_to or ""),
                         json.dumps(hist_links), txn, now))
            hid = cur.lastrowid
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {"id": listing_id, "object_id": object_id,
                "status": ("open" if partial else status), "closed_for": sold_for,
                "history_id": hid, "txn_id": txn, "partial": partial,
                "qty_sold": sold_qty, "qty_remaining": (qty - sold_qty) if partial else 0,
                "linked_wishlists": linked_wishlists}

    def close_wishlist_entry(self, session_uuid: str, wid: int,
                             bought_for: Optional[Dict[str, Any]] = None,
                             bought_from: str = "", status: str = "bought",
                             qty_bought: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Close out an owned WISHLIST entry when the buyer actually bought the
        item. Mirrors ``close_listing`` but records the trade in the OTHER
        direction: the caller is the BUYER, so the history row is
        party_a = seller (``bought_from``), party_b = me (buyer).

        ``bought_for`` is {coins?: int, items?: [{slug,type,quality,qty}]} — what
        the buyer gave up. ``qty_bought`` enables a PARTIAL buy (qty reduced in
        place, entry stays open) exactly like a partial sale. Returns the close
        summary, or None if the entry isn't owned by the caller / already closed.
        """
        status = (status or "bought").lower()
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT item_slug, item_type, quality_floor, qty FROM wishlist_entries "
                    "WHERE id = ? AND trader_uuid = ? AND status = 'open'",
                    (wid, session_uuid))
        row = cur.fetchone()
        if row is None:
            if not self._persistent_conn:
                conn.close()
            return None
        slug, itype, quality, qty = row
        qty = qty if qty is not None else 1
        now = time.time(); txn = self._txn_id(cur)
        bought_qty = qty
        if status == "bought" and qty_bought is not None:
            try:
                bought_qty = max(1, min(int(qty_bought), qty))
            except (TypeError, ValueError):
                bought_qty = qty
        partial = status == "bought" and bought_qty < qty
        if partial:
            cur.execute(
                "UPDATE wishlist_entries SET qty = ?, updated_at = ?, txn_id = ?, "
                "version = version + 1 WHERE id = ? AND trader_uuid = ?",
                (qty - bought_qty, now, txn, wid, session_uuid))
        else:
            cur.execute(
                "UPDATE wishlist_entries SET status = ?, updated_at = ?, txn_id = ?, "
                "version = version + 1 WHERE id = ? AND trader_uuid = ?",
                (status, now, txn, wid, session_uuid))
        object_id = f"{self._TRADING_ORIGIN}:W{wid}"
        hid = None
        if status == "bought":
            buyer = self.get_trader(session_uuid) or {}
            buyer_name = buyer.get("display_name") or buyer.get("in_game_name") or ""
            items = [{"slug": slug, "type": itype, "quality": quality or "", "qty": bought_qty}]
            # OTHER direction: party_a = seller we bought from, party_b = me (buyer).
            cur.execute("INSERT INTO trade_history (origin_site, items_json, sold_for_json, "
                        "party_a_name, party_b_name, linked_object_ids_json, txn_id, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (self._TRADING_ORIGIN, json.dumps(items), json.dumps(bought_for or {}),
                         (bought_from or ""), buyer_name,
                         json.dumps([object_id]), txn, now))
            hid = cur.lastrowid
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {"id": wid, "object_id": object_id,
                "status": ("open" if partial else status), "bought_for": bought_for,
                "history_id": hid, "txn_id": txn, "partial": partial,
                "qty_bought": bought_qty, "qty_remaining": (qty - bought_qty) if partial else 0}

    def listings_for_item(self, item_slug: str) -> List[Dict[str, Any]]:
        """Open listings for an item across all traders (for the item detail view)."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute("SELECT l.id, l.item_slug, l.item_type, l.item_quality, l.qty, l.price_coins, "
                    "l.trade_for_json, l.obo, l.accept_wishlist, l.txn_id, t.in_game_name, t.display_name, "
                    "l.note, l.expires_at, l.trader_uuid, l.version, l.created_at "
                    "FROM listings l JOIN traders t ON l.trader_uuid = t.session_uuid "
                    "WHERE l.item_slug = ? AND l.status = 'open' "
                    "AND (l.expires_at IS NULL OR l.expires_at > ?) "
                    "ORDER BY l.txn_id DESC", (item_slug, now))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{"object_id": f"{self._TRADING_ORIGIN}:L{r[0]}", "side": "selling",
                 "item": {"slug": r[1], "type": r[2], "quality": r[3]}, "qty": r[4],
                 "price_coins": r[5], "trade_for": json.loads(r[6]) if r[6] else None,
                 "obo": bool(r[7]), "accept_wishlist": bool(r[8]), "txn_id": r[9],
                 "trader": r[10] or r[11], "display_name": r[11], "note": r[12], "expires_at": r[13],
                 "trader_id": f"{self._TRADING_ORIGIN}:{r[14]}", "version": r[15],
                 "created_at": r[16],
                 "is_expired": bool(r[13] is not None and r[13] <= now)} for r in rows]

    def wishlists_for_item(self, item_slug: str) -> List[Dict[str, Any]]:
        """Wishlist entries for an item across all traders."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute("SELECT w.id, w.item_slug, w.item_type, w.quality_rule, w.quality_floor, "
                    "w.max_coins, w.trade_for_json, w.txn_id, t.in_game_name, t.display_name, w.qty, w.note, "
                    "w.expires_at, w.trader_uuid, w.version, w.created_at "
                    "FROM wishlist_entries w JOIN traders t ON w.trader_uuid = t.session_uuid "
                    "WHERE w.item_slug = ? AND w.status = 'open' AND (w.expires_at IS NULL OR w.expires_at > ?) "
                    "ORDER BY w.txn_id DESC", (item_slug, now))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{"object_id": f"{self._TRADING_ORIGIN}:W{r[0]}", "side": "buying",
                 "item": {"slug": r[1], "type": r[2]},
                 "quality_rule": r[3], "quality_floor": r[4], "max_coins": r[5],
                 "trade_for": json.loads(r[6]) if r[6] else None, "txn_id": r[7],
                 "trader": r[8] or r[9], "display_name": r[9], "qty": r[10], "note": r[11],
                 "expires_at": r[12], "trader_id": f"{self._TRADING_ORIGIN}:{r[13]}",
                 "version": r[14], "created_at": r[15],
                 "is_expired": bool(r[12] is not None and r[12] <= now)} for r in rows]

    def recent_history(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Recent confirmed sales (global), newest first."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT items_json, sold_for_json, party_a_name, party_b_name, txn_id, created_at, "
                    "linked_object_ids_json FROM trade_history ORDER BY txn_id DESC LIMIT ?", (int(limit),))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{"items": json.loads(r[0]), "sold_for": json.loads(r[1]), "party_a": r[2],
                 "party_b": r[3], "txn_id": r[4], "created_at": r[5],
                 "linked_object_ids": json.loads(r[6]) if r[6] else []} for r in rows]

    def historical_average_prices(self) -> Dict[str, int]:
        """Average sold-for coin price per item slug across ALL trade history
        (local + federated). Only sales with a coin price count; trade-only
        sales are ignored. Returns {slug: avg_coins_rounded}."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT items_json, sold_for_json FROM trade_history")
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        totals: Dict[str, list] = {}
        for items_json, sold_json in rows:
            try:
                items = json.loads(items_json) or []
                sold = json.loads(sold_json) or {}
            except (json.JSONDecodeError, TypeError):
                continue
            coins = sold.get("coins")
            if coins is None:
                continue
            # coins is the TOTAL for the sale; average PER-ITEM prices, so divide
            # by the units sold (matches the per-item ask/bid price domain).
            total_units = 0
            for it in items:
                try:
                    total_units += int((it or {}).get("qty") or 1)
                except (TypeError, ValueError):
                    total_units += 1
            if total_units < 1:
                total_units = 1
            per_unit = float(coins) / total_units
            for it in items:
                slug = (it or {}).get("slug")
                if not slug:
                    continue
                totals.setdefault(slug, []).append(per_unit)
        return {slug: _coin_num(sum(vals) / len(vals)) for slug, vals in totals.items() if vals}

    def trading_prices(self, slugs=None, by_rarity: bool = True) -> List[Dict[str, Any]]:
        """Market price aggregates across the whole marketplace (local + federated).
          - listings    = count of open sell listings
          - lowest_ask  = min open-listing coin price
          - highest_bid = max open-wishlist coin budget
          - last_traded = coins of the most recent confirmed sale (+ its time)
          - estimate / range / n_prices — only once the item has at least one
            confirmed trade (an unsold listing alone shouldn't fabricate a value).
            Signals = ask prices + bid prices + trade coins; estimate = median,
            range = min..max, n_prices = signal count, n_traded = trade count.
        When ``by_rarity`` (default), each (slug, quality-token) is a SEPARATE row
        so a Perfect sale isn't mixed with a Normal one (the Prices board). When
        False, everything for a slug collapses into one row (the item-detail card).
        Pass ``slugs`` to restrict to specific items. Sorted by listings desc."""
        import statistics
        want = set(slugs) if slugs else None
        agg: Dict[tuple, Dict[str, Any]] = {}

        def _qtok(raw):
            return (raw or "") if by_rarity else ""

        def _row(slug, qtok, itype=None):
            k = (slug, qtok)
            a = agg.get(k)
            if a is None:
                a = agg[k] = {"slug": slug, "quality": qtok, "asks": [], "bids": [],
                              "listings": 0, "buy_listings": 0, "trades": [],
                              "traders": set(), "type": itype}
            if itype and not a.get("type"):
                a["type"] = itype
            return a

        conn = self._get_connection(); cur = conn.cursor()
        for l in (self.all_open_listings() + self.remote_objects("listing")):
            it = l.get("item") or {}; slug = it.get("slug")
            if not slug or (want and slug not in want):
                continue
            a = _row(slug, _qtok(it.get("quality")), it.get("type")); a["listings"] += 1
            if l.get("trader"):
                a["traders"].add(str(l.get("trader")))
            p = l.get("price_coins")
            if p is not None and p > 0:
                a["asks"].append(_coin_num(p))
        for w in (self.all_wishlist_entries() + self.remote_objects("wishlist")):
            it = w.get("item") or {}; slug = it.get("slug")
            if not slug or (want and slug not in want):
                continue
            qtok = _qtok(w.get("quality_floor") or it.get("quality"))
            a = _row(slug, qtok, it.get("type")); a["buy_listings"] += 1
            if w.get("trader"):
                a["traders"].add(str(w.get("trader")))
            b = w.get("max_coins")
            if b is not None and b > 0:
                a["bids"].append(_coin_num(b))
        # Trades newest-first (txn_id DESC) so trades[0] is the most recent.
        cur.execute("SELECT items_json, sold_for_json, created_at, party_a_name, party_b_name "
                    "FROM trade_history ORDER BY txn_id DESC")
        for items_json, sold_json, created_at, party_a, party_b in cur.fetchall():
            try:
                items = json.loads(items_json) or []; sold = json.loads(sold_json) or {}
            except (json.JSONDecodeError, TypeError):
                continue
            coins = sold.get("coins")
            if coins is None or coins <= 0:
                continue
            # sold_for.coins is the TOTAL paid for the whole sale; price signals
            # (asks/bids) are PER ITEM, so convert to a per-unit price by dividing
            # by the units sold. A single-line bulk sale (e.g. 5555 bones for
            # 27,775) becomes 5/unit instead of polluting the estimate with the
            # lump total.
            total_units = 0
            for it in items:
                try:
                    total_units += int((it or {}).get("qty") or 1)
                except (TypeError, ValueError):
                    total_units += 1
            if total_units < 1:
                total_units = 1
            per_unit = _coin_num(coins / total_units)
            if per_unit <= 0:
                per_unit = _coin_num(coins) if coins and coins > 0 else 0  # keep fractional sub-coin signal
            for it in items:
                slug = (it or {}).get("slug")
                if not slug or (want and slug not in want):
                    continue
                a = _row(slug, _qtok((it or {}).get("quality")), (it or {}).get("type"))
                a["trades"].append((per_unit, created_at))
                for pname in (party_a, party_b):
                    if pname:
                        a["traders"].add(str(pname))
        if not self._persistent_conn:
            conn.close()

        out = []
        cutoff_30d = time.time() - 30 * 86400
        for a in agg.values():
            asks, bids, trades = a["asks"], a["bids"], a["trades"]
            n_traded = len(trades)
            estimate = range_min = range_max = None
            n_prices = 0
            if n_traded >= 1:
                signals = asks + bids + [c for c, _ in trades]
                if signals:
                    n_prices = len(signals)
                    estimate = _coin_num(statistics.median(signals))
                    range_min, range_max = min(signals), max(signals)
            recent = [c for c, at in trades if at is not None and float(at) >= cutoff_30d]
            trades_30d = len(recent)
            avg_30d = _coin_num(sum(recent) / len(recent)) if recent else None
            out.append({
                "slug": a["slug"], "quality": (a["quality"] if by_rarity else None),
                "type": a.get("type"),
                "estimate": estimate, "n_prices": n_prices, "n_traded": n_traded,
                "n_traders": len(a["traders"]),
                "range_min": range_min, "range_max": range_max,
                "lowest_ask": (min(asks) if asks else None),
                "highest_bid": (max(bids) if bids else None),
                "listings": a["listings"], "buy_listings": a["buy_listings"],
                "last_traded": (trades[0][0] if trades else None),
                "last_traded_at": (trades[0][1] if trades else None),
                "trades_30d": trades_30d, "avg_30d": avg_30d,
            })
        out.sort(key=lambda r: (-r["listings"], r["slug"], r.get("quality") or ""))
        return out

    def wipe_trading_data_for_launch(self) -> int:
        """One-time, idempotent LAUNCH wipe of local trading test data.

        Deletes every local trading row (listings, wishlists, messages, match
        alerts, blocks, entry links, sale history, bank warnings, traders +
        their settings, and the mirrored/queued federation objects). KEEPS the
        federation peer(s) + tokens, the inbound sync cursor, and the txn
        counter — so cross-site stays connected, old remote test data isn't
        re-pulled, and outbound txn ids stay monotonic.

        Guarded by a `trading_meta` flag so it runs at most once no matter how
        many workers/restarts call it. Returns rows deleted (0 if already done).
        """
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS trading_meta (key TEXT PRIMARY KEY, value TEXT)")
        cur.execute("SELECT value FROM trading_meta WHERE key = 'launch_wiped'")
        row = cur.fetchone()
        if row and row[0]:
            if not self._persistent_conn:
                conn.close()
            return 0
        # Local trading content only. NOT in this list (intentionally kept):
        # trading_seq (monotonic txn counter), trading_meta (guard).
        wipe_tables = [
            "listings", "wishlist_entries", "trade_messages",
            "wishlist_match_alerts", "trade_blocks", "entry_links",
            "trade_history", "ignored_bank_warnings", "traders",
            "federation_objects", "federation_inbox",
        ]
        deleted = 0
        for t in wipe_tables:
            try:
                cur.execute(f"DELETE FROM {t}")
                if cur.rowcount and cur.rowcount > 0:
                    deleted += cur.rowcount
            except Exception:
                pass  # table may not exist in this schema revision
        cur.execute("INSERT OR REPLACE INTO trading_meta (key, value) VALUES ('launch_wiped', ?)",
                    (str(int(time.time())),))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def trading_launch_wiped(self) -> bool:
        """True once the one-time launch wipe has run (trading_meta guard set)."""
        conn = self._get_connection(); cur = conn.cursor()
        try:
            cur.execute("SELECT value FROM trading_meta WHERE key = 'launch_wiped'")
            row = cur.fetchone()
        except Exception:
            row = None
        if not self._persistent_conn:
            conn.close()
        return bool(row and row[0])

    def get_trading_meta(self, key: str) -> Optional[str]:
        """Read a trading_meta kv value (None if unset). Used for one-off deploy
        guards (e.g. the equipment-type federation backfill)."""
        conn = self._get_connection(); cur = conn.cursor()
        try:
            cur.execute("CREATE TABLE IF NOT EXISTS trading_meta (key TEXT PRIMARY KEY, value TEXT)")
            cur.execute("SELECT value FROM trading_meta WHERE key = ?", (key,))
            row = cur.fetchone()
        except Exception:
            row = None
        if not self._persistent_conn:
            conn.close()
        return (row[0] if row else None)

    def set_trading_meta(self, key: str, value: str) -> None:
        """Set a trading_meta kv value (idempotent one-off guard marker)."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS trading_meta (key TEXT PRIMARY KEY, value TEXT)")
        cur.execute("INSERT OR REPLACE INTO trading_meta (key, value) VALUES (?, ?)", (key, value))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_listings(self, session_uuid: str) -> List[Dict[str, Any]]:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT id, item_slug, item_type, item_quality, qty, price_coins, "
                    "trade_for_json, status, closed_for_json, notify, obo, accept_wishlist, txn_id, "
                    "note, expires_at, version, created_at FROM listings "
                    "WHERE trader_uuid = ? ORDER BY updated_at DESC", (session_uuid,))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        now = time.time()
        return [{"id": r[0], "object_id": f"{self._TRADING_ORIGIN}:L{r[0]}",
                 "side": "selling",
                 "item": {"slug": r[1], "type": r[2], "quality": r[3]}, "qty": r[4],
                 "price_coins": r[5], "trade_for": json.loads(r[6]) if r[6] else None,
                 "status": r[7], "closed_for": json.loads(r[8]) if r[8] else None,
                 "notify": bool(r[9]), "obo": bool(r[10]), "accept_wishlist": bool(r[11]),
                 "txn_id": r[12], "note": r[13], "expires_at": r[14], "version": r[15],
                 "created_at": r[16],
                 "is_expired": bool(r[14] is not None and r[14] <= now)} for r in rows]

    def delete_listing(self, session_uuid: str, listing_id: int) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        cur.execute("UPDATE listings SET status = 'deleted', updated_at = ?, txn_id = ?, "
                    "version = version + 1 WHERE id = ? AND trader_uuid = ? "
                    "AND (status = 'open' OR status IS NULL)", (now, txn, listing_id, session_uuid))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def delete_all_listings(self, session_uuid: str) -> int:
        """Soft-delete all of the caller's open listings (status='deleted', row
        retained) so each terminal change federates to peers. Each row gets its
        own monotonic txn_id so the batched push can't skip rows past the batch
        size. Returns the number affected."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute("SELECT id FROM listings WHERE trader_uuid = ? AND (status = 'open' OR status IS NULL)",
                    (session_uuid,))
        ids = [r[0] for r in cur.fetchall()]
        for _lid in ids:
            cur.execute("UPDATE listings SET status = 'deleted', updated_at = ?, txn_id = ?, "
                        "version = version + 1 WHERE id = ?", (now, self._txn_id(cur), _lid))
        n = len(ids); conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def create_wishlist_entry(self, session_uuid: str, item: Dict[str, str],
                              quality_rule: str = "exact", quality_floor: str = "",
                              max_coins: Optional[int] = None, trade_for: Optional[list] = None,
                              notify_match: bool = False, qty: int = 1,
                              note: Optional[str] = None) -> Dict[str, Any]:
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        expires = now + 604800  # wishlist entries expire after 7 days unless renewed
        quality_floor = self._fed_quality_token(quality_floor, item.get("type"))
        cur.execute(
            "INSERT INTO wishlist_entries (origin_site, trader_uuid, item_slug, item_type, "
            "quality_rule, quality_floor, max_coins, trade_for_json, notify_match, qty, note, expires_at, txn_id, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (self._TRADING_ORIGIN, session_uuid, item["slug"], item["type"], quality_rule,
             quality_floor, max_coins, json.dumps(trade_for) if trade_for else None,
             1 if notify_match else 0, int(qty or 1), (note or None), expires, txn, now, now))
        wid = cur.lastrowid; conn.commit()
        if not self._persistent_conn:
            conn.close()
        # Notify opted-in listing owners whose open listing satisfies this new
        # wishlist (reverse of the wishlist-match alert; seller must have notify=1).
        self.generate_listing_match_alerts(item, max_coins, quality_rule, quality_floor,
                                           wisher_uuid=session_uuid,
                                           matched_object_id=f"{self._TRADING_ORIGIN}:W{wid}")
        return {"id": wid, "object_id": f"{self._TRADING_ORIGIN}:W{wid}", "txn_id": txn}

    def get_wishlist(self, session_uuid: str) -> List[Dict[str, Any]]:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT id, item_slug, item_type, quality_rule, quality_floor, max_coins, "
                    "trade_for_json, notify_match, txn_id, expires_at, qty, note, version, status, created_at FROM wishlist_entries "
                    "WHERE trader_uuid = ? AND (status IS NULL OR status != 'deleted') ORDER BY updated_at DESC", (session_uuid,))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        now = time.time()
        return [{"id": r[0], "object_id": f"{self._TRADING_ORIGIN}:W{r[0]}",
                 "side": "buying",
                 "item": {"slug": r[1], "type": r[2]}, "quality_rule": r[3], "quality_floor": r[4],
                 "max_coins": r[5], "trade_for": json.loads(r[6]) if r[6] else None,
                 "notify_match": bool(r[7]), "txn_id": r[8], "expires_at": r[9],
                 "qty": r[10], "note": r[11], "version": r[12], "status": r[13],
                 "created_at": r[14],
                 "is_expired": bool(r[9] is not None and r[9] <= now)} for r in rows]

    def renew_wishlist_entry(self, session_uuid: str, wid: int) -> bool:
        """Reset an owned wishlist entry's expiry to 7 days out."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute("UPDATE wishlist_entries SET expires_at = ?, updated_at = ?, version = version + 1 "
                    "WHERE id = ? AND trader_uuid = ?", (now + 604800, now, wid, session_uuid))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def renew_all_wishlist_entries(self, session_uuid: str) -> int:
        """Reset expiry to 7 days out for ALL of the caller's open wishlist entries.
        Returns the number renewed."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute("UPDATE wishlist_entries SET expires_at = ?, updated_at = ?, version = version + 1 "
                    "WHERE trader_uuid = ? AND (status = 'open' OR status IS NULL)",
                    (now + 604800, now, session_uuid))
        n = cur.rowcount; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def auto_renew_entries(self, session_uuid: str, threshold_days: int = 4) -> int:
        """Renew (expires_at = now + 7d) all of this trader's listings AND wishlist
        entries that have fewer than `threshold_days` days left (expired ones
        included). Returns the number of rows renewed. Used by the opt-in
        'auto-renew on site open' preference."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cutoff = now + threshold_days * 86400  # rows expiring before this are renewed
        new_exp = now + 604800
        total = 0
        for table, extra in (("listings", "AND status = 'open'"), ("wishlist_entries", "")):
            cur.execute(
                f"UPDATE {table} SET expires_at = ?, updated_at = ?, version = version + 1 "
                f"WHERE trader_uuid = ? AND expires_at IS NOT NULL AND expires_at < ? {extra}",
                (new_exp, now, session_uuid, cutoff))
            total += cur.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return total

    def delete_wishlist_entry(self, session_uuid: str, wid: int) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        cur.execute("UPDATE wishlist_entries SET status = 'deleted', updated_at = ?, txn_id = ?, "
                    "version = version + 1 WHERE id = ? AND trader_uuid = ? "
                    "AND (status = 'open' OR status IS NULL)", (now, txn, wid, session_uuid))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def delete_all_wishlist_entries(self, session_uuid: str) -> int:
        """Soft-delete all of the caller's open wishlist entries (status='deleted',
        row retained) so each terminal change federates to peers. Each row gets
        its own monotonic txn_id so the batched push can't skip rows past the
        batch size. Returns the number affected."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        cur.execute("SELECT id FROM wishlist_entries WHERE trader_uuid = ? AND (status = 'open' OR status IS NULL)",
                    (session_uuid,))
        ids = [r[0] for r in cur.fetchall()]
        for _wid in ids:
            cur.execute("UPDATE wishlist_entries SET status = 'deleted', updated_at = ?, txn_id = ?, "
                        "version = version + 1 WHERE id = ?", (now, self._txn_id(cur), _wid))
        n = len(ids); conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def add_block(self, blocker_uuid: str, blocked_name: str) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("INSERT OR IGNORE INTO trade_blocks (blocker_uuid, blocked_name, created_at) "
                    "VALUES (?, ?, ?)", (blocker_uuid, blocked_name, time.time()))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def remove_block(self, blocker_uuid: str, blocked_name: str) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("DELETE FROM trade_blocks WHERE blocker_uuid = ? AND blocked_name = ?",
                    (blocker_uuid, blocked_name))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def list_blocks(self, blocker_uuid: str) -> List[str]:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT blocked_name FROM trade_blocks WHERE blocker_uuid = ?", (blocker_uuid,))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [r[0] for r in rows]

    def is_blocked(self, blocker_uuid: str, blocked_name: str) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT 1 FROM trade_blocks WHERE blocker_uuid = ? AND blocked_name = ?",
                    (blocker_uuid, blocked_name))
        hit = cur.fetchone() is not None
        if not self._persistent_conn:
            conn.close()
        return hit

    def link_entries(self, listing_object_id: str, wishlist_object_id: str,
                     created_by_uuid: str) -> bool:
        """Link a listing + wishlist so a trade is not double-counted. Idempotent."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("INSERT OR IGNORE INTO entry_links (listing_object_id, wishlist_object_id, "
                    "created_by_uuid, created_at) VALUES (?, ?, ?, ?)",
                    (listing_object_id, wishlist_object_id, created_by_uuid, time.time()))
        created = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return created

    def unlink_entries(self, listing_object_id: str, wishlist_object_id: str) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("DELETE FROM entry_links WHERE listing_object_id = ? AND wishlist_object_id = ?",
                    (listing_object_id, wishlist_object_id))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def links_for_object(self, object_id: str) -> List[Dict[str, str]]:
        """All links that involve this object (as listing OR wishlist). Returns
        [{listing_object_id, wishlist_object_id}]."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT listing_object_id, wishlist_object_id FROM entry_links "
                    "WHERE listing_object_id = ? OR wishlist_object_id = ?", (object_id, object_id))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{"listing_object_id": r[0], "wishlist_object_id": r[1]} for r in rows]

    def fulfill_wishlist_entry(self, wishlist_object_id: str) -> bool:
        """Mark a LOCAL wishlist entry fulfilled (drops from active wishlists +
        federates the terminal change). No-op for a non-local object_id."""
        prefix = f"{self._TRADING_ORIGIN}:W"
        if not wishlist_object_id.startswith(prefix):
            return False
        try:
            wid = int(wishlist_object_id[len(prefix):])
        except ValueError:
            return False
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        cur.execute("UPDATE wishlist_entries SET status = 'fulfilled', updated_at = ?, "
                    "txn_id = ?, version = version + 1 WHERE id = ? AND status = 'open'",
                    (now, txn, wid))
        changed = cur.rowcount > 0; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return changed

    def append_history(self, items: list, sold_for: dict, party_a_name: str, party_b_name: str,
                       linked_object_ids: Optional[list] = None) -> int:
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        cur.execute("INSERT INTO trade_history (origin_site, items_json, sold_for_json, "
                    "party_a_name, party_b_name, linked_object_ids_json, txn_id, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (self._TRADING_ORIGIN, json.dumps(items), json.dumps(sold_for),
                     party_a_name, party_b_name,
                     json.dumps(linked_object_ids) if linked_object_ids else None, txn, now))
        hid = cur.lastrowid; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return hid

    # Terminal statuses that take a remote object OUT of the active marketplace.
    # None of these hard-delete the row — the mirror keeps full state so history
    # and audit survive. 'sold' additionally records a trade_history entry.
    _FED_SOLD = {"sold"}
    _FED_CLOSED = {"deleted", "removed", "closed", "cancelled", "canceled", "expired", "fulfilled"}

    # {open, sold, closed, deleted}; our local lifecycle has richer terminal
    # states (e.g. a wishlist goes 'bought', a listing 'cancelled'). Map each
    # does not reject the change with "unknown status". 'open' and any already-
    # valid token pass through unchanged.
    _FED_OUT_STATUS = {
        "bought": "sold", "fulfilled": "sold",
        "removed": "deleted", "expired": "deleted",
        "cancelled": "closed", "canceled": "closed",
    }
    _FED_OUT_STATUS_OK = {"open", "sold", "closed", "deleted"}


    def remote_objects(self, kind: str, include_expired: bool = False) -> List[Dict[str, Any]]:
        """Remote (peer) listings or wishlists for Browse/Search, shaped like the
        local all_open_listings / all_wishlist_entries rows."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        where = "WHERE kind = ? AND status = 'open'"
        params = [kind]
        if not include_expired:
            where += " AND (expires_at IS NULL OR expires_at > ?)"
            params.append(now)
        cur.execute(
            "SELECT object_id, source_site, version, txn_id, trader_id, trader_name, display_name, "
            "item_slug, item_type, item_quality, qty, price_coins, trade_for_json, note, "
            "quality_rule, quality_floor, max_coins, expires_at, negotiable, raw_json FROM federation_objects "
            f"{where} ORDER BY txn_id DESC", params)
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for r in rows:
            created = None
            if r[19]:
                try:
                    raw = json.loads(r[19]) or {}
                    # Prefer the contract's canonical `listed`; accept `created_at`
                    # as a backward-compatible alias.
                    created = raw.get("listed") if raw.get("listed") is not None else raw.get("created_at")
                except (json.JSONDecodeError, TypeError):
                    created = None
            base = {"object_id": r[0], "source_site": r[1], "version": r[2], "txn_id": r[3],
                    "trader_id": r[4], "trader": r[5] or r[6], "display_name": r[6],
                    "item": {"slug": r[7], "type": r[8], "quality": r[9]},
                    "trade_for": json.loads(r[12]) if r[12] else None, "note": r[13],
                    "expires_at": r[17], "is_expired": bool(r[17] is not None and r[17] <= now),
                    "created_at": created,
                    "remote": True}
            if kind == "listing":
                base.update({"side": "selling", "qty": r[10], "price_coins": r[11],
                             "negotiable": bool(r[18]), "obo": bool(r[18])})
            else:
                base.update({"side": "buying", "qty": r[10], "quality_rule": r[14],
                             "quality_floor": r[15], "max_coins": r[16]})
            out.append(base)
        return out

    def trading_tx_series(self, days: int = 30, bucket_secs: int = 600) -> Dict[str, Any]:
        """Bucketed transaction counts over the last ``days`` for the admin graphs.
        Two scopes: ``us`` (origin_site='flames') and ``combined`` (us + federated
        peers). Local listings/wishlists are soft-closed (bucketed by created_at
        for creation, updated_at for sold/closed); DELETED rows are hard-removed so
        they can't be shown historically. Remote (federation_objects) events are
        bucketed by updated_at (their only timestamp) and classified by status."""
        now = time.time()
        start = now - days * 86400
        nb = int((now - start) // bucket_secs) + 1
        buckets = [int(start + i * bucket_secs) for i in range(nb)]
        keys = ["listing_created", "listing_sold", "listing_closed",
                "wishlist_created", "wishlist_fulfilled", "trade_confirmed", "message"]
        us = {k: [0] * nb for k in keys}
        combined = {k: [0] * nb for k in keys}
        us_coins = [0] * nb
        comb_coins = [0] * nb

        def _idx(ts):
            if ts is None:
                return None
            i = int((float(ts) - start) // bucket_secs)
            return i if 0 <= i < nb else None

        def _bump(scope, key, ts):
            i = _idx(ts)
            if i is not None:
                scope[key][i] += 1

        def _both(key, ts):
            i = _idx(ts)
            if i is not None:
                us[key][i] += 1
                combined[key][i] += 1

        conn = self._get_connection(); cur = conn.cursor()
        # Local listings (all local = 'us' and part of 'combined').
        cur.execute("SELECT created_at, updated_at, status FROM listings")
        for created_at, updated_at, status in cur.fetchall():
            _both("listing_created", created_at)
            s = (status or "open").lower()
            if s == "sold":
                _both("listing_sold", updated_at)
            elif s != "open":
                _both("listing_closed", updated_at)
        # Local wishlist entries.
        cur.execute("SELECT created_at, updated_at, status FROM wishlist_entries")
        for created_at, updated_at, status in cur.fetchall():
            _both("wishlist_created", created_at)
            s = (status or "open").lower()
            if s != "open":
                _both("wishlist_fulfilled", updated_at)
        # Remote mirror objects (combined only; one timestamp, classify by status).
        cur.execute("SELECT kind, status, updated_at FROM federation_objects")
        for kind, status, updated_at in cur.fetchall():
            k = (kind or "").lower(); s = (status or "open").lower()
            if k == "listing":
                if s == "open":
                    _bump(combined, "listing_created", updated_at)
                elif s == "sold":
                    _bump(combined, "listing_sold", updated_at)
                else:
                    _bump(combined, "listing_closed", updated_at)
            elif k == "wishlist":
                if s == "open":
                    _bump(combined, "wishlist_created", updated_at)
                else:
                    _bump(combined, "wishlist_fulfilled", updated_at)
        cur.execute("SELECT created_at, origin_site, sold_for_json FROM trade_history WHERE created_at >= ?", (start,))
        for created_at, origin, sold_for_json in cur.fetchall():
            i = _idx(created_at)
            _bump(combined, "trade_confirmed", created_at)
            mine = (origin or self._TRADING_ORIGIN) == self._TRADING_ORIGIN
            if mine:
                _bump(us, "trade_confirmed", created_at)
            # Coins volume: sum the 'coins' leg of each confirmed trade.
            if i is not None and sold_for_json:
                try:
                    coins = _coin_num((json.loads(sold_for_json) or {}).get("coins") or 0)
                except (ValueError, TypeError):
                    coins = 0
                if coins:
                    comb_coins[i] += coins
                    if mine:
                        us_coins[i] += coins
        cur.execute("SELECT created_at, origin_site FROM trade_messages WHERE created_at >= ?", (start,))
        for created_at, origin in cur.fetchall():
            _bump(combined, "message", created_at)
            if (origin or self._TRADING_ORIGIN) == self._TRADING_ORIGIN:
                _bump(us, "message", created_at)
        if not self._persistent_conn:
            conn.close()
        return {"bucket_secs": bucket_secs, "start": int(start), "end": int(now),
                "days": days, "buckets": buckets, "keys": keys,
                "us": us, "combined": combined,
                "coins": {"us": us_coins, "combined": comb_coins}}

    def trading_leaderboards(self, days: int = 30, limit: int = 20) -> Dict[str, Any]:
        """Top-N tables for the admin trading page: current open listings per
        trader, current open wishlist items per trader, confirmed trades (last
        ``days``, both parties), and messages sent / received (last ``days``).
        Includes federated peers where the data carries a name."""
        from collections import defaultdict
        now = time.time(); start = now - days * 86400
        conn = self._get_connection(); cur = conn.cursor()

        def _top(counter):
            return [{"name": n, "count": c} for n, c in
                    sorted(counter.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:limit]]

        listed = defaultdict(int)
        cur.execute("SELECT t.in_game_name, COUNT(*) FROM listings l "
                    "JOIN traders t ON t.session_uuid = l.trader_uuid "
                    "WHERE l.status = 'open' GROUP BY t.in_game_name")
        for name, c in cur.fetchall():
            listed[name or "(unknown)"] += c
        cur.execute("SELECT COALESCE(NULLIF(display_name,''), trader_name), COUNT(*) "
                    "FROM federation_objects WHERE kind='listing' AND status='open' "
                    "GROUP BY COALESCE(NULLIF(display_name,''), trader_name)")
        for name, c in cur.fetchall():
            listed[name or "(unknown)"] += c

        wish = defaultdict(int)
        cur.execute("SELECT t.in_game_name, COUNT(*) FROM wishlist_entries w "
                    "JOIN traders t ON t.session_uuid = w.trader_uuid "
                    "WHERE (w.status = 'open' OR w.status IS NULL) GROUP BY t.in_game_name")
        for name, c in cur.fetchall():
            wish[name or "(unknown)"] += c
        cur.execute("SELECT COALESCE(NULLIF(display_name,''), trader_name), COUNT(*) "
                    "FROM federation_objects WHERE kind='wishlist' AND status='open' "
                    "GROUP BY COALESCE(NULLIF(display_name,''), trader_name)")
        for name, c in cur.fetchall():
            wish[name or "(unknown)"] += c

        trades = defaultdict(int)
        cur.execute("SELECT party_a_name, party_b_name FROM trade_history WHERE created_at >= ?", (start,))
        for a, b in cur.fetchall():
            if a:
                trades[a] += 1
            if b:
                trades[b] += 1

        sent = defaultdict(int); recv = defaultdict(int)
        cur.execute("SELECT from_name, COUNT(*) FROM trade_messages WHERE created_at >= ? GROUP BY from_name", (start,))
        for name, c in cur.fetchall():
            sent[name or "(unknown)"] += c
        cur.execute("SELECT to_name, COUNT(*) FROM trade_messages WHERE created_at >= ? GROUP BY to_name", (start,))
        for name, c in cur.fetchall():
            recv[name or "(unknown)"] += c

        if not self._persistent_conn:
            conn.close()
        return {"days": days, "limit": limit,
                "listings": _top(listed), "wishlist": _top(wish),
                "trades": _top(trades), "messages_sent": _top(sent),
                "messages_received": _top(recv)}

    def trading_inventory_snapshot(self) -> Dict[str, Any]:
        """Point-in-time active-vs-expired counts for our (local) open listings and
        wishlist entries. 'Expired' = still status='open' but past expires_at."""
        now = time.time()
        conn = self._get_connection(); cur = conn.cursor()

        def _counts(table, open_clause):
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {open_clause} "
                        "AND (expires_at IS NULL OR expires_at > ?)", (now,))
            active = cur.fetchone()[0]
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {open_clause} "
                        "AND expires_at IS NOT NULL AND expires_at <= ?", (now,))
            expired = cur.fetchone()[0]
            return {"active": active, "expired": expired}

        listings = _counts("listings", "status = 'open'")
        wishlist = _counts("wishlist_entries", "(status = 'open' OR status IS NULL)")
        if not self._persistent_conn:
            conn.close()
        return {"listings": listings, "wishlist": wishlist}

    def local_changes_since(self, since: int = 0, peer_site: Optional[str] = None) -> List[Dict[str, Any]]:
        """Our own listings + wishlist entries (public), plus any locally-authored
        messages addressed to ``peer_site``, with txn_id > since (ascending). This
        is the payload for both GET /changes and the push client. Messages are
        scoped to the destination peer so private local-to-local chat is never
        leaked to a peer; listings/wishlists are the public marketplace and go to
        every peer. Uses the monotonic txn_id as the backfill cursor."""
        rows = []
        for r in self.all_open_listings(include_expired=True):
            if (r.get("txn_id") or 0) > since:
                rows.append({**r, "kind": "listing", "negotiable": bool(r.get("obo")),
                             "listed": r.get("created_at")})
        for r in self.all_wishlist_entries(include_expired=True):
            if (r.get("txn_id") or 0) > since:
                rows.append({**r, "kind": "wishlist", "listed": r.get("created_at")})
        # Terminal (sold/closed/etc.) listings that changed since the cursor — so
        # excluded from all_open_listings once it leaves 'open').
        for r in self._local_terminal_listings_since(since):
            rows.append(r)
        for r in self._local_terminal_wishlists_since(since):
            rows.append(r)
        # Partial-fill sales: the sold portion of a still-OPEN listing. Emitted as
        # closing their mirror of the listing (which stays open at its reduced qty).
        for r in self._local_partial_sales_since(since):
            rows.append(r)
        if peer_site:
            for r in self._local_messages_for_peer(peer_site, since):
                rows.append(r)
        # normalization existed): never emit the literal 'normal' quality, base is
        # '', and item.type is always a non-null string.
        # Outbound equipment TYPE is also normalized to the shared 'item' vocab:
        # locally we split equipment into gear/tool/loot (by slot), but the
        # gear/tool/loot listing never surfaces on their side. We keep the split
        # type in OUR storage (Browse derives category from the slug, not the wire
        # type) and only collapse it to 'item' on the way out.
        _EQUIP = {"gear", "tool", "loot"}
        for ch in rows:
            k = ch.get("kind")
            if k not in ("listing", "wishlist", "sale"):
                continue
            it = ch.get("item") if isinstance(ch.get("item"), dict) else None
            itype = (it.get("type") if it else None)
            if k == "wishlist":
                ch["quality_floor"] = self._fed_quality_token(ch.get("quality_floor"), itype)
            # {open, sold, closed, deleted} so a terminal change (e.g. a 'bought'
            # wishlist) is not rejected with "unknown status".
            st = str(ch.get("status") or "open").lower()
            if st not in self._FED_OUT_STATUS_OK:
                ch["status"] = self._FED_OUT_STATUS.get(st, "closed")
            if it is not None:
                if "quality" in it:
                    it["quality"] = self._fed_quality_token(it.get("quality"), itype)
                if it.get("type") in _EQUIP:
                    it["type"] = "item"       # collapse gear/tool/loot -> item (peer vocab)
                elif it.get("type") is None:
                    it["type"] = ""
            # 'sale' records carry items[] (plural) rather than a single item.
            for sit in (ch.get("items") or []):
                if isinstance(sit, dict) and sit.get("type") in _EQUIP:
                    sit["type"] = "item"
        rows.sort(key=lambda x: x.get("txn_id") or 0)
        return rows

    def _local_partial_sales_since(self, since: int) -> List[Dict[str, Any]]:
        """Our own trade_history rows whose linked listing is STILL OPEN — i.e. a
        partial sale that reduced the listing's qty rather than closing it — with
        txn_id > since, shaped as kind:'sale' changes. A FULL sale's listing goes
        terminal and already federates via _local_terminal_listings_since (status
        + sold_for), so it is excluded here (no double-count). This lets a peer
        record the sold units in its own history without touching its still-open
        mirror of the listing. Deduped peer-side by object_id ('<origin>:S<id>')."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "SELECT id, items_json, sold_for_json, party_a_name, party_b_name, "
            "linked_object_ids_json, txn_id FROM trade_history "
            "WHERE origin_site = ? AND txn_id > ? ORDER BY txn_id ASC",
            (self._TRADING_ORIGIN, int(since)))
        hrows = cur.fetchall()
        out = []
        for (hid, items_json, sold_for_json, party_a, party_b, linked_json, txn) in hrows:
            try:
                linked = json.loads(linked_json or "[]")
            except (json.JSONDecodeError, TypeError):
                linked = []
            listing_oid = next((o for o in linked if ":L" in str(o)), None)
            if not listing_oid:
                continue
            try:
                lid = int(str(listing_oid).split(":L", 1)[1])
            except (ValueError, IndexError):
                continue
            # Only emit if the listing is still open locally (partial sale). A
            # closed/sold listing already federates its terminal status + sold_for.
            cur.execute("SELECT status FROM listings WHERE id = ? AND origin_site = ?",
                        (lid, self._TRADING_ORIGIN))
            lr = cur.fetchone()
            if not lr or (lr[0] or "open") != "open":
                continue
            try:
                items = json.loads(items_json or "[]")
            except (json.JSONDecodeError, TypeError):
                items = []
            first = items[0] if items else {}
            try:
                sold_for = json.loads(sold_for_json or "{}")
            except (json.JSONDecodeError, TypeError):
                sold_for = {}
            out.append({
                "kind": "sale",
                "object_id": f"{self._TRADING_ORIGIN}:S{hid}",
                "sold_object_id": listing_oid,
                "version": hid, "txn_id": txn,
                "item": {"slug": first.get("slug"), "type": first.get("type"),
                         "quality": first.get("quality")},
                "qty": first.get("qty"),
                "sold_for": sold_for,
                "trader": party_a, "display_name": party_a, "sold_to": party_b,
            })
        if not self._persistent_conn:
            conn.close()
        return out

    def _local_terminal_wishlists_since(self, since: int) -> List[Dict[str, Any]]:
        """Our own non-open wishlists (fulfilled/…) with txn_id > since, as terminal
        wishlist changes so peers drop them from their mirror."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "SELECT w.id, w.item_slug, w.item_type, w.status, w.txn_id, w.version, "
            "t.in_game_name, t.display_name, w.trader_uuid FROM wishlist_entries w "
            "JOIN traders t ON w.trader_uuid = t.session_uuid "
            "WHERE w.status != 'open' AND w.txn_id > ? ORDER BY w.txn_id ASC", (int(since),))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for (wid, slug, itype, status, txn, ver, iname, dname, tuuid) in rows:
            out.append({
                "kind": "wishlist", "object_id": f"{self._TRADING_ORIGIN}:W{wid}",
                "version": ver, "txn_id": txn, "status": status,
                "item": {"slug": slug, "type": itype},
                "trader": iname, "display_name": dname,
                "trader_id": f"{self._TRADING_ORIGIN}:{tuuid}",
            })
        return out

    def _local_terminal_listings_since(self, since: int) -> List[Dict[str, Any]]:
        """Our own non-open listings (sold/closed/cancelled/…) with txn_id > since,
        shaped as terminal listing changes so peers learn the status flip. Carries
        the item + closed_for so a peer's history can record the sale."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "SELECT l.id, l.item_slug, l.item_type, l.item_quality, l.qty, l.price_coins, "
            "l.trade_for_json, l.status, l.closed_for_json, l.txn_id, l.version, t.in_game_name, "
            "t.display_name, l.trader_uuid FROM listings l JOIN traders t ON l.trader_uuid = t.session_uuid "
            "WHERE l.status != 'open' AND l.txn_id > ? ORDER BY l.txn_id ASC", (int(since),))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for (lid, slug, itype, quality, qty, price, tf, status, closed_for, txn, ver, iname, dname, tuuid) in rows:
            change = {
                "kind": "listing", "object_id": f"{self._TRADING_ORIGIN}:L{lid}",
                "version": ver, "txn_id": txn, "status": status,
                "item": {"slug": slug, "type": itype, "quality": quality},
                "qty": qty, "price_coins": price,
                "trade_for": json.loads(tf) if tf else None,
                "trader": iname, "display_name": dname,
                "trader_id": f"{self._TRADING_ORIGIN}:{tuuid}",
            }
            if status == "sold" and closed_for:
                try:
                    change["sold_for"] = json.loads(closed_for)
                except (json.JSONDecodeError, TypeError):
                    pass
            out.append(change)
        return out

    def _local_messages_for_peer(self, peer_site: str, since: int) -> List[Dict[str, Any]]:
        """Locally-authored messages (origin = us) addressed to a trader on
        ``peer_site`` with txn_id > since — shaped as kind:'message' wire changes."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "SELECT id, thread_key, from_name, to_name, from_uuid, from_trader_id, to_trader_id, "
            "about_object_id, body, txn_id FROM trade_messages "
            "WHERE origin_site = ? AND txn_id > ? AND to_trader_id LIKE ? ORDER BY txn_id ASC",
            (self._TRADING_ORIGIN, since, peer_site + ":%"))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for (mid, tkey, fname, tname, fuuid, from_tid, to_tid, about, body, txn) in rows:
            out.append({
                "kind": "message",
                "object_id": f"{self._TRADING_ORIGIN}:M{mid}",
                "version": 1, "txn_id": txn,
                "from_trader_id": from_tid or (f"{self._TRADING_ORIGIN}:{fuuid}" if fuuid else None),
                "from_name": fname, "to_trader_id": to_tid, "to_name": tname,
                "about_object_id": about, "body": body,
            })
        return out

    def post_message(self, from_uuid: Optional[str], from_name: str, to_name: str,
                     to_uuid: Optional[str], body: str,
                     about_object_id: Optional[str] = None,
                     to_trader_id: Optional[str] = None,
                     from_trader_id: Optional[str] = None,
                     origin_site: Optional[str] = None,
                     fed_object_id: Optional[str] = None,
                     txn_id: Optional[int] = None,
                     created_at: Optional[float] = None) -> Dict[str, Any]:
        """Insert a message. Local sends pass only the first args; inbound
        federated messages pass origin_site/fed_object_id (+ pre-resolved
        to_uuid) so they land in the recipient's inbox and dedupe by peer id."""
        key_parts = sorted([from_name, to_name])
        thread_key = f"{key_parts[0]}|{key_parts[1]}" + (f":{about_object_id}" if about_object_id else "")
        # Default a local sender's trader_id from their uuid when not supplied.
        if from_trader_id is None and from_uuid:
            from_trader_id = f"{self._TRADING_ORIGIN}:{from_uuid}"
        conn = self._get_connection(); cur = conn.cursor()
        now = created_at or time.time()
        txn = txn_id if txn_id is not None else self._txn_id(cur)
        cur.execute("INSERT INTO trade_messages (origin_site, thread_key, from_name, to_name, "
                    "from_uuid, to_uuid, to_trader_id, from_trader_id, about_object_id, body, "
                    "fed_object_id, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (origin_site or self._TRADING_ORIGIN, thread_key, from_name, to_name,
                     from_uuid, to_uuid, to_trader_id, from_trader_id, about_object_id, body,
                     fed_object_id, txn, now))
        mid = cur.lastrowid; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {"id": mid, "thread_key": thread_key, "txn_id": txn}

    def mark_messages_read(self, session_uuid: str) -> int:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("UPDATE trade_messages SET read_at = ? WHERE to_uuid = ? AND read_at IS NULL",
                    (time.time(), session_uuid))
        cur.execute("UPDATE wishlist_match_alerts SET read_at = ? WHERE trader_uuid = ? AND read_at IS NULL",
                    (time.time(), session_uuid))
        n = cur.rowcount; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def unread_count(self, session_uuid: str) -> int:
        conn = self._get_connection(); cur = conn.cursor()
        # Exclude messages from blocked senders so the badge matches the visible
        # (blocked-filtered) inbox.
        cur.execute(
            "SELECT COUNT(*) FROM trade_messages WHERE to_uuid = ? AND read_at IS NULL "
            "AND from_name NOT IN (SELECT blocked_name FROM trade_blocks WHERE blocker_uuid = ?)",
            (session_uuid, session_uuid))
        msgs = cur.fetchone()[0]
        if not self._persistent_conn:
            conn.close()
        # Match alerts are NO LONGER counted here — they surface on My Wishlist /
        # My Listings (and clear on visiting those tabs), not the inbox badge.
        return int(msgs)

    def list_threads(self, session_uuid: str, in_game_name: str = "") -> List[Dict[str, Any]]:
        """Inbox view: one row per conversation thread the caller participates in.

        A caller participates when their site-keyed session_uuid is the
        from_uuid/to_uuid of a message in the thread. Participation is keyed
        STRICTLY on the uuid, never the display name — two sessions that imported
        the same in-game character have distinct uuids and MUST NOT see each
        other's messages. Inbound/federated messages carry a resolved to_uuid
        (from to_trader_id), so they still match their real recipient by uuid.
        Each row carries the counterpart's name, the latest message body/time, the
        thread's about_object_id, total message count, and the caller's unread count
        (inbound messages to them not yet read)."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "SELECT thread_key, from_name, to_name, from_uuid, to_uuid, about_object_id, "
            "body, read_at, created_at, txn_id, from_trader_id, to_trader_id FROM trade_messages "
            "WHERE from_uuid = ? OR to_uuid = ? "
            "ORDER BY created_at ASC",
            (session_uuid, session_uuid))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        threads: Dict[str, Dict[str, Any]] = {}
        for (tkey, fname, tname, fuuid, tuuid, about, body, read_at, created, txn, from_tid, to_tid) in rows:
            # Counterpart = the party that isn't the caller, decided by the
            # name match as "caller is sender" wrongly flipped the counterpart to
            # ourselves (profile opened "me"). Caller is the sender only when
            # from_uuid is literally our session_uuid.
            if fuuid == session_uuid:
                counterpart = tname
                counterpart_trader_id = to_tid
            else:
                counterpart = fname
                counterpart_trader_id = from_tid
            th = threads.get(tkey)
            if th is None:
                th = {"thread_key": tkey, "counterpart": counterpart,
                      "counterpart_trader_id": counterpart_trader_id,
                      "about_object_id": about, "messages": 0, "unread": 0,
                      "last_body": body, "last_at": created, "last_txn_id": txn}
                threads[tkey] = th
            th["messages"] += 1
            th["last_body"] = body
            th["last_at"] = created
            th["last_txn_id"] = txn
            th["counterpart"] = counterpart
            if counterpart_trader_id:
                th["counterpart_trader_id"] = counterpart_trader_id
            if tuuid == session_uuid and read_at is None:
                th["unread"] += 1
        out = list(threads.values())
        out.sort(key=lambda t: t.get("last_at") or 0, reverse=True)
        for th in out:
            if th.get("about_object_id"):
                th["about_item"] = self.object_item(th["about_object_id"])
        return out

    def get_thread_messages(self, session_uuid: str, in_game_name: str,
                            thread_key: str) -> Optional[List[Dict[str, Any]]]:
        """Ordered messages for one thread, oldest first. Returns None when the
        caller is not a participant in that thread (prevents reading others'
        conversations). Participation and per-message visibility are keyed on the
        caller's site-keyed uuid, NOT the display name: a thread_key is derived
        from the two display NAMES, so two sessions that imported the same
        character could collide on one thread_key — scoping to the uuid ensures
        each session only ever sees the messages it actually sent or received.
        Each message flags ``mine`` from the caller's perspective."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "SELECT id, from_name, to_name, from_uuid, to_uuid, about_object_id, body, "
            "read_at, created_at, txn_id, origin_site FROM trade_messages "
            "WHERE thread_key = ? ORDER BY created_at ASC", (thread_key,))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        if not rows:
            return None
        msgs: List[Dict[str, Any]] = []
        participant = False
        for (mid, fname, tname, fuuid, tuuid, about, body, read_at, created, txn, origin) in rows:
            # Identity is the site-keyed uuid, not the name. Only surface messages
            # where the caller is literally the sender or recipient — this both
            # proves participation and isolates two same-named sessions that
            # happen to share a (name-derived) thread_key.
            if session_uuid not in (fuuid, tuuid):
                continue
            participant = True
            mine = (fuuid == session_uuid)
            msgs.append({"id": mid, "from_name": fname, "to_name": tname,
                         "about_object_id": about, "body": body, "mine": mine,
                         "read": read_at is not None, "created_at": created,
                         "txn_id": txn, "origin_site": origin})
        if not participant:
            return None
        return msgs

    def object_item(self, object_id: str) -> Optional[Dict[str, Any]]:
        """Resolve a listing/wishlist object_id ("{origin}:L{id}" / ":W{id}") to its
        item {slug, type, quality}. Checks local tables for our own origin, else the
        federated-objects mirror. Returns None if it can't be resolved."""
        if not object_id or ":" not in object_id:
            return None
        origin, rest = object_id.split(":", 1)
        conn = self._get_connection(); cur = conn.cursor()
        item = None
        if origin == self._TRADING_ORIGIN and rest and rest[0] in ("L", "W"):
            try:
                rid = int(rest[1:])
            except ValueError:
                rid = None
            if rid is not None:
                if rest[0] == "L":
                    cur.execute("SELECT item_slug, item_type, item_quality FROM listings WHERE id = ?", (rid,))
                else:
                    cur.execute("SELECT item_slug, item_type FROM wishlist_entries WHERE id = ?", (rid,))
                row = cur.fetchone()
                if row:
                    item = {"slug": row[0], "type": row[1], "quality": (row[2] if len(row) > 2 else "")}
        if item is None:
            cur.execute("SELECT item_slug, item_type, item_quality FROM federation_objects WHERE object_id = ?", (object_id,))
            row = cur.fetchone()
            if row:
                item = {"slug": row[0], "type": row[1], "quality": row[2]}
        if not self._persistent_conn:
            conn.close()
        return item

    def object_detail(self, object_id: str) -> Optional[Dict[str, Any]]:
        """Full detail for a listing/wishlist object_id — everything the thread
        banner needs: kind, side, item, qty, price/max, quality rule+floor, note,
        listed time, status, and owner identity. Resolves local tables for our own
        origin, else the federated-objects mirror."""
        if not object_id or ":" not in object_id:
            return None
        origin, rest = object_id.split(":", 1)
        conn = self._get_connection(); cur = conn.cursor()
        d = None
        if origin == self._TRADING_ORIGIN and rest and rest[0] in ("L", "W"):
            try:
                rid = int(rest[1:])
            except ValueError:
                rid = None
            if rid is not None and rest[0] == "L":
                cur.execute("SELECT item_slug, item_type, item_quality, qty, price_coins, note, "
                            "created_at, status, trader_uuid FROM listings WHERE id = ?", (rid,))
                r = cur.fetchone()
                if r:
                    owner = self.get_trader(r[8]) or {}
                    d = {"kind": "listing", "side": "selling",
                         "item": {"slug": r[0], "type": r[1], "quality": r[2]},
                         "qty": r[3], "price_coins": r[4], "note": r[5],
                         "listed": r[6], "status": r[7],
                         "owner": owner.get("display_name") or owner.get("in_game_name")}
            elif rid is not None and rest[0] == "W":
                cur.execute("SELECT item_slug, item_type, quality_rule, quality_floor, max_coins, qty, "
                            "note, created_at, status, trader_uuid FROM wishlist_entries WHERE id = ?", (rid,))
                r = cur.fetchone()
                if r:
                    owner = self.get_trader(r[9]) or {}
                    d = {"kind": "wishlist", "side": "buying",
                         "item": {"slug": r[0], "type": r[1]},
                         "quality_rule": r[2], "quality_floor": r[3], "max_coins": r[4],
                         "qty": r[5], "note": r[6], "listed": r[7], "status": r[8],
                         "owner": owner.get("display_name") or owner.get("in_game_name")}
        if d is None:
            cur.execute("SELECT kind, item_slug, item_type, item_quality, qty, price_coins, note, "
                        "quality_rule, quality_floor, max_coins, status, trader_name, display_name, raw_json "
                        "FROM federation_objects WHERE object_id = ?", (object_id,))
            r = cur.fetchone()
            if r:
                listed = None
                if r[13]:
                    try:
                        raw = json.loads(r[13]) or {}
                        listed = raw.get("listed") if raw.get("listed") is not None else raw.get("created_at")
                    except (json.JSONDecodeError, TypeError):
                        listed = None
                kind = r[0] or ("wishlist" if ":W" in object_id else "listing")
                d = {"kind": kind, "side": ("buying" if kind == "wishlist" else "selling"),
                     "item": {"slug": r[1], "type": r[2], "quality": r[3]},
                     "qty": r[4], "price_coins": r[5], "note": r[6],
                     "quality_rule": r[7], "quality_floor": r[8], "max_coins": r[9],
                     "status": r[10], "owner": r[12] or r[11], "listed": listed, "remote": True}
        if not self._persistent_conn:
            conn.close()
        return d

    def mark_thread_read(self, session_uuid: str, thread_key: str) -> int:
        """Mark only the caller's inbound unread messages in ONE thread as read."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("UPDATE trade_messages SET read_at = ? "
                    "WHERE thread_key = ? AND to_uuid = ? AND read_at IS NULL",
                    (time.time(), thread_key, session_uuid))
        n = cur.rowcount; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def list_match_alerts(self, trader_uuid: str, unread_only: bool = False,
                          limit: int = 50) -> List[Dict[str, Any]]:
        """Wishlist match alerts for a trader (newest first), joined to the
        originating wishlist entry's item for display."""
        conn = self._get_connection(); cur = conn.cursor()
        where = "WHERE a.trader_uuid = ?"
        params: tuple = (trader_uuid,)
        if unread_only:
            where += " AND a.read_at IS NULL"
        cur.execute(
            "SELECT a.id, a.wishlist_id, a.matched_object_id, a.read_at, a.created_at, "
            "a.txn_id, w.item_slug, w.item_type, w.quality_floor, w.quality_rule "
            "FROM wishlist_match_alerts a "
            "LEFT JOIN wishlist_entries w ON a.wishlist_id = w.id "
            f"{where} ORDER BY a.created_at DESC LIMIT ?", params + (int(limit),))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for (aid, wid, obj, read_at, created, txn, slug, itype, qfloor, qrule) in rows:
            out.append({"id": aid, "wishlist_id": wid, "matched_object_id": obj,
                        "read": read_at is not None, "created_at": created, "txn_id": txn,
                        "item": ({"slug": slug, "type": itype, "quality": qfloor or "",
                                  "quality_rule": qrule} if slug else None)})
        return out

    def list_listing_match_alerts(self, trader_uuid: str, unread_only: bool = False,
                                  limit: int = 50) -> List[Dict[str, Any]]:
        """Listing match alerts for a trader (newest first), joined to the owned
        listing's item for display — surfaced on My Listings."""
        conn = self._get_connection(); cur = conn.cursor()
        where = "WHERE a.trader_uuid = ?"
        params: tuple = (trader_uuid,)
        if unread_only:
            where += " AND a.read_at IS NULL"
        cur.execute(
            "SELECT a.id, a.listing_id, a.matched_object_id, a.read_at, a.created_at, a.txn_id, "
            "l.item_slug, l.item_type, l.item_quality "
            "FROM listing_match_alerts a LEFT JOIN listings l ON a.listing_id = l.id "
            f"{where} ORDER BY a.created_at DESC LIMIT ?", params + (int(limit),))
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for (aid, lid, obj, read_at, created, txn, slug, itype, qual) in rows:
            out.append({"id": aid, "listing_id": lid, "matched_object_id": obj,
                        "read": read_at is not None, "created_at": created, "txn_id": txn,
                        "item": ({"slug": slug, "type": itype, "quality": qual or ""} if slug else None)})
        return out

    def match_alert_summary(self, session_uuid: str) -> Dict[str, Any]:
        """Unread match-alert counts + the owned object ids with a pending match,
        for the My Wishlist / My Listings tab badges and top-of-page surfacing."""
        wl = [a for a in self.list_match_alerts(session_uuid, unread_only=True) if a.get("item")]
        li = [a for a in self.list_listing_match_alerts(session_uuid, unread_only=True) if a.get("item")]
        return {
            "wishlist": {"count": len(wl),
                         "ids": sorted({a["wishlist_id"] for a in wl}),
                         "items": wl},
            "listing": {"count": len(li),
                        "ids": sorted({a["listing_id"] for a in li}),
                        "items": li},
        }

    def mark_wishlist_matches_read(self, session_uuid: str) -> int:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("UPDATE wishlist_match_alerts SET read_at = ? WHERE trader_uuid = ? AND read_at IS NULL",
                    (time.time(), session_uuid))
        n = cur.rowcount; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def mark_listing_matches_read(self, session_uuid: str) -> int:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("UPDATE listing_match_alerts SET read_at = ? WHERE trader_uuid = ? AND read_at IS NULL",
                    (time.time(), session_uuid))
        n = cur.rowcount; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def add_match_alert(self, trader_uuid: str, wishlist_id: int, matched_object_id: str) -> int:
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time(); txn = self._txn_id(cur)
        cur.execute("INSERT INTO wishlist_match_alerts (trader_uuid, wishlist_id, "
                    "matched_object_id, txn_id, created_at) VALUES (?, ?, ?, ?, ?)",
                    (trader_uuid, wishlist_id, matched_object_id, txn, now))
        aid = cur.lastrowid; conn.commit()
        if not self._persistent_conn:
            conn.close()
        return aid

    def set_bank_ignore(self, session_uuid: str, item_slug: str) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("INSERT OR IGNORE INTO ignored_bank_warnings (session_uuid, item_slug) "
                    "VALUES (?, ?)", (session_uuid, item_slug))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def is_bank_ignored(self, session_uuid: str, item_slug: str) -> bool:
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT 1 FROM ignored_bank_warnings WHERE session_uuid = ? AND item_slug = ?",
                    (session_uuid, item_slug))
        hit = cur.fetchone() is not None
        if not self._persistent_conn:
            conn.close()
        return hit

    def get_trader(self, session_uuid: str) -> Optional[Dict[str, Any]]:
        """Read-only trader lookup (does NOT create). Returns None if absent."""
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("SELECT session_uuid, in_game_name, display_name, contact_prefs_json, auto_renew, "
                    "share_inventory FROM traders WHERE session_uuid = ?", (session_uuid,))
        row = cur.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {"session_uuid": row[0], "in_game_name": row[1], "display_name": row[2],
                "contact_prefs": json.loads(row[3] or "[]"), "auto_renew": bool(row[4]),
                "share_inventory": bool(row[5]),
                "account_id": row[0], "trader_id": f"{self._TRADING_ORIGIN}:{row[0]}"}

    def all_open_listings(self, include_expired: bool = False) -> List[Dict[str, Any]]:
        """All open listings joined with the owning trader's display identity.
        Expired listings (expires_at <= now) are excluded unless include_expired."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        where = "WHERE l.status = 'open'"
        params: tuple = ()
        if not include_expired:
            where += " AND (l.expires_at IS NULL OR l.expires_at > ?)"
            params = (now,)
        cur.execute("SELECT l.id, l.item_slug, l.item_type, l.item_quality, l.qty, l.price_coins, "
                    "l.trade_for_json, l.obo, l.accept_wishlist, l.txn_id, t.in_game_name, t.display_name, "
                    "l.note, l.expires_at, l.trader_uuid, l.version, l.created_at "
                    "FROM listings l JOIN traders t ON l.trader_uuid = t.session_uuid "
                    f"{where} ORDER BY l.txn_id DESC", params)
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{"object_id": f"{self._TRADING_ORIGIN}:L{r[0]}", "side": "selling",
                 "item": {"slug": r[1], "type": r[2], "quality": r[3]}, "qty": r[4],
                 "price_coins": r[5], "trade_for": json.loads(r[6]) if r[6] else None,
                 "obo": bool(r[7]), "accept_wishlist": bool(r[8]), "txn_id": r[9],
                 "trader": r[10] or r[11], "display_name": r[11], "note": r[12], "expires_at": r[13],
                 "trader_id": f"{self._TRADING_ORIGIN}:{r[14]}", "version": r[15],
                 "created_at": r[16],
                 "is_expired": bool(r[13] is not None and r[13] <= now)} for r in rows]

    def all_wishlist_entries(self, include_expired: bool = False) -> List[Dict[str, Any]]:
        """All wishlist entries joined with the owning trader's display identity.
        Expired entries excluded unless include_expired."""
        conn = self._get_connection(); cur = conn.cursor()
        now = time.time()
        where = "WHERE w.status = 'open'"
        params: tuple = ()
        if not include_expired:
            where += " AND (w.expires_at IS NULL OR w.expires_at > ?)"
            params = (now,)
        cur.execute("SELECT w.id, w.item_slug, w.item_type, w.quality_rule, w.quality_floor, "
                    "w.max_coins, w.trade_for_json, w.txn_id, t.in_game_name, t.display_name, w.expires_at, w.qty, w.note, "
                    "w.trader_uuid, w.version, w.created_at "
                    "FROM wishlist_entries w JOIN traders t ON w.trader_uuid = t.session_uuid "
                    f"{where} ORDER BY w.txn_id DESC", params)
        rows = cur.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{"object_id": f"{self._TRADING_ORIGIN}:W{r[0]}", "side": "buying",
                 "item": {"slug": r[1], "type": r[2]}, "quality_rule": r[3], "quality_floor": r[4],
                 "max_coins": r[5], "trade_for": json.loads(r[6]) if r[6] else None,
                 "txn_id": r[7], "trader": r[8] or r[9], "display_name": r[9], "expires_at": r[10],
                 "qty": r[11], "note": r[12], "trader_id": f"{self._TRADING_ORIGIN}:{r[13]}", "version": r[14],
                 "created_at": r[15],
                 "is_expired": bool(r[10] is not None and r[10] <= now)} for r in rows]

    def enable_feature(self, session_uuid: str, feature: str, enabled_by: str) -> bool:
        """Enable a feature flag for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO feature_flags (session_uuid, feature, enabled_at, enabled_by)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        """, (session_uuid, feature, enabled_by))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def disable_feature(self, session_uuid: str, feature: str) -> bool:
        """Disable a feature flag for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM feature_flags WHERE session_uuid = ? AND feature = ?",
            (session_uuid, feature)
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ── Fastest Craft results (.kiro/specs/fastest-craft/, R6) ──────────────
    def upsert_fastest_craft_result(self, session_uuid, item_ref, variant, quality, *,
                                    base_gearset_export=None, total_steps=None,
                                    with_banked_steps=None, root_self_steps=None,
                                    child_quantities=None, material_offsets=None,
                                    needed_owned_counts=None, subtree_scope_keys=None,
                                    base_dominance_bitmap=None, base_scope=None):
        """Insert/replace one (session, item, variant, quality) Fastest Craft row.
        JSON fields are serialized here; callers pass plain dicts/lists."""
        import json as _json
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute("""
            INSERT OR REPLACE INTO fastest_craft_results
                (session_uuid, item_ref, variant, quality, base_gearset_export,
                 total_steps_per_craft, with_banked_steps, root_self_steps,
                 child_quantities_json, material_offsets_json,
                 needed_owned_counts_json, subtree_scope_keys_json,
                 base_dominance_bitmap, base_scope_json, last_computed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
        """, (session_uuid, item_ref, variant, quality, base_gearset_export,
              total_steps, with_banked_steps, root_self_steps,
              _json.dumps(child_quantities or {}), _json.dumps(material_offsets or {}),
              _json.dumps(needed_owned_counts or {}), _json.dumps(subtree_scope_keys or []),
              base_dominance_bitmap, _json.dumps(base_scope) if base_scope is not None else None))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def get_fastest_craft_results(self, session_uuid, item_refs=None):
        """Return Fastest Craft rows for a session (optionally restricted to
        item_refs). JSON fields are parsed back into dicts/lists."""
        import json as _json
        conn = self._get_connection(); cur = conn.cursor()
        if item_refs:
            qs = ",".join("?" * len(item_refs))
            cur.execute(
                "SELECT session_uuid,item_ref,variant,quality,base_gearset_export,"
                "total_steps_per_craft,with_banked_steps,root_self_steps,"
                "child_quantities_json,material_offsets_json,needed_owned_counts_json,"
                "subtree_scope_keys_json,base_dominance_bitmap,base_scope_json,"
                "last_computed_at FROM fastest_craft_results "
                f"WHERE session_uuid=? AND item_ref IN ({qs})",
                (session_uuid, *item_refs))
        else:
            cur.execute(
                "SELECT session_uuid,item_ref,variant,quality,base_gearset_export,"
                "total_steps_per_craft,with_banked_steps,root_self_steps,"
                "child_quantities_json,material_offsets_json,needed_owned_counts_json,"
                "subtree_scope_keys_json,base_dominance_bitmap,base_scope_json,"
                "last_computed_at FROM fastest_craft_results "
                "WHERE session_uuid=?", (session_uuid,))
        cols = ("session_uuid", "item_ref", "variant", "quality", "base_gearset_export",
                "total_steps_per_craft", "with_banked_steps", "root_self_steps",
                "child_quantities", "material_offsets", "needed_owned_counts",
                "subtree_scope_keys", "base_dominance_bitmap", "base_scope",
                "last_computed_at")

        def _loads(v, default):
            try:
                return _json.loads(v) if v is not None else default
            except (TypeError, ValueError):
                return default
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["child_quantities"] = _loads(d["child_quantities"], {})
            d["material_offsets"] = _loads(d["material_offsets"], {})
            d["needed_owned_counts"] = _loads(d["needed_owned_counts"], {})
            d["subtree_scope_keys"] = _loads(d["subtree_scope_keys"], [])
            d["base_scope"] = _loads(d["base_scope"], None)
            rows.append(d)
        if not self._persistent_conn:
            conn.close()
        return rows

    def delete_fastest_craft_results(self, session_uuid, item_refs=None, quality=None):
        """Delete stored Fastest Craft rows for a session so they recompute on
        the next run. item_refs=None deletes ALL rows for the session; otherwise
        only the given items. quality (optional) narrows the delete to a single
        quality tier. Returns the number of rows deleted."""
        conn = self._get_connection(); cur = conn.cursor()
        where = ["session_uuid=?"]
        params = [session_uuid]
        if item_refs:
            where.append("item_ref IN (%s)" % ",".join("?" * len(item_refs)))
            params.extend(item_refs)
        if quality:
            where.append("quality=?")
            params.append(quality)
        cur.execute("DELETE FROM fastest_craft_results WHERE " + " AND ".join(where),
                    tuple(params))
        n = cur.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def update_fastest_craft_banked(self, session_uuid, item_ref, variant, quality,
                                    with_banked_steps, needed_owned_counts):
        """Update ONLY the banked step count + owned-count snapshot for one row
        (the cheap page-load recompute; no re-solve)."""
        import json as _json
        conn = self._get_connection(); cur = conn.cursor()
        cur.execute(
            "UPDATE fastest_craft_results SET with_banked_steps=?, needed_owned_counts_json=? "
            "WHERE session_uuid=? AND item_ref=? AND variant=? AND quality=?",
            (with_banked_steps, _json.dumps(needed_owned_counts or {}),
             session_uuid, item_ref, variant, quality))
        updated = cur.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def has_feature(self, session_uuid: str, feature: str) -> bool:
        """Check if a session has a feature enabled (including hardcoded list)."""
        if feature == 'travel' and session_uuid in self._TRAVEL_ALWAYS_ENABLED:
            return True
        # Crafting tree is in BETA: enabled for ALL sessions (2026-05-15
        # release). The hardcoded _CRAFTING_TREE_ALWAYS_ENABLED set above
        # is kept around for the FAC admin UI but no longer gates access.
        # Users will see a dismissible "BETA" banner inside the tree view
        # explaining that things may change and saved configurations may
        # be deleted before the final release.
        if feature == 'crafting_tree':
            return True
        # 2026-08-14: Exact crafting-tree optimizer released to ALL sessions so
        # we can collect bug reports before removing the checkbox entirely. The
        # server-side gate in app.py (/api/crafting-tree/optimize) reads this,
        # and the client checkbox is ungated in crafting-tree-settings.js.
        if feature == 'crafting_tree_exact':
            return True
        # Holistic LP mode also enabled for ALL sessions (2026-05-15
        # release). User decision: 'We should show holistic/LP view
        # for everyone.' Means every tree calc runs the LP solver so
        # totals reflect optimal byproduct sharing. Frontend shows
        # per-node Holistic Solver Insight strips by default.
        if feature == 'crafting_tree_lp':
            return True
        # Generic is enabled for ALL sessions (no longer feature-gated)
        if feature == 'generic':
            return True
        # 2026-06-17: Goals report (stats_report) + Local Optimization released
        # to ALL sessions (FAC removed). Mirrors the crafting_tree BETA pattern
        # above. The hardcoded _STATS_REPORT_ALWAYS_ENABLED set below is kept for
        # the FAC admin UI but no longer gates access.
        if feature == 'stats_report':
            return True
        if feature == 'local_optimization':
            return True
        if feature == 'non_owned_alternatives' and session_uuid in self._NON_OWNED_ALTERNATIVES_ENABLED:
            return True
        if feature == 'april_fools' and session_uuid in self._APRIL_FOOLS_ALWAYS_ENABLED:
            return True
        if feature == 'stats_report' and session_uuid in self._STATS_REPORT_ALWAYS_ENABLED:
            return True
        if feature == 'crafting_tree_lp' and session_uuid in self._CRAFTING_TREE_LP_ALWAYS_ENABLED:
            return True
        if feature == 'pin_item' and session_uuid in self._PIN_ITEM_ALWAYS_ENABLED:
            return True
        if feature == 'walkdle' and session_uuid in self._WALKDLE_ALWAYS_ENABLED:
            return True
        if feature == 'exact_xp_optimizer' and session_uuid in self._EXACT_XP_OPTIMIZER_ENABLED:
            return True
        if feature == 'new_optimizer' and session_uuid in self._NEW_OPTIMIZER_ALWAYS_ENABLED:
            return True
        if feature == 'achievements' and session_uuid in self._ACHIEVEMENTS_ALWAYS_ENABLED:
            return True
        if feature == 'upgrades_tracker' and session_uuid in self._UPGRADES_TRACKER_ALWAYS_ENABLED:
            return True
        if feature == 'fastest_craft_goals' and session_uuid in self._FASTEST_CRAFT_GOALS_ALWAYS_ENABLED:
            return True
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM feature_flags WHERE session_uuid = ? AND feature = ?",
            (session_uuid, feature)
        )
        result = cursor.fetchone() is not None
        if not self._persistent_conn:
            conn.close()
        return result

    def has_april_fools(self, session_uuid: str) -> bool:
        """Check if April Fools UI should be shown for this session.

        The feature flag stays true all of April (so checkboxes remain visible).
        The actual enabled state is controlled by the user's toggle preferences.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        year = now.year
        window_start = datetime(year, 3, 31, 10, 0, 0, tzinfo=timezone.utc)
        window_end   = datetime(year, 4, 30, 23, 59, 59, tzinfo=timezone.utc)
        in_window = window_start <= now < window_end
        hardcoded = session_uuid in self._APRIL_FOOLS_ALWAYS_ENABLED
        return in_window or hardcoded
        return result

    def list_feature_sessions(self, feature: str) -> list:
        """List all sessions with a specific feature enabled."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT session_uuid, enabled_at, enabled_by
            FROM feature_flags WHERE feature = ?
            ORDER BY enabled_at DESC
        """, (feature,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [
            {'session_uuid': r[0], 'enabled_at': r[1], 'enabled_by': r[2]}
            for r in rows
        ]
        # Include hardcoded sessions
        hardcoded_map = {
            'travel': self._TRAVEL_ALWAYS_ENABLED,
            'crafting_tree': self._CRAFTING_TREE_ALWAYS_ENABLED,
            'generic': self._GENERIC_ALWAYS_ENABLED,
            'non_owned_alternatives': self._NON_OWNED_ALTERNATIVES_ENABLED,
            'april_fools': self._APRIL_FOOLS_ALWAYS_ENABLED,
            'stats_report': self._STATS_REPORT_ALWAYS_ENABLED,
            'crafting_tree_lp': self._CRAFTING_TREE_LP_ALWAYS_ENABLED,
            'pin_item': self._PIN_ITEM_ALWAYS_ENABLED,
            'walkdle': self._WALKDLE_ALWAYS_ENABLED,
            'new_optimizer': self._NEW_OPTIMIZER_ALWAYS_ENABLED,
            'achievements': self._ACHIEVEMENTS_ALWAYS_ENABLED,
            'upgrades_tracker': self._UPGRADES_TRACKER_ALWAYS_ENABLED,
        }
        hardcoded_uuids = hardcoded_map.get(feature, set())
        for hc_uuid in hardcoded_uuids:
            if not any(r['session_uuid'] == hc_uuid for r in results):
                results.insert(0, {
                    'session_uuid': hc_uuid,
                    'enabled_at': 'always',
                    'enabled_by': 'hardcoded',
                })
        return results

    # ========================================================================
    # WALKDLE (DAILY PUZZLE) METHODS
    # ========================================================================

    def get_walkdle_attempt(self, session_uuid: str, puzzle_date: str, mode: str) -> Optional[dict]:
        """Return the saved attempt state dict for a (session, date, mode), or None."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT state_json, created_at, updated_at FROM daily_puzzle_attempts
               WHERE session_uuid = ? AND puzzle_date = ? AND mode = ?""",
            (session_uuid, puzzle_date, mode),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        try:
            state = json.loads(row[0]) if row[0] else {}
        except (ValueError, TypeError):
            state = {}
        return {'state': state, 'created_at': row[1], 'updated_at': row[2]}

    def upsert_walkdle_attempt(self, session_uuid: str, puzzle_date: str, mode: str, state: dict) -> bool:
        """Insert or update the saved attempt state for a (session, date, mode)."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO daily_puzzle_attempts (session_uuid, puzzle_date, mode, state_json, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(session_uuid, puzzle_date, mode)
               DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP""",
            (session_uuid, puzzle_date, mode, json.dumps(state)),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def sync_walkdle_first_seen(self, item_ids, launch_date: str, today: str) -> dict:
        """Record first-seen dates for walkdle items; return the full {id: date} map.

        On first population (empty table) ALL given ids are backfilled to
        `launch_date` (they all existed at launch). Afterwards, any id not
        already recorded is inserted with `today`. Existing rows are never
        changed, so an item's first_seen is permanent once set.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT item_id, first_seen FROM walkdle_item_first_seen")
        existing = {row[0]: row[1] for row in cursor.fetchall()}
        backfill = not existing
        rows_to_add = []
        for iid in item_ids:
            if iid in existing:
                continue
            rows_to_add.append((iid, launch_date if backfill else today))
        if rows_to_add:
            cursor.executemany(
                "INSERT OR IGNORE INTO walkdle_item_first_seen (item_id, first_seen) VALUES (?, ?)",
                rows_to_add,
            )
            conn.commit()
        result = dict(existing)
        for iid, d in rows_to_add:
            result.setdefault(iid, d)
        if not self._persistent_conn:
            conn.close()
        return result

    def list_walkdle_attempts(self, session_uuid: str, mode: str) -> list:
        """List all saved attempts for a session+mode (for the calendar)."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT puzzle_date, state_json FROM daily_puzzle_attempts
               WHERE session_uuid = ? AND mode = ?
               ORDER BY puzzle_date""",
            (session_uuid, mode),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for r in rows:
            try:
                state = json.loads(r[1]) if r[1] else {}
            except (ValueError, TypeError):
                state = {}
            out.append({'puzzle_date': r[0], 'state': state})
        return out

    def walkdle_day_stats(self, puzzle_date: str, mode: str) -> dict:
        """Aggregate the guess-count distribution for a (puzzle_date, mode).

        Returns {total, solved, failed, histogram} across every session that
        finished (solved or failed) that puzzle, plus a per-difficulty breakdown
        for hard / normal / easy (each a SUBSET of the totals). Difficulty is
        resolved per attempt:
          - easy   : advanced filters were used (easy_mode is not False, which
                     also captures pre-feature attempts with no easy_mode key)
          - normal : not easy AND the Show-stats assist was used (stats_used)
          - hard   : neither assist (easy_mode explicitly False, no stats_used)
        `histogram` maps a solve guess-count to how many players solved in
        exactly that many; histogram_{hard,normal,easy} are the same per tier.
        """
        import json

        def _resolve_mode(st):
            if st.get('easy_mode') is not False:  # True or missing -> easy
                return 'easy'
            if st.get('stats_used'):
                return 'normal'
            return 'hard'

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT state_json FROM daily_puzzle_attempts WHERE puzzle_date = ? AND mode = ?",
            (puzzle_date, mode),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        solved = 0
        failed = 0
        histogram = {}
        per = {m: {'solved': 0, 'failed': 0, 'histogram': {}} for m in ('hard', 'normal', 'easy')}
        for (sj,) in rows:
            try:
                st = json.loads(sj) if sj else {}
            except (ValueError, TypeError):
                st = {}
            m = _resolve_mode(st)
            if st.get('solved'):
                solved += 1
                n = len(st.get('guesses') or [])
                histogram[n] = histogram.get(n, 0) + 1
                per[m]['solved'] += 1
                per[m]['histogram'][n] = per[m]['histogram'].get(n, 0) + 1
            elif st.get('failed'):
                failed += 1
                per[m]['failed'] += 1
        out = {'total': solved + failed, 'solved': solved, 'failed': failed, 'histogram': histogram}
        for m in ('hard', 'normal', 'easy'):
            out[f'solved_{m}'] = per[m]['solved']
            out[f'failed_{m}'] = per[m]['failed']
            out[f'total_{m}'] = per[m]['solved'] + per[m]['failed']
            out[f'histogram_{m}'] = per[m]['histogram']
        return out

    # ========================================================================
    # STATS REPORT METHODS
    # ========================================================================

    @staticmethod
    def _row_to_dict(cursor, row):
        """Convert a sqlite3 row to a dict using cursor.description for column names."""
        if row is None:
            return None
        return {cursor.description[i][0]: row[i] for i in range(len(row))}

    def get_stats_report_run(self, run_id: str) -> dict:
        """Get a single stats report run by ID."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stats_report_runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        d = self._row_to_dict(cursor, row)
        d['categories'] = json.loads(d['categories'])
        d['skills'] = json.loads(d['skills'])
        return d

    def get_latest_stats_report_run(self, session_uuid: str) -> dict:
        """Get the most recent stats report run for a session."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM stats_report_runs
            WHERE session_uuid = ?
            ORDER BY started_at DESC
            LIMIT 1
        """, (session_uuid,))
        row = cursor.fetchone()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        d = {desc[i][0]: row[i] for i in range(len(row))}
        d['categories'] = json.loads(d['categories'])
        d['skills'] = json.loads(d['skills'])
        return d

    def get_stats_report_run_by_id(self, session_uuid: str, run_id: str) -> dict:
        """Get ONE stats report run by id, scoped to the session (so a run_id
        from another session can never be read). Returns None if not found.
        Used by the status poll so a run is tracked by its OWN id rather than
        'latest run for session' — a stale prior run must never drive a new
        run's UI (bug: a days-old failed run hijacked a fresh local FC run)."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM stats_report_runs
            WHERE id = ? AND session_uuid = ?
            LIMIT 1
        """, (run_id, session_uuid))
        row = cursor.fetchone()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        d = {desc[i][0]: row[i] for i in range(len(row))}
        d['categories'] = json.loads(d['categories'])
        d['skills'] = json.loads(d['skills'])
        return d

    def get_stats_report_results_v2(self, session_uuid: str) -> dict:
        """Read stats_report_results (new schema) grouped by category and subcategory."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT category, subcategory, source_name, location, service,
                   rank, metric_value, metric_name, export_string,
                   optimization_version, extras_json, computed_at
            FROM stats_report_results
            WHERE session_uuid = ?
            ORDER BY category, subcategory, metric_value DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        out = {}
        for row in rows:
            (cat, sub, src, loc, svc, rank, mv, mn, exp, ver, extras, computed) = row
            cat_dict = out.setdefault(cat, {})
            sub_list = cat_dict.setdefault(sub, [])
            extras_obj = None
            if extras:
                try:
                    import json
                    extras_obj = json.loads(extras)
                except Exception:
                    pass
            sub_list.append({
                'source_name': src,
                'location': loc,
                'service': svc,
                'rank': rank,
                'metric_value': mv,
                'metric_name': mn,
                'export_string': exp,
                'optimization_version': ver,
                'extras': extras_obj,
                'computed_at': computed,
            })
        return out

    def get_stats_report_results(self, run_id: str) -> dict:
        """Get all results for a run, grouped by category and sorted by metric_value.
        
        For 'xp' and 'coins' categories, sorts descending (higher is better).
        For 'new_items' and 'chests' categories, sorts ascending (lower is better).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM stats_report_gearsets
            WHERE run_id = ?
            ORDER BY category, metric_value
        """, (run_id,))
        rows = cursor.fetchall()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        
        results = {}
        for row in rows:
            d = {desc[i][0]: row[i] for i in range(len(row))}
            cat = d['category']
            if cat not in results:
                results[cat] = []
            results[cat].append(d)
        
        # Sort each category correctly: descending for xp/coins, ascending for new_items/chests
        for cat, items in results.items():
            reverse = cat in ('xp', 'coins')
            results[cat] = sorted(
                [r for r in items if r['metric_value'] is not None],
                key=lambda r: r['metric_value'],
                reverse=reverse
            )
        
        return results

    def get_stats_report_results_latest_per_scope(self, session_uuid: str) -> dict:
        """Get the latest gearset result PER SCOPE across ALL of a session's runs,
        grouped + sorted like get_stats_report_results.

        Why: each run gets a fresh run_id and job rows use random ids, so a
        stale_only re-run only writes rows for the stale/newly-unlocked
        scopes. Reading WHERE run_id = latest then drops every unchanged
        scope, blanking the report. Reading by SESSION and keeping the
        newest row per scope makes the report ADDITIVE — a re-run updates
        the changed scopes in place and leaves the rest intact.

        Scope key = (category, activity_name, skill_name, chest_name) — the
        same tuple that uniquely identifies a job/row (xp uses skill_name,
        chests use chest_name, new_items carries the kind in skill_name).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        # ASC so later (newer) rows overwrite earlier ones in the dedupe map.
        cursor.execute("""
            SELECT * FROM stats_report_gearsets
            WHERE session_uuid = ?
            ORDER BY created_at ASC
        """, (session_uuid,))
        rows = cursor.fetchall()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()

        by_scope = {}
        for row in rows:
            d = {desc[i][0]: row[i] for i in range(len(row))}
            key = (d.get('category'), d.get('activity_name'),
                   d.get('skill_name'), d.get('chest_name'))
            by_scope[key] = d  # newest wins (ASC order)

        results = {}
        for d in by_scope.values():
            results.setdefault(d['category'], []).append(d)

        for cat, items in results.items():
            reverse = cat in ('xp', 'coins')
            results[cat] = sorted(
                [r for r in items if r['metric_value'] is not None],
                key=lambda r: r['metric_value'],
                reverse=reverse
            )
        return results

    def get_stats_report_gearset(self, result_id: str) -> dict:
        """Get a single stats report gearset result by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stats_report_gearsets WHERE id = ?", (result_id,))
        row = cursor.fetchone()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {desc[i][0]: row[i] for i in range(len(row))}

    def update_stats_report_gearset_alternatives(self, result_id: str,
                                                  alternatives=None,
                                                  locked_alternatives=None,
                                                  hidden_alternatives=None) -> bool:
        """Merge on-demand-computed slot alternatives into a goals-report
        gearset row's metrics_json, so the report serves them from the DB on
        reload (via _storedRowAlternatives) instead of recomputing on every
        popup open.

        The worker no longer precomputes alternatives, so the slot-alternatives
        endpoint is the sole source; this caches its output. In-place UPDATE by
        id, merging only the three `_slot_*alternatives` keys and preserving the
        rest of metrics_json. No-op (returns False) when the row is gone.

        Note: goals-report rows are not user-editable, so the endpoint always
        scores against the row's stored optimized gearset — the cached
        alternatives therefore stay consistent with the row on reload.
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT metrics_json FROM stats_report_gearsets WHERE id = ?",
            (result_id,),
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False
        try:
            mj = _json.loads(row[0]) if row[0] else {}
            if not isinstance(mj, dict):
                mj = {}
        except Exception:
            mj = {}
        mj['_slot_alternatives'] = alternatives or {}
        mj['_slot_locked_alternatives'] = locked_alternatives or {}
        mj['_slot_hidden_alternatives'] = hidden_alternatives or {}
        cursor.execute(
            "UPDATE stats_report_gearsets SET metrics_json = ? WHERE id = ?",
            (_json.dumps(mj), result_id),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def create_stats_report_gearset(self, result_id: str, run_id: str, session_uuid: str,
                                     category: str, activity_name: str, skill_name: str,
                                     chest_name: str, metric_value: float, metric_name: str,
                                     gearset_export: str, job_status: str = 'complete',
                                     error_message: str = None,
                                     metrics_json=None) -> bool:
        """Create a stats report gearset result row.

        ``metrics_json`` is an optional dict (or pre-serialized JSON string)
        with the optimizer's metric breakdown — used by the frontend for
        steps-to-next-level calc and the Secondary XP popover. Older rows
        written before the metrics_json column existed will have NULL here
        and the frontend gracefully degrades.
        """
        import json as _json
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        if metrics_json is not None and not isinstance(metrics_json, str):
            try:
                metrics_json = _json.dumps(metrics_json)
            except Exception:
                metrics_json = None
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO stats_report_gearsets
                (id, run_id, session_uuid, category, activity_name, skill_name, chest_name,
                 metric_value, metric_name, gearset_export, job_status, error_message,
                 metrics_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (result_id, run_id, session_uuid, category, activity_name, skill_name, chest_name,
              metric_value, metric_name, gearset_export, job_status, error_message,
              metrics_json, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def create_stats_report_result(
        self,
        session_uuid: str,
        category: str,
        subcategory: str,
        source_name: str,
        location: str,
        service: str,
        rank: int,
        metric_value: float,
        metric_name: str,
        export_string: str,
        dominance_bitmap: bytes,
        metric_inputs_hash: str,
        optimization_version: int,
        extras_json: str = None,
    ) -> bool:
        """Insert-or-replace a stats_report_results row.

        extras_json is optional auxiliary data per row. Initial use:
        chip-row data for new_items rows (T17). Rows that don't need extras
        leave it NULL.
        """
        import time
        now = int(time.time())
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO stats_report_results
                (session_uuid, category, subcategory, source_name, location, service,
                 rank, metric_value, metric_name, export_string,
                 dominance_bitmap, metric_inputs_hash, optimization_version, extras_json, computed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_uuid, category, subcategory, source_name, location, service,
              rank, metric_value, metric_name, export_string,
              dominance_bitmap, metric_inputs_hash, optimization_version, extras_json, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def prune_orphaned_new_items_results(self, session_uuid: str,
                                         valid_scopes, kinds) -> int:
        """Delete stale new_items result rows whose (source_name, subcategory)
        scope is no longer produced by build_new_items_jobs.

        The new_items report is stored additively (INSERT OR REPLACE per
        scope) and read additively (latest-per-scope), with no run scoping.
        So once an activity stops yielding an unowned drop of a given kind
        (e.g. the user hatches/obtains the pet, so its egg is now owned),
        the previously-written row is never overwritten *and never deleted*
        — it lingers forever (bug 01797bdb: a Tiger egg row from a stale run
        kept showing even though the user owns the tiger pet). This reconciles
        the stored rows against the freshly-built valid scope set.

        Args:
            session_uuid: the live session whose rows to reconcile.
            valid_scopes: iterable of (source_name, subcategory) tuples that
                build_new_items_jobs produced this run (the authoritative set
                of currently-valid new_items scopes, BEFORE stale filtering).
            kinds: the subcategories (kinds) actually built this run. Pruning
                is restricted to these so a kind-filtered run (e.g. gear-only)
                never deletes valid rows of kinds it didn't recompute.

        Returns the number of rows deleted.

        Reconciles BOTH backing tables:
          * stats_report_results  — read by get_stats_report_results_v2 and
            the stale-detection layer.
          * stats_report_gearsets — read by get_stats_report_results_latest_
            per_scope, which is what /api/stats-report/results (the goals
            report display) actually returns. Local (Pyodide) optimization
            writes its fast rows here via /api/stats-report/local-scope, so a
            gearset-only orphan (bug 6c68245b: "Sticky finger shorts" gear row
            lingering after the user obtained the item) is invisible to a
            results-only prune. Both tables key new_items scopes on
            (activity/source name, kind) so the same valid set applies.
        """
        kinds = {(k or '').lower() for k in (kinds or []) if k}
        if not kinds:
            return 0
        valid = {((s or ''), (k or '').lower()) for (s, k) in (valid_scopes or set())}
        conn = self._get_connection()
        cursor = conn.cursor()
        placeholders = ','.join('?' for _ in kinds)
        sorted_kinds = sorted(kinds)
        deleted = 0

        # stats_report_results: scope = (source_name, subcategory)
        cursor.execute(
            "SELECT rowid, source_name, subcategory FROM stats_report_results "
            "WHERE session_uuid = ? AND category = 'new_items' "
            "AND lower(subcategory) IN (" + placeholders + ")",
            (session_uuid, *sorted_kinds),
        )
        results_orphans = [
            rowid for (rowid, src, sub) in cursor.fetchall()
            if ((src or ''), (sub or '').lower()) not in valid
        ]
        if results_orphans:
            cursor.executemany(
                "DELETE FROM stats_report_results WHERE rowid = ?",
                [(rid,) for rid in results_orphans],
            )
            deleted += len(results_orphans)

        # stats_report_gearsets: scope = (activity_name, skill_name=kind)
        cursor.execute(
            "SELECT rowid, activity_name, skill_name FROM stats_report_gearsets "
            "WHERE session_uuid = ? AND category = 'new_items' "
            "AND lower(skill_name) IN (" + placeholders + ")",
            (session_uuid, *sorted_kinds),
        )
        gearset_orphans = [
            rowid for (rowid, act, kind) in cursor.fetchall()
            if ((act or ''), (kind or '').lower()) not in valid
        ]
        if gearset_orphans:
            cursor.executemany(
                "DELETE FROM stats_report_gearsets WHERE rowid = ?",
                [(rid,) for rid in gearset_orphans],
            )
            deleted += len(gearset_orphans)

        if deleted:
            conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def prune_orphaned_target_items_results(self, session_uuid: str,
                                            built_groups, valid_result,
                                            valid_gearset) -> int:
        """Delete orphaned target_items rows whose (item, activity) scope is no
        longer produced by build_target_items_jobs.

        Like the new_items report, target_items is stored additively (INSERT OR
        REPLACE per scope) and read additively (latest-per-scope), so once an
        activity stops yielding an item's drop (item obtained, activity renamed/
        removed, or a fine variant no longer built because "include fine" was
        turned off) the previously-written row is never overwritten and never
        deleted -- it lingers forever. This reconciles the stored rows against
        the freshly-built valid scope set.

        Pruning is RESTRICTED to `built_groups` (the group_slugs actually built
        this run), so a group the user did NOT select this run keeps its rows
        (mirrors prune_orphaned_new_items_results' kind-restriction).

        Reconciles BOTH backing tables:
          * stats_report_results  -- scope = (subcategory=group_slug,
            source_name=item_slug, location=activity_slug). Read by the
            stale-detection layer / get_stats_report_results_v2.
          * stats_report_gearsets -- scope = (skill_name=group_slug,
            chest_name=item_slug, activity_name). Read by
            get_stats_report_results_latest_per_scope, which is what the goals
            report display actually returns.

        Args:
            built_groups: iterable of group_slugs built this run (restriction set).
            valid_result: set of (group_slug, item_slug, activity_slug) tuples
                valid for stats_report_results this run.
            valid_gearset: set of (group_slug, item_slug, activity_name) tuples
                valid for stats_report_gearsets this run.

        Returns the number of rows deleted across both tables.
        """
        groups = {(g or '') for g in (built_groups or set()) if g}
        if not groups:
            return 0
        valid_result = {tuple((x or '') for x in t) for t in (valid_result or set())}
        valid_gearset = {tuple((x or '') for x in t) for t in (valid_gearset or set())}
        conn = self._get_connection()
        cursor = conn.cursor()
        placeholders = ','.join('?' for _ in groups)
        sorted_groups = sorted(groups)
        deleted = 0

        # stats_report_results: scope = (subcategory, source_name, location)
        cursor.execute(
            "SELECT rowid, subcategory, source_name, location FROM stats_report_results "
            "WHERE session_uuid = ? AND category = 'target_items' "
            "AND subcategory IN (" + placeholders + ")",
            (session_uuid, *sorted_groups),
        )
        results_orphans = [
            rowid for (rowid, sub, src, loc) in cursor.fetchall()
            if ((sub or ''), (src or ''), (loc or '')) not in valid_result
        ]
        if results_orphans:
            cursor.executemany(
                "DELETE FROM stats_report_results WHERE rowid = ?",
                [(rid,) for rid in results_orphans],
            )
            deleted += len(results_orphans)

        # stats_report_gearsets: scope = (skill_name, chest_name, activity_name)
        cursor.execute(
            "SELECT rowid, skill_name, chest_name, activity_name FROM stats_report_gearsets "
            "WHERE session_uuid = ? AND category = 'target_items' "
            "AND skill_name IN (" + placeholders + ")",
            (session_uuid, *sorted_groups),
        )
        gearset_orphans = [
            rowid for (rowid, grp, itm, act) in cursor.fetchall()
            if ((grp or ''), (itm or ''), (act or '')) not in valid_gearset
        ]
        if gearset_orphans:
            cursor.executemany(
                "DELETE FROM stats_report_gearsets WHERE rowid = ?",
                [(rid,) for rid in gearset_orphans],
            )
            deleted += len(gearset_orphans)

        if deleted:
            conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def create_stats_report_run(self, session_uuid: str, run_id: str, categories: list,
                                 skills: list, total_jobs: int, notify_on_complete: bool) -> bool:
        """Create a new stats report run record."""
        import json
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO stats_report_runs
                (id, session_uuid, categories, skills, total_jobs, completed_jobs, failed_jobs,
                 status, notify_on_complete, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, 0, 0, 'running', ?, ?, ?)
        """, (run_id, session_uuid, json.dumps(categories), json.dumps(skills),
              total_jobs, 1 if notify_on_complete else 0, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def mark_running_runs_interrupted(self) -> int:
        """Flip ALL `running` stats-report runs on this DB to `interrupted`.

        Used by the @app.on_event("shutdown") graceful-shutdown hook.
        Mirrors what the user-initiated /api/stats-report/cancel does
        for one session, but ranges over every active run because we're
        about to take the entire container down.

        The 'interrupted' status (vs 'failed') tells the orphan-resume
        sweeper on the NEXT container start "this run was cleanly
        suspended by a deploy, not abandoned by the user — please
        resume it". get_orphan_runs already includes 'interrupted' in
        its WHERE clause, so the resume path picks them up automatically
        without further changes.

        Combined with _kill_all_stats_report_workers in app.py and a
        bumped docker compose stop_grace_period, this gives an in-flight
        worker time to finish its current job and write a result row
        before the container is SIGKILL'd. The new container then
        resumes from where the old one left off via stale-detection.

        Returns:
            int — number of run rows flipped.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'interrupted',
                last_progress_at = ?
            WHERE status = 'running'
        """, (now,))
        rows = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return rows

    def cancel_stats_report_run(self, session_uuid: str) -> dict:
        """Mark the session's currently-running stats-report run as failed.

        Used by /api/stats-report/cancel — non-destructive cancellation
        that preserves all stats_report_results / stale-scope / snapshot
        data (unlike reset_stats_report_data which wipes everything).

        The status flip lets a still-alive worker subprocess notice on
        its next progress write that the run is no longer 'running' and
        self-terminate via os._exit(0) (see worker.execute_job's
        get_stats_report_run check). Combined with
        _kill_stats_report_worker_for_session sending SIGTERM up front,
        this guarantees the worker stops within ~1 job (~20s) even if
        SIGTERM is missed.

        Returns:
            {'cancelled_run_id': <uuid or None>, 'rows_updated': int}
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM stats_report_runs "
            "WHERE session_uuid = ? AND status = 'running' "
            "ORDER BY started_at DESC LIMIT 1",
            (session_uuid,),
        )
        row = cursor.fetchone()
        cancelled_run_id = row[0] if row else None
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE session_uuid = ? AND status = 'running'
        """, (now, session_uuid))
        rows_updated = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {
            'cancelled_run_id': cancelled_run_id,
            'rows_updated': rows_updated,
        }

    def update_stats_report_progress(self, run_id: str, success: bool) -> bool:
        """Atomically increment completed_jobs or failed_jobs for a run.
        
        Also writes last_progress_at (added 2026-05-22 for auto-resume) so
        the orphan-sweeper can tell "abandoned hours ago" from "container
        just restarted". The timestamp is best-effort — if the schema
        is older and lacks the column, the UPDATE silently no-ops on
        that field.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        if success:
            cursor.execute("""
                UPDATE stats_report_runs
                SET completed_jobs = completed_jobs + 1,
                    last_progress_at = ?
                WHERE id = ?
            """, (now, run_id))
        else:
            cursor.execute("""
                UPDATE stats_report_runs
                SET failed_jobs = failed_jobs + 1,
                    last_progress_at = ?
                WHERE id = ?
            """, (now, run_id))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def get_orphan_runs(self, max_age_hours: int = 24, max_resume_count: int = 3) -> list:
        """Return runs that should be respawned at app startup.
        
        An "orphan" is a stats_report_runs row whose worker subprocess was
        killed (by container restart, OOM, etc.) leaving the row stuck at
        status='running' or status='interrupted'.
        
        Filters:
        - status IN ('running', 'interrupted')
        - started_at within last max_age_hours (skip ancient stale rows —
          user has moved on)
        - resume_count < max_resume_count (skip runaway respawn loops)
        - last_progress_at within last max_age_hours OR NULL (NULL means
          worker died before writing any progress, still resumable)
        
        See ui/app.py::_resume_orphan_runs for the caller.
        """
        import json
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
        conn = self._get_connection()
        # _get_connection() doesn't set row_factory, so cursor.fetchall()
        # returns plain tuples by default. The dict(r) below requires Row
        # objects (which support keys()). Set the factory locally so we
        # don't change behavior for other callers of _get_connection.
        prev_row_factory = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, session_uuid, categories, skills, total_jobs,
                       completed_jobs, failed_jobs, status, notify_on_complete,
                       started_at, resume_count, last_progress_at
                FROM stats_report_runs
                WHERE status IN ('running', 'interrupted')
                  AND started_at >= ?
                  AND COALESCE(resume_count, 0) < ?
                  AND (last_progress_at IS NULL OR last_progress_at >= ?)
                ORDER BY started_at ASC
            """, (cutoff, max_resume_count, cutoff))
            rows = cursor.fetchall()
        finally:
            conn.row_factory = prev_row_factory
        if not self._persistent_conn:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d['categories'] = json.loads(d['categories']) if d.get('categories') else []
            except Exception:
                d['categories'] = []
            try:
                d['skills'] = json.loads(d['skills']) if d.get('skills') else []
            except Exception:
                d['skills'] = []
            out.append(d)
        return out

    def increment_resume_count(self, run_id: str) -> int:
        """Increment resume_count for a run. Returns the new value.
        
        Called by the orphan-sweeper before respawning a worker so the
        next iteration can detect runaway respawn loops (e.g., worker
        crashes on the same job every time → after N attempts, give up
        and mark failed).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET resume_count = COALESCE(resume_count, 0) + 1
            WHERE id = ?
        """, (run_id,))
        cursor.execute("SELECT resume_count FROM stats_report_runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        # row is a plain tuple — _get_connection() doesn't set row_factory
        # to sqlite3.Row, so use index access. row[0] is resume_count.
        new_count = row[0] if row else 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return new_count

    def mark_run_interrupted(self, run_id: str) -> bool:
        """Flip a run to status='interrupted' (clean shutdown sentinel).
        
        Called by the worker's SIGTERM handler so the new container's
        startup sweep knows we exited cleanly (not crashed). Either way
        the run gets resumed — this is purely diagnostic.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'interrupted', last_progress_at = ?
            WHERE id = ? AND status = 'running'
        """, (now, run_id))
        ok = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return ok

    def fail_resume_exhausted_runs(self, max_resume_count: int = 3) -> int:
        """Mark runs that hit the resume-count cap as permanently failed.
        
        Called once at app startup AFTER respawning healthy orphans, to
        clean up rows that have been resumed too many times (likely a
        worker crashing on the same job). Returns count of rows flipped.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE status IN ('running', 'interrupted')
              AND COALESCE(resume_count, 0) >= ?
        """, (now, max_resume_count))
        n = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def fail_abandoned_runs(self, max_age_hours: int = 24) -> int:
        """Mark runs older than max_age_hours as failed (user moved on).
        
        Called at app startup to clean up rows that won't be resumed
        because they're too old. Without this they'd stay at status=
        'running' forever and continue blocking new runs via the
        existing_run check in /api/stats-report/run.
        """
        from datetime import datetime, timezone, timedelta
        now_dt = datetime.now(timezone.utc)
        cutoff = (now_dt - timedelta(hours=max_age_hours)).isoformat()
        now = now_dt.isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE status IN ('running', 'interrupted')
              AND started_at < ?
        """, (now, cutoff))
        n = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def complete_stats_report_run(self, run_id: str, inventory_fingerprint: str = None) -> bool:
        """Mark a run as complete with timestamp.

        inventory_fingerprint param is retained for backward compat with
        existing callers but is now a no-op since the column was dropped
        in 20260522_120001 (replaced by per-row dominance_bitmap +
        metric_inputs_hash on stats_report_results).
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        # 2026-07-11 (bug 30add94e): reconcile total_jobs up to completed_jobs.
        # A local (Pyodide) run's server-side stale PRECOUNT can undercount how
        # many scopes the browser actually runs (the browser's resume-skip
        # identity doesn't always match the server stale set), so completed_jobs
        # can overshoot total_jobs (observed 9 completed vs 5 total). That
        # corrupt count pins the progress bar into its "completed >= total"
        # ("Finishing…") branch, shows a nonsense "9/5" run summary, and — via
        # the /local-scope self-finalize firing at completed>=total — flips the
        # run to complete BEFORE the browser posts its last scopes, so the
        # client renders a PARTIAL report. Clamping total up to completed at
        # every finalize keeps the record coherent (you can never complete more
        # jobs than exist). MAX() only ever raises total, never lowers it, so
        # server runs (completed == total) and correct local runs are unchanged.
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'complete', completed_at = ?,
                total_jobs = MAX(total_jobs, completed_jobs)
            WHERE id = ?
        """, (now, run_id))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def compute_inventory_fingerprint(self, session_uuid: str) -> str:
        """Compute a SHA-256 fingerprint of the session's current item ownership state.
        
        The fingerprint is a hash of sorted (item_id, has, hide, quality) tuples,
        derived from character_config.items (has/quality) and ui_config.items (hide).
        Returns a hex digest string.
        """
        import hashlib
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT character_config, ui_config FROM sessions WHERE uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row or not row[0]:
            return hashlib.sha256(b'').hexdigest()
        
        try:
            char_config = json.loads(row[0]) if row[0] else {}
            ui_config = json.loads(row[1]) if row[1] else {}
        except (json.JSONDecodeError, TypeError):
            return hashlib.sha256(b'').hexdigest()
        
        char_items = char_config.get('items', {}) if isinstance(char_config, dict) else {}
        ui_items = ui_config.get('items', {}) if isinstance(ui_config, dict) else {}
        
        # Collect all item IDs from both configs
        all_item_ids = set(char_items.keys()) | set(ui_items.keys())
        
        canonical = sorted(
            (
                item_id,
                bool(char_items.get(item_id, {}).get('has', False) if isinstance(char_items.get(item_id), dict) else False),
                bool(ui_items.get(item_id, {}).get('hide', False) if isinstance(ui_items.get(item_id), dict) else False),
                str(char_items.get(item_id, {}).get('quality', '') if isinstance(char_items.get(item_id), dict) else '')
            )
            for item_id in all_item_ids
        )
        payload = json.dumps(canonical, separators=(',', ':'))
        return hashlib.sha256(payload.encode()).hexdigest()

    def mark_stats_report_runs_stale(self, session_uuid: str) -> int:
        """Mark all completed stats report runs as stale if inventory has changed.
        
        Computes the current inventory fingerprint and compares against stored fingerprints.
        Sets is_stale=1 on any run where the fingerprint differs.
        Returns the number of runs marked stale.
        """
        new_fingerprint = self.compute_inventory_fingerprint(session_uuid)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET is_stale = 1
            WHERE session_uuid = ?
              AND status = 'complete'
              AND inventory_fingerprint IS NOT NULL
              AND inventory_fingerprint != ?
        """, (session_uuid, new_fingerprint))
        count = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return count

    def merge_stats_report_jobs(self, run_id: str, new_jobs: list) -> int:
        """Add new pending jobs to an existing run and increment total_jobs.
        
        new_jobs is a list of dicts with keys:
            id, category, activity_name, skill_name, chest_name, session_uuid
        
        If a (skill_name, category) or (activity_name, category) pair already exists
        in the run with status='complete', it is overwritten and refreshed_at is set.
        
        Returns the number of new job rows inserted.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        
        inserted = 0
        for job in new_jobs:
            # Check if a result already exists for this (category, skill_name/activity_name)
            existing_id = None
            if job.get('skill_name'):
                cursor.execute("""
                    SELECT id FROM stats_report_gearsets
                    WHERE run_id = ? AND category = ? AND skill_name = ?
                """, (run_id, job['category'], job['skill_name']))
            elif job.get('activity_name'):
                cursor.execute("""
                    SELECT id FROM stats_report_gearsets
                    WHERE run_id = ? AND category = ? AND activity_name = ?
                """, (run_id, job['category'], job['activity_name']))
            else:
                cursor.execute("""
                    SELECT id FROM stats_report_gearsets
                    WHERE run_id = ? AND category = ? AND chest_name = ?
                """, (run_id, job['category'], job.get('chest_name')))
            
            row = cursor.fetchone()
            if row:
                # Overwrite existing result — reset to pending and set refreshed_at
                cursor.execute("""
                    UPDATE stats_report_gearsets
                    SET job_status = 'pending', metric_value = NULL, metric_name = NULL,
                        gearset_export = NULL, error_message = NULL, refreshed_at = ?
                    WHERE id = ?
                """, (now, row[0]))
            else:
                # Insert new pending row
                cursor.execute("""
                    INSERT INTO stats_report_gearsets
                        (id, run_id, session_uuid, category, activity_name, skill_name,
                         chest_name, job_status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """, (job['id'], run_id, job['session_uuid'], job['category'],
                      job.get('activity_name'), job.get('skill_name'),
                      job.get('chest_name'), now))
                inserted += 1
        
        # Increment total_jobs by the number of new (non-overwrite) jobs
        if inserted > 0:
            cursor.execute("""
                UPDATE stats_report_runs
                SET total_jobs = total_jobs + ?, status = 'running'
                WHERE id = ?
            """, (inserted, run_id))
        elif new_jobs:
            # All were overwrites — still set status back to running
            cursor.execute("""
                UPDATE stats_report_runs SET status = 'running' WHERE id = ?
            """, (run_id,))
        
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return inserted

    # ========================================================================
    # TARGETED BROADCAST METHODS
    # ========================================================================

    def create_targeted_broadcast(self, message: str, session_uuids: list, created_by: str,
                                   send_push: bool = False, push_title: str = None, push_message: str = None) -> Dict[str, Any]:
        """Create a targeted broadcast visible only to specific sessions.

        Args:
            message: Broadcast message text
            session_uuids: List of session UUIDs that can see this broadcast
            created_by: Discord username who created it
            send_push: Whether to send a push notification for this broadcast
            push_title: Optional push notification title (defaults to "Walkscape Optimizer")
            push_message: Optional push notification body (short blurb)

        Returns:
            Dict with broadcast data
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()

        broadcast_id = str(uuid.uuid4())
        uuids_json = _json.dumps(session_uuids)
        cursor.execute("""
            INSERT INTO targeted_broadcasts (id, message, session_uuids, created_at, created_by, active, send_push, push_title, push_message)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
        """, (broadcast_id, message, uuids_json, created_by, 1 if send_push else 0, push_title, push_message))
        conn.commit()

        cursor.execute(
            "SELECT id, message, session_uuids, created_at, created_by, active, send_push, push_title, push_message FROM targeted_broadcasts WHERE id = ?",
            (broadcast_id,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': row[0],
            'message': row[1],
            'session_uuids': _json.loads(row[2]),
            'created_at': row[3],
            'created_by': row[4],
            'active': bool(row[5]),
            'send_push': bool(row[6]),
            'push_title': row[7],
            'push_message': row[8],
        }

    def get_targeted_broadcasts_for_session(self, session_uuid: str) -> list:
        """Get all active targeted broadcasts that include this session UUID.

        Args:
            session_uuid: The session to check

        Returns:
            List of broadcast dicts
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, session_uuids, created_at, created_by
            FROM targeted_broadcasts
            WHERE active = 1
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        results = []
        for row in rows:
            uuids = _json.loads(row[2])
            if session_uuid in uuids:
                results.append({
                    'id': row[0],
                    'message': row[1],
                    'session_uuids': uuids,
                    'created_at': row[3],
                    'created_by': row[4],
                })
        return results

    def clear_targeted_broadcast(self, broadcast_id: str) -> bool:
        """Deactivate a targeted broadcast by ID.

        Returns:
            True if a record was updated, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE targeted_broadcasts SET active = 0 WHERE id = ? AND active = 1",
            (broadcast_id,)
        )
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def add_uuids_to_targeted_broadcast(self, broadcast_id: str, new_uuids: list) -> Optional[Dict[str, Any]]:
        """Add session UUIDs to an existing active targeted broadcast.

        Returns:
            Updated broadcast dict, or None if not found
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, message, session_uuids FROM targeted_broadcasts WHERE id = ? AND active = 1",
            (broadcast_id,)
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return None

        existing = _json.loads(row[2])
        merged = list(dict.fromkeys(existing + new_uuids))
        cursor.execute(
            "UPDATE targeted_broadcasts SET session_uuids = ? WHERE id = ?",
            (_json.dumps(merged), broadcast_id)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {'id': row[0], 'message': row[1], 'session_uuids': merged}

    def list_targeted_broadcasts(self, active_only: bool = True) -> list:
        """List targeted broadcasts.

        Args:
            active_only: If True, only return active broadcasts

        Returns:
            List of broadcast dicts
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()

        if active_only:
            cursor.execute("""
                SELECT id, message, session_uuids, created_at, created_by, active
                FROM targeted_broadcasts WHERE active = 1
                ORDER BY created_at DESC
            """)
        else:
            cursor.execute("""
                SELECT id, message, session_uuids, created_at, created_by, active
                FROM targeted_broadcasts
                ORDER BY created_at DESC LIMIT 20
            """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        return [
            {
                'id': r[0],
                'message': r[1],
                'session_uuids': _json.loads(r[2]),
                'created_at': r[3],
                'created_by': r[4],
                'active': bool(r[5]),
            }
            for r in rows
        ]

    # ========================================================================
    # SESSION GROUP METHODS
    # ========================================================================

    def create_group(self, name: str, created_by: str) -> Dict[str, Any]:
        """Create a new empty session group."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO session_groups (name, session_uuids, created_at, created_by)
            VALUES (?, '[]', CURRENT_TIMESTAMP, ?)
        """, (name.upper(), created_by))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {'name': name.upper(), 'session_uuids': [], 'created_by': created_by}

    def add_to_group(self, name: str, session_uuids: list) -> bool:
        """Add session UUIDs to a group. Creates group if it doesn't exist."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        name = name.upper()

        cursor.execute("SELECT session_uuids FROM session_groups WHERE name = ?", (name,))
        row = cursor.fetchone()
        if row:
            existing = _json.loads(row[0])
        else:
            existing = []
            cursor.execute("""
                INSERT INTO session_groups (name, session_uuids, created_at, created_by)
                VALUES (?, '[]', CURRENT_TIMESTAMP, 'auto')
            """, (name,))

        # Merge without duplicates
        merged = list(dict.fromkeys(existing + session_uuids))
        cursor.execute(
            "UPDATE session_groups SET session_uuids = ? WHERE name = ?",
            (_json.dumps(merged), name)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def remove_from_group(self, name: str, session_uuids: list) -> bool:
        """Remove session UUIDs from a group."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        name = name.upper()

        cursor.execute("SELECT session_uuids FROM session_groups WHERE name = ?", (name,))
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False

        existing = _json.loads(row[0])
        remove_set = set(session_uuids)
        updated = [u for u in existing if u not in remove_set]
        cursor.execute(
            "UPDATE session_groups SET session_uuids = ? WHERE name = ?",
            (_json.dumps(updated), name)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def get_group(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a session group by name."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, session_uuids, created_at, created_by FROM session_groups WHERE name = ?",
            (name.upper(),)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'name': row[0],
            'session_uuids': _json.loads(row[1]),
            'created_at': row[2],
            'created_by': row[3],
        }

    def list_groups(self) -> list:
        """List all session groups."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name, session_uuids, created_at, created_by FROM session_groups ORDER BY name")
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'name': r[0],
                'session_uuids': _json.loads(r[1]),
                'created_at': r[2],
                'created_by': r[3],
            }
            for r in rows
        ]

    def delete_group(self, name: str) -> bool:
        """Delete a session group."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM session_groups WHERE name = ?", (name.upper(),))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def get_group_members_with_names(self, name: str) -> list:
        """Get group members with their character names."""
        import json as _json
        group = self.get_group(name)
        if not group:
            return []

        conn = self._get_connection()
        cursor = conn.cursor()
        results = []
        for uuid in group['session_uuids']:
            cursor.execute("SELECT character_config FROM sessions WHERE uuid = ?", (uuid,))
            row = cursor.fetchone()
            char_name = 'Unknown'
            if row and row[0]:
                try:
                    config = json.loads(row[0])
                    char_name = config.get('name', 'Unknown')
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append({'uuid': uuid, 'name': char_name})

        if not self._persistent_conn:
            conn.close()
        return results

    # ========================================================================
    # BROADCAST METHODS
    # ========================================================================

    def create_broadcast(self, message: str, created_by: str, valid_from: str = None, valid_until: str = None,
                         send_push: bool = False, push_title: str = None, push_message: str = None) -> Dict[str, Any]:
        """Create a new broadcast, deactivating any existing active broadcast.

        Args:
            message: Broadcast message text
            created_by: Discord username who created it
            valid_from: Optional ISO UTC timestamp — broadcast hidden before this time
            valid_until: Optional ISO UTC timestamp — broadcast hidden after this time
            send_push: Whether to send a push notification for this broadcast
            push_title: Optional push notification title (defaults to "Walkscape Optimizer")
            push_message: Optional push notification body (short blurb)

        Returns:
            Dict with broadcast id, message, created_at, created_by, active, valid_from, valid_until, send_push, push_title, push_message
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Deactivate existing active broadcasts
        cursor.execute("UPDATE broadcasts SET active = 0 WHERE active = 1")

        broadcast_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO broadcasts (id, message, created_at, created_by, active, valid_from, valid_until, send_push, push_title, push_message)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?, ?, ?)
        """, (broadcast_id, message, created_by, valid_from, valid_until, 1 if send_push else 0, push_title, push_message))
        conn.commit()

        cursor.execute(
            "SELECT id, message, created_at, created_by, active, valid_from, valid_until, send_push, push_title, push_message FROM broadcasts WHERE id = ?",
            (broadcast_id,)
        )
        row = cursor.fetchone()

        if not self._persistent_conn:
            conn.close()

        return {
            'id': row[0],
            'message': row[1],
            'created_at': row[2],
            'created_by': row[3],
            'active': bool(row[4]),
            'valid_from': row[5],
            'valid_until': row[6],
            'send_push': bool(row[7]),
            'push_title': row[8],
            'push_message': row[9],
        }

    def clear_broadcast(self) -> bool:
        """Deactivate all active broadcasts.

        Returns:
            True if any broadcast was deactivated, False if none were active
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("UPDATE broadcasts SET active = 0 WHERE active = 1")
        changed = cursor.rowcount > 0
        conn.commit()

        if not self._persistent_conn:
            conn.close()
        return changed

    def get_active_broadcast(self) -> Optional[Dict[str, Any]]:
        """Get the currently active broadcast, respecting valid_from/valid_until schedule.

        Returns:
            Dict with broadcast data or None if no active/scheduled broadcast
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, created_at, created_by, active, valid_from, valid_until
            FROM broadcasts
            WHERE active = 1
              AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
              AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP)
            ORDER BY created_at DESC
            LIMIT 1
        """)
        row = cursor.fetchone()

        if not self._persistent_conn:
            conn.close()

        if not row:
            return None

        return {
            'id': row[0],
            'message': row[1],
            'created_at': row[2],
            'created_by': row[3],
            'active': bool(row[4]),
            'valid_from': row[5],
            'valid_until': row[6],
        }

    def dismiss_broadcast(self, broadcast_id: str, session_uuid: str) -> bool:
        """Record a broadcast dismissal for a session.

        Handles duplicate dismissals gracefully (idempotent).

        Args:
            broadcast_id: ID of the broadcast being dismissed
            session_uuid: UUID of the session dismissing it

        Returns:
            True on success (including duplicate dismissal)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("""
                INSERT INTO broadcast_dismissals (broadcast_id, session_uuid, dismissed_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (broadcast_id, session_uuid))
            conn.commit()
        except sqlite3.IntegrityError:
            # Duplicate dismissal — that's fine, idempotent
            pass

        if not self._persistent_conn:
            conn.close()
        return True

    def get_broadcast_dismissal_count(self, broadcast_id: str) -> int:
        """Get the number of sessions that have dismissed a broadcast.

        Args:
            broadcast_id: ID of the broadcast

        Returns:
            Count of dismissals
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT COUNT(*) FROM broadcast_dismissals WHERE broadcast_id = ?",
            (broadcast_id,)
        )
        count = cursor.fetchone()[0]

        if not self._persistent_conn:
            conn.close()
        return count

    def list_broadcasts(self, limit: int = 50) -> list:
        """List all broadcasts ordered by creation date descending.

        Args:
            limit: Max number of broadcasts to return

        Returns:
            List of dicts with id, message, created_at, created_by, active, valid_from, valid_until
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, created_at, created_by, active, valid_from, valid_until
            FROM broadcasts
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        return [
            {
                'id': row[0],
                'message': row[1],
                'created_at': row[2],
                'created_by': row[3],
                'active': bool(row[4]),
                'valid_from': row[5],
                'valid_until': row[6],
            }
            for row in rows
        ]

    # ========================================================================
    # SESSION SNAPSHOT METHODS
    # ========================================================================

    def create_snapshot(self, original_uuid: str, description: str = None,
                        created_by: str = 'admin') -> Optional[Dict[str, Any]]:
        """Create a snapshot of a session (copies character_config, ui_config, gear_sets, feature_flags).

        Args:
            original_uuid: UUID of the session to snapshot
            description: Optional description
            created_by: Who created the snapshot

        Returns:
            Dict with snapshot info, or None if original session not found
        """
        session = self.get_session(original_uuid)
        if not session:
            return None

        # Create snapshot session with new UUID
        snapshot_uuid = str(uuid.uuid4())
        self.create_session(snapshot_uuid)

        # Copy character_config and ui_config
        if session.get('character_config'):
            self.update_character_config(snapshot_uuid, session['character_config'])
        if session.get('ui_config'):
            self.update_ui_config(snapshot_uuid, session['ui_config'])

        # Copy owned items + inventory value to the snapshot. Without this the
        # snapshot session has an empty inventory, so "Export Config" run on a
        # snapshot exports no owned items, and the goals-report / crafting
        # optimizer produces no results when a reviewer runs it. get_session
        # returns all_items_raw as the RAW json string (or None);
        # update_all_items_raw re-serialises a dict, so parse it back first.
        raw_items = session.get('all_items_raw')
        if raw_items:
            try:
                items_dict = json.loads(raw_items) if isinstance(raw_items, str) else raw_items
                self.update_all_items_raw(snapshot_uuid, items_dict)
            except Exception:
                pass
        inv_value = session.get('inventory_value')
        if inv_value is not None:
            try:
                self.update_inventory_value(snapshot_uuid, inv_value)
            except Exception:
                pass

        # Copy gear sets
        gear_sets = self.get_gear_sets(original_uuid)
        for gs in gear_sets:
            self.create_gear_set(
                session_uuid=snapshot_uuid,
                name=gs['name'],
                slots_json=gs['slots_json'],
                is_optimized=gs.get('is_optimized', False),
                export_string=gs.get('export_string'),
            )

        # Copy feature flags
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT feature, enabled_by FROM feature_flags WHERE session_uuid = ?",
            (original_uuid,)
        )
        for row in cursor.fetchall():
            self.enable_feature(snapshot_uuid, row[0], f"snapshot-of-{row[1]}")

        # Copy the goals-report (stats_report_*) state so the snapshot
        # reproduces the report exactly (results + stale badges + prev snapshot).
        try:
            self.copy_stats_report_data(original_uuid, snapshot_uuid)
        except Exception as _e:
            pass

        # Record the snapshot
        snapshot_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO session_snapshots (id, original_session_uuid, snapshot_session_uuid,
                                           description, created_at, created_by)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        """, (snapshot_id, original_uuid, snapshot_uuid, description, created_by))
        conn.commit()

        if not self._persistent_conn:
            conn.close()

        return {
            'id': snapshot_id,
            'original_session_uuid': original_uuid,
            'snapshot_session_uuid': snapshot_uuid,
            'description': description,
            'created_by': created_by,
        }

    def list_snapshots(self, original_uuid: str = None) -> list:
        """List session snapshots, optionally filtered by original session.

        Args:
            original_uuid: If provided, only snapshots of this session

        Returns:
            List of snapshot dicts
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        if original_uuid:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid,
                       description, created_at, created_by
                FROM session_snapshots
                WHERE original_session_uuid = ?
                ORDER BY created_at DESC
            """, (original_uuid,))
        else:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid,
                       description, created_at, created_by
                FROM session_snapshots
                ORDER BY created_at DESC
            """)

        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        return [
            {
                'id': r[0],
                'original_session_uuid': r[1],
                'snapshot_session_uuid': r[2],
                'description': r[3],
                'created_at': r[4],
                'created_by': r[5],
            }
            for r in rows
        ]

    def delete_snapshot(self, snapshot_id: str) -> bool:
        """Delete a snapshot and its associated session data.

        Args:
            snapshot_id: Snapshot record ID

        Returns:
            True if deleted
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT snapshot_session_uuid FROM session_snapshots WHERE id = ?",
            (snapshot_id,)
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False

        snapshot_uuid = row[0]

        # Delete the snapshot record
        cursor.execute("DELETE FROM session_snapshots WHERE id = ?", (snapshot_id,))
        conn.commit()

        if not self._persistent_conn:
            conn.close()

        # Delete the snapshot session and all its data
        self.delete_session(snapshot_uuid)
        return True



    # ========================================================================
    # GENERIC DEFINITIONS (Activities, Recipes, Services)
    # ========================================================================

    # --- Generic Activities ---

    def save_generic_activity(self, session_uuid: str, name: str, skill: str,
                              location: str, base_steps: int, base_xp: float,
                              max_efficiency: float, required_level: int = 1,
                              is_public: bool = True, source: str = None,
                              icon: str = '⚡', contributed_by: str = None,
                              requirements_json: str = '{}',
                              icon_color: str = None,
                              secondary_xp_json: str = '{}') -> dict:
        """Save a new generic activity definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_activities
                (id, session_uuid, name, skill, location, base_steps, base_xp,
                 max_efficiency, required_level, is_public, source, icon, contributed_by,
                 requirements_json, icon_color, secondary_xp_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, skill, location, base_steps, base_xp,
              max_efficiency, required_level, 1 if is_public else 0, source, icon,
              contributed_by, requirements_json, icon_color, secondary_xp_json, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'skill': skill, 'location': location, 'base_steps': base_steps,
            'base_xp': base_xp, 'max_efficiency': max_efficiency,
            'required_level': required_level, 'is_public': is_public,
            'source': source, 'icon': icon, 'icon_color': icon_color,
            'contributed_by': contributed_by,
            'requirements_json': requirements_json,
            'secondary_xp_json': secondary_xp_json,
            'created_at': now, 'updated_at': now
        }

    def get_generic_activities_by_session(self, session_uuid: str) -> list:
        """Get all generic activities for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, base_steps, base_xp,
                   max_efficiency, required_level, is_public, source, created_at, updated_at,
                   icon, contributed_by, requirements_json, icon_color, secondary_xp_json
            FROM generic_activities WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_activity(r) for r in rows]

    def get_public_generic_activities(self) -> list:
        """Get all public generic activities (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, base_steps, base_xp,
                   max_efficiency, required_level, is_public, source, created_at, updated_at,
                   icon, contributed_by, requirements_json, icon_color, secondary_xp_json
            FROM generic_activities WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_activity(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_activity(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic activity.

        Accepts keyword args for any updatable column (name, skill, location,
        base_steps, base_xp, max_efficiency, required_level, is_public, source).

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'skill', 'location', 'base_steps', 'base_xp',
                    'max_efficiency', 'required_level', 'is_public', 'source', 'icon',
                    'contributed_by', 'requirements_json', 'icon_color', 'secondary_xp_json'}
        return self._update_generic('generic_activities', session_uuid, def_id, allowed, kwargs)

    def delete_generic_activity(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic activity. Returns True if deleted."""
        return self._delete_generic('generic_activities', session_uuid, def_id)

    # --- Generic Recipes ---

    def save_generic_recipe(self, session_uuid: str, name: str, skill: str,
                            base_steps: int, base_xp: float, max_efficiency: float,
                            required_level: int = 1, service_id: str = None,
                            is_public: bool = True, source: str = None,
                            icon: str = '⚡', contributed_by: str = None,
                            is_quality_item: bool = False,
                            requirements_json: str = '{}',
                            icon_color: str = None) -> dict:
        """Save a new generic recipe definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_recipes
                (id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                 required_level, service_id, is_public, source, icon, contributed_by,
                 is_quality_item, requirements_json, icon_color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, skill, base_steps, base_xp,
              max_efficiency, required_level, service_id,
              1 if is_public else 0, source, icon, contributed_by,
              1 if is_quality_item else 0, requirements_json, icon_color, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'skill': skill, 'base_steps': base_steps, 'base_xp': base_xp,
            'max_efficiency': max_efficiency, 'required_level': required_level,
            'service_id': service_id, 'is_public': is_public,
            'source': source, 'icon': icon, 'icon_color': icon_color,
            'contributed_by': contributed_by,
            'created_at': now, 'updated_at': now
        }

    def get_generic_recipes_by_session(self, session_uuid: str) -> list:
        """Get all generic recipes for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                   required_level, service_id, is_public, source, created_at, updated_at,
                   icon, contributed_by, is_quality_item, requirements_json, icon_color
            FROM generic_recipes WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_recipe(r) for r in rows]

    def get_public_generic_recipes(self) -> list:
        """Get all public generic recipes (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                   required_level, service_id, is_public, source, created_at, updated_at,
                   icon, contributed_by, is_quality_item, requirements_json, icon_color
            FROM generic_recipes WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_recipe(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_recipe(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic recipe.

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'skill', 'base_steps', 'base_xp', 'max_efficiency',
                    'required_level', 'service_id', 'is_public', 'source', 'contributed_by',
                    'is_quality_item', 'requirements_json', 'icon_color'}
        return self._update_generic('generic_recipes', session_uuid, def_id, allowed, kwargs)

    def delete_generic_recipe(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic recipe. Returns True if deleted."""
        return self._delete_generic('generic_recipes', session_uuid, def_id)

    # --- Generic Services ---

    def save_generic_service(self, session_uuid: str, name: str, skill: str,
                             location: str, stats_json: str = '{}',
                             is_public: bool = True, source: str = None,
                             icon: str = '⚡', contributed_by: str = None,
                             tier: str = 'basic', icon_color: str = None) -> dict:
        """Save a new generic service definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_services
                (id, session_uuid, name, skill, location, stats_json,
                 is_public, source, icon, contributed_by, tier, icon_color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, skill, location, stats_json,
              1 if is_public else 0, source, icon, contributed_by, tier, icon_color, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'skill': skill, 'location': location, 'tier': tier,
            'stats': json.loads(stats_json) if isinstance(stats_json, str) else stats_json,
            'is_public': is_public, 'source': source, 'icon': icon,
            'icon_color': icon_color, 'contributed_by': contributed_by,
            'created_at': now, 'updated_at': now
        }

    def get_generic_services_by_session(self, session_uuid: str) -> list:
        """Get all generic services for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, stats_json,
                   is_public, source, created_at, updated_at, icon, contributed_by, tier, icon_color
            FROM generic_services WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_service(r) for r in rows]

    def get_public_generic_services(self) -> list:
        """Get all public generic services (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, stats_json,
                   is_public, source, created_at, updated_at, icon, contributed_by, tier, icon_color
            FROM generic_services WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_service(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_service(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic service.

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'skill', 'location', 'stats_json', 'is_public', 'source',
                    'contributed_by', 'icon', 'tier', 'icon_color'}
        return self._update_generic('generic_services', session_uuid, def_id, allowed, kwargs)

    def delete_generic_service(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic service. Returns True if deleted."""
        return self._delete_generic('generic_services', session_uuid, def_id)

    # --- Generic Items ---

    def save_generic_item(self, session_uuid: str, name: str, icon: str = '⚡',
                          icon_color: str = None, slot: str = None,
                          keywords: str = '[]', stats_json: str = '{}',
                          quality_stats_json: str = None, rarity: str = 'common',
                          is_crafted: bool = False, is_public: bool = True,
                          source: str = None, contributed_by: str = None,
                          export_item_name: str = None,
                          duration: int = 1000,
                          value: int = 0,
                          quality_values_json: str = None,
                          gated_stats_json: str = '{}',
                          icon_path: str = None,
                          gear_set_export: str = None,
                          data_status: str = None) -> dict:
        """Save a new generic item definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_items
                (id, session_uuid, name, icon, icon_color, slot, keywords,
                 stats_json, quality_stats_json, rarity, is_crafted, is_public,
                 source, contributed_by, export_item_name, duration,
                 value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, icon, icon_color, slot, keywords,
              stats_json, quality_stats_json, rarity, 1 if is_crafted else 0,
              1 if is_public else 0, source, contributed_by, export_item_name,
              duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'icon': icon, 'icon_color': icon_color, 'slot': slot,
            'keywords': json.loads(keywords) if isinstance(keywords, str) else keywords,
            'stats': json.loads(stats_json) if isinstance(stats_json, str) else stats_json,
            'quality_stats': json.loads(quality_stats_json) if isinstance(quality_stats_json, str) and quality_stats_json else quality_stats_json,
            'rarity': rarity, 'is_crafted': bool(is_crafted),
            'is_public': is_public, 'source': source,
            'contributed_by': contributed_by,
            'export_item_name': export_item_name,
            'gear_set_export': gear_set_export,
            'data_status': data_status,
            'duration': duration,
            'value': value,
            'quality_values': json.loads(quality_values_json) if isinstance(quality_values_json, str) and quality_values_json else quality_values_json,
            'gated_stats': json.loads(gated_stats_json) if isinstance(gated_stats_json, str) and gated_stats_json else {},
            'icon_path': icon_path,
            'created_at': now, 'updated_at': now
        }

    def get_generic_items_by_session(self, session_uuid: str) -> list:
        """Get all generic items for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                   stats_json, quality_stats_json, rarity, is_crafted, is_public,
                   source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
            FROM generic_items WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_item(r) for r in rows]

    def get_generic_item_by_id(self, item_id: str) -> Optional[dict]:
        """Get a single generic item by its ID (any session)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                   stats_json, quality_stats_json, rarity, is_crafted, is_public,
                   source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
            FROM generic_items WHERE id = ?
        """, (item_id,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return self._row_to_generic_item(row) if row else None

    def get_public_generic_items(self) -> list:
        """Get all public generic items (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                   stats_json, quality_stats_json, rarity, is_crafted, is_public,
                   source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
            FROM generic_items WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_item(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_item(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic item.

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'icon', 'icon_color', 'slot', 'keywords', 'stats_json',
                    'quality_stats_json', 'rarity', 'is_crafted', 'is_public', 'source',
                    'contributed_by', 'export_item_name', 'gear_set_export', 'data_status', 'duration',
                    'value', 'quality_values_json', 'gated_stats_json', 'icon_path'}
        return self._update_generic('generic_items', session_uuid, def_id, allowed, kwargs)

    def delete_generic_item(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic item. Returns True if deleted."""
        return self._delete_generic('generic_items', session_uuid, def_id)

    # --- Sharing toggle (works for all types) ---

    def toggle_generic_sharing(self, session_uuid: str, def_type: str,
                               def_id: str, is_public: bool) -> bool:
        """Toggle the is_public flag on a generic definition.

        Args:
            session_uuid: Owner session
            def_type: 'activity', 'recipe', or 'service'
            def_id: Definition UUID
            is_public: New sharing state

        Returns:
            True if updated.
        """
        table_map = {
            'activity': 'generic_activities',
            'recipe': 'generic_recipes',
            'service': 'generic_services',
            'item': 'generic_items',
        }
        table = table_map.get(def_type)
        if not table:
            return False

        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute(f"""
            UPDATE {table} SET is_public = ?, updated_at = ?
            WHERE id = ? AND session_uuid = ?
        """, (1 if is_public else 0, now, def_id, session_uuid))
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    # --- Get single generic definition by id ---

    def get_generic_definition(self, def_type: str, def_id: str) -> Optional[dict]:
        """Get a single generic definition by type and id.

        Args:
            def_type: 'activity', 'recipe', 'service', or 'item'
            def_id: Definition UUID

        Returns:
            Definition dict or None if not found.
        """
        table_map = {
            'activity': 'generic_activities',
            'recipe': 'generic_recipes',
            'service': 'generic_services',
            'item': 'generic_items',
        }
        table = table_map.get(def_type)
        if not table:
            return None

        conn = self._get_connection()
        cursor = conn.cursor()

        if def_type == 'activity':
            cursor.execute("""
                SELECT id, session_uuid, name, skill, location, base_steps, base_xp,
                       max_efficiency, required_level, is_public, source, created_at, updated_at,
                       icon, contributed_by, requirements_json, icon_color, secondary_xp_json
                FROM generic_activities WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_activity(row) if row else None

        elif def_type == 'recipe':
            cursor.execute("""
                SELECT id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                       required_level, service_id, is_public, source, created_at, updated_at,
                       icon, contributed_by, is_quality_item, requirements_json, icon_color
                FROM generic_recipes WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_recipe(row) if row else None

        elif def_type == 'item':
            cursor.execute("""
                SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                       stats_json, quality_stats_json, rarity, is_crafted, is_public,
                       source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
                FROM generic_items WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_item(row) if row else None

        else:  # service
            cursor.execute("""
                SELECT id, session_uuid, name, skill, location, stats_json,
                       is_public, source, created_at, updated_at, icon, contributed_by, tier
                FROM generic_services WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_service(row) if row else None

    # --- Private helpers for generic definitions ---

    def _row_to_generic_activity(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'skill': row[3], 'location': row[4], 'base_steps': row[5],
            'base_xp': row[6], 'max_efficiency': row[7],
            'required_level': row[8], 'is_public': bool(row[9]),
            'source': row[10], 'created_at': row[11], 'updated_at': row[12]
        }
        if len(row) > 13:
            d['icon'] = row[13] or '⚡'
        else:
            d['icon'] = '⚡'
        if len(row) > 14:
            d['contributed_by'] = row[14]
        else:
            d['contributed_by'] = None
        if len(row) > 15:
            d['requirements_json'] = row[15] or '{}'
        else:
            d['requirements_json'] = '{}'
        if len(row) > 16:
            d['icon_color'] = row[16]
        else:
            d['icon_color'] = None
        if len(row) > 17:
            d['secondary_xp_json'] = row[17] or '{}'
        else:
            d['secondary_xp_json'] = '{}'
        return d

    def _row_to_generic_recipe(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'skill': row[3], 'base_steps': row[4], 'base_xp': row[5],
            'max_efficiency': row[6], 'required_level': row[7],
            'service_id': row[8], 'is_public': bool(row[9]),
            'source': row[10], 'created_at': row[11], 'updated_at': row[12]
        }
        if len(row) > 13:
            d['icon'] = row[13] or '⚡'
        else:
            d['icon'] = '⚡'
        if len(row) > 14:
            d['contributed_by'] = row[14]
        else:
            d['contributed_by'] = None
        if len(row) > 15:
            d['is_quality_item'] = bool(row[15])
        else:
            d['is_quality_item'] = False
        if len(row) > 16:
            d['requirements_json'] = row[16] or '{}'
        else:
            d['requirements_json'] = '{}'
        if len(row) > 17:
            d['icon_color'] = row[17]
        else:
            d['icon_color'] = None
        return d

    def _row_to_generic_service(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'skill': row[3], 'location': row[4],
            'stats': json.loads(row[5]) if row[5] else {},
            'is_public': bool(row[6]), 'source': row[7],
            'created_at': row[8], 'updated_at': row[9]
        }
        if len(row) > 10:
            d['icon'] = row[10] or '⚡'
        else:
            d['icon'] = '⚡'
        if len(row) > 11:
            d['contributed_by'] = row[11]
        else:
            d['contributed_by'] = None
        if len(row) > 12:
            d['tier'] = row[12] or 'basic'
        else:
            d['tier'] = 'basic'
        if len(row) > 13:
            d['icon_color'] = row[13]
        else:
            d['icon_color'] = None
        return d

    def _row_to_generic_item(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'icon': row[3] or '⚡', 'icon_color': row[4],
            'slot': row[5],
            'keywords': json.loads(row[6]) if row[6] else [],
            'stats': json.loads(row[7]) if row[7] else {},
            'quality_stats': json.loads(row[8]) if row[8] else None,
            'rarity': row[9], 'is_crafted': bool(row[10]),
            'is_public': bool(row[11]), 'source': row[12],
            'contributed_by': row[13],
            'created_at': row[14], 'updated_at': row[15]
        }
        if len(row) > 16:
            d['export_item_name'] = row[16]
        else:
            d['export_item_name'] = None
        if len(row) > 17:
            d['duration'] = row[17] or 1000
        else:
            d['duration'] = 1000
        if len(row) > 18:
            d['value'] = row[18] or 0
        else:
            d['value'] = 0
        if len(row) > 19:
            d['quality_values'] = json.loads(row[19]) if row[19] else None
        else:
            d['quality_values'] = None
        if len(row) > 20:
            d['gated_stats'] = json.loads(row[20]) if row[20] else {}
        else:
            d['gated_stats'] = {}
        if len(row) > 21:
            d['icon_path'] = row[21]
        else:
            d['icon_path'] = None
        if len(row) > 22:
            d['gear_set_export'] = row[22]
        else:
            d['gear_set_export'] = None
        if len(row) > 23:
            d['data_status'] = row[23]
        else:
            d['data_status'] = None
        return d

    # --- Generic Keywords ---

    def get_all_custom_keywords(self) -> list:
        """Get all custom keywords (user-created, not from wiki). Case-insensitive dedup."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            # Deduplicate by LOWER(name), keeping the most recently created entry
            cursor.execute("""
                SELECT id, name, banned, icon, contributed_by, source, created_at, icon_color
                FROM generic_keywords
                WHERE id IN (
                    SELECT id FROM generic_keywords g1
                    WHERE created_at = (
                        SELECT MAX(created_at) FROM generic_keywords g2
                        WHERE LOWER(g2.name) = LOWER(g1.name)
                    )
                    GROUP BY LOWER(name)
                )
                ORDER BY name COLLATE NOCASE
            """)
            rows = cursor.fetchall()
        except Exception:
            rows = []
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'name': r[1], 'banned': bool(r[2]), 'icon': r[3] or '🏷️',
                 'contributed_by': r[4], 'source': r[5], 'created_at': r[6],
                 'icon_color': r[7] if len(r) > 7 else None} for r in rows]

    def save_custom_keyword(self, name: str, icon: str = '🏷️', banned: bool = True,
                            contributed_by: str = None, icon_color: str = None) -> dict:
        """Save a new custom keyword. Case-insensitive dedup. Returns the saved keyword dict."""
        import uuid as _uuid
        new_id = str(_uuid.uuid4())
        now = _utc_now()
        conn = self._get_connection()
        cursor = conn.cursor()
        # Check for case-insensitive duplicate
        cursor.execute("SELECT id, name, icon, icon_color FROM generic_keywords WHERE LOWER(name) = LOWER(?)", (name,))
        existing = cursor.fetchone()
        if existing:
            # Update icon/color if changed
            cursor.execute("UPDATE generic_keywords SET icon = ?, icon_color = ?, updated_at = ? WHERE id = ?",
                           (icon, icon_color, now, existing[0]))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return {'id': existing[0], 'name': existing[1], 'banned': banned, 'icon': icon,
                    'icon_color': icon_color, 'contributed_by': contributed_by, 'created_at': now}
        cursor.execute("""
            INSERT INTO generic_keywords (id, name, banned, icon, icon_color, contributed_by, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        """, (new_id, name, 1 if banned else 0, icon, icon_color, contributed_by, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {'id': new_id, 'name': name, 'banned': banned, 'icon': icon,
                'icon_color': icon_color, 'contributed_by': contributed_by, 'created_at': now}

    def delete_custom_keyword(self, keyword_id: str) -> bool:
        """Delete a custom keyword by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM generic_keywords WHERE id = ? AND source IS NULL", (keyword_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def _update_generic(self, table: str, session_uuid: str, def_id: str,
                        allowed: set, kwargs: dict) -> bool:
        """Generic update helper for generic definition tables."""
        fields = {k: v for k, v in kwargs.items() if k in allowed}
        if not fields:
            return False

        # Convert is_public bool to int for SQLite
        if 'is_public' in fields:
            fields['is_public'] = 1 if fields['is_public'] else 0
        if 'is_crafted' in fields:
            fields['is_crafted'] = 1 if fields['is_crafted'] else 0

        fields['updated_at'] = _utc_now()

        # JSON-serialize any list/dict values for SQLite storage
        import json as _json
        for k, v in fields.items():
            if isinstance(v, (list, dict)):
                fields[k] = _json.dumps(v)

        set_clause = ', '.join(f'{k} = ?' for k in fields)
        values = list(fields.values()) + [def_id, session_uuid]

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE {table} SET {set_clause} WHERE id = ? AND session_uuid = ?
        """, values)
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def _delete_generic(self, table: str, session_uuid: str, def_id: str) -> bool:
        """Generic delete helper for generic definition tables."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            DELETE FROM {table} WHERE id = ? AND session_uuid = ?
        """, (def_id, session_uuid))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # PUSH SUBSCRIPTION CRUD METHODS
    # ========================================================================

    def upsert_push_subscription(self, session_uuid: str, endpoint: str, p256dh: str, auth: str) -> None:
        """Insert or replace a push subscription keyed by endpoint.

        Args:
            session_uuid: Session UUID that owns this subscription
            endpoint: Push endpoint URL (unique key)
            p256dh: P-256 Diffie-Hellman public key
            auth: Authentication secret
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            INSERT INTO push_subscriptions (session_uuid, endpoint, p256dh_key, auth_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                session_uuid = excluded.session_uuid,
                p256dh_key = excluded.p256dh_key,
                auth_key = excluded.auth_key,
                updated_at = excluded.updated_at
        """, (session_uuid, endpoint, p256dh, auth, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def delete_push_subscription(self, endpoint: str) -> bool:
        """Remove a push subscription by endpoint URL.

        Args:
            endpoint: Push endpoint URL to remove

        Returns:
            True if a row was deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def get_push_subscriptions_for_session(self, session_uuid: str) -> list:
        """Get all push subscriptions for a session.

        Args:
            session_uuid: Session UUID

        Returns:
            List of dicts with endpoint, p256dh_key, auth_key, created_at, updated_at
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT session_uuid, endpoint, p256dh_key, auth_key, created_at, updated_at
            FROM push_subscriptions
            WHERE session_uuid = ?
            ORDER BY created_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'session_uuid': r[0],
                'endpoint': r[1],
                'p256dh': r[2],
                'auth': r[3],
                'created_at': r[4],
                'updated_at': r[5],
            }
            for r in rows
        ]

    def get_all_push_subscriptions_for_global(self, pref_key: str) -> list:
        """Get all push subscriptions where notification_preferences has pref_key=1.

        Used for global broadcast sends.

        Args:
            pref_key: Column name in notification_preferences (e.g. 'global_announcements')

        Returns:
            List of dicts with session_uuid, endpoint, p256dh, auth
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        # Only allow known column names to prevent SQL injection
        allowed_keys = {'global_announcements', 'targeted_announcements'}
        if pref_key not in allowed_keys:
            if not self._persistent_conn:
                conn.close()
            return []
        cursor.execute(f"""
            SELECT ps.session_uuid, ps.endpoint, ps.p256dh_key, ps.auth_key
            FROM push_subscriptions ps
            INNER JOIN notification_preferences np ON ps.session_uuid = np.session_uuid
            WHERE np.{pref_key} = 1
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'session_uuid': r[0],
                'endpoint': r[1],
                'p256dh': r[2],
                'auth': r[3],
            }
            for r in rows
        ]

    def get_push_subscriptions_for_sessions(self, session_uuids: list, pref_key: str) -> list:
        """Get push subscriptions for specific sessions where pref_key=1.

        Used for targeted broadcast sends.

        Args:
            session_uuids: List of session UUIDs to target
            pref_key: Column name in notification_preferences

        Returns:
            List of dicts with session_uuid, endpoint, p256dh, auth
        """
        if not session_uuids:
            return []
        conn = self._get_connection()
        cursor = conn.cursor()
        # Only allow known column names to prevent SQL injection
        allowed_keys = {'global_announcements', 'targeted_announcements'}
        if pref_key not in allowed_keys:
            if not self._persistent_conn:
                conn.close()
            return []
        placeholders = ','.join('?' * len(session_uuids))
        cursor.execute(f"""
            SELECT ps.session_uuid, ps.endpoint, ps.p256dh_key, ps.auth_key
            FROM push_subscriptions ps
            INNER JOIN notification_preferences np ON ps.session_uuid = np.session_uuid
            WHERE ps.session_uuid IN ({placeholders})
              AND np.{pref_key} = 1
        """, session_uuids)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'session_uuid': r[0],
                'endpoint': r[1],
                'p256dh': r[2],
                'auth': r[3],
            }
            for r in rows
        ]

    # ========================================================================
    # NOTIFICATION PREFERENCES CRUD METHODS
    # ========================================================================

    def upsert_notification_preferences(self, session_uuid: str, global_announcements: bool, targeted_announcements: bool, trading: Optional[bool] = None) -> None:
        """Insert or update notification preferences for a session.

        Args:
            session_uuid: Session UUID
            global_announcements: Whether to receive global broadcast push notifications
            targeted_announcements: Whether to receive targeted push notifications
            trading: Explicit trading-notification choice. None leaves the stored
                value untouched (unset → follows targeted_announcements).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        trading_val = None if trading is None else (1 if trading else 0)
        cursor.execute("""
            INSERT INTO notification_preferences (session_uuid, global_announcements, targeted_announcements, trading, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_uuid) DO UPDATE SET
                global_announcements = excluded.global_announcements,
                targeted_announcements = excluded.targeted_announcements,
                trading = COALESCE(excluded.trading, notification_preferences.trading),
                updated_at = excluded.updated_at
        """, (session_uuid, 1 if global_announcements else 0, 1 if targeted_announcements else 0, trading_val, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_notification_preferences(self, session_uuid: str) -> dict:
        """Get notification preferences for a session.

        Args:
            session_uuid: Session UUID

        Returns:
            Dict with 'global_announcements' and 'targeted_announcements' booleans.
            Defaults to False for both if no preferences are stored.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT global_announcements, targeted_announcements, trading
            FROM notification_preferences
            WHERE session_uuid = ?
        """, (session_uuid,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if row is None:
            return {'global_announcements': False, 'targeted_announcements': False, 'trading': False}
        targeted = bool(row[1])
        # trading NULL = unset → follow Personal notifications (targeted).
        trading = targeted if row[2] is None else bool(row[2])
        return {
            'global_announcements': bool(row[0]),
            'targeted_announcements': targeted,
            'trading': trading,
        }

    # ========================================================================
    # PUSH NOTIFICATION EVENTS CRUD METHODS
    # ========================================================================

    def record_push_event(self, broadcast_id: Optional[str], targeted_broadcast_id: Optional[str],
                          session_uuid: str, endpoint: str, event_type: str,
                          status_code: Optional[int] = None) -> None:
        """Record a push notification delivery/analytics event.

        Computes SHA-256 of the endpoint URL for privacy-preserving analytics.

        Args:
            broadcast_id: Global broadcast ID (or None)
            targeted_broadcast_id: Targeted broadcast ID (or None)
            session_uuid: Session UUID
            endpoint: Push endpoint URL (hashed before storage)
            event_type: One of 'delivered', 'failed', 'clicked', 'dismissed'
            status_code: HTTP status code from push service (optional)
        """
        import hashlib
        endpoint_hash = hashlib.sha256(endpoint.encode('utf-8')).hexdigest()
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            INSERT INTO push_notification_events
                (broadcast_id, targeted_broadcast_id, session_uuid, endpoint_hash, event_type, status_code, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (broadcast_id, targeted_broadcast_id, session_uuid, endpoint_hash, event_type, status_code, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_push_analytics(self, broadcast_id: Optional[str] = None, targeted_broadcast_id: Optional[str] = None) -> dict:
        """Get push notification analytics for a broadcast.

        Args:
            broadcast_id: Global broadcast ID to filter by (or None)
            targeted_broadcast_id: Targeted broadcast ID to filter by (or None)

        Returns:
            Dict with delivered, failed, clicked, dismissed counts and click_through_rate
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        if broadcast_id is not None:
            cursor.execute("""
                SELECT event_type, COUNT(*) as cnt
                FROM push_notification_events
                WHERE broadcast_id = ?
                GROUP BY event_type
            """, (broadcast_id,))
        elif targeted_broadcast_id is not None:
            cursor.execute("""
                SELECT event_type, COUNT(*) as cnt
                FROM push_notification_events
                WHERE targeted_broadcast_id = ?
                GROUP BY event_type
            """, (targeted_broadcast_id,))
        else:
            cursor.execute("""
                SELECT event_type, COUNT(*) as cnt
                FROM push_notification_events
                GROUP BY event_type
            """)

        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        counts = {'delivered': 0, 'failed': 0, 'clicked': 0, 'dismissed': 0}
        for event_type, cnt in rows:
            if event_type in counts:
                counts[event_type] = cnt

        delivered = counts['delivered']
        clicked = counts['clicked']
        ctr = round(clicked / delivered * 100, 1) if delivered > 0 else 0.0

        return {
            'delivered': delivered,
            'failed': counts['failed'],
            'clicked': clicked,
            'dismissed': counts['dismissed'],
            'click_through_rate': ctr,
        }

    # ========================================================================
    # NOTEPAD (FAC-gated multi-note rich-text notes)
    # ========================================================================

    @staticmethod
    def _derive_note_title(content_json: str) -> str:
        """Title = first non-empty line of plain text, else 'Untitled'.

        content_json is a Quill Delta ({"ops":[...]}). Reconstruct plain text by
        concatenating string inserts (embeds -> a single space placeholder), then
        return the first line whose stripped text is non-empty, capped 120 chars.
        """
        import json as _json
        try:
            delta = _json.loads(content_json) if content_json else {}
            ops = delta.get('ops', []) if isinstance(delta, dict) else []
        except (ValueError, TypeError):
            ops = []
        parts = []
        for op in ops:
            ins = op.get('insert') if isinstance(op, dict) else None
            if isinstance(ins, str):
                parts.append(ins)
            elif ins is not None:
                parts.append(' ')  # embed (entity link / image) placeholder
        text = ''.join(parts)
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped:
                return stripped[:120]
        return 'Untitled'

    def count_notes(self, session_uuid: str) -> int:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM notes WHERE session_uuid = ?", (session_uuid,))
        n = cursor.fetchone()[0]
        if not self._persistent_conn:
            conn.close()
        return int(n)

    def list_notes(self, session_uuid: str) -> list:
        """List notes for a session, most-recently-updated first."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, title, updated_at FROM notes WHERE session_uuid = ? "
            "ORDER BY updated_at DESC, id",
            (session_uuid,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'title': r[1], 'updated_at': r[2]} for r in rows]

    def get_note(self, session_uuid: str, note_id: str) -> Optional[dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, title, content_json, created_at, updated_at FROM notes "
            "WHERE id = ? AND session_uuid = ?",
            (note_id, session_uuid),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {'id': row[0], 'title': row[1], 'content_json': row[2],
                'created_at': row[3], 'updated_at': row[4]}

    def create_note(self, session_uuid: str, content_json: Optional[str] = None) -> str:
        import uuid as _uuid
        note_id = str(_uuid.uuid4())
        if not content_json:
            content_json = '{"ops":[{"insert":"\\n"}]}'
        title = self._derive_note_title(content_json)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO notes (id, session_uuid, title, content_json) VALUES (?, ?, ?, ?)",
            (note_id, session_uuid, title, content_json),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return note_id

    def update_note(self, session_uuid: str, note_id: str, content_json: str) -> bool:
        """Update a note's content; re-derive title; bump updated_at."""
        title = self._derive_note_title(content_json)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notes SET content_json = ?, title = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND session_uuid = ?",
            (content_json, title, note_id, session_uuid),
        )
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def delete_note(self, session_uuid: str, note_id: str) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM notes WHERE id = ? AND session_uuid = ?",
            (note_id, session_uuid),
        )
        deleted = cursor.rowcount > 0
        cursor.execute(
            "UPDATE notepad_state SET selected_note_id = NULL, updated_at = CURRENT_TIMESTAMP "
            "WHERE session_uuid = ? AND selected_note_id = ?",
            (session_uuid, note_id),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def get_selected_note(self, session_uuid: str) -> Optional[str]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT selected_note_id FROM notepad_state WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row[0] if row and row[0] else None

    def set_selected_note(self, session_uuid: str, note_id: Optional[str]) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO notepad_state (session_uuid, selected_note_id, updated_at) "
            "VALUES (?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(session_uuid) DO UPDATE SET "
            "selected_note_id = excluded.selected_note_id, updated_at = CURRENT_TIMESTAMP",
            (session_uuid, note_id),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    # ========================================================================
    # ACHIEVEMENT TRACKER PROGRESS
    # ========================================================================

    def get_achievement_progress(self, session_uuid: str) -> dict:
        """Return the session's achievement-tracker progress blob (manual
        check-offs + reward reveals). Empty dict when none saved."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT data FROM achievement_progress WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row or not row[0]:
            return {}
        try:
            return json.loads(row[0])
        except (ValueError, TypeError):
            return {}

    def set_achievement_progress(self, session_uuid: str, data: dict) -> bool:
        """Upsert the session's achievement-tracker progress blob."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO achievement_progress (session_uuid, data, updated_at) "
            "VALUES (?, ?, CURRENT_TIMESTAMP)",
            (session_uuid, json.dumps(data or {})),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    # ========================================================================
    # SAVED CRAFTING TREES
    # ========================================================================

    def save_crafting_tree(self, session_uuid: str, name: str, target_item_id: str, tree_data: dict) -> str:
        """Save a crafting tree preset."""
        import uuid as _uuid
        tree_id = str(_uuid.uuid4())
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO saved_crafting_trees (id, session_uuid, name, target_item_id, tree_data) VALUES (?, ?, ?, ?, ?)",
            (tree_id, session_uuid, name, target_item_id, json.dumps(tree_data))
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return tree_id

    def list_crafting_trees(self, session_uuid: str) -> list:
        """List all saved crafting trees for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, target_item_id, created_at FROM saved_crafting_trees WHERE session_uuid = ? ORDER BY created_at DESC",
            (session_uuid,)
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'name': r[1], 'target_item_id': r[2], 'created_at': r[3]} for r in rows]

    def load_crafting_tree(self, tree_id: str, session_uuid: str) -> Optional[dict]:
        """Load a saved crafting tree by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, target_item_id, tree_data FROM saved_crafting_trees WHERE id = ? AND session_uuid = ?",
            (tree_id, session_uuid)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {'id': row[0], 'name': row[1], 'target_item_id': row[2], 'tree_data': json.loads(row[3])}

    def delete_crafting_tree(self, tree_id: str, session_uuid: str) -> bool:
        """Delete a saved crafting tree."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM saved_crafting_trees WHERE id = ? AND session_uuid = ?", (tree_id, session_uuid))
        conn.commit()
        deleted = cursor.rowcount > 0
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # ITEM UPGRADES TRACKER (FAC: upgrades_tracker; spec .kiro/specs/item-upgrades-tracker/)
    # ========================================================================

    def get_working_tracker(self, session_uuid: str) -> dict:
        """Return the session's working-draft tracker {entries:[...]}. Empty if none."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT entries_json FROM upgrades_trackers WHERE session_uuid = ? AND is_working = 1",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        entries = json.loads(row[0]) if row and row[0] else []
        return {"entries": entries}

    def save_working_tracker(self, session_uuid: str, entries: list) -> bool:
        """Upsert the session's working-draft row (is_working=1)."""
        import uuid as _uuid
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM upgrades_trackers WHERE session_uuid = ? AND is_working = 1",
            (session_uuid,)
        )
        row = cursor.fetchone()
        payload = json.dumps(entries or [])
        if row:
            conn.execute(
                "UPDATE upgrades_trackers SET entries_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (payload, row[0])
            )
        else:
            conn.execute(
                "INSERT INTO upgrades_trackers (id, session_uuid, name, entries_json, is_working) VALUES (?, ?, NULL, ?, 1)",
                (str(_uuid.uuid4()), session_uuid, payload)
            )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def list_trackers(self, session_uuid: str) -> list:
        """List saved (named) trackers for a session, newest first."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, entries_json, updated_at FROM upgrades_trackers "
            "WHERE session_uuid = ? AND is_working = 0 ORDER BY updated_at DESC",
            (session_uuid,)
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for r in rows:
            try:
                count = len(json.loads(r[2]) if r[2] else [])
            except Exception:
                count = 0
            out.append({'id': r[0], 'name': r[1], 'entry_count': count, 'updated_at': r[3]})
        return out

    def save_tracker(self, session_uuid: str, name: str, entries: list, tracker_id: str = None) -> str:
        """Create a new named tracker, or overwrite an existing one (by id) the session owns."""
        import uuid as _uuid
        conn = self._get_connection()
        cursor = conn.cursor()
        payload = json.dumps(entries or [])
        if tracker_id:
            cursor.execute(
                "SELECT id FROM upgrades_trackers WHERE id = ? AND session_uuid = ? AND is_working = 0",
                (tracker_id, session_uuid)
            )
            if cursor.fetchone():
                conn.execute(
                    "UPDATE upgrades_trackers SET name = ?, entries_json = ?, updated_at = CURRENT_TIMESTAMP "
                    "WHERE id = ? AND session_uuid = ?",
                    (name, payload, tracker_id, session_uuid)
                )
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return tracker_id
        new_id = str(_uuid.uuid4())
        conn.execute(
            "INSERT INTO upgrades_trackers (id, session_uuid, name, entries_json, is_working) VALUES (?, ?, ?, ?, 0)",
            (new_id, session_uuid, name, payload)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return new_id

    def load_tracker(self, tracker_id: str, session_uuid: str) -> Optional[dict]:
        """Load a saved tracker by id (session-scoped)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, entries_json, updated_at FROM upgrades_trackers "
            "WHERE id = ? AND session_uuid = ? AND is_working = 0",
            (tracker_id, session_uuid)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        try:
            entries = json.loads(row[2]) if row[2] else []
        except Exception:
            entries = []
        return {'id': row[0], 'name': row[1], 'entries': entries, 'updated_at': row[3]}

    def delete_tracker(self, tracker_id: str, session_uuid: str) -> bool:
        """Delete a saved tracker (session-scoped)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM upgrades_trackers WHERE id = ? AND session_uuid = ? AND is_working = 0",
            (tracker_id, session_uuid)
        )
        conn.commit()
        deleted = cursor.rowcount > 0
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # BANK LAYOUT SIMULATOR (spec: .kiro/BANK_LAYOUT_SPEC.md)
    # ========================================================================

    def create_bank_layout(self, session_uuid: str, name: str, tabs: list,
                           settings: dict, source: str = 'user',
                           schema_version: int = 1) -> str:
        """Create a new bank layout for a session. Returns the new layout id."""
        import uuid as _uuid
        layout_id = str(_uuid.uuid4())
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO bank_layouts (id, session_uuid, name, source, schema_version, "
            "settings_json, layout_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (layout_id, session_uuid, name, source, schema_version,
             json.dumps(settings or {}), json.dumps({'tabs': tabs or []}))
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return layout_id

    def update_bank_layout(self, layout_id: str, session_uuid: str, name: str,
                           tabs: list, settings: dict) -> bool:
        """Update an owned ('user' source) layout. Community/default are read-only."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE bank_layouts SET name = ?, layout_json = ?, settings_json = ?, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_uuid = ? AND source = 'user'",
            (name, json.dumps({'tabs': tabs or []}), json.dumps(settings or {}),
             layout_id, session_uuid)
        )
        conn.commit()
        updated = cursor.rowcount > 0
        if not self._persistent_conn:
            conn.close()
        return updated

    def list_bank_layouts(self, session_uuid: str) -> list:
        """List a session's own layouts (newest first)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, source, is_shared, share_id, updated_at FROM bank_layouts "
            "WHERE session_uuid = ? ORDER BY updated_at DESC",
            (session_uuid,)
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'name': r[1], 'source': r[2], 'is_shared': bool(r[3]),
                 'share_id': r[4], 'updated_at': r[5]} for r in rows]

    def load_bank_layout(self, layout_id: str, session_uuid: str) -> Optional[dict]:
        """Load one of the session's own layouts by id."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, source, schema_version, settings_json, layout_json, "
            "is_shared, share_id FROM bank_layouts WHERE id = ? AND session_uuid = ?",
            (layout_id, session_uuid)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {'id': row[0], 'name': row[1], 'source': row[2], 'schemaVersion': row[3],
                'settings': json.loads(row[4] or '{}'),
                'tabs': (json.loads(row[5] or '{}') or {}).get('tabs', []),
                'is_shared': bool(row[6]), 'share_id': row[7], 'readOnly': False}

    def delete_bank_layout(self, layout_id: str, session_uuid: str) -> bool:
        """Delete one of the session's own layouts."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM bank_layouts WHERE id = ? AND session_uuid = ?",
                       (layout_id, session_uuid))
        conn.commit()
        deleted = cursor.rowcount > 0
        if not self._persistent_conn:
            conn.close()
        return deleted

    def set_bank_share(self, layout_id: str, session_uuid: str, shared: bool,
                       search_text: str = '') -> Optional[str]:
        """Publish/unpublish an owned layout to the community. Returns share_id
        when shared, None when unshared or not found."""
        import uuid as _uuid
        conn = self._get_connection()
        cursor = conn.cursor()
        if shared:
            share_id = _uuid.uuid4().hex
            cursor.execute(
                "UPDATE bank_layouts SET is_shared = 1, share_id = ?, search_text = ?, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_uuid = ? AND source = 'user'",
                (share_id, search_text or '', layout_id, session_uuid)
            )
            result = share_id if cursor.rowcount > 0 else None
        else:
            cursor.execute(
                "UPDATE bank_layouts SET is_shared = 0, share_id = NULL, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_uuid = ?",
                (layout_id, session_uuid)
            )
            result = None
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return result

    def list_community_bank_layouts(self, query: str = '', limit: int = 100) -> list:
        """Search shared community layouts. ANONYMOUS: never exposes session_uuid or
        character name — only share_id, name, and created_at."""
        conn = self._get_connection()
        cursor = conn.cursor()
        if query:
            like = f"%{query.strip()}%"
            cursor.execute(
                "SELECT share_id, name, created_at FROM bank_layouts WHERE is_shared = 1 "
                "AND (name LIKE ? OR search_text LIKE ?) ORDER BY updated_at DESC LIMIT ?",
                (like, like, limit)
            )
        else:
            cursor.execute(
                "SELECT share_id, name, created_at FROM bank_layouts WHERE is_shared = 1 "
                "ORDER BY updated_at DESC LIMIT ?",
                (limit,)
            )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{'share_id': r[0], 'name': r[1], 'created_at': r[2]} for r in rows]

    def load_community_bank_layout(self, share_id: str) -> Optional[dict]:
        """Load a shared layout read-only and ANONYMOUS (no author identity)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, schema_version, settings_json, layout_json FROM bank_layouts "
            "WHERE share_id = ? AND is_shared = 1",
            (share_id,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {'share_id': share_id, 'name': row[0], 'source': 'community',
                'schemaVersion': row[1], 'settings': json.loads(row[2] or '{}'),
                'tabs': (json.loads(row[3] or '{}') or {}).get('tabs', []),
                'readOnly': True}

    def copy_community_bank_layout(self, share_id: str, session_uuid: str,
                                   name: str) -> Optional[str]:
        """Fork a shared layout into a new editable 'user' layout for the session."""
        src = self.load_community_bank_layout(share_id)
        if not src:
            return None
        return self.create_bank_layout(
            session_uuid, name or src['name'], src.get('tabs', []),
            src.get('settings', {}), source='user',
            schema_version=src.get('schemaVersion', 1)
        )

    def get_bank_item_history(self, session_uuid: str) -> dict:
        """Return {item_id: {tab_id, cat_id, order}} — the self-tracking placeholder
        store for this session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT item_id, tab_id, cat_id, order_index FROM bank_item_history "
            "WHERE session_uuid = ?",
            (session_uuid,)
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return {r[0]: {'tab_id': r[1], 'cat_id': r[2], 'order': r[3]} for r in rows}

    def set_bank_item_history(self, session_uuid: str, placements: list) -> None:
        """Upsert placement history. `placements` = [{item_id, tab_id, cat_id, order}]."""
        conn = self._get_connection()
        for p in (placements or []):
            conn.execute(
                "INSERT INTO bank_item_history (session_uuid, item_id, tab_id, cat_id, "
                "order_index, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(session_uuid, item_id) DO UPDATE SET tab_id = excluded.tab_id, "
                "cat_id = excluded.cat_id, order_index = excluded.order_index, "
                "updated_at = CURRENT_TIMESTAMP",
                (session_uuid, p.get('item_id'), p.get('tab_id'), p.get('cat_id'),
                 int(p.get('order', 0)))
            )
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_bank_working_layout(self, session_uuid: str):
        """Return {'layout': dict, 'current_id': str|None} for the session's in-progress
        (unsaved) bank layout, or None if there isn't one / it's corrupt."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT layout_json, current_id FROM bank_working_layout WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        try:
            layout = json.loads(row[0])
        except (TypeError, ValueError):
            return None
        if not isinstance(layout, dict):
            return None
        return {'layout': layout, 'current_id': row[1]}

    def set_bank_working_layout(self, session_uuid: str, layout: dict, current_id=None) -> None:
        """Upsert the session's in-progress working layout (one row per session)."""
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO bank_working_layout (session_uuid, layout_json, current_id, updated_at) "
            "VALUES (?, ?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(session_uuid) DO UPDATE SET layout_json = excluded.layout_json, "
            "current_id = excluded.current_id, updated_at = CURRENT_TIMESTAMP",
            (session_uuid, json.dumps(layout), current_id)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_topbar_layout(self, session_uuid: str):
        """Return the session's saved top-bar customization layout dict, or None.
        Shape: { topbar: {left:[...], right:[...]}, hidden:[...], drawer:[...],
                 title: {enabled: bool, text: str} }. FAC: topbar_customization."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT layout_json FROM topbar_layout WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        try:
            layout = json.loads(row[0])
        except (TypeError, ValueError):
            return None
        return layout if isinstance(layout, dict) else None

    def set_topbar_layout(self, session_uuid: str, layout: dict) -> None:
        """Upsert the session's top-bar customization layout (one row per session)."""
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO topbar_layout (session_uuid, layout_json, updated_at) "
            "VALUES (?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(session_uuid) DO UPDATE SET layout_json = excluded.layout_json, "
            "updated_at = CURRENT_TIMESTAMP",
            (session_uuid, json.dumps(layout))
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def delete_topbar_layout(self, session_uuid: str) -> None:
        """Remove the session's saved top-bar layout (reset-to-default)."""
        conn = self._get_connection()
        conn.execute("DELETE FROM topbar_layout WHERE session_uuid = ?", (session_uuid,))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_bank_config(self, key: str, default=None):
        """Read a global bank config value (e.g. the community-search kill switch)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM bank_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row[0] if row else default

    def set_bank_config(self, key: str, value: str) -> None:
        """Write a global bank config value."""
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO bank_config (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    # ========================================================================
    # OPTIMIZATION SETTINGS MIGRATION LOG
    # ========================================================================

    def has_optimization_settings_migration(self, session_uuid: str) -> bool:
        """Return True if this session has already been logged as migrated.

        Used to avoid repeated logging when the same session saves settings
        multiple times after the initial migration.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM optimization_settings_migration_log WHERE session_uuid = ? LIMIT 1",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row is not None

    def log_optimization_settings_migration(
        self,
        session_uuid: str,
        action: str,
        before: list,
        after: list,
    ) -> None:
        """Record that a session's activity sorting was migrated/removed.

        Args:
            session_uuid: Session identifier.
            action: 'removed', 'migrated', or 'custom' — see migration SQL.
            before: Sorting list before migration (list of [key, weight, target]).
            after: Sorting list after migration (same shape).

        Uses INSERT OR IGNORE keyed on session_uuid so the first migration
        event wins; subsequent saves for the same session are no-ops.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR IGNORE INTO optimization_settings_migration_log
                (session_uuid, action, before_json, after_json)
            VALUES (?, ?, ?, ?)
            """,
            (session_uuid, action, json.dumps(before), json.dumps(after)),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
