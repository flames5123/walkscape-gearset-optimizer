/**
 * PinnedSavesPresetBar — preset save/load/delete/export/import UI.
 *
 * Layout (matches GearSetManager, with Import/Export as siblings of the
 * dropdown toggle so they're always accessible without opening the menu):
 *
 *   [ Save ] [ name input ▼ ] [ Import ] [ Export ]
 *
 * The bar uses flex-wrap so on narrow viewports the Import/Export pair
 * wraps beneath the name input row.
 *
 * Clicking the dropdown toggle slides open a panel containing:
 *   - "+ New Pinned Save" (clears the name)
 *   - One row per saved preset, each with a two-click ✕ delete button
 *
 * Import/Export reveal a shared text input (below the bar) for paste/copy.
 */

import api from '../api.js';
import { encodePinnedPreset, decodePinnedPreset } from '../utils/pinned-preset-codec.js';

export default class PinnedSavesPresetBar {
    /**
     * @param {HTMLElement} element  - Root element to render into.
     * @param {Object} opts
     * @param {Function} opts.getPinState  () => PinPath[]
     * @param {Function} opts.setPinState  (pinPaths: PinPath[]) => void
     */
    constructor(element, { getPinState, setPinState } = {}) {
        this.$element = $(element);
        this.getPinState = getPinState || (() => []);
        this.setPinState = setPinState || (() => { });
        this.presets = [];
        this.nameText = '';
        this.selectedId = null;
        this.dropdownOpen = false;
        this.importRowOpen = false;
        this.pendingDelete = null;
        this._deleteResetTimer = null;

        this._render();
        this._attachEvents();
        this.refreshPresets();

        // Click-outside-to-close (matches gear-set-manager behavior)
        this._docClick = (e) => {
            if (!this.dropdownOpen) return;
            if (!$(e.target).closest('.pinned-saves-preset-bar-inner').length) {
                this._closeDropdown();
            }
        };
        $(document).on('click', this._docClick);
    }

    destroy() {
        $(document).off('click', this._docClick);
        clearTimeout(this._deleteResetTimer);
    }

    refreshPresets() {
        return api.getPinnedSaves()
            .done((list) => {
                this.presets = Array.isArray(list) ? list : [];
                // Only re-render the dropdown contents if it's open so we
                // don't clobber user-focused state (e.g. name-input cursor).
                if (this.dropdownOpen) {
                    this._renderDropdownContentInPlace();
                }
            })
            .fail(() => {
                this.presets = [];
                if (this.dropdownOpen) {
                    this._renderDropdownContentInPlace();
                }
            });
    }

    _canSave() {
        return this.nameText.trim().length > 0;
    }

    _render() {
        const arrowIcon = `<span class="expand-arrow ${this.dropdownOpen ? 'expanded' : ''}">▼</span>`;
        const canSave = this._canSave();

        const html = `
            <div class="pinned-saves-preset-bar-inner gear-set-manager">
                <div class="gear-set-header pin-preset-header">
                    <button class="save-button pin-preset-save-btn" ${canSave ? '' : 'disabled'}>Save</button>
                    <div class="gear-set-dropdown-button pin-preset-dropdown-button">
                        <input
                            type="text"
                            class="gear-set-name-input pin-preset-name-input"
                            placeholder="New Pinned Save"
                            value="${_escape(this.nameText)}"
                            maxlength="60"
                        />
                        <button class="dropdown-toggle pin-preset-dropdown-toggle">${arrowIcon}</button>
                    </div>
                    <div class="pin-preset-io-buttons">
                        <button class="button pin-preset-import-btn" type="button">Import</button>
                        <button class="button pin-preset-export-btn" type="button">Export</button>
                    </div>
                </div>
                <div class="gear-set-dropdown pin-preset-dropdown" style="display: none;"></div>
                <div class="pin-preset-import-row" style="display: ${this.importRowOpen ? 'block' : 'none'};">
                    <input type="text" class="pin-preset-import-input" placeholder="Paste preset string, press Enter…" />
                </div>
            </div>
        `;
        this.$element.html(html);
    }

    _renderDropdownContent() {
        const items = this.presets.map((p) => {
            const isPendingDelete = this.pendingDelete === p.id;
            const deleteClass = isPendingDelete ? 'delete-confirm' : 'delete-button';
            const deleteText = isPendingDelete ? 'Delete?' : '×';
            return `
                <div class="gear-set-item pin-preset-item" data-id="${_escape(p.id)}">
                    <span class="gear-set-name">${_escape(p.name)}</span>
                    <button class="${deleteClass}" data-id="${_escape(p.id)}">${deleteText}</button>
                </div>
            `;
        }).join('');

        const emptyMsg = this.presets.length === 0
            ? '<div class="gear-set-item pin-preset-empty" style="opacity:0.6; font-style:italic;">No saved layouts yet</div>'
            : '';

        return `
            <div class="gear-set-list">
                <div class="gear-set-item new-gear-set pin-preset-new">
                    <span class="gear-set-name">+ New Pinned Save</span>
                </div>
                ${emptyMsg}
                ${items}
            </div>
        `;
    }

    _renderDropdownContentInPlace() {
        const $dropdown = this.$element.find('.pin-preset-dropdown');
        $dropdown.html(this._renderDropdownContent());
    }

    _openDropdown() {
        if (this.dropdownOpen) return;
        this.dropdownOpen = true;
        const $dropdown = this.$element.find('.pin-preset-dropdown');
        const $arrow = this.$element.find('.pin-preset-dropdown-toggle .expand-arrow');
        $dropdown.html(this._renderDropdownContent());
        $arrow.addClass('expanded');
        $dropdown.stop(true, true).slideDown(200);
    }

    _closeDropdown() {
        if (!this.dropdownOpen) return;
        this.dropdownOpen = false;
        this.pendingDelete = null;
        clearTimeout(this._deleteResetTimer);
        const $dropdown = this.$element.find('.pin-preset-dropdown');
        const $arrow = this.$element.find('.pin-preset-dropdown-toggle .expand-arrow');
        $arrow.removeClass('expanded');
        $dropdown.stop(true, true).slideUp(200);
    }

    _toggleImportRow(show) {
        this.importRowOpen = (show == null) ? !this.importRowOpen : !!show;
        const $row = this.$element.find('.pin-preset-import-row');
        if (this.importRowOpen) {
            $row.stop(true, true).slideDown(150);
            setTimeout(() => this.$element.find('.pin-preset-import-input').focus(), 160);
        } else {
            $row.stop(true, true).slideUp(150);
        }
    }

    _attachEvents() {
        const $el = this.$element;

        // Name input — tracks typing, enables Save
        $el.on('input', '.pin-preset-name-input', (e) => {
            this.nameText = String($(e.target).val() || '');
            $el.find('.pin-preset-save-btn').prop('disabled', !this._canSave());
        });

        // Save button
        $el.on('click', '.pin-preset-save-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = this.nameText.trim();
            if (!name) return;
            const pinPaths = this.getPinState() || [];
            api.savePinnedSave({ name, pin_paths: pinPaths })
                .done(() => {
                    api.showSuccess(`Saved "${name}"`);
                    this.nameText = '';
                    this.$element.find('.pin-preset-name-input').val('');
                    this.$element.find('.pin-preset-save-btn').prop('disabled', true);
                    this.refreshPresets();
                });
        });

        // Dropdown toggle — slide open/closed
        $el.on('click', '.pin-preset-dropdown-toggle', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.dropdownOpen) this._closeDropdown();
            else this._openDropdown();
        });

        // "+ New Pinned Save"
        $el.on('click', '.pin-preset-new', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.nameText = '';
            this.selectedId = null;
            this.$element.find('.pin-preset-name-input').val('');
            this.$element.find('.pin-preset-save-btn').prop('disabled', true);
            this._closeDropdown();
            this.$element.find('.pin-preset-name-input').focus();
        });

        // Load a preset by clicking its row
        $el.on('click', '.pin-preset-item', (e) => {
            if ($(e.target).hasClass('delete-button') || $(e.target).hasClass('delete-confirm')) return;
            e.preventDefault();
            e.stopPropagation();
            const id = $(e.currentTarget).attr('data-id');
            const preset = this.presets.find((p) => p.id === id);
            if (!preset) return;
            this.selectedId = id;
            this.nameText = preset.name;
            this.$element.find('.pin-preset-name-input').val(preset.name);
            this.$element.find('.pin-preset-save-btn').prop('disabled', false);
            this.setPinState(preset.pin_paths || []);
            this._closeDropdown();
            api.showInfo(`Loaded "${preset.name}"`);
        });

        // Two-click delete inside the dropdown
        $el.on('click', '.pin-preset-dropdown .delete-button, .pin-preset-dropdown .delete-confirm', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = $(e.currentTarget).attr('data-id');
            if (!id) return;
            if (this.pendingDelete !== id) {
                this.pendingDelete = id;
                clearTimeout(this._deleteResetTimer);
                this._deleteResetTimer = setTimeout(() => {
                    this.pendingDelete = null;
                    if (this.dropdownOpen) this._renderDropdownContentInPlace();
                }, 3000);
                this._renderDropdownContentInPlace();
                return;
            }
            clearTimeout(this._deleteResetTimer);
            this.pendingDelete = null;
            api.deletePinnedSave(id).done(() => {
                api.showSuccess('Preset deleted');
                this.refreshPresets();
            });
        });

        // Export — shows the import row with the encoded string and copies
        $el.on('click', '.pin-preset-export-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pinPaths = this.getPinState() || [];
            let encoded = '';
            try {
                encoded = encodePinnedPreset(pinPaths);
            } catch (_err) {
                api.showError('Failed to encode pinned preset');
                return;
            }
            this._toggleImportRow(true);
            const $input = $el.find('.pin-preset-import-input');
            $input.val(encoded);
            setTimeout(() => { $input.select(); }, 170);
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(encoded);
                } else {
                    document.execCommand('copy');
                }
                api.showSuccess('Copied to clipboard');
            } catch (_err) { /* fallback: user copies manually */ }
        });

        // Import — opens the input row
        $el.on('click', '.pin-preset-import-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._toggleImportRow();
            if (this.importRowOpen) {
                this.$element.find('.pin-preset-import-input').val('');
            }
        });

        // Import — Enter to decode + apply, Escape to close
        $el.on('keydown', '.pin-preset-import-input', (e) => {
            if (e.key === 'Escape') {
                this._toggleImportRow(false);
                return;
            }
            if (e.key !== 'Enter') return;
            const encoded = String($(e.target).val() || '').trim();
            if (!encoded) return;
            try {
                const paths = decodePinnedPreset(encoded);
                this.setPinState(paths);
                this._toggleImportRow(false);
                this._closeDropdown();
                api.showSuccess('Imported pinned preset');
            } catch (_err) {
                api.showError('Invalid pinned preset');
            }
        });
    }
}

function _escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
