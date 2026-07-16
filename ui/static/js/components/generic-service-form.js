/**
 * GenericServiceForm — form for creating/editing generic services.
 *
 * Rendered inside GenericRecipeForm when "🔧 Generic Service" is selected
 * from the service dropdown. Follows the same UI patterns as GenericActivityForm.
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import LocationDropdown from './location-dropdown.js';

const STAT_TYPES = [
    { value: 'work_efficiency', label: 'Work Efficiency (%)' },
    { value: 'double_action', label: 'Double Action (%)' },
    { value: 'double_rewards', label: 'Double Rewards (%)' },
    { value: 'quality_outcome', label: 'Quality Outcome' },
    { value: 'no_material_consumed', label: 'No Material Consumed (%)' },
    { value: 'steps_add', label: 'Steps (flat)' },
    { value: 'steps_percent', label: 'Steps (%)' },
    { value: 'bonus_xp_percent', label: 'Bonus XP (%)' },
];

const CRAFTING_SKILLS = ['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring'];

const EMOJI_OPTIONS = ['⚡', '⚔️', '🎯', '🏹', '🛡️', '🔥', '💎', '🌊', '🌲', '⛏️', '🎣', '🍳', '🪚', '🧵', '🐾', '🏔️', '❄️', '☀️', '🌙', '⭐'];

const SKILL_ICON_FALLBACK = {
    'traveling': '🧭',
};
function skillIcon(name) {
    const skillId = name.toLowerCase().replace(' ', '_');
    const fallback = SKILL_ICON_FALLBACK[skillId];
    if (fallback) return `<span class="ga-skill-icon-emoji">${fallback}</span>`;
    return `<img src="/assets/icons/text/skill_icons/${skillId}.svg" class="ga-skill-icon" />`;
}

class GenericServiceForm extends Component {
    constructor(element, props = {}) {
        super(element, props);
        this.showCommunity = store.state.column3?.showGenericServiceCommunity || false;
        this.savedDefs = [];
        this.communityDefs = [];
        this.currentDefId = null;
        this.selectedIcon = '⚡';
        this.selectedIconColor = null;
        this.savedSearchText = '';
        this.selectedSkill = '';
        this.skillDropdownOpen = false;
        this.selectedTier = 'basic';

        // Dynamic stat rows: [{type: 'work_efficiency', value: 5.0}, ...]
        this.statRows = [];

        // Location dropdown instance
        this.locationDropdown = null;

        this._loadSavedDefinitions();
    }

    // ------------------------------------------------------------------
    // DATA LOADING
    // ------------------------------------------------------------------

    async _loadSavedDefinitions(skipRender = false) {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            const defs = await api.getGenericDefinitions(uuid);
            this.savedDefs = defs.services || [];
            store.state.column3.savedGenericServices = this.savedDefs;
            if (this.showCommunity) await this._loadCommunity();
            if (!skipRender) this.render();
        } catch (e) {
            console.error('GenericServiceForm: failed to load saved defs', e);
        }
    }

    async _loadCommunity() {
        try {
            const defs = await api.getCommunityDefinitions();
            this.communityDefs = defs.services || [];
        } catch (e) {
            this.communityDefs = [];
        }
    }

    // ------------------------------------------------------------------
    // ACTIONS
    // ------------------------------------------------------------------

    async toggleCommunity() {
        this.showCommunity = !this.showCommunity;
        store.state.column3.showGenericServiceCommunity = this.showCommunity;
        store._saveColumn3Selection();
        if (this.showCommunity && this.communityDefs.length === 0) {
            await this._loadCommunity();
        }
        this.$element.find('.gs-saved-dropdown').html(this._renderSavedDropdownItems());
    }

    populateFromSaved(def) {
        this.currentDefId = def.id;
        this.selectedIcon = def.icon || '⚡';
        this.selectedIconColor = def.icon_color || null;
        this.selectedTier = def.tier || 'basic';
        this.selectedSkill = def.skill ? def.skill.charAt(0).toUpperCase() + def.skill.slice(1).toLowerCase() : '';
        // Parse stats_json into stat rows
        const stats = def.stats_json ? (typeof def.stats_json === 'string' ? JSON.parse(def.stats_json) : def.stats_json) : {};
        this.statRows = Object.entries(stats).map(([type, value]) => ({ type, value }));
        if (this.statRows.length === 0) {
            this.statRows = [];
        }
        this.render();
        this.$element.find('#gs-name').val(def.name);
        this.$element.find('#gs-share').prop('checked', !!def.is_public);
        if (this.locationDropdown && def.location) {
            this.locationDropdown.selectLocation(def.location);
        }
    }

    addStatRow() {
        // Read current stat rows from DOM first
        this._syncStatRowsFromDOM();
        this.statRows.push({ type: 'work_efficiency', value: 0 });
        this._renderStatRows();
    }

    removeStatRow(index) {
        this._syncStatRowsFromDOM();
        this.statRows.splice(index, 1);
        // Animate removal of the specific row instead of re-rendering all
        const $row = this.$element.find(`.gs-stat-row[data-index="${index}"]`);
        $row.slideUp(150, () => {
            $row.remove();
            // Re-index remaining rows
            this.$element.find('.gs-stat-row').each((i, el) => {
                $(el).attr('data-index', i);
            });
        });
    }

    _syncStatRowsFromDOM() {
        const rows = [];
        this.$element.find('.gs-stat-row').each(function () {
            rows.push({
                type: $(this).find('.gs-stat-type').val(),
                value: parseFloat($(this).find('.gs-stat-value').val()) || 0,
            });
        });
        if (rows.length > 0) {
            this.statRows = rows;
        }
    }

    _getSelectedLocation() {
        if (!this.locationDropdown) return '';
        const loc = this.locationDropdown.getSelectedLocation();
        return loc ? loc.id : '';
    }

    /** Read form data for external use (by GenericRecipeForm). */
    readForm() {
        this._syncStatRowsFromDOM();
        const skill = this.selectedSkill || '';
        const stats = {};
        for (const row of this.statRows) {
            if (row.type && row.value !== 0) {
                stats[row.type] = row.value;
            }
        }
        return {
            name: (this.$element.find('#gs-name').val() || '').trim(),
            skill: skill.toLowerCase(),
            location: this._getSelectedLocation(),
            tier: this.selectedTier,
            stats_json: JSON.stringify(stats),
            is_public: this.$element.find('#gs-share').is(':checked'),
            icon: this.selectedIcon,
            icon_color: this.selectedIconColor || null,
        };
    }

    async saveDefinition() {
        const data = this.readForm();
        if (!data.name) { api.showError('Service name is required.'); return; }
        if (!data.skill) { api.showError('Skill is required.'); return; }
        if (!data.location) { api.showError('Location is required.'); return; }

        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            if (this.currentDefId) {
                await api.updateGenericDefinition(uuid, this.currentDefId, {
                    type: 'service', ...data
                });
                api.showSuccess('Generic service updated.');
            } else {
                const saved = await api.saveGenericDefinition(uuid, {
                    type: 'service', ...data
                });
                this.currentDefId = saved.id;
            }
            await this._loadSavedDefinitions(true);

            store.state.column3.genericService = data;
            store._notifySubscribers('column3.genericService');

            // Update UI without re-rendering
            this.$element.find('.gs-saved-value').html(this._getSelectedDefName());
            // Show Delete button if it's not already there
            if (this.currentDefId && !this.$element.find('.btn-delete-service').length) {
                this.$element.find('.gs-actions').append(
                    '<button class="btn-delete-service optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>'
                );
            }
            api.showSuccess('Generic service saved.');
        } catch (e) {
            // api.js shows error toast
        }
    }

    async deleteDefinition() {
        if (!this.currentDefId) return;
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            await api.deleteGenericDefinition(uuid, this.currentDefId, 'service');
            api.showSuccess('Generic service deleted.');
            this.currentDefId = null;
            this.statRows = [];
            await this._loadSavedDefinitions(true);

            store.state.column3.genericService = null;
            store._notifySubscribers('column3.genericService');

            this.render();
        } catch (e) { /* handled */ }
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    _getSelectedDefName() {
        if (!this.currentDefId) return '+ New Generic Service';
        const def = this.savedDefs.find(d => d.id === this.currentDefId);
        if (!def) return '+ New Generic Service';
        const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
        return `${iconHtml} ${def.name}`;
    }

    _renderSavedDropdownItems() {
        const savedIds = new Set(this.savedDefs.map(d => d.id));
        const search = (this.savedSearchText || '').toLowerCase();
        let searchBox = '<input type="text" class="gs-saved-search" placeholder="Search by name, location..." value="' + (this.savedSearchText || '') + '" />';
        let items = '<div class="gs-saved-item gs-saved-new" data-id=""><span>+ New Generic Service</span></div>';

        const matchesSearch = (def) => {
            if (!search) return true;
            if (def.name.toLowerCase().includes(search)) return true;
            if (def.location) {
                const locDisplay = def.location.replace(/_/g, ' ').toLowerCase();
                if (locDisplay.includes(search)) return true;
            }
            return false;
        };

        for (const def of this.savedDefs) {
            if (!matchesSearch(def)) continue;
            const loc = def.location ? ` (${def.location.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())})` : '';
            const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
            items += `<div class="gs-saved-item" data-id="${def.id}"><span>${iconHtml} ${def.name}${loc}</span></div>`;
        }
        if (this.showCommunity && this.communityDefs.length > 0) {
            items += '<div class="gs-saved-divider">Community</div>';
            for (const def of this.communityDefs) {
                if (savedIds.has(def.id)) continue;
                if (!matchesSearch(def)) continue;
                const loc = def.location ? ` (${def.location.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())})` : '';
                const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                items += `<div class="gs-saved-item" data-id="community::${def.id}"><span>${iconHtml} ${def.name}${loc}</span></div>`;
            }
        }
        return searchBox + `<div class="gs-saved-list">${items}</div>`;
    }

    _renderStatTypeOptions(selectedType) {
        return STAT_TYPES.map(st =>
            `<option value="${st.value}" ${st.value === selectedType ? 'selected' : ''}>${st.label}</option>`
        ).join('');
    }

    _renderStatRows() {
        const $container = this.$element.find('.gs-stat-rows');
        const html = this.statRows.map((row, i) => `
            <div class="gs-stat-row" data-index="${i}">
                <select class="gs-stat-type">${this._renderStatTypeOptions(row.type)}</select>
                <input type="number" class="gs-stat-value" value="${row.value}" step="0.1" />
                <button class="gs-stat-remove" title="Remove stat">✕</button>
            </div>
        `).join('');
        $container.html(html);
        // Slide in new rows
        $container.find('.gs-stat-row').last().hide().slideDown(150);
    }

    _renderEmojiPicker() {
        return EMOJI_OPTIONS.map(e =>
            `<span class="gs-emoji-option ${e === this.selectedIcon ? 'selected' : ''}" data-emoji="${e}">${e}</span>`
        ).join('');
    }

    _getSelectedSkillDisplay() {
        if (!this.selectedSkill) return 'Select skill...';
        const skillId = this.selectedSkill.toLowerCase().replace(' ', '_');
        return `${skillIcon(this.selectedSkill)} ${this.selectedSkill}`;
    }

    _renderSkillDropdownItems() {
        let items = '';
        for (const name of CRAFTING_SKILLS) {
            const skillId = name.toLowerCase().replace(' ', '_');
            items += `<div class="ga-skill-item" data-skill="${name}">
                ${skillIcon(name)}
                <span>${name}</span>
            </div>`;
        }
        return items;
    }

    render() {
        // Destroy old location dropdown before re-rendering
        if (this.locationDropdown) { this.locationDropdown.destroy(); this.locationDropdown = null; }

        const statRowsHtml = this.statRows.map((row, i) => `
            <div class="gs-stat-row" data-index="${i}">
                <select class="gs-stat-type">${this._renderStatTypeOptions(row.type)}</select>
                <input type="number" class="gs-stat-value" value="${row.value}" step="0.1" />
                <button class="gs-stat-remove" title="Remove stat">✕</button>
            </div>
        `).join('');

        const html = `
            <div class="generic-service-form activity-info-section" style="margin-top:var(--spacing-sm)">
                <div class="activity-info-header" style="cursor:default">
                    <span class="activity-info-title">🔧 Generic Service</span>
                </div>
                <div class="activity-info-content">
                    <div class="gs-row gs-saved-selector">
                        <label>Saved Services</label>
                        <div class="gs-saved-button">
                            <div class="gs-saved-value">${this._getSelectedDefName()}</div>
                            <button class="gs-saved-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="gs-saved-dropdown" style="display:none"></div>
                        <label class="gs-checkbox-label gs-community-row">
                            <input type="checkbox" id="gs-show-community" ${this.showCommunity ? 'checked' : ''} />
                            Show community definitions
                        </label>
                    </div>

                    <div class="gs-row gs-name-row">
                        <div class="gs-icon-picker">
                            <button class="gs-icon-btn" title="Click to pick icon" ${this.selectedIconColor ? `style="${window.emojiTintStyle(this.selectedIconColor)}"` : ''}>${window.emojiForPlatform(this.selectedIcon)}</button>
                            <div class="gs-icon-popup" style="display:none">
                                <div class="gs-icon-defaults">
                                    ${this._renderEmojiPicker()}
                                </div>
                                <div style="display:flex;align-items:center;gap:6px;padding:4px 8px">
                                    <label style="font-size:12px;color:var(--text-secondary)">Tint:</label>
                                    <input type="color" class="gs-icon-color" value="${this.selectedIconColor || '#ffffff'}" style="width:32px;height:24px;border:none;cursor:pointer" />
                                    <button class="gs-color-clear" style="background:none;border:1px solid var(--border-color);border-radius:4px;color:var(--text-secondary);font-size:11px;padding:2px 6px;cursor:pointer">Clear</button>
                                </div>
                                <emoji-picker class="gs-full-picker"></emoji-picker>
                            </div>
                        </div>
                        <div class="gs-name-field">
                            <label>Name</label>
                            <input type="text" id="gs-name" />
                        </div>
                    </div>

                    <div class="gs-row">
                        <label>Tier</label>
                        <div style="display:flex;gap:8px">
                            <button class="gs-tier-btn optimize-btn ${this.selectedTier === 'basic' ? 'gs-tier-active' : ''}" data-tier="basic" style="flex:1;font-size:13px;padding:6px">Basic</button>
                            <button class="gs-tier-btn optimize-btn ${this.selectedTier === 'advanced' ? 'gs-tier-active' : ''}" data-tier="advanced" style="flex:1;font-size:13px;padding:6px">Advanced</button>
                        </div>
                    </div>

                    <div class="gs-row ga-skill-selector">
                        <label>Skill Category</label>
                        <div class="ga-skill-button">
                            <div class="ga-skill-value">${this._getSelectedSkillDisplay()}</div>
                            <button class="ga-skill-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="ga-skill-dropdown" style="display:none"></div>
                    </div>

                    <div class="gs-row">
                        <label>Location</label>
                        <div id="gs-location-dropdown"></div>
                    </div>

                    <div class="gs-row">
                        <label>Stats</label>
                        <div class="gs-stat-rows">${statRowsHtml}</div>
                        <button class="gs-add-stat optimize-btn" style="width:auto;padding:4px 12px;font-size:12px;margin-top:var(--spacing-xs)">+ Add Stat</button>
                    </div>

                    <div class="gs-row">
                        <label class="gs-checkbox-label">
                            <input type="checkbox" id="gs-share" checked />
                            Share with others
                        </label>
                    </div>

                    <div class="gs-actions">
                        <button class="btn-save-service optimize-btn" style="font-size:14px">💾 Save Service</button>
                        ${this.currentDefId ? '<button class="btn-delete-service optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>' : ''}
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);

        // Create location dropdown
        this.locationDropdown = new LocationDropdown(
            this.$element.find('#gs-location-dropdown'),
            { label: 'Service', onSelect: () => { } }
        );

        this.attachEvents();
    }

    attachEvents() {
        this.$element.off('click.gs change.gs input.gs keydown.gs');
        $(document).off('click.gs-saved');

        // Tier selector
        this.$element.on('click.gs', '.gs-tier-btn', (e) => {
            e.preventDefault();
            this.selectedTier = $(e.currentTarget).data('tier');
            this.$element.find('.gs-tier-btn').removeClass('gs-tier-active');
            $(e.currentTarget).addClass('gs-tier-active');

            // Auto-update name based on tier + skill
            const skill = this.selectedSkill || '';
            const currentName = this.$element.find('#gs-name').val() || '';
            if (!currentName || currentName.startsWith('Basic ') || currentName.startsWith('Advanced ')) {
                const tierLabel = this.selectedTier === 'advanced' ? 'Advanced' : 'Basic';
                const skillLabel = skill || 'Service';
                this.$element.find('#gs-name').val(`${tierLabel} ${skillLabel}`);
            }
        });

        // Custom saved definitions dropdown
        this.$element.on('click.gs', '.gs-saved-button', (e) => {
            e.stopPropagation();
            this.savedDropdownOpen = !this.savedDropdownOpen;
            const $dd = this.$element.find('.gs-saved-dropdown');
            const $arrow = this.$element.find('.gs-saved-toggle .expand-arrow');
            if (this.savedDropdownOpen) {
                this.savedSearchText = '';
                $dd.html(this._renderSavedDropdownItems());
                $arrow.addClass('expanded');
                $dd.slideDown(200);
                // Auto-focus search after slideDown
                setTimeout(() => $dd.find('.gs-saved-search').focus(), 160);
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(200);
            }
        });
        this.$element.on('input.gs', '.gs-saved-search', (e) => {
            e.stopPropagation();
            this.savedSearchText = $(e.target).val();
            const fullHtml = this._renderSavedDropdownItems();
            const $temp = $('<div>').html(fullHtml);
            this.$element.find('.gs-saved-list').html($temp.find('.gs-saved-list').html());
        });
        this.$element.on('keydown.gs', '.gs-saved-search', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const $list = this.$element.find('.gs-saved-list');
            const $items = $list.find('.gs-saved-item:visible');
            if (!$items.length) return;
            const $active = $items.filter('.keyboard-active');
            let idx = $active.length ? $items.index($active) : -1;

            if (e.key === 'ArrowDown') {
                $items.removeClass('keyboard-active');
                idx = idx < $items.length - 1 ? idx + 1 : 0;
                const $next = $items.eq(idx);
                $next.addClass('keyboard-active');
                const container = $list[0], el = $next[0];
                const elBottom = el.offsetTop + el.offsetHeight;
                const viewBottom = container.scrollTop + container.clientHeight;
                if (elBottom > viewBottom) {
                    container.scrollTop += elBottom - viewBottom;
                } else if (el.offsetTop < container.scrollTop) {
                    container.scrollTop = el.offsetTop;
                }
            } else if (e.key === 'ArrowUp') {
                $items.removeClass('keyboard-active');
                idx = idx > 0 ? idx - 1 : $items.length - 1;
                const $prev = $items.eq(idx);
                $prev.addClass('keyboard-active');
                const container = $list[0], el = $prev[0];
                if (el.offsetTop < container.scrollTop) {
                    container.scrollTop = el.offsetTop;
                } else {
                    const elBottom = el.offsetTop + el.offsetHeight;
                    const viewBottom = container.scrollTop + container.clientHeight;
                    if (elBottom > viewBottom) {
                        container.scrollTop += elBottom - viewBottom;
                    }
                }
            } else if (e.key === 'Enter' && $active.length) {
                $active.trigger('click');
            }
        });
        this.$element.on('click.gs', '.gs-saved-item', (e) => {
            e.stopPropagation();
            const defId = $(e.currentTarget).data('id') || '';
            this.savedDropdownOpen = false;
            this.$element.find('.gs-saved-dropdown').slideUp(200);
            this.$element.find('.gs-saved-toggle .expand-arrow').removeClass('expanded');
            if (!defId) {
                this.currentDefId = null;
                this.selectedIcon = '⚡';
                this.selectedIconColor = null;
                this.selectedSkill = '';
                this.selectedTier = 'basic';
                this.statRows = [];
                this.render();
                return;
            }
            if (String(defId).startsWith('community::')) {
                const cid = String(defId).replace('community::', '');
                const def = this.communityDefs.find(d => d.id === cid);
                if (def) this.populateFromSaved(def);
                return;
            }
            const def = this.savedDefs.find(d => d.id === defId);
            if (def) this.populateFromSaved(def);
        });
        this.$element.on('change.gs', '#gs-show-community', () => this.toggleCommunity());

        // Skill dropdown
        this.$element.on('click.gs', '.ga-skill-button', (e) => {
            e.stopPropagation();
            this.skillDropdownOpen = !this.skillDropdownOpen;
            const $dd = this.$element.find('.ga-skill-dropdown');
            const $arrow = this.$element.find('.ga-skill-toggle .expand-arrow');
            if (this.skillDropdownOpen) {
                $dd.html(this._renderSkillDropdownItems());
                $arrow.addClass('expanded');
                $dd.slideDown(200);
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(200);
            }
        });
        this.$element.on('click.gs', '.ga-skill-item', (e) => {
            e.stopPropagation();
            this.selectedSkill = $(e.currentTarget).data('skill');
            this.skillDropdownOpen = false;
            this.$element.find('.ga-skill-dropdown').slideUp(200);
            this.$element.find('.ga-skill-toggle .expand-arrow').removeClass('expanded');
            this.$element.find('.ga-skill-value').html(this._getSelectedSkillDisplay());
        });

        // Stat row management
        this.$element.on('click.gs', '.gs-add-stat', (e) => {
            e.preventDefault();
            this.addStatRow();
        });
        this.$element.on('click.gs', '.gs-stat-remove', (e) => {
            e.preventDefault();
            const index = $(e.currentTarget).closest('.gs-stat-row').data('index');
            this.removeStatRow(index);
        });

        // Save / Delete
        this.$element.on('click.gs', '.btn-save-service', (e) => {
            e.preventDefault();
            this.saveDefinition();
        });
        this.$element.on('click.gs', '.btn-delete-service', (e) => {
            e.preventDefault();
            this.deleteDefinition();
        });

        // Emoji picker — body-appended floating with smart positioning
        this.$element.on('click.gs', '.gs-icon-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ($('.gs-icon-popup-floating').length) {
                $('.gs-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
                $(document).off('click.gs-icon-floating');
                return;
            }
            const $source = this.$element.find('.gs-icon-popup');
            const $floating = $('<div class="gs-icon-popup-floating"></div>');
            $floating.html($source.html());
            const rect = e.currentTarget.getBoundingClientRect();
            const popupW = 340;
            $floating.css({
                position: 'fixed', top: '-9999px', left: '-9999px',
                width: popupW + 'px', 'max-height': '70vh', 'overflow-y': 'auto',
                'z-index': 100000, background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)', 'border-radius': '8px',
                'box-shadow': '0 8px 32px rgba(0,0,0,0.5)',
                visibility: 'hidden', display: 'block',
            });
            $('body').append($floating);
            const popupH = Math.min($floating[0].scrollHeight, window.innerHeight * 0.7);
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const spaceAbove = rect.top - 8;
            const openAbove = spaceBelow < popupH && spaceAbove > spaceBelow;
            let top = openAbove ? rect.top - Math.min(popupH, spaceAbove) - 4 : rect.bottom + 4;
            let left = rect.left;
            if (left + popupW > window.innerWidth) left = window.innerWidth - popupW - 8;
            if (left < 4) left = 4;
            $floating.css({ top: top + 'px', left: left + 'px', visibility: '', display: 'none' });
            $floating.slideDown(150);
            $floating.on('click', '.gs-emoji-option', (ev) => {
                ev.stopPropagation();
                this.selectedIcon = $(ev.currentTarget).data('emoji');
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$element.find('.gs-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
                $(document).off('click.gs-icon-floating');
            });
            $floating.on('input', '.gs-icon-color', (ev) => {
                this.selectedIconColor = $(ev.target).val();
                this.$element.find('.gs-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
            });
            $floating.on('click', '.gs-color-clear', () => {
                this.selectedIconColor = null;
                this.$element.find('.gs-icon-btn').html(this.selectedIcon);
                $floating.find('.gs-icon-color').val('#ffffff');
            });
            const fpicker = $floating.find('emoji-picker')[0];
            if (fpicker) fpicker.addEventListener('emoji-click', (ev) => {
                this.selectedIcon = ev.detail.unicode;
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$element.find('.gs-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
                $(document).off('click.gs-icon-floating');
            });
            setTimeout(() => {
                $(document).on('click.gs-icon-floating', (ev) => {
                    if ($(ev.target).closest('.gs-icon-popup-floating, .gs-icon-btn').length) return;
                    $floating.slideUp(150, () => $floating.remove());
                    $(document).off('click.gs-icon-floating');
                });
            }, 10);
        });

        // Close saved dropdown on outside click
        $(document).off('click.gs-saved').on('click.gs-saved', (e) => {
            if (this.savedDropdownOpen && !$(e.target).closest('.gs-saved-selector').length) {
                this._closeSavedDropdown();
            }
        });
    }

    _closeSavedDropdown() {
        if (this.savedDropdownOpen) {
            this.savedDropdownOpen = false;
            this.$element.find('.gs-saved-dropdown').slideUp(200);
            this.$element.find('.gs-saved-toggle .expand-arrow').removeClass('expanded');
        }
    }

    destroy() {
        this.$element.off('click.gs change.gs input.gs keydown.gs');
        $(document).off('click.gs-saved');
        if (this.locationDropdown) { this.locationDropdown.destroy(); this.locationDropdown = null; }
        super.destroy();
    }
}

export default GenericServiceForm;
