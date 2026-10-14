#!/usr/bin/env python3
"""Dump the Walkdle guessable-item pool to JSON for the best-guess solver.

The pool is exactly what GET /api/walkdle/catalog serves (ui/walkdle_catalog.py
build_walkdle_items) -- the id-sorted equipment pool the browser engine picks
the daily target from and compares guesses against. Writing it to a file lets
the Node solver (util/walkdle_best_guess.mjs) score every candidate guess with
the same data the game uses, offline.

Usage:
    python3 util/walkdle_dump_catalog.py [out.json]   # default: walkdle_catalog.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ui.walkdle_catalog import build_walkdle_items  # noqa: E402


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else 'walkdle_catalog.json'
    items = build_walkdle_items()
    with open(out, 'w') as fh:
        json.dump(items, fh)
    print(f'Wrote {len(items)} items to {out}')


if __name__ == '__main__':
    main()
