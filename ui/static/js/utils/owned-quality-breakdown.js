/**
 * Per-quality "owned" breakdown for item hover popovers.
 *
 * Shared by every hover surface that shows how many of an item the player owns
 * (the drops / notepad / crafting-tree / gearset-comparison popover and the
 * trading item-stats card). Replaces the old single "N owned" (total across
 * qualities) line with:
 *
 *   line 1 : "<count for the hovered quality> owned"
 *   line 2 : "(<n> <Quality>, <m> <Quality>, ...)"  — only qualities actually
 *            owned (count > 0), the quality WORDS in their quality colour and
 *            the NUMBERS in var(--text-secondary).
 *
 * Data source: /api/owned-by-quality -> { item_id: { token: qty } } where token
 * is '' (base/Normal), 'common'..'ethereal' (craft rarity tiers) or 'fine'.
 * The map is fetched once and cached module-wide.
 *
 * ownedBlockHtml() returns null when the item has no meaningful per-quality
 * variety to show (e.g. a fixed-rarity loot item, or an item owned only at
 * Normal) so the caller can fall back to the plain "N owned" total line.
 */

let _ownedQ = null;
let _ownedQLoading = null;

/** Fetch (once) and cache the live per-quality owned map. Idempotent.
 * Resolves to the map. An empty result (e.g. no character imported yet) is NOT
 * cached, so a later import populates the breakdown without a page reload. */
export function fetchOwnedByQuality() {
    if (_ownedQ) return Promise.resolve(_ownedQ);
    if (_ownedQLoading) return _ownedQLoading;
    _ownedQLoading = (async () => {
        let map = {};
        try {
            map = (await (await fetch('/api/owned-by-quality')).json()).owned || {};
        } catch (e) {
            map = {};
        }
        if (map && Object.keys(map).length) _ownedQ = map;
        _ownedQLoading = null;
        return map;
    })();
    return _ownedQLoading;
}

/** Synchronous access to whatever has been cached so far ({} if not loaded). */
export function ownedByQualityCache() { return _ownedQ || {}; }

// token (export suffix) -> quality label
const TOKEN_TO_LABEL = {
    '': 'Normal', common: 'Normal', uncommon: 'Good', rare: 'Great',
    epic: 'Excellent', legendary: 'Perfect', ethereal: 'Eternal', fine: 'Fine',
};
// quality label -> rarity class (for the quality colour var)
const RARITY_BY_LABEL = {
    Normal: 'common', Good: 'uncommon', Great: 'rare',
    Excellent: 'epic', Perfect: 'legendary', Eternal: 'ethereal',
};
const LABEL_ORDER = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal', 'Fine'];
const LABELS = new Set(LABEL_ORDER);

// Resolve a stored token ('', 'epic', 'fine', ...) to its quality label.
// Unlike normLabel(), the empty base token IS meaningful here -> 'Normal'.
function tokenLabel(tok) {
    if (tok in TOKEN_TO_LABEL) return TOKEN_TO_LABEL[tok];
    return LABELS.has(tok) ? tok : null;
}

// Accept either a token ('epic', 'fine', '') or an already-resolved quality
// label ('Excellent', 'Fine', 'Normal'); return the canonical quality label.
// Empty / missing -> null (the caller treats that as "no specific quality").
function normLabel(x) {
    if (x == null || x === '') return null;
    if (LABELS.has(x)) return x;
    const k = String(x).toLowerCase();
    if (k === 'fine') return 'Fine';
    return TOKEN_TO_LABEL[k] || null;
}

function colorFor(label) {
    if (label === 'Fine') return 'var(--fine-color)';
    const r = RARITY_BY_LABEL[label];
    return r ? `var(--rarity-${r}-border, var(--text-secondary))` : 'var(--text-secondary)';
}

/**
 * Build the two-line owned block, or return null when there is nothing
 * per-quality worth showing (caller then falls back to the plain total line).
 *
 * @param {Object} opts
 * @param {Object|null} opts.ownedMap      - { token: qty } for THIS item
 * @param {string|null} opts.activeQuality - the hovered quality (label or token)
 * @param {boolean} [opts.totalActive]     - line 1 shows the TOTAL owned across
 *                                           qualities (Column-1 row has no single
 *                                           hovered quality)
 * @param {string} [opts.line1Class]       - class for the "N owned" line
 * @param {string} [opts.line1Style]       - inline style for the "N owned" line
 * @param {string} [opts.breakdownStyle]   - inline style for the breakdown line
 * @returns {string|null}
 */
export function ownedBlockHtml(opts = {}) {
    const { ownedMap, activeQuality } = opts;
    if (!ownedMap || typeof ownedMap !== 'object') return null;

    const counts = {};
    for (const [tok, qty] of Object.entries(ownedMap)) {
        const label = tokenLabel(tok);
        if (!label) continue;
        counts[label] = (counts[label] || 0) + (Number(qty) || 0);
    }
    const owned = LABEL_ORDER.filter(l => (counts[l] || 0) > 0);
    if (owned.length === 0) return null;
    // Nothing worth breaking down: a single Normal-only stack (fixed-rarity
    // loot items also land here via the '' token). Let the caller show the
    // plain total instead.
    if (owned.length === 1 && owned[0] === 'Normal') return null;

    const activeLabel = normLabel(activeQuality) || 'Normal';
    const activeCount = opts.totalActive
        ? owned.reduce((s, l) => s + (counts[l] || 0), 0)
        : (counts[activeLabel] || 0);

    const l1cls = opts.line1Class ? ` class="${opts.line1Class}"` : '';
    const l1style = opts.line1Style ? ` style="${opts.line1Style}"` : '';
    const line1 = `<div${l1cls}${l1style}>${activeCount} owned</div>`;

    const parts = owned.map(l =>
        `<span style="color:var(--text-secondary);">${counts[l]}</span>&nbsp;`
        + `<span style="color:${colorFor(l)};">${l}</span>`);
    const bdStyle = opts.breakdownStyle
        || 'text-align:center;font-size:0.8em;color:var(--text-secondary);margin:-6px 0 8px;';
    const line2 = `<div class="owned-quality-breakdown" style="${bdStyle}">(${parts.join(', ')})</div>`;

    return line1 + line2;
}
