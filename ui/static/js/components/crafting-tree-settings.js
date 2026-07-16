/**
 * GlobalSettingsPanel — Crafting tree global settings controls.
 *
 * Inputs: target quantity, daily steps, target quality (same dropdown as Column 3),
 * buffer percentage, spoiler protection toggle, line color palette.
 */

import Component from './base.js';
import store from '../state.js';
import { wireInfoIcons } from '../info-popover.js';

const BUFFER_INFO = 'Crafts/gathers a percentage of extra items above your target as a safety margin against bad RNG. A 5% buffer plans for 5% over the target quantity, so unlucky quality rolls or drop variance are less likely to leave you short.';

const QUALITIES = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
const QUALITY_BG = {
    'Normal': 'var(--rarity-common)', 'Good': 'var(--rarity-uncommon)',
    'Great': 'var(--rarity-rare)', 'Excellent': 'var(--rarity-epic)',
    'Perfect': 'var(--rarity-legendary)', 'Eternal': 'var(--rarity-ethereal)',
};
const QUALITY_BORDER = {
    'Normal': 'var(--rarity-common-border)', 'Good': 'var(--rarity-uncommon-border)',
    'Great': 'var(--rarity-rare-border)', 'Excellent': 'var(--rarity-epic-border)',
    'Perfect': 'var(--rarity-legendary-border)', 'Eternal': 'var(--rarity-ethereal-border)',
};

// 8 colors per palette — covers depth 0-7 (practical max for real recipes)
export const LINE_COLOR_PALETTES = {
    'Rainbow': ['#e05252', '#e07c3a', '#b8a832', '#3a9e6e', '#4a90c4', '#6a4fc4', '#9b3fa8', '#c43f7a'],
    'Uno Reverse': ['#3fc4c4', '#c43f9b', '#9b3fa8', '#6a4fc4', '#4a90c4', '#3a9e6e', '#b8a832', '#e07c3a'],
    'Pastel': ['#d4a0a0', '#d4b48a', '#d4cc9a', '#9ecfb0', '#a8b8d4', '#b8aed4', '#c8b8d4', '#a8d4cc'],
    'Mauve': ['#c084d4', '#b070c8', '#a060bc', '#9050b0', '#8040a4', '#7030a0', '#6020a0', '#5010a0'],
    'Electric': ['#00d4d4', '#20c4c4', '#40b4c4', '#60a4c4', '#8094c4', '#a084c4', '#c074c4', '#e064c4'],
    'Citrus': ['#22cc22', '#44bb22', '#88bb22', '#ccbb22', '#ee8822', '#ee6644', '#ee8822', '#ddcc22'],
    'Blush': ['#e0407a', '#d060a0', '#c080b0', '#d07060', '#e09040', '#e0b040', '#e09040', '#cc2020'],
    'Custom': ['#e05252', '#e07c3a', '#b8a832', '#3a9e6e', '#4a90c4', '#6a4fc4', '#9b3fa8', '#c43f7a'],
};

export const DEFAULT_PALETTE = 'Rainbow';

class GlobalSettingsPanel extends Component {
    constructor(element, props = {}) {
        super(element, props);
        this.qualityDropdownOpen = false;
        this.render();
        this.attachEvents();
        // Keep the "Run optimization locally" checkbox in sync with the same
        // global setting on other surfaces (settings modal, goals report,
        // quick-settings panel).
        this._syncRunLocal = () => {
            const enabled = !!(window.settingsModal && window.settingsModal.runLocalOptimization);
            const $cb = this.$element && this.$element.find && this.$element.find('.ct-run-local');
            if ($cb && $cb.length) $cb.prop('checked', enabled);
        };
        window.addEventListener('runLocalOptimizationChanged', this._syncRunLocal);
        window.addEventListener('optimizationSettingsLoaded', this._syncRunLocal);
    }

    render() {
        const settings = store.get('ui.crafting_tree.global_settings') || {};
        const qty = settings.target_quantity || 1;
        const daily = settings.daily_steps || 10000;
        const quality = settings.target_quality || 'Perfect';
        const buffer = ((settings.buffer_percentage ?? 0.05) * 100).toFixed(0);
        const spoiler = settings.spoiler_protection !== false;
        const useFine = settings.use_fine || false;
        const skipShops = settings.skip_shops !== false;  // default true
        // Optimize-pets / optimize-consumables: when on, the per-node
        // optimizer is allowed to consider pets / consumables in its
        // gearset score. When off (default for both), those slots are
        // ignored (matches current behavior — INCLUDE_PETS=False and
        // INCLUDE_CONSUMABLES=False in ui/optimize_worker.py around the
        // crafting_tree_node activity path). User-asked: surface these
        // as top-level toggles next to spoiler protect + fine mats.
        const optimizePets = !!settings.optimize_pets;
        const optimizeConsumables = !!settings.optimize_consumables;
        // "Run optimization locally" mirrors the GLOBAL setting
        // (window.settingsModal.runLocalOptimization), synced across surfaces —
        // it is NOT part of the crafting-tree settings object. FAC-gated.
        const localFacOn = !!(window._featureFlags && window._featureFlags.local_optimization);
        const runLocal = !!(window.settingsModal && window.settingsModal.runLocalOptimization);
        const runLocalCheckboxHtml = localFacOn ? `
                    <label class="crafting-tree-settings-label crafting-tree-toggle">
                        <input type="checkbox" class="ct-run-local" ${runLocal ? 'checked' : ''}>
                        Run optimization locally
                        <span class="travel-info-icon" data-info="Runs the optimizer in your browser instead of on the server. On a reasonably modern phone or computer this is usually faster, and it reduces server load. Older or low-end devices may be slower than the server. Results are identical to a server run, and once finished they're saved to the server, so they're available on all your devices." role="button" tabindex="0" aria-label="About running locally" style="font-style:normal;">ⓘ</span>
                    </label>` : '';
        const isEquipment = this.props.isEquipment;

        const bg = QUALITY_BG[quality] || '';
        const border = QUALITY_BORDER[quality] || '';
        const btnStyle = bg ? `background: ${bg}; border: 2px solid ${border};` : '';

        const qualityItemsHtml = QUALITIES.map(q => {
            const qBg = QUALITY_BG[q];
            return `<div class="target-item quality-item" data-value="${q}" style="background: ${qBg};">
                <span>${q}</span>
            </div>`;
        }).join('');

        const html = `
            <div class="crafting-tree-settings">
                <div class="crafting-tree-settings-row">
                    <label class="crafting-tree-settings-label">
                        Quantity
                        <input type="number" class="crafting-tree-input ct-qty"
                               value="${qty}" min="1" step="1">
                    </label>
                    <label class="crafting-tree-settings-label">
                        Daily Steps
                        <input type="number" class="crafting-tree-input ct-daily"
                               value="${daily}" min="1000" step="1000">
                    </label>
                    ${isEquipment ? `
                    <div class="crafting-tree-settings-label">
                        <span>Target Quality</span>
                        <div class="target-selector ct-quality-selector">
                            <div class="target-dropdown-button" style="${btnStyle}">
                                <div class="target-dropdown-value">
                                    <span>${quality}</span>
                                </div>
                                <button class="target-dropdown-toggle" type="button">
                                    <span class="expand-arrow">▼</span>
                                </button>
                            </div>
                            <div class="target-dropdown ct-quality-panel" style="display: none;">
                                ${qualityItemsHtml}
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    <label class="crafting-tree-settings-label">
                        <span>Buffer % <span class="travel-info-icon" data-info="${BUFFER_INFO}" role="button" tabindex="0" aria-label="Buffer percentage info" style="font-style:normal;">ⓘ</span></span>
                        <input type="number" class="crafting-tree-input ct-buffer"
                               value="${buffer}" min="0" max="100" step="1">
                    </label>
                    <label class="crafting-tree-settings-label crafting-tree-toggle" style="flex-basis:100%">
                        <input type="checkbox" class="ct-spoiler" ${spoiler ? 'checked' : ''}>
                        Spoiler Protection
                    </label>
                    <label class="crafting-tree-settings-label crafting-tree-toggle">
                        <input type="checkbox" class="ct-fine" ${useFine ? 'checked' : ''}>
                        Fine Materials
                    </label>
                    <label class="crafting-tree-settings-label crafting-tree-toggle">
                        <input type="checkbox" class="ct-skip-shops" ${skipShops ? 'checked' : ''}>
                        Skip Shops (auto)
                    </label>
                    <label class="crafting-tree-settings-label crafting-tree-toggle">
                        <input type="checkbox" class="ct-optimize-pets" ${optimizePets ? 'checked' : ''}>
                        Optimize Pets
                    </label>
                    <label class="crafting-tree-settings-label crafting-tree-toggle">
                        <input type="checkbox" class="ct-optimize-consumables" ${optimizeConsumables ? 'checked' : ''}>
                        Optimize Consumables
                    </label>
                    ${runLocalCheckboxHtml}
                    <button class="button button-primary crafting-tree-calc-btn" style="width:100%">Calculate &amp; Optimize All</button>
                </div>
            </div>
        `;
        this.$element.html(html);
        // Wire up info popovers (Buffer % tooltip, etc.)
        try { wireInfoIcons(this.$element[0]); } catch (e) { /* ignore */ }
        return html;
    }

    attachEvents() {
        const self = this;

        // Quality dropdown toggle
        this.$element.on('click', '.ct-quality-selector .target-dropdown-button', function (e) {
            e.stopPropagation();
            self.qualityDropdownOpen = !self.qualityDropdownOpen;
            const $panel = self.$element.find('.ct-quality-panel');
            const $arrow = $(this).find('.expand-arrow');
            if (self.qualityDropdownOpen) {
                $arrow.addClass('expanded');
                $panel.slideDown(200);
            } else {
                $arrow.removeClass('expanded');
                $panel.slideUp(150);
            }
        });

        // Quality item click
        this.$element.on('click', '.ct-quality-panel .target-item', function (e) {
            e.stopPropagation();
            const val = $(this).data('value');
            const bg = QUALITY_BG[val] || '';
            const border = QUALITY_BORDER[val] || '';
            const $btn = self.$element.find('.ct-quality-selector .target-dropdown-button');
            $btn.attr('style', bg ? `background: ${bg}; border: 2px solid ${border};` : '');
            $btn.find('.target-dropdown-value span').text(val);
            self.qualityDropdownOpen = false;
            self.$element.find('.ct-quality-panel').slideUp(150);
            self.$element.find('.ct-quality-selector .expand-arrow').removeClass('expanded');
            self._emitChange();
        });

        // Close quality dropdown on outside click
        $(document).on('click.ct-quality', function (e) {
            if (self.qualityDropdownOpen && !$(e.target).closest('.ct-quality-selector').length) {
                self.qualityDropdownOpen = false;
                self.$element.find('.ct-quality-panel').slideUp(150);
                self.$element.find('.ct-quality-selector .expand-arrow').removeClass('expanded');
            }
        });

        // Palette row click — handled in settings-modal.js
        // Custom color input change — handled in settings-modal.js

        this.$element.on('change input', '.ct-qty, .ct-daily, .ct-buffer, .ct-spoiler, .ct-fine, .ct-skip-shops, .ct-optimize-pets, .ct-optimize-consumables', function () {
            self._emitChange();
        });

        // "Run optimization locally" mirrors the GLOBAL setting
        // (window.settingsModal.runLocalOptimization) and is synced across the
        // settings modal, goals report, and quick-settings panel. It is NOT
        // part of the crafting-tree settings object, so it does NOT call
        // _emitChange().
        this.$element.on('change', '.ct-run-local', function () {
            const checked = $(this).is(':checked');
            if (window.settingsModal) {
                window.settingsModal.runLocalOptimization = checked;
                try { window.settingsModal.saveGlobalOptimizationSettings(); } catch (_) { /* non-fatal */ }
            }
            try {
                window.dispatchEvent(new CustomEvent('runLocalOptimizationChanged', { detail: { enabled: checked } }));
            } catch (_) { /* non-fatal */ }
        });
    }

    _emitChange() {
        const qualityVal = this.$element.find('.ct-quality-selector .target-dropdown-value span').text() || 'Perfect';
        // Palette is managed by settings-modal, read from store
        const existingSettings = store.get('ui.crafting_tree.global_settings') || {};

        const settings = {
            target_quantity: parseInt(this.$element.find('.ct-qty').val()) || 1,
            daily_steps: parseInt(this.$element.find('.ct-daily').val()) || 10000,
            target_quality: qualityVal,
            buffer_percentage: (parseInt(this.$element.find('.ct-buffer').val()) || 0) / 100,
            spoiler_protection: this.$element.find('.ct-spoiler').is(':checked'),
            use_fine: this.$element.find('.ct-fine').is(':checked'),
            skip_shops: this.$element.find('.ct-skip-shops').is(':checked'),
            optimize_pets: this.$element.find('.ct-optimize-pets').is(':checked'),
            optimize_consumables: this.$element.find('.ct-optimize-consumables').is(':checked'),
            line_colors: existingSettings.line_colors || DEFAULT_PALETTE,
            custom_colors: existingSettings.custom_colors || LINE_COLOR_PALETTES['Custom'],
        };
        store.update('ui.crafting_tree.global_settings', settings);
        if (this.props.onChange) {
            this.props.onChange(settings);
        }
    }

    destroy() {
        $(document).off('click.ct-quality');
        this.$element.off('change input click');
        super.destroy();
    }
}

export default GlobalSettingsPanel;
