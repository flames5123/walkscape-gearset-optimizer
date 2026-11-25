"""Database backend selection + Postgres compatibility shim (P1, GATED).

SAFETY / GATING
---------------
The backend is chosen by the ``WALKSCAPE_DB_BACKEND`` environment variable and
**defaults to ``sqlite``**. Prod/main set no such variable, so this module's
Postgres path is completely dormant there — ``connect()`` returns an ordinary
``sqlite3`` connection identical to the app's existing behavior. psycopg is
imported lazily, only on the Postgres branch, so prod never needs the
dependency installed.

This is the P1 foundation only. It is NOT wired into DatabaseManager yet; adding
``WALKSCAPE_DB_BACKEND=postgres`` is the only thing that activates any of the
Postgres code, and only on the testing container.

Postgres activation requires, on the testing container only:
  - ``pip install -r requirements-postgres.txt`` (psycopg[binary,pool])
  - ``WALKSCAPE_DB_BACKEND=postgres``
  - ``DATABASE_URL=postgresql://user:pass@host/db``
"""

import os
import re
import sqlite3

# ── Backend selection ────────────────────────────────────────────────────────
_BACKEND = os.environ.get("WALKSCAPE_DB_BACKEND", "sqlite").strip().lower()


def get_backend() -> str:
    """Return the active DB backend name ('sqlite' default, or 'postgres')."""
    return _BACKEND


def is_postgres() -> bool:
    return _BACKEND == "postgres"


# ── SQL fragment helpers for api_access_audit.timestamp ───────────────────────
# That column is the ONE timestamp column converted to a real Postgres
# `timestamptz`; every other timestamp column in the app is still ISO text.
# The _rewrite_dialect shim assumes text and rewrites date()/datetime()/
# strftime() args as replace(x,'Z','')::timestamp, which is invalid against a
# real timestamptz. These helpers emit a NATIVE Postgres expression (which the
# shim leaves untouched) on PG, and the original SQLite function form on SQLite,
# so day/hour/day-of-week bucketing of that column works on both backends.
def ts_day(col: str) -> str:
    """Truncate a timestamp column to a day ('YYYY-MM-DD')."""
    return f"{col}::date" if is_postgres() else f"DATE({col})"


def ts_hour_bucket(col: str) -> str:
    """Truncate a timestamp column to an hour bucket string 'YYYY-MM-DD HH:00'."""
    return (f"to_char({col}, 'YYYY-MM-DD HH24\":00\"')" if is_postgres()
            else f"strftime('%Y-%m-%d %H:00', REPLACE({col}, 'Z', ''))")


def ts_dow(col: str) -> str:
    """Integer day-of-week 0=Sun..6=Sat (matches SQLite strftime '%w')."""
    return (f"EXTRACT(DOW FROM {col})::int" if is_postgres()
            else f"CAST(strftime('%w', {col}) AS INTEGER)")


def ts_hour(col: str) -> str:
    """Integer hour-of-day 0..23 (matches SQLite strftime '%H')."""
    return (f"EXTRACT(HOUR FROM {col})::int" if is_postgres()
            else f"CAST(strftime('%H', {col}) AS INTEGER)")


# ── Paramstyle translation (SQLite qmark '?'  ->  psycopg format '%s') ─────────
# psycopg uses pyformat/format paramstyle, so two transforms are required on the
# raw SQLite SQL text:
#   1. Every literal '%' must become '%%' (psycopg scans the whole string for
#      format placeholders — an un-escaped '%' in e.g. LIKE '%foo%' would break).
#   2. Every positional '?' that is NOT inside a string literal becomes '%s'.
# Order matters: escape '%' FIRST, then insert '%s' placeholders (so the inserted
# placeholders are not themselves doubled).
def translate_paramstyle(sql: str) -> str:
    """Translate SQLite qmark SQL to psycopg format paramstyle. Literal-aware."""
    # Step 1: escape all percent signs.
    sql = sql.replace("%", "%%")
    # Step 2: replace '?' with '%s' only outside single/double quoted literals.
    out = []
    in_single = False
    in_double = False
    i = 0
    n = len(sql)
    while i < n:
        c = sql[i]
        if in_single:
            out.append(c)
            if c == "'":
                # SQLite escapes a quote inside a '...' literal by doubling it.
                if i + 1 < n and sql[i + 1] == "'":
                    out.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue
        if in_double:
            out.append(c)
            if c == '"':
                if i + 1 < n and sql[i + 1] == '"':
                    out.append('"')
                    i += 2
                    continue
                in_double = False
            i += 1
            continue
        # not in a literal
        if c == "'":
            in_single = True
            out.append(c)
        elif c == '"':
            in_double = True
            out.append(c)
        elif c == "?":
            out.append("%s")
        else:
            out.append(c)
        i += 1
    return "".join(out)


# ── Postgres connection shims (lazy; only used when backend == 'postgres') ─────
# P2 dialect rewrites: SQLite SQL -> Postgres, applied transparently in the
# cursor so the app's ~450 call sites need no per-statement edits.
_TABLE_META = {}


def _table_meta(raw_conn, table):
    """Return {'pk': [...], 'has_identity': bool} for a table (cached)."""
    if table in _TABLE_META:
        return _TABLE_META[table]
    pk, has_identity = [], False
    try:
        c = raw_conn.cursor()
        c.execute(
            "SELECT a.attname FROM pg_index i "
            "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
            "WHERE i.indrelid = %s::regclass AND i.indisprimary",
            (table,),
        )
        pk = [r[0] for r in c.fetchall()]
        c.execute(
            "SELECT is_identity FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s",
            (table,),
        )
        has_identity = any(r[0] == "YES" for r in c.fetchall())
        c.close()
    except Exception:
        pass
    _TABLE_META[table] = {"pk": pk, "has_identity": has_identity}
    return _TABLE_META[table]


def _json_rewrite(sql):
    """json_extract(expr, '$.a.b') -> safe jsonb text extract.

    SQLite's json_extract returns NULL on non-JSON / empty input. A bare
    (expr)::jsonb cast in Postgres instead RAISES 'invalid input syntax for
    type json' on any such row -- e.g. the 17 sessions whose character_config
    is '' (empty string) -- which 500s the whole admin query (dashboard,
    reports, sessions/list). Guard the cast with PG16's `IS JSON` predicate so
    bad/empty text yields NULL exactly like SQLite. Prod and testing are both
    postgres:16, so `IS JSON` is available. NULL input stays NULL (NULL IS JSON
    is not true -> CASE returns NULL -> `NULL #>> '{...}'` is NULL).
    """
    def _sub(m):
        expr = m.group(1).strip()
        parts = [p for p in re.split(r"[.\[\]]", m.group(2).lstrip("$")) if p]
        safe = "(CASE WHEN (%s) IS JSON THEN (%s)::jsonb END)" % (expr, expr)
        if not parts:
            return safe
        return "%s #>> '{%s}'" % (safe, ",".join(parts))
    return re.sub(r"(?is)json_extract\(\s*(.+?)\s*,\s*'(\$[^']*)'\s*\)", _sub, sql)


# ---------------------------------------------------------------------------
# SQLite datetime('now', ...) / strftime(fmt, x, ...) -> Postgres.
#
# WalkScape stores all timestamp columns as ISO *text* (see _utc_now: a value
# like '2026-10-20T04:30:22.975Z'; CURRENT_TIMESTAMP writes space-separated).
# These helpers translate the SQLite date functions the app (and the DB-coupled
# tests) use so the SAME SQL runs on Postgres with the SAME text semantics:
#   * datetime(...) emits 'YYYY-MM-DD HH24:MI:SS' (matches SQLite datetime()).
#   * casts are Z-tolerant (strip a trailing 'Z' before ::timestamp).
# Only invoked on the Postgres path; SQLite runs the original SQL untouched.
# ---------------------------------------------------------------------------
_STRFTIME_TOKENS = {
    "%Y": "YYYY", "%m": "MM", "%d": "DD",
    "%H": "HH24", "%M": "MI", "%S": "SS", "%f": "US", "%j": "DDD",
    "%W": "WW",
}


def _find_matching_paren(s, open_idx):
    """Index of the ')' matching the '(' at open_idx (quote/paren aware)."""
    depth = 0
    i = open_idx
    in_q = False
    while i < len(s):
        ch = s[i]
        if in_q:
            if ch == "'":
                if i + 1 < len(s) and s[i + 1] == "'":
                    i += 2
                    continue
                in_q = False
        else:
            if ch == "'":
                in_q = True
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def _split_top_args(argstr):
    """Split a call's arg list on top-level commas (quote/paren aware)."""
    args = []
    depth = 0
    in_q = False
    cur = []
    i = 0
    while i < len(argstr):
        ch = argstr[i]
        if in_q:
            cur.append(ch)
            if ch == "'":
                if i + 1 < len(argstr) and argstr[i + 1] == "'":
                    cur.append("'")
                    i += 2
                    continue
                in_q = False
        else:
            if ch == "'":
                in_q = True
                cur.append(ch)
            elif ch == "(":
                depth += 1
                cur.append(ch)
            elif ch == ")":
                depth -= 1
                cur.append(ch)
            elif ch == "," and depth == 0:
                args.append("".join(cur).strip())
                cur = []
            else:
                cur.append(ch)
        i += 1
    if cur:
        args.append("".join(cur).strip())
    return args


def _is_str_lit(a):
    return len(a) >= 2 and a[0] == "'" and a[-1] == "'"


def _ts_base_expr(x):
    """A PG timestamp expression from a SQLite datetime/strftime first arg."""
    if x.strip().lower() == "'now'":
        return "(now() AT TIME ZONE 'UTC')"
    # Z-tolerant: stored ISO text may carry a trailing 'Z' (_utc_now) and be
    # 'T'- or space-separated; strip the Z, then cast to a wall-clock timestamp.
    return "(replace(%s, 'Z', '')::timestamp)" % x


def _apply_mods(base, mods):
    for mod in mods:
        if _is_str_lit(mod):
            # SQLite modifier syntax ('-7 days', '+1 hour') is valid PG interval.
            base = "(%s + interval %s)" % (base, mod)
        else:
            # Parameter placeholder (?) or expression -> cast to interval.
            base = "(%s + (%s)::interval)" % (base, mod)
    return base


def _translate_datetime(args):
    base = _apply_mods(_ts_base_expr(args[0]), args[1:])
    return "to_char(%s, 'YYYY-MM-DD HH24:MI:SS')" % base


def _translate_strftime(args):
    fmt = args[0]
    xexpr = args[1] if len(args) > 1 else "'now'"
    base = _apply_mods(_ts_base_expr(xexpr), args[2:])
    inner = fmt[1:-1] if _is_str_lit(fmt) else fmt
    # %w = day-of-week 0-6 (Sun=0); to_char has no matching numbering, so use
    # EXTRACT(DOW) which is also Sun=0.
    if inner == "%w":
        return "(EXTRACT(DOW FROM %s)::integer)" % base
    out = []
    lit = []

    def flush():
        if lit:
            out.append('"' + "".join(lit).replace('"', "") + '"')
            del lit[:]

    i = 0
    while i < len(inner):
        if inner[i] == "%" and i + 1 < len(inner):
            tok = inner[i:i + 2]
            if tok == "%%":
                lit.append("%")
                i += 2
                continue
            repl = _STRFTIME_TOKENS.get(tok)
            if repl:
                flush()
                out.append(repl)
                i += 2
                continue
        lit.append(inner[i])
        i += 1
    flush()
    return "to_char(%s, '%s')" % (base, "".join(out))


def _translate_date(args):
    """SQLite date('now','-6 months') / date(col) -> PG 'YYYY-MM-DD' text."""
    base = _apply_mods(_ts_base_expr(args[0]), args[1:])
    return "to_char(%s, 'YYYY-MM-DD')" % base


def _translate_printf(args):
    """SQLite printf numeric forms -> PG to_char. Value cast to numeric so
    number-in-text columns coerce like SQLite does.
      %d / %i          -> plain integer
      %,d / %,i        -> comma-grouped integer
      %.Nf / %,.Nf     -> N-decimal float, optional comma grouping
    Any other form raises -> original printf(...) is preserved untouched.
    """
    if len(args) != 2 or not _is_str_lit(args[0]):
        raise ValueError("unsupported printf form")
    fmt = args[0][1:-1]
    val = args[1]
    m = re.fullmatch(r"%(,?)(?:\.(\d+))?([dif])", fmt)
    if not m:
        raise ValueError("unsupported printf form")
    grouped = m.group(1) == ","
    conv = m.group(3)
    decimals = 0 if conv in ("d", "i") else int(m.group(2) or 6)
    intpart = "999G999G999G999G999G990" if grouped else "99999999999999990"
    mask = "FM" + intpart + (("D" + "0" * decimals) if decimals else "")
    return "to_char((%s)::numeric, '%s')" % (val, mask)


def _translate_json_array_length(args):
    """SQLite json_array_length(col, '$.path') / json_array_length(col) -> PG
    jsonb_array_length, with the same IS JSON guard as _json_rewrite so bad/
    empty text yields NULL instead of raising."""
    expr = args[0].strip()
    safe = "(CASE WHEN (%s) IS JSON THEN (%s)::jsonb END)" % (expr, expr)
    target = safe
    if len(args) >= 2 and _is_str_lit(args[1]):
        parts = [p for p in re.split(r"[.\[\]]", args[1][1:-1].lstrip("$")) if p]
        if parts:
            target = "%s #> '{%s}'" % (safe, ",".join(parts))
    return "jsonb_array_length(%s)" % target


def _translate_round(args):
    """PG has no round(double precision, int); cast the value to numeric. Only
    the 2-arg form is rewritten -- 1-arg round is valid PG, so raise to keep it."""
    if len(args) == 2:
        return "round((%s)::numeric, %s)" % (args[0], args[1])
    raise ValueError("leave 1-arg round untouched")


def _rewrite_fn_calls(s, name, translate):
    low = s.lower()
    needle = name.lower() + "("
    out = []
    i = 0
    n = len(s)
    while i < n:
        j = low.find(needle, i)
        if j == -1:
            out.append(s[i:])
            break
        if j > 0 and (s[j - 1].isalnum() or s[j - 1] == "_"):
            out.append(s[i:j + len(needle)])
            i = j + len(needle)
            continue
        open_idx = j + len(name)
        close_idx = _find_matching_paren(s, open_idx)
        if close_idx == -1:
            out.append(s[i:])
            break
        args = _split_top_args(s[open_idx + 1:close_idx])
        out.append(s[i:j])
        try:
            out.append(translate(args))
        except Exception:
            out.append(s[j:close_idx + 1])
        i = close_idx + 1
    return "".join(out)


def _sqlite_dt_funcs_to_pg(s):
    low = s.lower()
    if "datetime(" in low:
        s = _rewrite_fn_calls(s, "datetime", _translate_datetime)
    if "date(" in low:
        s = _rewrite_fn_calls(s, "date", _translate_date)
    if "strftime(" in low:
        s = _rewrite_fn_calls(s, "strftime", _translate_strftime)
    return s


def _rewrite_dialect(raw_conn, sql, add_returning=True):
    """Rewrite SQLite-isms to Postgres. Returns (sql, returning_col_or_None).

    - INSERT OR IGNORE  -> INSERT ... ON CONFLICT DO NOTHING
    - INSERT OR REPLACE -> INSERT ... ON CONFLICT (pk) DO UPDATE SET <non-pk>=EXCLUDED...
    - json_extract(...)  -> jsonb #>>
    - plain INSERT into an identity-PK table gets `RETURNING <pk>` so the cursor
      can emulate sqlite3.lastrowid.
    """
    s = _json_rewrite(sql)
    # SQLite implicit `rowid` -> explicit surrogate column the generator added
    # to the stats-report tables that the prune code addresses by rowid.
    s = re.sub(r"(?i)\browid\b", "_pg_rowid", s)
    # SQLite scalar MAX(a,b) / MIN(a,b) -> PG GREATEST/LEAST (PG MAX/MIN are
    # aggregates; the 2-arg scalar form only exists in SQLite). Only the
    # multi-arg (comma) form is rewritten; single-arg aggregates are untouched.
    s = re.sub(r"(?i)\bMAX\s*\(([^()]*,[^()]*)\)", r"GREATEST(\1)", s)
    s = re.sub(r"(?i)\bMIN\s*\(([^()]*,[^()]*)\)", r"LEAST(\1)", s)
    # sqlite_master -> PG catalog: expose a (name, type) source so the app's
    # schema-introspection queries (WHERE type='table', name=..., NOT LIKE
    # 'sqlite_%', ORDER BY name) run unchanged against Postgres.
    if re.search(r"(?i)\bsqlite_master\b", s):
        s = re.sub(r"(?i)\bsqlite_master\b",
                   "(SELECT tablename AS name, 'table' AS type FROM pg_tables "
                   "WHERE schemaname='public' UNION ALL SELECT indexname AS name, "
                   "'index' AS type FROM pg_indexes WHERE schemaname='public') sqlite_master",
                   s)
    # SQLite datetime('now',...) / strftime(fmt, x, ...) -> Postgres.
    s = _sqlite_dt_funcs_to_pg(s)
    # Scalar-function dialect rewrites (admin custom queries write SQLite SQL):
    #   json_array_length(col,'$.path') -> jsonb_array_length (IS JSON guarded)
    #   printf('%,d'|'%d', X)           -> to_char / integer text (numeric cast)
    #   round(double precision, int)    -> round((..)::numeric, int)
    _low2 = s.lower()
    if "json_array_length(" in _low2:
        s = _rewrite_fn_calls(s, "json_array_length", _translate_json_array_length)
    if "printf(" in _low2:
        s = _rewrite_fn_calls(s, "printf", _translate_printf)
    if "round(" in _low2:
        s = _rewrite_fn_calls(s, "round", _translate_round)
    m = re.match(r"(?is)^\s*INSERT\s+OR\s+(IGNORE|REPLACE)\s+INTO\s+", s)
    if m:
        kind = m.group(1).upper()
        s = s[:m.start()] + "INSERT INTO " + s[m.end():]
        tm = re.match(r'(?is)^\s*INSERT\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)', s)
        table = tm.group(1) if tm else None
        cols = [c.strip().strip('"') for c in tm.group(2).split(",")] if tm else []
        s = s.rstrip().rstrip(";")
        if kind == "IGNORE":
            s += " ON CONFLICT DO NOTHING"
        else:
            meta = _table_meta(raw_conn, table) if table else {"pk": []}
            pk = meta.get("pk") or []
            setcols = [c for c in cols if c not in pk]
            if pk and setcols:
                sets = ", ".join("%s = EXCLUDED.%s" % (c, c) for c in setcols)
                s += " ON CONFLICT (%s) DO UPDATE SET %s" % (", ".join(pk), sets)
            elif pk:
                s += " ON CONFLICT (%s) DO NOTHING" % ", ".join(pk)
            else:
                s += " ON CONFLICT DO NOTHING"
    ret = None
    if (add_returning and re.match(r"(?is)^\s*INSERT\s+INTO", s)
            and not re.search(r"(?is)\bRETURNING\b", s)):
        tm2 = re.match(r'(?is)^\s*INSERT\s+INTO\s+"?(\w+)"?', s)
        if tm2:
            meta = _table_meta(raw_conn, tm2.group(1))
            if meta.get("has_identity") and meta.get("pk"):
                ret = meta["pk"][0]
                s = s.rstrip().rstrip(";") + " RETURNING " + ret
    return s, ret


class _CompatRow:
    """sqlite3.Row-compatible row: supports row[int], row['col'], .keys(),
    iteration over values, len(), and dict(row)."""
    __slots__ = ("_vals", "_idx")
    def __init__(self, vals, idx):
        self._vals = vals
        self._idx = idx
    def __getitem__(self, k):
        if isinstance(k, str):
            return self._vals[self._idx[k]]
        return self._vals[k]
    def __len__(self):
        return len(self._vals)
    def __iter__(self):
        return iter(self._vals)
    def keys(self):
        return list(self._idx.keys())
    def get(self, k, default=None):
        try:
            return self[k]
        except (KeyError, IndexError):
            return default


def _sqlite_compat_rf(cursor):
    """psycopg row_factory producing _CompatRow (sqlite3.Row-like)."""
    desc = cursor.description
    cols = [d.name for d in desc] if desc else []
    idx = {name: i for i, name in enumerate(cols)}
    def make(values):
        return _CompatRow(list(values), idx)
    return make


_TEST_TOLERANT_DDL = False  # set True by the test conftest only (postgres suite)


def _split_statements(script):
    """Naive ';' split for DDL scripts / admin SQL — adequate for the
    semicolon-separated statements these callers use."""
    return [s for s in (part.strip() for part in script.split(";")) if s]


def _exec_script(raw_conn, script):
    """Run a multi-statement script through the PG connection, applying the
    dialect rewrites to each statement. Faithful by default (raises on error,
    like sqlite3.executescript). When the test flag _TEST_TOLERANT_DDL is set
    (test fixtures replaying migrations already baked into pg_schema.sql),
    redundant-DDL errors (already-exists, duplicate column, sqlite-only syntax)
    are swallowed so the shared PG schema isn't fought over."""
    tolerant = _TEST_TOLERANT_DDL
    for stmt in _split_statements(script):
        sql = translate_paramstyle(_rewrite_dialect(raw_conn, stmt, add_returning=False)[0])
        try:
            c = raw_conn.cursor()
            c.execute(sql)
            c.close()
        except Exception:
            try:
                raw_conn.rollback()
            except Exception:
                pass
            if not tolerant:
                raise


class _ParamCursor:
    """Wraps a psycopg cursor. Applies P2 dialect rewrites + qmark->format
    paramstyle translation, and emulates sqlite3.lastrowid via auto-RETURNING
    on identity-PK inserts."""

    def __init__(self, cur, conn):
        self._cur = cur
        self._conn = conn
        self._last_returning = None

    def execute(self, sql, params=()):
        s, ret = _rewrite_dialect(self._conn, sql, add_returning=True)
        self._cur.execute(translate_paramstyle(s), tuple(params) if params else None)
        self._last_returning = None
        if ret is not None:
            try:
                row = self._cur.fetchone()
                self._last_returning = row[0] if row else None
            except Exception:
                self._last_returning = None
        return self

    def executemany(self, sql, seq_of_params):
        s, _ = _rewrite_dialect(self._conn, sql, add_returning=False)
        self._cur.executemany(translate_paramstyle(s), [tuple(p) for p in seq_of_params])
        return self

    def executescript(self, script):
        # sqlite3.Cursor.executescript parity (used by the admin SQL endpoint).
        _exec_script(self._conn, script)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def fetchmany(self, size=None):
        return self._cur.fetchmany(size) if size is not None else self._cur.fetchmany()

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description

    @property
    def lastrowid(self):
        # Emulated via auto-RETURNING on identity-PK inserts (see execute()).
        return self._last_returning

    def close(self):
        self._cur.close()


class _ParamConn:
    """Wraps a pooled psycopg connection with a sqlite3-Connection-like surface
    (cursor/execute/commit/rollback/close). ``close()`` returns the connection to
    the pool after rolling back any open transaction (psycopg aborts a
    transaction on any error and requires rollback before reuse)."""

    def __init__(self, raw_conn, pool):
        self._conn = raw_conn
        self._pool = pool
        self._row_factory = None

    @property
    def row_factory(self):
        return self._row_factory

    @row_factory.setter
    def row_factory(self, rf):
        # Any truthy factory (the app always uses sqlite3.Row) -> dict/index
        # hybrid rows via _sqlite_compat_rf on cursors created afterward.
        self._row_factory = rf

    def cursor(self):
        if self._row_factory is not None:
            raw = self._conn.cursor(row_factory=_sqlite_compat_rf)
        else:
            raw = self._conn.cursor()
        return _ParamCursor(raw, self._conn)

    def execute(self, sql, params=()):
        cur = self.cursor()
        cur.execute(sql, params)
        return cur

    def executescript(self, script):
        # sqlite3.Connection.executescript parity (test fixtures + any app use).
        _exec_script(self._conn, script)
        return self

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        # sqlite3.Connection context-manager parity: commit on success, rollback
        # on error. Does NOT close (matches sqlite3); the pooled conn returns via
        # close()/__del__.
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        except Exception:
            pass
        return False

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        # Best-effort reset, then hand back to the pool. Idempotent so the
        # GC safety-net below can't double-return a connection.
        conn = self._conn
        if conn is None:
            return
        self._conn = None
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            self._pool.putconn(conn)
        except Exception:
            pass

    def __del__(self):
        # Safety net: a caller that drops the reference without close() (common
        # in the sqlite era, where connections were free) still returns the
        # pooled connection instead of leaking it until the pool starves.
        try:
            self.close()
        except Exception:
            pass


_PG_POOL = None

# Defensive per-session timeouts applied to EVERY pooled PG connection (see
# _configure_pg_connection). These are the self-heal backstop for the
# single-worker prod box: without them PostgreSQL waits on a lock forever and
# never aborts an idle-in-transaction session, so one leaked/abandoned
# transaction (a DB method that raised between acquiring a connection and
# closing it) could hold row locks indefinitely and wedge every subsequent
# request (prod incident 2026-11-20). All overridable via env; all milliseconds.
#   statement_timeout                    - cap any single statement
#   lock_timeout                         - cap how long a statement waits on a lock
#   idle_in_transaction_session_timeout  - server terminates a connection left
#                                          idle inside an open transaction,
#                                          reaping a leaked txn + its row locks.
#                                          Generous (60s) so it never clips a
#                                          legitimate worker between short
#                                          commits — workers compute in Python
#                                          with NO connection held, then
#                                          open+commit+close per write.
_PG_STATEMENT_TIMEOUT_MS = int(os.environ.get("WALKSCAPE_PG_STATEMENT_TIMEOUT_MS", "30000"))
_PG_LOCK_TIMEOUT_MS = int(os.environ.get("WALKSCAPE_PG_LOCK_TIMEOUT_MS", "15000"))
_PG_IDLE_IN_TXN_TIMEOUT_MS = int(os.environ.get("WALKSCAPE_PG_IDLE_IN_TXN_TIMEOUT_MS", "60000"))


def _configure_pg_connection(conn):
    """Pool ``configure`` hook: runs once on every new/reconnected pooled
    connection to install the defensive session timeouts above. Best-effort —
    a configure hiccup must never stop the pool from serving a connection, so
    errors are swallowed (the timeouts are a backstop, not correctness). The
    SET values are ints from int(), so the f-string is injection-safe. A plain
    SET persists for the whole session once its transaction commits."""
    try:
        conn.execute(f"SET statement_timeout = {_PG_STATEMENT_TIMEOUT_MS}")
        conn.execute(f"SET lock_timeout = {_PG_LOCK_TIMEOUT_MS}")
        conn.execute(f"SET idle_in_transaction_session_timeout = {_PG_IDLE_IN_TXN_TIMEOUT_MS}")
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _get_pg_pool():
    global _PG_POOL
    if _PG_POOL is None:
        import psycopg_pool  # lazy: only imported on the postgres branch
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError(
                "WALKSCAPE_DB_BACKEND=postgres but DATABASE_URL is not set"
            )
        _PG_POOL = psycopg_pool.ConnectionPool(
            dsn, min_size=1, max_size=32, open=True,
            configure=_configure_pg_connection,
        )
    return _PG_POOL


# ── Public factory ────────────────────────────────────────────────────────────
def connect(sqlite_path, *, timeout=30):
    """Return a DB connection for the active backend.

    sqlite (default): an ordinary sqlite3 connection with the app's standard
    WAL + busy_timeout PRAGMAs — byte-identical to DatabaseManager._get_connection
    today, so wiring this in is a no-op when the env var is unset.

    postgres: a pooled psycopg connection wrapped in _ParamConn.
    """
    if _BACKEND == "postgres":
        pool = _get_pg_pool()
        return _ParamConn(pool.getconn(), pool)
    conn = sqlite3.connect(sqlite_path, timeout=timeout)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn
