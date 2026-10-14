#!/usr/bin/env python3
"""Full-catalog wiki value audit — find every item whose tools-API value is
stale vs the live game (like ectoplasm's Fine Value 6-should-be-5).

The WalkScape wiki auto-syncs from the live game, so its infobox
"Value" (common) and "Fine Value" are authoritative. The tools-API
``itemValue.value`` sometimes lags. This script fetches every catalog item's
wiki page (cached), parses Value / Fine Value, and diffs against the tools-API
values.

Two mismatch classes:

  * AUTO-CORRECTABLE (material / consumable, common|fine tier): these flow
    through ``old_shape_emitters._material_value``, which already honors
    ``util/wiki_value_corrections.WIKI_VALUE_CORRECTIONS``. With ``--emit`` the
    script writes every confirmed mismatch here into that file, so the correct
    in-game value is used everywhere (bank/total-wealth AND optimizer
    sell-value) and survives future tools-API rescrapes.

  * REPORT-ONLY (gear: loot / crafted / egg): their per-quality values are
    multiplier-derived and the wiki only lists one base Value, so a naive diff
    is unreliable. These are printed for manual review, never auto-corrected.

  Curiosity-keyword items are treated like any other material: the wiki is the
  authoritative in-game value (a uniform Value 0 / Fine Value 6), so where the
  tools-API disagrees (e.g. it lists 10/50 for Name tag) the wiki value wins.

Usage:
    python3 util/scrapers/audit_wiki_values.py            # audit (uses HTML cache)
    python3 util/scrapers/audit_wiki_values.py --rescrape # force wiki refetch
    python3 util/scrapers/audit_wiki_values.py --emit     # write corrections file
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scraper_utils as su  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
ITEMS_CACHE = REPO_ROOT / 'util' / 'cache' / 'tools_api_cache' / 'items'
HTML_CACHE = REPO_ROOT / 'util' / 'cache' / 'item_values_cache'
CORRECTIONS_PY = REPO_ROOT / 'util' / 'wiki_value_corrections.py'
WIKI = 'https://wiki.walkscape.app/wiki/'

# tiers the wiki reliably exposes and _material_value can override
AUDIT_TIERS = ('common', 'fine')
# types whose common/fine value flows through _material_value (auto-correctable)
MATERIAL_TYPES = ('material', 'consumable')
FETCH_DELAY_S = 0.4  # polite delay on a fresh (cache-miss) download


def load_value_items():
    """[(id, name, type, value_dict)] for every item whose itemValue.value is a
    per-tier dict (skips null-value and scalar-currency items)."""
    out = []
    for f in sorted(glob.glob(str(ITEMS_CACHE / '*.json'))):
        if os.path.basename(f).startswith('_'):
            continue
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        v = (d.get('itemValue') or {}).get('value')
        if isinstance(v, dict) and d.get('id') and d.get('name'):
            kw = [str(k).lower() for k in (d.get('keywords') or [])]
            out.append((d['id'], d['name'], d.get('type'), v, kw))
    return out


def parse_wiki_values(html: str):
    """Return {'value_rows': [int,...], 'fine': int|None} from the infobox.

    Materials have a single 'Value:' row (common) + one 'Fine Value:' row.
    Gear has a *per-quality* 'Value:' table (common..ethereal, 6 rows) and no
    'Fine Value:'. We keep every 'Value:' row so a gear table can be matched
    against the API's full per-quality value set rather than a single tier.
    """
    out = {'value_rows': [], 'fine': None}
    if not html:
        return out
    soup = BeautifulSoup(html, 'html.parser')
    for tr in soup.find_all('tr'):
        cells = [c.get_text(strip=True) for c in tr.find_all(['th', 'td'])]
        if not cells:
            continue
        label = cells[0].rstrip(':').strip().lower()
        if label not in ('value', 'fine value'):
            continue
        num = None
        for c in cells[1:]:
            m = re.search(r'-?\d[\d,]*', c)
            if m:
                num = int(m.group(0).replace(',', ''))
                break
        if num is None:
            continue
        if label == 'fine value':
            out['fine'] = num
        else:
            out['value_rows'].append(num)
    return out


def fetch(name: str, rescrape: bool):
    page = name.replace(' ', '_')
    path = HTML_CACHE / f'{page}.html'
    missed = rescrape or not path.exists()
    html = su.download_with_retry(f'{WIKI}{page}', path) if not rescrape \
        else su.download_page(f'{WIKI}{page}', path, rescrape=True)
    if missed:
        time.sleep(FETCH_DELAY_S)
    return html


def run(rescrape: bool = False, emit: bool = False):
    items = load_value_items()
    print(f'[audit] {len(items)} items with per-tier tools-API values')

    auto = []      # (id, name, type, tier, api_v, wiki_v)  material/consumable
    report = []    # (id, name, type, tier, api_v, wiki_v)  gear
    no_wiki = []   # (id, name)  wiki page missing / no Value rows

    for iid, name, typ, apiv, kw in items:
        html = fetch(name, rescrape)
        wikiv = parse_wiki_values(html)
        value_rows = wikiv['value_rows']
        wiki_fine = wikiv['fine']
        if not value_rows and wiki_fine is None:
            no_wiki.append((iid, name))
            continue

        api_nonfine = sorted(v for t, v in apiv.items() if t != 'fine')
        api_fine = apiv.get('fine')

        if typ in MATERIAL_TYPES:
            # materials: single common Value row + one Fine Value row. The wiki
            # (game-synced) is authoritative for every material/consumable,
            # including Curiosity items — correct to the wiki value.
            wiki_common = value_rows[0] if len(value_rows) == 1 else None
            api_common = apiv.get('common')
            for tier, av, wv in (('common', api_common, wiki_common),
                                 ('fine', api_fine, wiki_fine)):
                if av is None or wv is None or int(av) == int(wv):
                    continue
                auto.append((iid, name, typ, tier, int(av), int(wv)))
        else:
            # gear: match the full per-quality Value table (set-wise) against API
            if value_rows and sorted(value_rows) != api_nonfine:
                report.append((iid, name, typ, 'value-table',
                               tuple(api_nonfine), tuple(sorted(value_rows))))

    # ── report ───────────────────────────────────────────────────────────
    print('\n' + '=' * 74)
    print(f'AUTO-CORRECTABLE mismatches (material/consumable, common|fine): {len(auto)}')
    print('=' * 74)
    for iid, name, typ, tier, av, wv in sorted(auto):
        print(f'  {name:32s} [{typ:10s}] {tier:6s} API={av:<6d} wiki={wv:<6d} (Δ{av - wv:+d})')

    print('\n' + '=' * 74)
    print(f'GEAR value-table differences (loot/crafted/egg, per-quality): {len(report)}')
    print('  (wiki shows a full common..ethereal Value table; flagged only when it')
    print('   genuinely differs from the API per-quality set — review manually)')
    print('=' * 74)
    for iid, name, typ, _kind, api_t, wiki_t in sorted(report):
        print(f'  {name:32s} [{typ:10s}] API={api_t} wiki={wiki_t}')

    print(f'\n[audit] {len(no_wiki)} items had no wiki Value rows (page missing / unparsable)')

    # ── build corrections dict (auto class only) ──────────────────────────
    corrections = {}
    for iid, name, typ, tier, av, wv in auto:
        corrections.setdefault(iid, {})[tier] = wv
    corrections = {k: dict(sorted(v.items())) for k, v in sorted(corrections.items())}

    if emit:
        write_corrections(corrections)
        print(f'\n[audit] wrote {len(corrections)} corrected items → {CORRECTIONS_PY}')
    else:
        print(f'\n[audit] --emit not set; would write {len(corrections)} corrected items.')
        print('        Proposed WIKI_VALUE_CORRECTIONS:')
        print('        ' + json.dumps(corrections, indent=2).replace('\n', '\n        '))
    return corrections, report, no_wiki


def write_corrections(corrections: dict):
    header = '''#!/usr/bin/env python3
"""Authoritative wiki value corrections for items whose tools-API `itemValue`
is stale or wrong.

The WalkScape wiki auto-syncs from the live game, so its "Value" / "Fine Value"
is the source of truth. Where the tools-API disagrees, we override at emit time
so the correct in-game value is used everywhere (bank/total-wealth AND optimizer
sell-value) and survives future tools-API rescrapes.

Generated by util/scrapers/audit_wiki_values.py --emit (full-catalog wiki
audit). The audit fetches every item's wiki Value / Fine Value and diffs
against the tools-API; every material/consumable common|fine mismatch lands
here. Re-run the audit after a data refresh to regenerate.

Keyed by tools-API item id -> {tier: value}, tier in {'common', 'fine'}.
"""

WIKI_VALUE_CORRECTIONS = {'''
    lines = [header]
    for iid, tiers in corrections.items():
        inner = ', '.join(f"{t!r}: {v}" for t, v in tiers.items())
        lines.append(f'    {iid!r}: {{{inner}}},')
    lines.append('}\n')
    CORRECTIONS_PY.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    run(rescrape='--rescrape' in sys.argv, emit='--emit' in sys.argv)
