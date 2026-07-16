/**
 * pinned-preset-codec.js — Encode/decode Pinned Saves preset strings.
 *
 * Export string format: base64 ∘ gzip ∘ UTF-8 ∘ JSON of
 *   { "version": 1, "pin_paths": PinPath[] }
 *
 * Matches the wire format used by the existing Optimization Preset bar.
 *
 * This module assumes a `pako` global (loaded via index.html) when running in
 * a browser. For Node unit tests, a lightweight shim is used if `pako` is not
 * globally available — see `_resolvePako()`.
 *
 * Pure — no DOM, no state. Round-trippable by design.
 */

function _resolvePako() {
    // Browser: globalThis.pako is populated by /static/js/pako.min.js.
    if (typeof globalThis !== 'undefined' && globalThis.pako) {
        return globalThis.pako;
    }
    // Node test harness: allow a pre-installed npm `pako` (optional).
    try {
        // eslint-disable-next-line no-undef
        if (typeof require === 'function') {
            // eslint-disable-next-line no-undef
            return require('pako');
        }
    } catch (_err) { /* fall through */ }
    throw new Error('pako is not available — cannot encode/decode pinned preset');
}

function _toBase64(uint8) {
    // Browser path.
    if (typeof btoa === 'function') {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < uint8.length; i += chunk) {
            bin += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
        }
        return btoa(bin);
    }
    // Node path.
    // eslint-disable-next-line no-undef
    if (typeof Buffer !== 'undefined') {
        // eslint-disable-next-line no-undef
        return Buffer.from(uint8).toString('base64');
    }
    throw new Error('No base64 encoder available');
}

function _fromBase64(str) {
    if (typeof atob === 'function') {
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    // eslint-disable-next-line no-undef
    if (typeof Buffer !== 'undefined') {
        // eslint-disable-next-line no-undef
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
    throw new Error('No base64 decoder available');
}

/**
 * Encode a list of Pin Path descriptors into a shareable string.
 *
 * Deterministic modulo gzip metadata: the JSON payload is stable for a given
 * `pinPaths`, so two independent encode(decode(s)) calls produce strings that
 * decode to the same descriptors.
 *
 * @param {Array<Object>} pinPaths
 * @returns {string}
 */
export function encodePinnedPreset(pinPaths) {
    if (!Array.isArray(pinPaths)) {
        throw new Error('pinPaths must be an array');
    }
    const payload = { version: 1, pin_paths: pinPaths };
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const pako = _resolvePako();
    const gz = pako.gzip(bytes);
    return _toBase64(gz);
}

/**
 * Decode a pinned preset string into its list of Pin Path descriptors.
 *
 * Throws a single generic `Error('Invalid pinned preset')` for any failure:
 * bad base64, bad gzip, bad JSON, wrong version, missing fields.
 *
 * @param {string} str
 * @returns {Array<Object>}
 */
export function decodePinnedPreset(str) {
    if (typeof str !== 'string' || !str.length) {
        throw new Error('Invalid pinned preset');
    }
    let bytes;
    try {
        bytes = _fromBase64(str);
    } catch (_err) {
        throw new Error('Invalid pinned preset');
    }
    let json;
    try {
        const pako = _resolvePako();
        const decompressed = pako.ungzip(bytes);
        json = new TextDecoder().decode(decompressed);
    } catch (_err) {
        throw new Error('Invalid pinned preset');
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (_err) {
        throw new Error('Invalid pinned preset');
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid pinned preset');
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.pin_paths)) {
        throw new Error('Invalid pinned preset');
    }
    return parsed.pin_paths;
}

export default { encodePinnedPreset, decodePinnedPreset };
