/**
 * pin-path.js — Stable-anchor Pin Path printer and parser.
 *
 * A Pin Path is a descriptor that identifies a DOM element inside one of two
 * Pinnable Roots (`combined-stats-section` or `column-3`) using a chain of
 * stable anchors. The descriptor survives re-renders as long as the re-render
 * preserves the high-priority anchors (ids, data-pin-id, data-stat, data-drop,
 * aria-label) on corresponding nodes.
 *
 * Pure — no DOM writes, no global state reads other than the element/root
 * the caller passes in. Safe for property-based testing under jsdom.
 *
 * Descriptor shape (JSON-serializable):
 *   {
 *     version: 1,
 *     root:    'combined-stats-section' | 'column-3',
 *     anchors: Anchor[]    // outermost first within the root
 *   }
 *
 * Anchor variants:
 *   { type: 'id',           value: string }
 *   { type: 'data-pin-id',  value: string }
 *   { type: 'data-stat',    value: string }
 *   { type: 'data-drop',    value: string }
 *   { type: 'role-label',   value: string }
 *   { type: 'class-text',   value: { class: string, text: string } }
 *   { type: 'tag-index',    value: { tag: string, index: number, textPrefix?: string } }
 */

const ANCHOR_TYPES = ['id', 'data-pin-id', 'data-stat', 'data-drop', 'role-label', 'class-text', 'tag-index'];
const KNOWN_ROOTS = ['combined-stats-section', 'column-3'];

/**
 * Pick the highest-priority stable anchor for a given element.
 * @param {Element} node
 * @returns {Object} Anchor descriptor.
 */
function pickAnchor(node) {
    if (!node || node.nodeType !== 1) {
        return { type: 'tag-index', value: { tag: '*', index: 0 } };
    }
    if (node.id) {
        return { type: 'id', value: node.id };
    }
    // dataset may not exist on SVG in very old environments; guard it.
    const ds = node.dataset || {};
    if (ds.pinId) return { type: 'data-pin-id', value: ds.pinId };
    if (ds.stat) return { type: 'data-stat', value: ds.stat };
    if (ds.drop) return { type: 'data-drop', value: ds.drop };

    const aria = node.getAttribute && node.getAttribute('aria-label');
    if (aria) return { type: 'role-label', value: aria };

    const cls = node.classList ? [...node.classList].filter(c => !!c && !c.startsWith('pin-hover-')).join(' ') : '';
    const txt = (node.textContent || '').trim().slice(0, 40);
    if (cls && txt) return { type: 'class-text', value: { class: cls, text: txt } };

    const parent = node.parentElement;
    const tag = (node.tagName || '*').toLowerCase();
    let index = 0;
    if (parent) {
        const siblings = [...parent.children].filter(c => c.tagName === node.tagName);
        index = siblings.indexOf(node);
        if (index < 0) index = 0;
    }
    const textPrefix = txt.slice(0, 20);
    const val = { tag, index };
    if (textPrefix) val.textPrefix = textPrefix;
    return { type: 'tag-index', value: val };
}

/**
 * Build a Pin Path descriptor for `el`, walking up to `rootId`.
 *
 * @param {Element} el - Target element (must be a descendant of the root).
 * @param {string}  rootId - Pinnable Root id ('combined-stats-section' | 'column-3').
 * @returns {Object|null} Descriptor, or null if `el` is not inside the root.
 */
export function printPinPath(el, rootId) {
    if (!el || el.nodeType !== 1) return null;
    if (!KNOWN_ROOTS.includes(rootId)) return null;

    const root = el.ownerDocument && el.ownerDocument.getElementById
        ? el.ownerDocument.getElementById(rootId)
        : null;
    if (!root || !root.contains(el)) return null;
    if (el === root) {
        // Pinning the root itself is supported with an empty anchor chain.
        return { version: 1, root: rootId, anchors: [] };
    }

    // Walk from el upward to (but not including) root, collecting anchors.
    const chain = [];
    let node = el;
    while (node && node !== root) {
        chain.push(pickAnchor(node));
        node = node.parentElement;
    }
    chain.reverse(); // Outermost-first.
    return { version: 1, root: rootId, anchors: chain };
}

function cssEscape(value) {
    // Fall back to a minimal escape if CSS.escape is unavailable (old jsdom).
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
        return CSS.escape(String(value));
    }
    return String(value).replace(/([^\w-])/g, '\\$1');
}

function findChildMatching(scope, anchor) {
    if (!scope || !anchor) return null;
    const v = anchor.value;
    switch (anchor.type) {
        case 'id': {
            // Prefer the scope-local lookup; fall back to getElementById if
            // the id happens to also live outside the scope.
            const byQs = scope.querySelector('#' + cssEscape(v));
            if (byQs && scope.contains(byQs)) return byQs;
            return null;
        }
        case 'data-pin-id':
            return scope.querySelector('[data-pin-id="' + cssEscape(v) + '"]');
        case 'data-stat':
            return scope.querySelector('[data-stat="' + cssEscape(v) + '"]');
        case 'data-drop':
            return scope.querySelector('[data-drop="' + cssEscape(v) + '"]');
        case 'role-label':
            return scope.querySelector('[aria-label="' + cssEscape(v) + '"]');
        case 'class-text': {
            if (!v || !v.class) return null;
            const classSelector = '.' + v.class.split(/\s+/).filter(Boolean).map(cssEscape).join('.');
            const candidates = scope.querySelectorAll(classSelector);
            for (const c of candidates) {
                if ((c.textContent || '').trim() === v.text) return c;
            }
            // Prefix fallback — helps when a trailing number/unit changes.
            for (const c of candidates) {
                if ((c.textContent || '').trim().startsWith(v.text)) return c;
            }
            return candidates[0] || null;
        }
        case 'tag-index': {
            if (!v) return null;
            const tag = v.tag || '*';
            const candidates = scope.querySelectorAll(tag);
            if (v.textPrefix) {
                for (const c of candidates) {
                    if ((c.textContent || '').trim().startsWith(v.textPrefix)) return c;
                }
            }
            const idx = Math.max(0, v.index | 0);
            return candidates[idx] || null;
        }
        default:
            return null;
    }
}

/**
 * Resolve a Pin Path descriptor to its current DOM element (or null).
 *
 * @param {Object} descriptor - Descriptor returned by `printPinPath`.
 * @param {string} rootId - Pinnable Root id (must match the descriptor's root).
 * @param {Document} [doc] - Optional document (defaults to global document).
 * @returns {Element|null}
 */
export function resolvePinPath(descriptor, rootId, doc) {
    if (!descriptor || typeof descriptor !== 'object') return null;
    if (descriptor.root !== rootId) return null;
    if (!Array.isArray(descriptor.anchors)) return null;
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return null;
    const root = d.getElementById(rootId);
    if (!root) return null;

    let scope = root;
    for (const anchor of descriptor.anchors) {
        const next = findChildMatching(scope, anchor);
        if (!next) return null;
        scope = next;
    }
    return scope;
}

/**
 * Compute a stable, JSON-comparable key for a Pin Path descriptor.
 *
 * @param {Object} descriptor
 * @returns {string}
 */
export function pinPathKey(descriptor) {
    if (!descriptor) return '';
    try {
        return JSON.stringify(descriptor);
    } catch (_err) {
        return '';
    }
}

/**
 * Deep structural equality for Pin Path descriptors.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export function pinPathEquals(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return pinPathKey(a) === pinPathKey(b);
}

export const __TESTING__ = { pickAnchor, findChildMatching, ANCHOR_TYPES, KNOWN_ROOTS };

export default { printPinPath, resolvePinPath, pinPathKey, pinPathEquals };
