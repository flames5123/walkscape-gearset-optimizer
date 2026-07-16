"""
Pyodide runtime bundle builder.

PROTOTYPE (Option C: client-side optimization via Pyodide).

This module packages the *pure-Python* optimizer tree into a single in-memory
zip that can be downloaded by the browser, unpacked into the Pyodide virtual
filesystem, and used to run `ui.optimize_worker.main()` client-side — the exact
same code path the server runs as a subprocess, so results are logic-identical
(no second implementation, no formula drift).

The bundle deliberately excludes scrapers (network deps), caches, pyc files,
and anything that touches Flask/DB/network at import time. The activity /
recipe / travel optimize paths only need:

  - util/**            (minus scrapers, cache, __pycache__)
  - optimize_*_gearsets.py  (root optimizer entrypoints)
  - my_config.py            (get_character + config)
  - ui/optimize_worker.py + ui/__init__.py

Keeping this builder standalone (no Flask import) means it can be unit-tested
and the produced zip can be import-checked under native CPython, which is a
strong proxy for "will it import under Pyodide" since every module is pure
Python.
"""

from __future__ import annotations

import io
import os
import zipfile

# Root-level python files the optimizer entrypoints need.
ROOT_FILES = (
    "optimize_activity_gearsets.py",
    "optimize_craft_gearsets.py",
    "optimize_travel_gearsets.py",
    "my_config.py",
)

# ui/ files needed to run the worker as `python -m ui.optimize_worker`.
UI_FILES = (
    "ui/__init__.py",
    "ui/optimize_worker.py",
    "ui/crafting_tree.py",  # client-side crafting tree calculate (calculate_tree)
    "ui/stats_report_worker.py",  # client-side goals report (build_*_jobs + execute_job)
    "ui/crafting_tree_optimize.py",  # client-side crafting tree node optimize (shared core)
    "ui/travel_optimize_worker.py",  # client-side travel optimize (run_travel_optimization)
)

# Non-.py data files the optimizers read at RUNTIME (via open()). These live
# outside util/ and aren't .py, so the loops below won't pick them up — list
# them explicitly. The travel optimizer's _load_routes_by_id() opens
# ui/static/assets/map/data/routes.json relative to the project root; without
# it, client-side (Pyodide) travel optimization throws FileNotFoundError while
# the server path (full filesystem) works.
DATA_FILES = (
    "ui/static/assets/map/data/routes.json",
)

# Directories under util/ that must NOT ship to the browser.
#  - scrapers: network + filesystem deps, never used by the optimizer
#  - cache:    multi-MB scraped HTML/JSON, not needed at optimize time
#  - __pycache__: compiled artifacts
EXCLUDED_UTIL_DIRS = ("scrapers", "cache", "__pycache__")


def _iter_util_files(project_root: str):
    """Yield (abs_path, arcname) for every shippable file under util/."""
    util_root = os.path.join(project_root, "util")
    for dirpath, dirnames, filenames in os.walk(util_root):
        # Prune excluded directories in-place so os.walk doesn't descend them.
        rel_from_util = os.path.relpath(dirpath, util_root)
        top = rel_from_util.split(os.sep)[0] if rel_from_util != "." else ""
        if top in EXCLUDED_UTIL_DIRS:
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_UTIL_DIRS]
        for fn in filenames:
            if fn.endswith(".pyc"):
                continue
            if not fn.endswith(".py"):
                continue
            abs_path = os.path.join(dirpath, fn)
            arcname = os.path.relpath(abs_path, project_root)
            yield abs_path, arcname


def iter_bundle_members(project_root: str):
    """Yield (abs_path, arcname) for every file that belongs in the bundle.

    arcname is the path *relative to the project root*, so unpacking into a
    Pyodide working directory reproduces the import layout (util/..., ui/...,
    and root modules at top level).
    """
    for abs_path, arcname in _iter_util_files(project_root):
        yield abs_path, arcname
    for rel in ROOT_FILES + UI_FILES + DATA_FILES:
        abs_path = os.path.join(project_root, rel)
        if os.path.exists(abs_path):
            yield abs_path, rel


def build_bundle_bytes(project_root: str) -> bytes:
    """Build the runtime bundle zip and return its raw bytes."""
    buf = io.BytesIO()
    # ZIP_DEFLATED keeps the wire size small; the tree is ~4MB raw and
    # compresses well (it's mostly source text + data literals).
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        seen = set()
        for abs_path, arcname in iter_bundle_members(project_root):
            # Normalize to forward slashes for cross-platform unpack in Pyodide.
            arc = arcname.replace(os.sep, "/")
            if arc in seen:
                continue
            seen.add(arc)
            zf.write(abs_path, arc)
    return buf.getvalue()


if __name__ == "__main__":
    # Quick manual build + summary (used by the local import-completeness check).
    import sys

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = build_bundle_bytes(root)
    members = list(iter_bundle_members(root))
    sys.stderr.write(
        f"bundle: {len(members)} files, {len(data) / 1024:.0f} KiB compressed\n"
    )
    # Write to a path if requested so it can be extracted and import-checked.
    if len(sys.argv) > 1:
        with open(sys.argv[1], "wb") as fh:
            fh.write(data)
        sys.stderr.write(f"wrote {sys.argv[1]}\n")
