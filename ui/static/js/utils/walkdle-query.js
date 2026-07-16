/**
 * Walkdle guess-box query parser.
 *
 * Turns the text typed into the Walkdle guess box into a matcher used to filter
 * the candidate item list. Supports plain name/field substring matching (the
 * existing behavior), a NOT operator, and numeric field comparisons.
 *
 * Grammar — tokens are space-separated and ALL must match (logical AND):
 *   word            haystack (name/slot/quality/rarity/source/skills/keywords)
 *                   contains "word"
 *   !word | -word   haystack does NOT contain "word"
 *   "two words"     quoted phrase matched as a single substring. Smart/curly
 *                   double quotes (left/right) are accepted like a straight ".
 *   !"two words"    quoted phrase the haystack must NOT contain (- works too)
 *   field:N field=N field>N field<N field>=N field<=N
 *                   numeric compare against an item field. Recognized fields
 *                   (with aliases): value, level/lvl, stats, tier/rarity/quality.
 *                   tier/rarity/quality also accept tier NAMES (good, uncommon,
 *                   excellent, epic, ...), e.g. "rarity<excellent", "quality:good".
 *                   `:` and `=` mean equals. A leading !/- negates the compare.
 *
 * Unknown fields or non-numeric operands fall back to a plain substring match
 * of the raw token, so a stray colon never silently empties the results.
 */

/**
 * Maps a user-facing field name (and aliases) to the item property that holds
 * the number to compare against.
 */
const WALKDLE_NUMERIC_FIELDS = {
    value: 'value',
    level: 'level_req',
    level_req: 'level_req',
    lvl: 'level_req',
    stats: 'stat_count',
    stat_count: 'stat_count',
    tier: 'tier_index',
    rarity: 'tier_index',
    quality: 'tier_index',
};

// Tier fields (rarity/quality/tier) also accept tier *names*, mapped to the
// unified 0..5 tier index. Quality and rarity share the scale, so a name from
// either vocabulary resolves to its index (e.g. "excellent" == 3 == "epic").
const TIER_NAME_TO_INDEX = {
    normal: 0, good: 1, great: 2, excellent: 3, perfect: 4, eternal: 5,
    common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, ethereal: 5,
};

/** Escape regex metacharacters so a user token (which may contain (), ., etc.
 *  from item names) is matched literally inside a RegExp. */
function _escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a query into tokens. Keeps "quoted phrases" as a single token and
 * supports a leading ! or - negation on EITHER a bare word or a quoted phrase
 * (e.g. !"achievement reward"). Curly/smart double quotes from mobile keyboards
 * are accepted in any direction and treated like a straight ".
 *
 * Returns objects: { text, negate, quoted }.
 */
function tokenizeWalkdleQuery(raw) {
    // Normalize smart/curly/full-width double quotes (any direction) to ".
    const normalized = String(raw || '').replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]/g, '"');
    const tokens = [];
    // Optional !/- then a "quoted phrase", OR a bare run of non-space chars.
    const re = /(!|-)?"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(normalized)) !== null) {
        if (m[2] !== undefined) {
            tokens.push({ text: m[2], negate: m[1] === '!' || m[1] === '-', quoted: true });
        } else {
            tokens.push({ text: m[3], negate: false, quoted: false });
        }
    }
    return tokens;
}

/** Build a numeric comparator predicate for an operator + threshold. */
function makeNumericComparator(op, threshold) {
    switch (op) {
        case '>': return (v) => v > threshold;
        case '<': return (v) => v < threshold;
        case '>=': return (v) => v >= threshold;
        case '<=': return (v) => v <= threshold;
        case '=':
        case ':':
        default: return (v) => v === threshold;
    }
}

/**
 * Parse a Walkdle guess-box query into a matcher.
 *
 * @param {string} raw - the raw query string
 * @param {{advanced?: boolean}} [opts] - when advanced is false (default true),
 *   operators (!/-, field:N, field>N…) are disabled and matched literally
 * @returns {{ firstText: string|null, test: (item: object, hay: string) => boolean }}
 *   `firstText` is the first positive plain word (the caller uses it for name
 *   relevance ranking). `test(item, hay)` applies every token with AND, where
 *   `hay` is the lowercased haystack the caller builds from the item's text
 *   fields and numeric tokens compare against `item[field]`.
 */
export function parseWalkdleQuery(raw, opts) {
    // `advanced` gates the operator grammar (negation, numeric/tier compares).
    // When disabled (the default guess box), every token is a plain literal
    // substring/word match: quoted phrases still group, tier words still match
    // whole-word, but `!word`, `-word`, and `field:N`/`>`/`<`/`=` are matched
    // verbatim (so they simply find nothing) — "advanced filters off".
    const advanced = !opts || opts.advanced !== false;
    const tokens = [];
    let firstText = null;
    for (const t of tokenizeWalkdleQuery(raw)) {
        let text = t.text;
        let negate = t.negate;
        if (!text) continue;

        // Bare tokens may carry a leading ! or - (quoted tokens already had
        // their negation parsed off by the tokenizer). Only honored in advanced
        // mode; otherwise the !/- stays part of the literal needle.
        if (advanced && !t.quoted && (text[0] === '!' || text[0] === '-')) {
            negate = true;
            text = text.slice(1);
        }
        if (!text) continue;
        // Basic mode never negates — a quoted phrase typed with !/- is literal.
        if (!advanced) negate = false;

        let handled = false;
        // A quoted phrase is always a literal substring — never a field compare.
        // Field compares are an advanced-only operator.
        if (advanced && !t.quoted) {
            const m = text.match(/^([a-zA-Z_]+)(>=|<=|>|<|=|:)(.+)$/);
            if (m) {
                const field = WALKDLE_NUMERIC_FIELDS[m[1].toLowerCase()];
                const operand = m[3].trim();
                let num = Number(operand);
                // Tier fields also accept a tier NAME (e.g. rarity<excellent,
                // quality:good, tier>=epic) — mapped to the unified 0..5 index.
                if (field === 'tier_index' && !(operand !== '' && Number.isFinite(num))) {
                    const named = TIER_NAME_TO_INDEX[operand.toLowerCase()];
                    if (named !== undefined) num = named;
                }
                if (field && operand !== '' && Number.isFinite(num)) {
                    tokens.push({ kind: 'num', negate, field, cmp: makeNumericComparator(m[2], num) });
                    handled = true;
                }
            }
        }
        if (!handled) {
            const needle = text.toLowerCase();
            // Plain words match at a word-START boundary, not as a loose
            // substring. This finds whole words and prefixes — "oak" -> "oaken",
            // "ring" -> "Ring of ...", "common" -> Common tier — but NOT a match
            // buried mid-word: "ring" must not hit "adventu<ring>", "common"
            // must not hit "un<common>". A token that starts with punctuation
            // falls back to a plain substring match.
            const anchor = /^\w/.test(needle) ? '\\b' : '';
            const re = new RegExp(anchor + _escapeRegExp(needle));
            tokens.push({ kind: 'text', negate, needle, re });
            if (!negate && firstText === null) firstText = needle;
        }
    }
    return {
        firstText,
        test(item, hay) {
            for (const t of tokens) {
                let ok;
                if (t.kind === 'num') {
                    ok = typeof item[t.field] === 'number' && t.cmp(item[t.field]);
                } else {
                    ok = t.re ? t.re.test(hay) : hay.includes(t.needle);
                }
                if (t.negate) ok = !ok;
                if (!ok) return false;
            }
            return true;
        },
    };
}

export default { parseWalkdleQuery };
