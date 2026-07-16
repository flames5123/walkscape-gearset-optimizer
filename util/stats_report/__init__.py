"""Stats report stale detection — precompute and runtime modules.

This package holds the precompute pipeline (building static dominators,
applicability bitmaps, master index) plus the runtime layer
(CharacterStateSnapshot, compute_effective_owned_bitmap, detect_stale_scopes)
that powers the stale-detection feature.

See .kiro/specs/stats-report-stale-detection/ for the spec.
"""
