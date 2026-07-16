"""Precompute pipeline for stats-report stale detection.

Each builder is invokable in two modes:

  - **Full rebuild**: rebuilds every row in the precomputed table. Used at
    migration time and as a recovery option.
  - **Incremental**: rebuilds only rows affected by `changed_slugs`. Used by
    individual scrapers when they only emit a partial catalog refresh.

The orchestrators `precompute_all(db)` and `precompute_changed(db, slugs)`
in `runner.py` chain the builders together.
"""

from .runner import precompute_all, precompute_changed, precompute_is_stale

__all__ = ["precompute_all", "precompute_changed", "precompute_is_stale"]
