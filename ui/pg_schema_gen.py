"""Generate best-effort PostgreSQL DDL from the live SQLite schema (P1 tool).

Introspects a SQLite database (default: sessions.db) via sqlite_master +
PRAGMA table_info and emits CREATE TABLE / CREATE INDEX statements translated to
Postgres. This is a STARTING POINT for the migration schema, not a drop-in — the
output MUST be reviewed, especially:

  * Timestamp columns: classified against live data (typeof() over all 36
    TIMESTAMP columns) shows EVERY TIMESTAMP/DATETIME column stores ISO text
    (written via _utc_now() or the CURRENT_TIMESTAMP default), never epoch.
    So TIMESTAMP/DATETIME -> `text` and CURRENT_TIMESTAMP defaults ->
    `to_char(now(),'YYYY-MM-DD HH24:MI:SS')`. Epoch values (time.time(), ~53
    sites) live in REAL/INTEGER-declared columns, which map to numeric already.
  * ON CONFLICT upserts in the app need the matching UNIQUE constraints — verify
    they are emitted (unique indexes are translated).
  * Types are mapped heuristically from SQLite's dynamic affinity.

Usage:  python3 ui/pg_schema_gen.py [path/to/sessions.db] > ui/pg_schema.sql
"""

import re
import sqlite3
import sys

_TYPE_MAP = {
    "INTEGER": "bigint",
    "INT": "bigint",
    "BIGINT": "bigint",
    "TEXT": "text",
    "CLOB": "text",
    "VARCHAR": "text",
    "CHAR": "text",
    "REAL": "double precision",
    "DOUBLE": "double precision",
    "FLOAT": "double precision",
    "NUMERIC": "numeric",
    "DECIMAL": "numeric",
    "BLOB": "bytea",
    "BOOLEAN": "smallint",  # app stores/compares 0/1 ints (no bare-truthy WHERE)
    "BOOL": "smallint",
    "TIMESTAMP": "text",  # ground truth: ALL TIMESTAMP cols store ISO text (_utc_now/CURRENT_TIMESTAMP)
    "DATETIME": "text",
    "DATE": "text",
}


def _pg_type(sqlite_type: str) -> str:
    t = (sqlite_type or "TEXT").upper().strip()
    base = re.split(r"[(\s]", t, 1)[0]
    return _TYPE_MAP.get(base, "text")


# (table, column) -> explicit Postgres type, overriding the heuristic affinity
# map above. Used where a live column was intentionally converted to a richer
# PG type than its SQLite text affinity implies, so a regenerate of
# ui/pg_schema.sql does not silently revert it. See ui/pg_schema.sql.
#   api_access_audit.timestamp: converted text(ISO) -> timestamptz so date math
#   and the btree range index work natively (SQLite keeps it as text affinity).
_COLUMN_TYPE_OVERRIDES = {
    ("api_access_audit", "timestamp"): "timestamptz",
}


def _pg_default(dflt, pg_type: str):
    if dflt is None:
        return None
    d = str(dflt).strip()
    up = d.upper().lstrip("(")
    is_timeish = (up == "CURRENT_TIMESTAMP"
                  or up.startswith("DATETIME(")
                  or up.startswith("STRFTIME(")
                  or up.startswith("JULIANDAY("))
    if is_timeish:
        # Numeric (epoch) columns -> epoch seconds; text columns -> ISO string
        # (matching SQLite datetime('now') 'YYYY-MM-DD HH:MM:SS' output).
        if pg_type == "double precision":
            return "extract(epoch from now())"
        if pg_type in ("timestamptz", "timestamp with time zone", "timestamp"):
            return "now()"
        return "to_char(now(), 'YYYY-MM-DD HH24:MI:SS')"
    if pg_type == "boolean":
        if d in ("1", "'1'"):
            return "true"
        if d in ("0", "'0'"):
            return "false"
    return d


def _extract_unique(create_sql, colnames):
    """Best-effort extract UNIQUE constraints from a SQLite CREATE TABLE.

    PRAGMA table_info does NOT report UNIQUE, so inline column `... UNIQUE` and
    table-level `UNIQUE (cols)` constraints would otherwise be silently dropped
    (this is exactly how push_subscriptions.endpoint lost its constraint, which
    broke the `ON CONFLICT(endpoint)` upsert on Postgres). Returns a tuple of
    (set_of_inline_unique_column_names, list_of_table_level_unique_column_lists).
    """
    inline, table_level = set(), []
    if not create_sql:
        return inline, table_level
    m = re.search(r"\((.*)\)", create_sql, re.S)
    if not m:
        return inline, table_level
    # Split the column/constraint list on top-level commas (ignore commas inside
    # parens, e.g. a table-level UNIQUE(a, b) or CHECK(...)).
    parts, depth, cur = [], 0, ""
    for ch in m.group(1):
        if ch == "(":
            depth += 1
            cur += ch
        elif ch == ")":
            depth -= 1
            cur += ch
        elif ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    for p in parts:
        ps = p.strip()
        mt = re.match(r"(?i)^UNIQUE\s*\(([^)]*)\)", ps)
        if mt:
            cols = [c.strip().strip('"[]`') for c in mt.group(1).split(",")]
            cols = [c for c in cols if c in colnames]
            if cols:
                table_level.append(cols)
            continue
        if re.match(r"(?i)^(PRIMARY|FOREIGN|CHECK|CONSTRAINT)\b", ps):
            continue
        if not re.search(r"(?i)\bUNIQUE\b", ps):
            continue
        mc = re.match(r'["\[`]?(\w+)["\]`]?', ps)
        if mc and mc.group(1) in colnames:
            inline.add(mc.group(1))
    return inline, table_level


# SQLite's implicit integer rowid has no Postgres equivalent. These tables are
# addressed by `rowid` in app code (stats-report prune: SELECT rowid ... DELETE
# WHERE rowid=?), so give them an explicit surrogate identity column the adapter
# rewrites `rowid` to.
_ROWID_SURROGATE_TABLES = {"stats_report_results", "stats_report_gearsets"}


def generate(db_path: str) -> str:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    out = ["-- AUTO-GENERATED Postgres schema from SQLite (REVIEW BEFORE USE).",
           "-- See ui/pg_schema_gen.py docstring for the timestamp/epoch caveat.", ""]

    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()]

    for tbl in tables:
        create_sql = cur.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (tbl,)).fetchone()[0] or ""
        autoincrement = "AUTOINCREMENT" in create_sql.upper()
        cols = cur.execute(f"PRAGMA table_info('{tbl}')").fetchall()
        # cols: (cid, name, type, notnull, dflt_value, pk)
        lines = []
        pk_cols = [c[1] for c in cols if c[5]]
        single_int_pk = (len(pk_cols) == 1 and
                         any(c[5] and _pg_type(c[2]) == "bigint" for c in cols))
        inline_unique, table_unique = _extract_unique(create_sql, {c[1] for c in cols})
        for (_cid, name, ctype, notnull, dflt, pk) in cols:
            pg_type = _COLUMN_TYPE_OVERRIDES.get((tbl, name)) or _pg_type(ctype)
            if pk and single_int_pk and pg_type == "bigint":
                # SQLite INTEGER PRIMARY KEY [AUTOINCREMENT] -> identity column.
                lines.append(f'    "{name}" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
                continue
            frag = f'    "{name}" {pg_type}'
            if notnull:
                frag += " NOT NULL"
            if name in inline_unique:
                frag += " UNIQUE"
            dv = _pg_default(dflt, pg_type)
            if dv is not None:
                frag += f" DEFAULT {dv}"
            lines.append(frag)
        # rowid surrogate for tables addressed by `rowid` in app code.
        if tbl in _ROWID_SURROGATE_TABLES:
            lines.append('    "_pg_rowid" bigint GENERATED BY DEFAULT AS IDENTITY')
        # Table-level UNIQUE (cols) constraints (needed for matching ON CONFLICT).
        for ucols in table_unique:
            quoted = ", ".join(f'"{c}"' for c in ucols)
            lines.append(f"    UNIQUE ({quoted})")
        # Composite / non-identity PK
        if pk_cols and not single_int_pk:
            quoted = ", ".join(f'"{c}"' for c in pk_cols)
            lines.append(f"    PRIMARY KEY ({quoted})")
        out.append(f'CREATE TABLE IF NOT EXISTS "{tbl}" (')
        out.append(",\n".join(lines))
        out.append(");")
        out.append("")

    # Indexes (translate sqlite CREATE [UNIQUE] INDEX statements).
    idx = cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL "
        "ORDER BY name").fetchall()
    for (isql,) in idx:
        s = isql.strip()
        # Make indexes idempotent so _init_db_postgres can re-apply on every boot.
        if "IF NOT EXISTS" not in s.upper():
            s = re.sub(r"(?i)^CREATE\s+(UNIQUE\s+)?INDEX\s+",
                       lambda m: "CREATE " + (m.group(1) or "") + "INDEX IF NOT EXISTS ",
                       s, count=1)
        if not s.endswith(";"):
            s += ";"
        # SQLite and PG CREATE INDEX syntax largely overlap; emit for review.
        out.append(s)
    out.append("")

    conn.close()
    return "\n".join(out)


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "sessions.db"
    sys.stdout.write(generate(path))
