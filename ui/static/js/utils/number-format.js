/**
 * Global number formatting utility.
 *
 * Patches Number.prototype.toLocaleString so existing display call sites
 * automatically pick up the user's chosen thousand + decimal separators
 * with zero per-site changes. Also exposes formatNumber() / formatFixed() /
 * formatInt() helpers for new code and as drop-in replacements for the
 * `.toFixed(N)` and `.toFixed(N).replace(/\.?0+$/, '')` patterns sprinkled
 * across the components.
 *
 * User preferences (persisted in localStorage):
 *   - numberFormatThousand: ' ' | "'" | '.' | ','  (default ',')
 *   - numberFormatDecimal:  '.' | ','              (default '.')
 *
 * Constraint: thousand and decimal must differ. The setter clamps
 * invalid pairs by repicking the thousand separator.
 *
 * Whenever prefs change, a `numberFormatChanged` CustomEvent is fired
 * on `window` so re-renderable views can refresh their displayed numbers.
 *
 * IMPORTANT: This module must be imported BEFORE any view renders for the
 * prototype patch to take effect on first paint. Import it as the very first
 * thing in `main.js`.
 */

const STORAGE_THOUSAND = 'numberFormatThousand';
const STORAGE_DECIMAL = 'numberFormatDecimal';

// Allowed separator characters
const VALID_THOUSAND = [' ', "'", '.', ','];
const VALID_DECIMAL = ['.', ','];

const DEFAULT_THOUSAND = ',';
const DEFAULT_DECIMAL = '.';

let _thousand = DEFAULT_THOUSAND;
let _decimal = DEFAULT_DECIMAL;

function _readFromStorage() {
    try {
        const t = localStorage.getItem(STORAGE_THOUSAND);
        const d = localStorage.getItem(STORAGE_DECIMAL);
        if (VALID_THOUSAND.includes(t)) _thousand = t;
        if (VALID_DECIMAL.includes(d)) _decimal = d;
        if (_thousand === _decimal) {
            // Invalid pair (e.g. period both) — fall back to defaults.
            _thousand = DEFAULT_THOUSAND;
            _decimal = DEFAULT_DECIMAL;
        }
    } catch (_e) {
        // localStorage may throw in privacy modes; fall back to defaults.
    }
}

_readFromStorage();

/**
 * @returns {{thousand:string, decimal:string}}
 */
export function getNumberFormatPrefs() {
    return { thousand: _thousand, decimal: _decimal };
}

/**
 * Update preferences. Either field may be omitted to leave it unchanged.
 * If the resulting pair is invalid (same char), the thousand separator is
 * flipped to the other available char.
 *
 * @param {{thousand?:string, decimal?:string}} prefs
 * @returns {{thousand:string, decimal:string}} the effective prefs after clamping
 */
export function setNumberFormatPrefs({ thousand, decimal } = {}) {
    if (thousand !== undefined && VALID_THOUSAND.includes(thousand)) {
        _thousand = thousand;
    }
    if (decimal !== undefined && VALID_DECIMAL.includes(decimal)) {
        _decimal = decimal;
    }
    if (_thousand === _decimal) {
        // Repick thousand to the only other char that isn't the chosen decimal.
        _thousand = (_decimal === '.') ? ',' : '.';
    }
    try {
        localStorage.setItem(STORAGE_THOUSAND, _thousand);
        localStorage.setItem(STORAGE_DECIMAL, _decimal);
    } catch (_e) { /* ignore */ }
    if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('numberFormatChanged', {
            detail: { thousand: _thousand, decimal: _decimal },
        }));
    }
    return { thousand: _thousand, decimal: _decimal };
}

// ---------------------------------------------------------------------------
// Internal formatter cache. We always format with en-US (which uses ',' and
// '.') and post-process the string to swap separators. This way we get
// consistent grouping behavior across all values without relying on browser
// locale data for unusual combos like apostrophe-thousand.
// ---------------------------------------------------------------------------

const _formatterCache = new Map();
function _getFormatter(opts) {
    const key = JSON.stringify(opts || {});
    let f = _formatterCache.get(key);
    if (!f) {
        f = new Intl.NumberFormat('en-US', opts);
        _formatterCache.set(key, f);
    }
    return f;
}

const _SENTINEL = '\u0001';

function _applySeparators(s) {
    // s is en-US output: thousand = ',', decimal = '.'
    if (_thousand === ',' && _decimal === '.') return s;
    // Swap via a sentinel so substitutions don't collide.
    return s
        .replace(/\./g, _SENTINEL)
        .replace(/,/g, _thousand)
        .replace(new RegExp(_SENTINEL, 'g'), _decimal);
}

/**
 * Format a number using the current user prefs.
 * @param {number|string} num
 * @param {Intl.NumberFormatOptions} [opts]
 * @returns {string}
 */
export function formatNumber(num, opts) {
    if (num === null || num === undefined) return String(num);
    const n = (typeof num === 'number') ? num : Number(num);
    if (!Number.isFinite(n)) return String(num);
    const f = _getFormatter(opts);
    return _applySeparators(f.format(n));
}

/**
 * Drop-in replacement for `.toFixed(decimals)` that honors user prefs.
 * When `trim` is true, trailing zeros after the decimal separator (and the
 * separator itself if no fractional part remains) are stripped — i.e. the
 * common `x.toFixed(N).replace(/\.?0+$/, '')` pattern.
 *
 * @param {number|string} num
 * @param {number} decimals
 * @param {{trim?:boolean}} [opts]
 * @returns {string}
 */
export function formatFixed(num, decimals, opts) {
    const trim = !!(opts && opts.trim);
    const out = formatNumber(num, {
        minimumFractionDigits: trim ? 0 : decimals,
        maximumFractionDigits: decimals,
    });
    if (!trim) return out;
    // Intl handles trim internally when min < max; but for parity with the
    // legacy regex we additionally guarantee no trailing decimal separator.
    if (out.endsWith(_decimal)) return out.slice(0, -_decimal.length);
    return out;
}

/**
 * Format an integer (no decimals).
 * @param {number|string} num
 * @returns {string}
 */
export function formatInt(num) {
    return formatNumber(num, { maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Patch Number.prototype.toLocaleString so existing callers automatically
// pick up the user's prefs. Calls that pass an explicit locale (string or
// array) are honored unmodified — that opt-out is intentional.
// ---------------------------------------------------------------------------

const _origToLocaleString = Number.prototype.toLocaleString;

// Sentinel to detect double-patching across hot reloads / tests.
if (!_origToLocaleString.__walkscapePatched) {
    Number.prototype.toLocaleString = function (locales, options) {
        if (locales !== undefined && locales !== null) {
            // Caller wants a specific locale — respect it.
            return _origToLocaleString.call(this, locales, options);
        }
        return formatNumber(this.valueOf(), options);
    };
    Number.prototype.toLocaleString.__walkscapePatched = true;
    Number.prototype.toLocaleString.__original = _origToLocaleString;
}

// React to localStorage changes from other tabs/windows.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_THOUSAND || e.key === STORAGE_DECIMAL) {
            _readFromStorage();
            window.dispatchEvent(new CustomEvent('numberFormatChanged', {
                detail: { thousand: _thousand, decimal: _decimal },
            }));
        }
    });
}

export default {
    formatNumber,
    formatFixed,
    formatInt,
    getNumberFormatPrefs,
    setNumberFormatPrefs,
};
