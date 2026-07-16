#!/usr/bin/env python3
"""
Shared transforms for tools-api ingest scripts.

Implements the 3-state convention from the new typed schema:
  - MISSING: key absent from the dict (e.g. optional field not emitted)
  - NULL:    key present, value is None (e.g. nullable required field —
             "this concept does not apply" — distinct from empty)
  - EMPTY:   key present, value is [] / "" / {} (the concept applies but
             happens to have zero entries)
  - VALUE:   key present, value is non-empty

These three states are NOT interchangeable. Example: on a Cooldown,
`steps: 9999, seconds: null` means "this cooldown is measured in steps,
not seconds". `seconds: 0` would mean something different.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, Optional, Tuple


MISSING = 'MISSING'
NULL = 'NULL'
EMPTY = 'EMPTY'
VALUE = 'VALUE'


def field_state(d: Dict[str, Any], key: str) -> str:
    """Classify a field according to the 3+1-state convention."""
    if key not in d:
        return MISSING
    v = d[key]
    if v is None:
        return NULL
    if isinstance(v, (list, str, dict)) and len(v) == 0:
        return EMPTY
    return VALUE


def get_with_state(d: Dict[str, Any], key: str) -> Tuple[str, Any]:
    """Return (state, value). value is None for MISSING and NULL."""
    state = field_state(d, key)
    if state in (MISSING, NULL):
        return state, None
    return state, d[key]


# ────────────────────────────────────────────────────────────────────────
# Stat value normalization (shared with services ingest)
# ────────────────────────────────────────────────────────────────────────

# Internal stat names whose stored display value is the raw API number
# (no *100). `steps_add` is a flat step count (e.g. Ring of Pandemonium
# +2 steps); a *percent* steps modifier maps to `steps_percent` (NOT in
# this set) and IS multiplied by 100.
RAW_VALUE_STATS = frozenset({
    'steps_add', 'inventory_space',
})

# API stat name -> internal stat name for unconditional mappings.
# Anything not listed (and not split below) passes through unchanged.
STAT_NAME_MAP: Dict[str, str] = {}

# API stats that split into two different internal stats depending on the
# `isPercent` flag. The percent form is *100'd at display time; the flat
# form is stored raw. Resolved in normalize_stat_name().
#   api_name: (percent_internal_name, flat_internal_name)
PERCENT_SPLIT_STATS: Dict[str, Tuple[str, str]] = {
    'steps_required': ('steps_percent', 'steps_add'),
    'bonus_experience': ('bonus_xp_percent', 'bonus_xp_add'),
}


def normalize_stat_name(api_name: str, is_percent: bool = False) -> str:
    """Map an API stat name to its internal name.

    For stats in PERCENT_SPLIT_STATS the internal name depends on
    `is_percent` (e.g. steps_required -> steps_percent when the API flags
    it as a percent, else steps_add).
    """
    split = PERCENT_SPLIT_STATS.get(api_name)
    if split is not None:
        return split[0] if is_percent else split[1]
    return STAT_NAME_MAP.get(api_name, api_name)


def display_stat_value(stat_entry: Dict[str, Any]) -> float:
    """Convert a raw API stat entry's value into the stored display value.

    The API value sign is already correct. `isNegative` is a UI hint, not
    a sign multiplier. `isPercent` triggers *100 unless the resolved
    internal stat is in RAW_VALUE_STATS.
    """
    raw = float(stat_entry.get('value', 0.0))
    is_percent = bool(stat_entry.get('isPercent', False))
    api_name = stat_entry.get('stat', '')
    name = normalize_stat_name(api_name, is_percent)
    val = raw * 100 if is_percent and name not in RAW_VALUE_STATS else raw
    val = round(val, 4)
    if val == int(val):
        return float(int(val))
    return val


# ────────────────────────────────────────────────────────────────────────
# Requirement parsing
# ────────────────────────────────────────────────────────────────────────

def parse_reputation_requirement(req: Dict[str, Any]) -> Optional[Tuple[str, int]]:
    """Extract (faction_key, level) from a gameData reputation requirement."""
    if req.get('type') != 'gameData':
        return None
    body = req.get('requirement') or {}
    gd_id = body.get('gameDataId') or ''
    if not gd_id.endswith('Reputation'):
        return None
    faction_camel = gd_id[: -len('Reputation')]
    faction_key = re.sub(r'(?<!^)([A-Z])', r'_\1', faction_camel).lower()
    raw_data = body.get('data', '')
    try:
        parsed = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
        level_str = parsed.get('double') or parsed.get('int') or '0'
        level = int(float(level_str))
    except (TypeError, ValueError, json.JSONDecodeError):
        level = 0
    return (faction_key, level)


# ────────────────────────────────────────────────────────────────────────
# Python file emitter (preserves null/empty/missing in repr)
# ────────────────────────────────────────────────────────────────────────

def to_python_literal(value: Any, indent: int = 0, base: int = 0) -> str:
    """Render a JSON-like value as a Python literal.

    None → None. [] → []. {} → {}. Strings escaped via repr(). Ints/floats
    direct. Dicts pretty-printed with `indent` spaces per level.
    Numeric keys (e.g. cooldown level 5) are rendered as int literals.
    """
    pad_outer = ' ' * base
    pad_inner = ' ' * (base + indent)

    if value is None:
        return 'None'
    if isinstance(value, bool):
        return 'True' if value else 'False'
    if isinstance(value, (int,)):
        return str(value)
    if isinstance(value, float):
        if value == int(value):
            return f'{int(value)}.0'
        return repr(value)
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, list):
        if not value:
            return '[]'
        if indent <= 0:
            return '[' + ', '.join(to_python_literal(v, 0, 0) for v in value) + ']'
        items = [pad_inner + to_python_literal(v, indent, base + indent) for v in value]
        return '[\n' + ',\n'.join(items) + '\n' + pad_outer + ']'
    if isinstance(value, dict):
        if not value:
            return '{}'
        if indent <= 0:
            parts = [
                f'{_render_key(k)}: {to_python_literal(v, 0, 0)}'
                for k, v in value.items()
            ]
            return '{' + ', '.join(parts) + '}'
        parts = [
            f'{pad_inner}{_render_key(k)}: {to_python_literal(v, indent, base + indent)}'
            for k, v in value.items()
        ]
        return '{\n' + ',\n'.join(parts) + '\n' + pad_outer + '}'
    return repr(value)


def _render_key(k: Any) -> str:
    if isinstance(k, int) and not isinstance(k, bool):
        return str(k)
    return repr(k)


def write_python_data_module(
    out_path: str,
    var_name: str,
    data: Any,
    *,
    docstring: Optional[str] = None,
    extra_imports: Iterable[str] = (),
) -> None:
    """Emit a `name = {...}` Python module. Preserves None/empty/etc."""
    from pathlib import Path
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    lines = ['#!/usr/bin/env python3', '"""']
    if docstring:
        lines.append(docstring)
    else:
        lines.append('Auto-generated from the WalkScape tools API.')
    lines.append('DO NOT EDIT MANUALLY')
    lines.append('"""')
    lines.append('')
    for imp in extra_imports:
        lines.append(imp)
    if extra_imports:
        lines.append('')
    lines.append(f'{var_name} = {to_python_literal(data, indent=4)}')
    lines.append('')
    p.write_text('\n'.join(lines), encoding='utf-8')
