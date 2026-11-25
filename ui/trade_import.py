#!/usr/bin/env python3
"""Trading bulk import — pure, framework-free helpers for the file-upload flow.

The HTTP layer (ui/app.py) owns multipart upload, catalog resolution, and DB
writes. Everything here is deterministic and unit-testable:

  * delimiter sniffing + delimited parsing (csv/txt; xlsx rows come pre-parsed)
  * header auto-mapping to our fields
  * per-column validation (item name, quality capability, quantity, price, note)
  * duplicate detection (in-file AND against existing entries)
  * owned-item check (listings only)
  * assembling the good/bad validation report the UI renders before import

See TRADE_IMPORT_TASKS.md for the confirmed design.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Callable, Dict, List, Optional, Tuple

# ── Hard safety caps ─────────────────────────────────────────────────────────
# Catalogue could grow 10x (~20k items) and a user could list every item at
# every quality/fine (~120k distinct rows). 200k rows / 20 MB gives headroom.
MAX_ROWS = 200_000
MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_QTY = 1_000_000
MAX_NOTE_LEN = 500

# Our import fields. item_name is the only required one.
FIELDS = ("item_name", "quality", "quantity", "price", "notes")
REQUIRED_FIELDS = ("item_name",)

# Candidate delimiters for csv/txt sniffing, in preference order.
_DELIMS = (",", "\t", ";", "|")

# Header synonyms for auto-mapping. Compared after lowercasing + stripping every
# non-alphanumeric char (so "Item Name", "item_name", "item-name" all collapse).
_HEADER_SYNONYMS = {
    "item_name": {"item", "itemname", "name", "itemexport", "export", "exportname", "itemid"},
    "quality":   {"quality", "qual", "rarity", "tier", "variant"},
    "quantity":  {"quantity", "qty", "amount", "count", "qnty", "num"},
    "price":     {"price", "gold", "cost", "value", "priceeach", "pricegold", "goldeach"},
    "notes":     {"notes", "note", "comment", "comments", "desc", "description", "memo"},
}


def _norm_header(s: str) -> str:
    return "".join(ch for ch in str(s or "").lower() if ch.isalnum())


# ── Delimiter sniffing + parsing (csv/txt) ───────────────────────────────────
def sniff_delimiter(sample: str) -> Tuple[str, bool]:
    """Return ``(delimiter, ambiguous)`` for a text sample.

    Uses the first non-empty line's delimiter counts. ``ambiguous`` is True when
    two or more candidate delimiters tie on the top count (the UI then asks the
    user to pick). Falls back to comma when nothing delimits.
    """
    line = ""
    for raw in (sample or "").splitlines():
        if raw.strip():
            line = raw
            break
    counts = {d: line.count(d) for d in _DELIMS}
    best = max(counts.values()) if counts else 0
    if best <= 0:
        return (",", False)
    winners = [d for d, c in counts.items() if c == best]
    return (winners[0], len(winners) > 1)


def parse_delimited(text: str, delimiter: str) -> List[List[str]]:
    """Parse delimited text into a list of rows (header row included)."""
    text = (text or "").lstrip("\ufeff")  # drop a BOM if present
    reader = csv.reader(io.StringIO(text), delimiter=(delimiter or ","))
    return [[(c if c is not None else "") for c in row] for row in reader if row is not None]


def auto_map_headers(headers: List[str]) -> Dict[str, Optional[int]]:
    """Best-effort mapping ``{field: column_index|None}`` from a header row."""
    norm = [_norm_header(h) for h in (headers or [])]
    mapping: Dict[str, Optional[int]] = {f: None for f in FIELDS}
    used: set = set()
    for field in FIELDS:
        syn = _HEADER_SYNONYMS[field]
        for i, h in enumerate(norm):
            if i in used or not h:
                continue
            if h in syn or any(s in h for s in syn):
                mapping[field] = i
                used.add(i)
                break
    return mapping


# ── Per-column validation ────────────────────────────────────────────────────
def validate_quality(raw: str, cap: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """Normalize a quality value to a variant token for the item's capability.

    ``cap`` = ``{type, can_fine}`` from the catalog resolver. Returns
    ``(token, error)``; ``error`` is None on success. Rules (confirmed design):
      * crafted: normal/common/good/great/excellent/perfect/eternal (and the
        token forms). Blank -> 'common' (Normal). 'fine' is invalid.
      * material/consumable: blank/normal/common -> '' (base). 'fine' only if the
        item has a fine variant. Rarity words are invalid.
      * pet egg: blank -> ''. 'rare' allowed.
      * single-quality items (gear/tool/loot/coins): quality not needed; any
        value is accepted and stored as '' (the item's rarity is intrinsic).
    """
    w = str(raw or "").strip().lower()
    t = cap.get("type")
    if t == "crafted":
        ladder = {
            "": "common", "normal": "common", "common": "common",
            "good": "uncommon", "uncommon": "uncommon",
            "great": "rare", "rare": "rare",
            "excellent": "epic", "epic": "epic",
            "perfect": "legendary", "legendary": "legendary",
            "eternal": "ethereal", "ethereal": "ethereal",
        }
        if w == "":
            return ("common", None)
        if w == "fine":
            return (None, "'fine' is not a valid quality for a crafted item")
        if w in ladder:
            return (ladder[w], None)
        return (None, f"invalid quality '{raw}'")
    if t in ("material", "consumable"):
        if w in ("", "normal", "none", "common"):
            return ("", None)
        if w == "fine":
            if cap.get("can_fine"):
                return ("fine", None)
            return (None, "this item cannot be fine")
        return (None, f"invalid quality '{raw}' (expected blank or 'fine')")
    if t == "pet_egg":
        if w in ("", "normal", "none", "common"):
            return ("", None)
        if w == "rare":
            return ("rare", None)
        return (None, f"invalid quality '{raw}' (expected blank or 'rare')")
    # single-quality types: ignore any provided value, store base.
    return ("", None)


def validate_quantity(raw: str) -> Tuple[Optional[int], Optional[str]]:
    s = str(raw or "").strip().replace(",", "")
    if s == "":
        return (1, None)  # blank -> 1
    try:
        n = int(float(s))
    except (TypeError, ValueError):
        return (None, f"quantity '{raw}' is not a whole number")
    if n < 1:
        return (None, "quantity must be at least 1")
    if n > MAX_QTY:
        return (None, f"quantity exceeds the maximum ({MAX_QTY:,})")
    return (n, None)


def validate_price(raw: str, price_mode: str, avg: Optional[int]) -> Tuple[Optional[int], Optional[str]]:
    """Return ``(price_gold|None, error)``. None price = negotiable.

    ``price_mode``: '' uses the Price column; 'avg' uses the item's recent-sales
    average (``avg``), ignoring the column entirely. Gold is a whole number.
    """
    if price_mode == "avg":
        if avg is None:
            return (None, None)  # no history -> negotiable
        try:
            return (int(round(float(avg))), None)
        except (TypeError, ValueError):
            return (None, None)
    s = str(raw or "").strip().replace(",", "").lstrip("$")
    if s == "":
        return (None, None)  # negotiable
    try:
        n = float(s)
    except (TypeError, ValueError):
        return (None, f"price '{raw}' is not a number")
    if n < 0:
        return (None, "price cannot be negative")
    if n != int(n):
        return (None, "price must be a whole number of gold")
    return (int(n), None)


def validate_notes(raw: str) -> Tuple[Optional[str], Optional[str]]:
    s = str(raw or "").strip()
    if len(s) > MAX_NOTE_LEN:
        return (None, f"note exceeds the maximum length ({MAX_NOTE_LEN} characters)")
    return ((s or None), None)


def _cell(row: List[str], idx: Optional[int]) -> str:
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    return row[idx] if row[idx] is not None else ""


def dup_key(slug: str, quality_token: str) -> Tuple[str, str]:
    """Duplicate identity = item + quality (confirmed design)."""
    return (slug, quality_token or "")


# ── Report assembly ──────────────────────────────────────────────────────────
def validate_import(
    kind: str,
    rows: List[List[str]],
    mapping: Dict[str, Optional[int]],
    *,
    resolve_item: Callable[[str], Optional[Dict[str, Any]]],
    existing_index: Optional[Dict[Tuple[str, str], Dict[str, Any]]] = None,
    owned_index: Optional[Dict[str, Dict[str, int]]] = None,
    price_mode: str = "",
    avg_prices: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Build the good/bad validation report from parsed DATA rows (no header).

    ``kind`` is 'wishlist' or 'listings'. ``resolve_item(raw)`` returns the
    catalog capability dict ``{slug,type,name,can_fine}`` or None. Owned checks
    run only for listings. Returns a dict the UI renders before importing.
    """
    existing_index = existing_index or {}
    owned_index = owned_index or {}
    avg_prices = avg_prices or {}
    is_listings = (kind == "listings")

    name_idx = mapping.get("item_name")
    if name_idx is None:
        raise ValueError("item_name column must be mapped")

    good: List[Dict[str, Any]] = []
    bad: List[Dict[str, Any]] = []
    seen_first: Dict[Tuple[str, str], int] = {}  # (slug,qtok) -> good-row ordinal
    dup_count = owned_count = 0

    for i, row in enumerate(rows):
        row_no = i + 1  # 1-based data row (header excluded), for user messages
        raw_name = _cell(row, name_idx).strip()
        raw = {
            "item_name": raw_name,
            "quality": _cell(row, mapping.get("quality")),
            "quantity": _cell(row, mapping.get("quantity")),
            "price": _cell(row, mapping.get("price")),
            "notes": _cell(row, mapping.get("notes")),
        }
        # Wholly blank line — skip silently (trailing newline etc.).
        if not any(str(v).strip() for v in raw.values()):
            continue

        errors: List[str] = []
        if not raw_name:
            errors.append("missing item name")
            bad.append({"row": row_no, "raw": raw, "errors": errors})
            continue

        cap = resolve_item(raw_name)
        if not cap:
            errors.append("no matching item name")
            bad.append({"row": row_no, "raw": raw, "errors": errors})
            continue

        qtok, qerr = validate_quality(raw["quality"], cap)
        if qerr:
            errors.append(qerr)
        qty, qtyerr = validate_quantity(raw["quantity"])
        if qtyerr:
            errors.append(qtyerr)
        avg = avg_prices.get(cap["slug"])
        price, perr = validate_price(raw["price"], price_mode, avg)
        if perr:
            errors.append(perr)
        note, nerr = validate_notes(raw["notes"])
        if nerr:
            errors.append(nerr)

        if errors:
            bad.append({"row": row_no, "raw": raw, "errors": errors})
            continue

        key = dup_key(cap["slug"], qtok or "")
        entry: Dict[str, Any] = {
            "row": row_no,
            "item": {"slug": cap["slug"], "type": cap["type"],
                     "quality": qtok or "", "name": cap.get("name") or raw_name},
            "quality": qtok or "",
            "quantity": qty,
            "price": price,          # gold; None = negotiable
            "notes": note,
            "dup": None,
            "owned": None,
        }

        # Duplicate: against an existing entry, or an earlier row in THIS file.
        existing = existing_index.get(key)
        if existing is not None:
            entry["dup"] = {"source": "existing", "existing_id": existing.get("id"),
                            "existing_qty": existing.get("qty")}
            dup_count += 1
        elif key in seen_first:
            entry["dup"] = {"source": "file", "first_row": seen_first[key]}
            dup_count += 1
        else:
            seen_first[key] = row_no

        # Owned check — listings only.
        if is_listings:
            owned_qty = int(owned_index.get(cap["slug"], {}).get(qtok or "", 0))
            if qty > owned_qty:
                entry["owned"] = {"owned_qty": owned_qty, "listing_qty": qty, "too_few": True}
                owned_count += 1

        good.append(entry)

    return {
        "kind": kind,
        "total": len(good) + len(bad),
        "good": good,
        "bad": bad,
        "counts": {
            "importable": len(good),
            "bad": len(bad),
            "duplicates": dup_count,
            "owned_issues": owned_count,
        },
    }


# ── Template files ───────────────────────────────────────────────────────────
def template_rows(kind: str) -> List[List[str]]:
    """Header + example rows for a downloadable import template."""
    header = ["Item Name", "Quality", "Quantity", "Price", "Notes"]
    if kind == "listings":
        examples = [
            ["Oak Log", "", "100", "5", "bulk, obo"],
            ["adamant_bar_fine", "Fine", "10", "250", ""],
            ["Birch Logs", "", "50", "", "negotiable"],
        ]
    else:  # wishlist
        examples = [
            ["Oak Log", "", "100", "6", "want for crafting"],
            ["Topaz", "", "5", "", "any price"],
            ["adamant_bar_fine", "Fine", "10", "300", ""],
        ]
    return [header] + examples
