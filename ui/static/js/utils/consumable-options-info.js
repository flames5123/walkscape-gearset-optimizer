/**
 * Consumable Options (i) tooltip + deep-link.
 *
 * Powers the small ⓘ icon shown next to each per-page "use consumables"
 * checkbox (goals report, crafting tree, travel config). The popover shows a
 * concise summary of the two GLOBAL Consumable Options and a "Change options
 * here" link that opens the settings modal scrolled to the Consumable Options
 * section.
 *
 * Icons are wired via document-level delegation so they work regardless of
 * which page re-rendered them. Any element with class
 * `consumable-options-info-icon` becomes an anchor; any click on a
 * `consumable-options-change-link` (rendered inside the popover) opens the
 * settings deep-link.
 *
 * The icon intentionally reuses the `.travel-info-icon` visual style but does
 * NOT carry `data-info` / `data-info-html`, so the generic `wireInfoIcons()`
 * skips it (it only wires icons that have that data) and we own the behavior.
 */
import { showInfoPopover } from '../info-popover.js';

function _isTouch() {
    try {
        return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    } catch (_) {
        return false;
    }
}

/** Build the popover HTML from the current global Consumable Options. */
export function getConsumableOptionsSummaryHtml() {
    const sm = (typeof window !== 'undefined' && window.settingsModal) ? window.settingsModal : {};
    const fineIncluded = sm.includeFineConsumables !== false; // default ON
    const minEnabled = !!sm.consumableMinOwnedEnabled;
    const minVal = Number.isFinite(sm.consumableMinOwned) ? sm.consumableMinOwned : 5;
    const minOp = (sm.consumableMinOwnedOperator === 'lte') ? 'lte' : 'lt';
    const useHidden = !!sm.consumableUseHidden;
    // Only surface enabled options (Fine is always shown). No "no limit" /
    // "not used" noise.
    const lines = [`Fine consumables: <strong>${fineIncluded ? 'Included' : 'Excluded'}</strong>`];
    if (minEnabled) {
        const phrase = minOp === 'lte' ? `fewer than or equal to ${minVal}` : `fewer than ${minVal}`;
        lines.push(`Ignoring consumables owned: <strong>${phrase}</strong>`);
    }
    if (useHidden) lines.push(`Hidden consumables: <strong>Used</strong>`);
    const body = lines.map(l => `<div style="margin-bottom:6px;">${l}</div>`).join('');
    return `
        ${body}
        <div style="margin-top:2px;">
            <a href="#" class="consumable-options-change-link"
               style="color: var(--accent-color, #4ea1ff); text-decoration: underline; cursor: pointer;">Adjust consumable options here →</a>
        </div>
    `;
}

/**
 * Open the settings modal at the Consumable Options section. If the modal is
 * ALREADY open, just expand + scroll to the section (never close/reopen).
 * Otherwise open it on the optimization tab, then expand + scroll.
 */
export function openConsumableOptionsSettings() {
    const sm = (typeof window !== 'undefined') ? window.settingsModal : null;
    if (!sm) return;
    const expandAndScroll = () => {
        try {
            const root = (sm.$element && sm.$element[0]) || document;
            const header = root.querySelector('.settings-collapsible-header[data-section="consumables"]');
            const body = root.querySelector('.settings-collapsible-body[data-section="consumables"]');
            if (header) {
                header.classList.remove('collapsed');
                const arrow = header.querySelector('.expand-arrow');
                if (arrow) arrow.classList.add('expanded');
            }
            if (body) body.style.display = '';
            const target = header || body;
            if (target && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (_) { /* non-fatal */ }
    };
    try {
        sm.collapsedSections = sm.collapsedSections || {};
        sm.collapsedSections.consumables = false;
    } catch (_) { /* non-fatal */ }
    try {
        if (typeof sm.saveBoolSetting === 'function') {
            sm.saveBoolSetting('settingsCollapsed_consumables', false);
        }
    } catch (_) { /* non-fatal */ }
    // Already open — just expand + scroll in place (the link only renders on
    // the optimization tab, so no tab switch is needed).
    if (sm.visible) {
        expandAndScroll();
        return;
    }
    try { sm.activeTab = 'optimization'; } catch (_) { /* non-fatal */ }
    try { sm.show(); } catch (_) { /* non-fatal */ }
    setTimeout(expandAndScroll, 200);
}

let _installed = false;

/** Install document-level delegation once. Safe to call repeatedly. */
export function installConsumableOptionsInfo() {
    if (_installed || typeof document === 'undefined') return;
    _installed = true;

    // Hover-show on non-touch devices.
    document.addEventListener('mouseover', (e) => {
        if (_isTouch()) return;
        const icon = e.target && e.target.closest && e.target.closest('.consumable-options-info-icon');
        if (!icon) return;
        showInfoPopover(icon, '', false, 'Consumable Options', getConsumableOptionsSummaryHtml());
    });

    // Click: the "Change options here" link opens settings; the icon pins the
    // popover (tap-to-open on touch).
    document.addEventListener('click', (e) => {
        const link = e.target && e.target.closest && e.target.closest('.consumable-options-change-link');
        if (link) {
            e.preventDefault();
            e.stopPropagation();
            openConsumableOptionsSettings();
            return;
        }
        const icon = e.target && e.target.closest && e.target.closest('.consumable-options-info-icon');
        if (icon) {
            e.preventDefault();
            e.stopPropagation();
            showInfoPopover(icon, '', true, 'Consumable Options', getConsumableOptionsSummaryHtml());
        }
    });
}

// Self-install on import.
installConsumableOptionsInfo();

/** The icon markup to drop next to a per-page consumables checkbox. */
export const CONSUMABLE_OPTIONS_INFO_ICON_HTML =
    '<span class="travel-info-icon consumable-options-info-icon" role="button" tabindex="0" ' +
    'aria-label="Consumable options">ⓘ</span>';
