/**
 * Wiki link helper.
 *
 * Centralizes the `?usedarkmode=1` query suffix appended to wiki.walkscape.app
 * links so it can be toggled from a single user setting ("Use wiki dark mode"
 * in Settings > Misc. UI Settings). When enabled (the default), wiki links open
 * the wiki in its dark theme; when disabled, the suffix is omitted so the wiki
 * uses its own default theme.
 *
 * The setting is persisted in localStorage under the same key the settings
 * modal reads/writes via loadBoolSetting (default ON: only an explicit 'false'
 * disables it).
 */

const STORAGE_KEY = 'useWikiDarkMode';

/**
 * Whether wiki links should request the wiki's dark mode.
 * Defaults to true (enabled) when the preference has never been set.
 * @returns {boolean}
 */
export function isWikiDarkModeEnabled() {
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch (_e) {
        // localStorage may throw in privacy modes — default to enabled.
        return true;
    }
}

/**
 * The query-string suffix to append to a wiki URL (between the path and any
 * `#fragment`). Returns `'?usedarkmode=1'` when enabled, otherwise `''`.
 * @returns {string}
 */
export function wikiDarkModeSuffix() {
    return isWikiDarkModeEnabled() ? '?usedarkmode=1' : '';
}

export default { isWikiDarkModeEnabled, wikiDarkModeSuffix };
