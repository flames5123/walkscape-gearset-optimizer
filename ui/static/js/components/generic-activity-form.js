/**
 * GenericActivityForm — form for creating/editing generic activities.
 *
 * Rendered inside Column 3 when "🔧 Generic" is selected from the
 * ActivitySelectorDropdown.
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import LocationDropdown from './location-dropdown.js';

const EMOJI_OPTIONS = ['⚡', '⚔️', '🎯', '🏹', '🛡️', '🔥', '💎', '🌊', '🌲', '⛏️', '🎣', '🍳', '🪚', '🧵', '🐾', '🏔️', '❄️', '☀️', '🌙', '⭐'];

const KNOWN_KEYWORDS = [
    { value: 'Achievement reward', icon: '🏆' },
    { value: 'Advanced diving gear', icon: '🤿' },
    { value: 'Adventuring tool set', icon: '🧰' },
    { value: 'Alcohol', icon: '🍺' },
    { value: 'Amulet', icon: '📿' },
    { value: 'Bar', icon: '�' },
    { value: 'Basket', icon: '�' },
    { value: 'Bellows', icon: '💨' },
    { value: 'Beverage', icon: '�' },
    { value: 'Bug catching net', icon: '�' },
    { value: 'Carpentry tool', icon: '🪚' },
    { value: 'Chisel', icon: '🪨' },
    { value: 'Climbing gear', icon: '🧗' },
    { value: 'Cooked fish', icon: '🐟' },
    { value: 'Cooking knife', icon: '�' },
    { value: 'Cooking pan', icon: '🍳' },
    { value: 'Cooking pot', icon: '🍲' },
    { value: 'Cooking recipe', icon: '📋' },
    { value: 'Cooking tool', icon: '�' },
    { value: 'Crafting tool', icon: '🔧' },
    { value: 'Currency', icon: '�' },
    { value: 'Cursed', icon: '💀' },
    { value: 'Cut gem', icon: '💎' },
    { value: 'Cutting board', icon: '🪵' },
    { value: 'Desert location', icon: '�️' },
    { value: 'Diving gear', icon: '🤿' },
    { value: 'Expert diving gear', icon: '�' },
    { value: 'Faction reward', icon: '🏅' },
    { value: 'Fish', icon: '�' },
    { value: 'Fishing cage', icon: '�' },
    { value: 'Fishing lure', icon: '🪝' },
    { value: 'Fishing net', icon: '🥅' },
    { value: 'Fishing rod', icon: '🎣' },
    { value: 'Fishing spear', icon: '🔱' },
    { value: 'Fishing tool', icon: '🎣' },
    { value: 'Fishing', icon: '🎣' },
    { value: 'Food', icon: '🍽️' },
    { value: 'Forge', icon: '�' },
    { value: 'Foraging tool', icon: '🌿' },
    { value: 'Gem', icon: '�' },
    { value: 'Gold pan', icon: '🥘' },
    { value: 'Hatchet', icon: '�' },
    { value: 'Heavy', icon: '⚖️' },
    { value: 'Ingredient', icon: '🌿' },
    { value: 'Kitchen', icon: '🍳' },
    { value: 'Knife', icon: '🔪' },
    { value: 'Life vest', icon: '🦺' },
    { value: 'Light source', icon: '💡' },
    { value: 'Light', icon: '�' },
    { value: 'Local map', icon: '�️' },
    { value: 'Log splitter', icon: '🪓' },
    { value: 'Log', icon: '�' },
    { value: 'Magnetic', icon: '🧲' },
    { value: 'Magnifying lens', icon: '🔍' },
    { value: 'Memosphere', icon: '�' },
    { value: 'Mining ores', icon: '⛏️' },
    { value: 'Mining tool', icon: '⛏️' },
    { value: 'Misc.', icon: '❓' },
    { value: 'Mushroom', icon: '🍄' },
    { value: 'Nugget', icon: '🪙' },
    { value: 'Offcut', icon: '✂️' },
    { value: 'Ore', icon: '🪨' },
    { value: 'Pet egg', icon: '🥚' },
    { value: 'Pickaxe', icon: '⛏️' },
    { value: 'Plank', icon: '🪵' },
    { value: 'Plant foraging', icon: '🌿' },
    { value: 'Plant', icon: '🌱' },
    { value: 'Processed', icon: '⚙️' },
    { value: 'Proper gear', icon: '👔' },
    { value: 'Regional', icon: '🗺️' },
    { value: 'Ring', icon: '💍' },
    { value: 'Rough gem', icon: '💎' },
    { value: 'Ruler', icon: '📏' },
    { value: 'Sander', icon: '🪵' },
    { value: 'Sandwich recipe', icon: '📋' },
    { value: 'Sandwich', icon: '🥪' },
    { value: 'Saw', icon: '🪚' },
    { value: 'Sawmill', icon: '🪚' },
    { value: 'Screwdriver', icon: '🪛' },
    { value: 'Shield', icon: '🛡️' },
    { value: 'Sickle', icon: '🌾' },
    { value: 'Skill book', icon: '📖' },
    { value: 'Skis', icon: '⛷️' },
    { value: 'Skydisc', icon: '🛸' },
    { value: 'Smelting', icon: '🔥' },
    { value: 'Smithing hammer', icon: '🔨' },
    { value: 'Smithing tool', icon: '🔨' },
    { value: 'Socks', icon: '🧦' },
    { value: 'Spectral location', icon: '👻' },
    { value: 'Spectral', icon: '👻' },
    { value: 'Spices', icon: '🌶️' },
    { value: 'Tailoring tool', icon: '🧵' },
    { value: 'Tool', icon: '🔧' },
    { value: 'Trash', icon: '🗑️' },
    { value: 'Treasure hunter set', icon: '💰' },
    { value: 'Trinket', icon: '💎' },
    { value: 'Trinketry bench', icon: '💎' },
    { value: 'Ultra light', icon: '🪶' },
    { value: 'Underwater', icon: '🌊' },
    { value: 'Water', icon: '💧' },
    { value: 'Weapon', icon: '⚔️' },
    { value: 'Woodcutting tool', icon: '🪓' },
    { value: 'Woodcutting trees', icon: '🌲' },
    { value: 'Workshop', icon: '🔧' },
    { value: 'Wrench', icon: '🔧' },
];

function kwIcon(value) {
    const id = value.toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
    return `<img src="/assets/icons/keywords/${id}.svg" style="width:18px;height:18px" onerror="this.style.display='none'" />`;
}

const SKILL_ICON_FALLBACK = {
    'traveling': '🧭',
};
function skillIcon(name) {
    const skillId = name.toLowerCase().replace(' ', '_');
    const fallback = SKILL_ICON_FALLBACK[skillId];
    if (fallback) return `<span class="ga-skill-icon-emoji">${fallback}</span>`;
    return `<img src="/assets/icons/text/skill_icons/${skillId}.svg" class="ga-skill-icon" />`;
}

class GenericActivityForm extends Component {
    constructor(element, props = {}) {
        super(element, props);
        this.inputMode = 'observed';    // 'observed' | 'known'
        this.showCommunity = store.state.column3?.showGenericCommunity || false;
        this.savedDefs = [];
        this.communityDefs = [];
        this.currentDefId = null;
        this.reverseResult = null;
        this.skillsList = [];
        this.selectedIcon = '⚡';
        this.selectedIconColor = null;
        this.selectedSkill = '';
        this.skillDropdownOpen = false;
        this.selectedSkill = '';
        this.skillDropdownOpen = false;
        this.isExpanded = true;

        // Location dropdown instances (created after render)
        this.locationDropdown = null;
        this.currentLocationDropdown = null;
        this.additionalLocationDropdowns = []; // Extra location dropdowns
        this.additionalLocations = []; // Saved additional location IDs

        // Requirements rows: [{type: 'keyword', keyword: 'diving gear', count: 3}, ...]
        this.requirementRows = [];
        this.customKeywordsFromDB = []; // Custom keywords loaded from DB

        // Secondary skill XP rows: [{skill: 'mining', xp: 50}, ...]
        this.secondaryXpRows = [];
        this._populatedSecondaryXp = [];

        this._loadSkills();
        this._loadSavedDefinitions();
        this._loadCustomKeywords();

        // Watch for selectedActivity changes to auto-populate on reload
        this._autoPopulateDone = false;
        this.subscribe('column3.selectedActivity', () => {
            if (this._autoPopulateDone) return;
            this._tryAutoPopulate();
        });
    }

    /**
     * Try to auto-populate from a saved generic activity selection (e.g., after page reload).
     * Only runs once.
     */
    _tryAutoPopulate() {
        const selectedId = store.state.column3?.selectedActivity;
        if (!selectedId || typeof selectedId !== 'string' || !selectedId.startsWith('generic::')) return;
        if (this.currentDefId) return; // Already populated
        const defId = selectedId.replace('generic::', '');
        const def = (this.savedDefs || []).find(d => d.id === defId)
            || (this.communityDefs || []).find(d => d.id === defId);
        if (def) {
            this._autoPopulateDone = true;
            this.populateFromSaved(def);
        }
    }

    // ------------------------------------------------------------------
    // DATA LOADING
    // ------------------------------------------------------------------

    async _loadSkills() {
        try {
            const data = await $.get('/api/skills');
            // Skills come as { skills: [...] } or just [...]
            const raw = data.skills || data || [];
            // Normalize to title case
            this.skillsList = raw.map(s => {
                const name = typeof s === 'string' ? s : (s.name || s.id || '');
                return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            }).filter(n => n && n.toLowerCase() !== 'traveling');
            // Ensure Hunting and Tailoring are included
            if (!this.skillsList.find(s => s.toLowerCase() === 'hunting')) this.skillsList.push('Hunting');
            if (!this.skillsList.find(s => s.toLowerCase() === 'tailoring')) this.skillsList.push('Tailoring');
            this.skillsList.sort();
            this.render();
        } catch (e) {
            console.error('GenericActivityForm: failed to load skills', e);
        }
    }

    async _loadCustomKeywords() {
        try {
            const data = await api.getCustomKeywords();
            // Deduplicate by lowercase name (keep first occurrence), sentence-case names
            const seen = new Set();
            this.customKeywordsFromDB = (data.keywords || []).filter(kw => {
                const key = kw.name.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).map(kw => ({ ...kw, name: kw.name.charAt(0).toUpperCase() + kw.name.slice(1).toLowerCase() }));
            // Re-render requirement rows if they exist (custom keyword icons may need updating)
            if (this.requirementRows.length > 0 && this.$element.find('.ga-req-rows').length) {
                this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
            }
        } catch (e) { this.customKeywordsFromDB = []; }
    }

    async _loadSavedDefinitions(skipRender = false) {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            const defs = await api.getGenericDefinitions(uuid);
            this.savedDefs = defs.activities || [];
            store.state.column3.savedGenericActivities = this.savedDefs;
            if (this.showCommunity) await this._loadCommunity();
            if (!skipRender) this.render();

            // Try auto-populate after defs are loaded
            this._tryAutoPopulate();
        } catch (e) {
            console.error('GenericActivityForm: failed to load saved defs', e);
        }
    }

    async _loadCommunity() {
        try {
            const defs = await api.getCommunityDefinitions();
            this.communityDefs = defs.activities || [];
        } catch (e) {
            this.communityDefs = [];
        }
    }

    // ------------------------------------------------------------------
    // ACTIONS
    // ------------------------------------------------------------------

    toggleInputMode() {
        this.inputMode = this.inputMode === 'observed' ? 'known' : 'observed';
        this.reverseResult = null;
        const isObs = this.inputMode === 'observed';

        // Update mode label and button text
        this.$element.find('.ga-mode-label').text(isObs ? 'Observed' : 'Known Base');
        this.$element.find('.btn-toggle-mode').text(isObs ? 'Switch to Known Base' : 'Switch to Observed');

        // Show/hide current location row
        const $curLocRow = this.$element.find('.ga-current-loc-row');
        if (isObs) {
            $curLocRow.slideDown(150);
            if (!this.currentLocationDropdown) {
                this.currentLocationDropdown = new LocationDropdown(
                    this.$element.find('#ga-current-loc-dropdown'),
                    { label: 'Current', onSelect: () => { } }
                );
            }
        } else {
            $curLocRow.slideUp(150);
        }

        // Toggle which fields are visible
        this.$element.find('.ga-observed-fields').toggle(isObs);
        this.$element.find('.ga-known-fields').toggle(!isObs);

        // Update button label
        this.$element.find('.btn-save-generic').text(isObs ? 'Calculate' : '💾 Save');

        // Clear reverse result
        this.$element.find('.ga-reverse-result-container').empty();
    }

    async toggleCommunity() {
        this.showCommunity = !this.showCommunity;
        store.state.column3.showGenericCommunity = this.showCommunity;
        store._saveColumn3Selection();
        if (this.showCommunity && this.communityDefs.length === 0) {
            await this._loadCommunity();
        }
        this.$element.find('.ga-saved-dropdown').html(this._renderSavedDropdownItems());
    }

    populateFromSaved(def) {
        this.currentDefId = def.id;
        this.selectedIcon = def.icon || '⚡';
        this.selectedIconColor = def.icon_color || null;
        this.inputMode = 'known';
        this.reverseResult = null;
        this.requirementRows = this._jsonToRequirementRows(def.requirements_json);
        // Restore additional locations from requirements JSON
        try {
            const reqs = typeof def.requirements_json === 'string' ? JSON.parse(def.requirements_json || '{}') : (def.requirements_json || {});
            this.additionalLocations = reqs.additional_locations || [];
        } catch (e) { this.additionalLocations = []; }
        // Restore secondary XP rows
        const secXpRaw = def.secondary_xp_json || '{}';
        const secXp = typeof secXpRaw === 'string' ? JSON.parse(secXpRaw) : (secXpRaw || {});
        this.secondaryXpRows = Object.entries(secXp).map(([skill, xp]) => ({ skill, xp }));
        this._populatedSecondaryXp = this.secondaryXpRows.map(r => ({ ...r }));
        // Store values in state so render() can use them
        this._populatedName = def.name || '';
        this._populatedBaseSteps = def.base_steps || '';
        this._populatedBaseXp = def.base_xp || 0;
        this._populatedMaxEff = Math.round((def.max_efficiency || 0) * 100) + 100;
        this._populatedReqLevel = def.required_level || 1;
        this._populatedIsPublic = !!def.is_public;
        this._populatedLocation = def.location || '';
        this.selectedSkill = def.skill ? def.skill.charAt(0).toUpperCase() + def.skill.slice(1).toLowerCase() : '';
        // Re-render first so fields exist, then populate
        this.render();
        this.$element.find('#ga-name').val(this._populatedName);
        this.$element.find('#ga-base-steps').val(this._populatedBaseSteps);
        this.$element.find('#ga-base-xp').val(this._populatedBaseXp);
        this.$element.find('#ga-max-eff').val(this._populatedMaxEff);
        this.$element.find('#ga-max-eff-slider').val(Math.min(this._populatedMaxEff, 350));
        this.$element.find('#ga-req-level').val(this._populatedReqLevel);
        this.$element.find('#ga-req-level-slider').val(this._populatedReqLevel);
        this.$element.find('#ga-share').prop('checked', this._populatedIsPublic);
        if (this.locationDropdown && this._populatedLocation) {
            this.locationDropdown.selectLocation(this._populatedLocation);
        }
    }

    _getSelectedLocation() {
        if (!this.locationDropdown) return '';
        const loc = this.locationDropdown.getSelectedLocation();
        return loc ? loc.id : '';
    }

    _getCurrentLocation() {
        if (!this.currentLocationDropdown) return '';
        const loc = this.currentLocationDropdown.getSelectedLocation();
        return loc ? loc.id : '';
    }

    _readForm() {
        const maxEffRaw = parseFloat(this.$element.find('#ga-max-eff').val()) || 0;
        const maxEff = maxEffRaw > 100 ? (maxEffRaw - 100) / 100 : maxEffRaw / 100;
        const skill = this.selectedSkill || '';
        return {
            name: (this.$element.find('#ga-name').val() || '').trim(),
            skill: skill.toLowerCase(),
            location: this._getSelectedLocation(),
            base_steps: parseInt(this.$element.find('#ga-base-steps').val()) || 0,
            base_xp: parseFloat(this.$element.find('#ga-base-xp').val()) || 0,
            max_efficiency: maxEff,
            required_level: parseInt(this.$element.find('#ga-req-level').val()) || 1,
            is_public: this.$element.find('#ga-share').is(':checked'),
            observed_steps: parseInt(this.$element.find('#ga-obs-steps').val()) || 0,
            observed_xp: parseFloat(this.$element.find('#ga-obs-xp').val()) || 0,
            current_location: this._getCurrentLocation(),
            icon: this.selectedIcon,
            icon_color: this.selectedIconColor || null,
            requirements_json: this._requirementsToJson(),
            secondary_xp_json: this._secondaryXpToJson(),
        };
    }

    /** Read raw form values (before normalization) for save/restore across re-renders. */
    _readFormRaw() {
        return {
            name: this.$element.find('#ga-name').val() || '',
            skill: this.selectedSkill || '',
            location: this._getSelectedLocation(),
            base_steps: this.$element.find('#ga-base-steps').val() || '',
            base_xp: this.$element.find('#ga-base-xp').val() || '',
            obs_steps: this.$element.find('#ga-obs-steps').val() || '',
            obs_xp: this.$element.find('#ga-obs-xp').val() || '',
            max_eff: this.$element.find('#ga-max-eff').val() || '160',
            req_level: this.$element.find('#ga-req-level').val() || '1',
            is_public: this.$element.find('#ga-share').is(':checked'),
            current_location: this._getCurrentLocation(),
            icon: this.selectedIcon,
        };
    }

    /** Restore form values after a re-render. */
    _restoreFormValues(v) {
        this.$element.find('#ga-name').val(v.name);
        this.selectedSkill = v.skill || this.selectedSkill;
        this.$element.find('#ga-base-steps').val(v.base_steps);
        this.$element.find('#ga-base-xp').val(v.base_xp);
        this.$element.find('#ga-obs-steps').val(v.obs_steps);
        this.$element.find('#ga-obs-xp').val(v.obs_xp);
        this.$element.find('#ga-max-eff').val(v.max_eff);
        this.$element.find('#ga-max-eff-slider').val(Math.min(parseInt(v.max_eff) || 160, 350));
        this.$element.find('#ga-req-level').val(v.req_level);
        this.$element.find('#ga-req-level-slider').val(parseInt(v.req_level) || 1);
        this.$element.find('#ga-share').prop('checked', v.is_public);
        // Restore location dropdowns
        if (this.locationDropdown && v.location) {
            this.locationDropdown.selectLocation(v.location);
        }
        if (this.currentLocationDropdown && v.current_location) {
            this.currentLocationDropdown.selectLocation(v.current_location);
        }
    }

    async submitForm() {
        const data = this._readForm();
        if (!data.name) { api.showError('Name is required.'); return; }
        if (!data.skill) { api.showError('Skill is required.'); return; }
        if (!data.location) { api.showError('Location is required.'); return; }

        if (this.inputMode === 'observed') {
            if (!data.observed_steps || data.observed_steps <= 0) {
                api.showError('Observed steps must be positive.'); return;
            }
            try {
                const skillLevel = store.state.character?.skills?.[data.skill] || 1;
                const reversePayload = {
                    observed_steps: data.observed_steps,
                    skill_level: skillLevel,
                    required_level: data.required_level,
                    max_efficiency: data.max_efficiency,
                };
                // Send observed XP for reverse calculation (accounts for collectible bonuses)
                if (data.observed_xp) {
                    reversePayload.observed_xp = data.observed_xp;
                    reversePayload.skill = data.skill;
                    reversePayload.location = data.location;
                }
                const result = await api.reverseCalculate(reversePayload);
                this.reverseResult = result;
                if (!result.ambiguous && result.base_steps) {
                    data.base_steps = result.base_steps;

                    // Check XP ambiguity — block save if ambiguous
                    const xpResult = result.xp_result;
                    if (xpResult && xpResult.ambiguous) {
                        this.reverseResult.computed_xp = null;
                        this.$element.find('.ga-reverse-result-container').html(this._renderReverseResult());
                        return;
                    }

                    // Use reverse-calculated base XP if available, otherwise fall back to observed
                    if (xpResult && xpResult.base_xp != null) {
                        data.base_xp = xpResult.base_xp;
                    } else if (data.observed_xp) {
                        data.base_xp = data.observed_xp;
                    }
                    this.reverseResult.computed_xp = data.base_xp != null ? data.base_xp : null;
                    this.$element.find('.ga-reverse-result-container').html(this._renderReverseResult());

                    // Convert secondary XP from observed to base
                    // XP in game = base_xp * (1 + bonus_xp_pct) + bonus_xp_add
                    // For secondary skills, same bonus applies
                    // Get bonus from primary conversion ratio, or from xpResult, or from result
                    let bonusMult = 1;
                    if (data.observed_xp && data.base_xp && data.base_xp > 0 && data.observed_xp > data.base_xp) {
                        bonusMult = data.observed_xp / data.base_xp;
                    } else if (xpResult && xpResult.bonus_xp_pct > 0) {
                        bonusMult = 1 + xpResult.bonus_xp_pct;
                    } else if (result && result.bonus_xp_pct > 0) {
                        bonusMult = 1 + result.bonus_xp_pct;
                    }
                    console.log('[SEC-XP] data.observed_xp:', data.observed_xp, 'data.base_xp:', data.base_xp);
                    console.log('[SEC-XP] xpResult:', xpResult);
                    console.log('[SEC-XP] bonusMult:', bonusMult);
                    console.log('[SEC-XP] secondaryXpRows BEFORE:', JSON.stringify(this.secondaryXpRows));
                    this._syncSecondaryXp();
                    console.log('[SEC-XP] secondaryXpRows AFTER sync:', JSON.stringify(this.secondaryXpRows));
                    for (const row of this.secondaryXpRows) {
                        if (row.xp > 0) {
                            const oldXp = row.xp;
                            // Always convert: round to nearest integer (base XP is always integer)
                            row.xp = bonusMult > 1
                                ? Math.round(row.xp / bonusMult)
                                : Math.round(row.xp);
                            console.log(`[SEC-XP] ${row.skill}: ${oldXp} -> ${row.xp} (bonusMult=${bonusMult})`);
                        }
                    }
                    console.log('[SEC-XP] secondaryXpRows FINAL:', JSON.stringify(this.secondaryXpRows));
                } else {
                    // Don't re-render — just update the result container
                    this.$element.find('.ga-reverse-result-container').html(this._renderReverseResult());
                    return;
                }
            } catch (e) {
                api.showError('Reverse calculation failed.');
                return;
            }
        }

        if (data.base_steps < 10) { api.showError('Base steps must be at least 10.'); return; }
        // Re-serialize secondary XP from in-memory rows (already converted, don't re-sync from DOM)
        const secXpResult = {};
        for (const r of this.secondaryXpRows) {
            if (r.skill && r.xp > 0) {
                secXpResult[r.skill.toLowerCase()] = r.xp;
            }
        }
        data.secondary_xp_json = JSON.stringify(secXpResult);
        this._saveDefinition(data);
    }

    async _saveDefinition(data) {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            const isNew = !this.currentDefId;
            if (this.currentDefId) {
                await api.updateGenericDefinition(uuid, this.currentDefId, {
                    type: 'activity', ...data
                });
            } else {
                const saved = await api.saveGenericDefinition(uuid, {
                    type: 'activity', ...data
                });
                this.currentDefId = saved.id;
            }
            await this._loadSavedDefinitions(true);

            store.state.column3.selectedActivity = `generic::${this.currentDefId}`;
            store.state.column3.genericActivity = data;
            store._notifySubscribers('column3.selectedActivity');
            store._notifySubscribers('column3.genericActivity');
            store._saveColumn3Selection();

            // Update UI without re-rendering
            this.$element.find('.ga-saved-value').html(this._getSelectedDefName());
            this.reverseResult = null;

            // Show saved confirmation in the result area
            this.$element.find('.ga-reverse-result-container').html(
                `<div class="reverse-result success">✓ Saved — Base Steps: <strong>${data.base_steps}</strong>, Base XP: <strong>${data.base_xp}</strong></div>`
            );

            // Switch to Known Base mode and show the saved values
            if (this.inputMode === 'observed') {
                this.inputMode = 'known';
                this.$element.find('.ga-mode-label').text('Known Base');
                this.$element.find('.btn-toggle-mode').text('Switch to Observed');
                this.$element.find('.ga-current-loc-row').slideUp(150);
                this.$element.find('.ga-observed-fields').slideUp(150);
                this.$element.find('.ga-known-fields').slideDown(150);
                this.$element.find('.btn-save-generic').text('💾 Save');
            }
            // Fill in the known base values
            this.$element.find('#ga-base-steps').val(data.base_steps);
            this.$element.find('#ga-base-xp').val(data.base_xp);

            // Update secondary XP inputs with converted base values
            this.$element.find('.ga-sec-xp-row').each((idx, el) => {
                if (idx < this.secondaryXpRows.length) {
                    $(el).find('.ga-sec-xp-value').val(this.secondaryXpRows[idx].xp);
                }
            });

            // Show success toast (single, after all updates)
            api.showSuccess(isNew ? 'Generic activity saved.' : 'Generic activity updated.');

            // Show View button if not already present
            if (!this.$element.find('.btn-view-generic').length) {
                const viewBtn = `<div class="ga-row ga-view-btn-row" style="margin-bottom:var(--spacing-xs)"><button class="btn-view-generic optimize-btn" style="font-size:14px;background:#2196F3;width:100%">View Activity Info</button></div>`;
                this.$element.find('.ga-saved-selector').after(viewBtn);
            }

            // Show Delete button if not already present
            if (!this.$element.find('.btn-delete-generic').length) {
                this.$element.find('.ga-actions').append('<button class="btn-delete-generic optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>');
            }

            // Scroll up to show the info section
            setTimeout(() => {
                const $info = $('#activity-recipe-info');
                if ($info.length) {
                    const headerHeight = $('header').outerHeight() || 60;
                    $('html, body').animate({ scrollTop: $info.offset().top - headerHeight - 8 }, 300);
                }
            }, 200);
        } catch (e) {
            // api.js shows error toast
        }
    }

    async deleteDefinition() {
        if (!this.currentDefId) return;
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            await api.deleteGenericDefinition(uuid, this.currentDefId, 'activity');
            api.showSuccess('Generic activity deleted.');
            this.currentDefId = null;
            this.reverseResult = null;
            await this._loadSavedDefinitions();

            store.state.column3.selectedActivity = null;
            store.state.column3.genericActivity = null;
            store._notifySubscribers('column3.selectedActivity');
            store._saveColumn3Selection();

            this.render();
        } catch (e) { /* handled */ }
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    _getSelectedDefName() {
        if (!this.currentDefId) return '+ New Generic Activity';
        const def = this.savedDefs.find(d => d.id === this.currentDefId);
        if (!def) return '+ New Generic Activity';
        const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
        return `${iconHtml} ${def.name}`;
    }

    _renderSavedDropdownItems() {
        const savedIds = new Set(this.savedDefs.map(d => d.id));
        const search = (this.savedSearchText || '').toLowerCase();
        if (!this._expandedSavedSkills) this._expandedSavedSkills = new Set();

        let searchBox = '<input type="text" class="ga-saved-search" placeholder="Search..." value="' + (this.savedSearchText || '') + '" />';

        let items = '<div class="ga-saved-item ga-saved-new" data-id=""><span>+ New Generic Activity</span></div>';

        // Group saved defs by skill
        const bySkill = {};
        for (const def of this.savedDefs) {
            if (search && !def.name.toLowerCase().includes(search)) continue;
            const skill = (def.skill || 'Other').replace(/^\w/, c => c.toUpperCase());
            if (!bySkill[skill]) bySkill[skill] = [];
            bySkill[skill].push(def);
        }

        // Auto-expand matching categories when searching
        if (search) {
            for (const skill of Object.keys(bySkill)) this._expandedSavedSkills.add(skill);
        }

        for (const skill of Object.keys(bySkill).sort()) {
            const isExpanded = this._expandedSavedSkills.has(skill);
            const skillId = skill.toLowerCase().replace(' ', '_');
            const skillIconPath = `/assets/icons/text/skill_icons/${skillId}.svg`;
            const skillIconHtml = skillIcon(skill);
            const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;

            items += `
                <div class="recipe-category">
                    <div class="category-header ga-saved-skill-header" data-skill="${skill}">
                        ${skillIconHtml}
                        <span class="skill-name">${skill}</span>
                        ${arrowIcon}
                    </div>`;

            if (isExpanded) {
                for (const def of bySkill[skill]) {
                    const loc = def.location ? ' (' + def.location.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + ')' : '';
                    const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                    items += `<div class="ga-saved-item recipe-item" data-id="${def.id}"><span>${iconHtml} ${def.name}${loc}</span></div>`;
                }
            }
            items += `</div>`;
        }

        if (this.showCommunity && this.communityDefs.length > 0) {
            const filtered = this.communityDefs.filter(d => !savedIds.has(d.id) && (!search || d.name.toLowerCase().includes(search)));
            if (filtered.length > 0) {
                // Group community defs by skill (same pattern as user's own defs)
                const communityBySkill = {};
                for (const def of filtered) {
                    const skill = (def.skill || 'Other').replace(/^\w/, c => c.toUpperCase());
                    if (!communityBySkill[skill]) communityBySkill[skill] = [];
                    communityBySkill[skill].push(def);
                }
                items += '<div class="ga-saved-divider">Community</div>';
                for (const skill of Object.keys(communityBySkill).sort()) {
                    const isExpanded = this._expandedSavedSkills.has('community::' + skill);
                    const skillIconHtml = skillIcon(skill);
                    const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;
                    items += `
                        <div class="recipe-category">
                            <div class="category-header ga-saved-skill-header" data-skill="community::${skill}">
                                ${skillIconHtml}
                                <span class="skill-name">${skill}</span>
                                ${arrowIcon}
                            </div>`;
                    if (isExpanded) {
                        for (const def of communityBySkill[skill]) {
                            const loc = def.location ? ' (' + def.location.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + ')' : '';
                            const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                            items += `<div class="ga-saved-item recipe-item" data-id="community::${def.id}"><span>${iconHtml} ${def.name}${loc}</span></div>`;
                        }
                    }
                    items += `</div>`;
                }
            }
        }
        return searchBox + '<div class="ga-saved-list recipe-list">' + items + '</div>';
    }

    _renderSavedDropdown() {
        let options = '<option value="">— New Generic Activity —</option>';
        for (const def of this.savedDefs) {
            const sel = def.id === this.currentDefId ? 'selected' : '';
            options += `<option value="${def.id}" ${sel}>${def.icon || '⚡'} ${def.name}</option>`;
        }
        if (this.showCommunity) {
            const savedIds = new Set(this.savedDefs.map(d => d.id));
            for (const def of this.communityDefs) {
                if (!savedIds.has(def.id)) {
                    options += `<option value="community::${def.id}">🌐 ${def.name}</option>`;
                }
            }
        }
        return options;
    }


    _renderEmojiPicker() {
        return EMOJI_OPTIONS.map(e =>
            `<span class="ga-emoji-option ${e === this.selectedIcon ? 'selected' : ''}" data-emoji="${e}">${e}</span>`
        ).join('');
    }

    _getSelectedSkillDisplay() {
        if (!this.selectedSkill) return 'Select skill...';
        const skillId = this.selectedSkill.toLowerCase().replace(' ', '_');
        return `${skillIcon(this.selectedSkill)} ${this.selectedSkill}`;
    }

    _renderSkillDropdownItems() {
        let items = '';
        for (const name of this.skillsList) {
            const skillId = name.toLowerCase().replace(' ', '_');
            items += `<div class="ga-skill-item" data-skill="${name}">
                ${skillIcon(name)}
                <span>${name}</span>
            </div>`;
        }
        return items;
    }

    _getSelectedSkillDisplay() {
        if (!this.selectedSkill) return 'Select skill...';
        const skillId = this.selectedSkill.toLowerCase().replace(' ', '_');
        return `${skillIcon(this.selectedSkill)} ${this.selectedSkill}`;
    }

    _renderSkillDropdownItems() {
        let items = '';
        for (const name of this.skillsList) {
            const skillId = name.toLowerCase().replace(' ', '_');
            items += `<div class="ga-skill-item" data-skill="${name}">
                ${skillIcon(name)}
                <span>${name}</span>
            </div>`;
        }
        return items;
    }

    _renderSkillOptions() {
        return this.skillsList.map(name =>
            `<option value="${name}">${name}</option>`
        ).join('');
    }

    _renderReverseResult() {
        if (!this.reverseResult) return '';
        const r = this.reverseResult;
        const xp = r.xp_result;

        if (!r.ambiguous && r.base_steps) {
            let html = `<div class="reverse-result success">✓ Base Steps resolved: <strong>${r.base_steps}</strong>`;

            // XP ambiguous — show candidate buttons + calibrate
            if (xp && xp.ambiguous && xp.candidates && xp.candidates.length > 1) {
                const xpBtns = xp.candidates.map(c =>
                    `<button class="btn-pick-xp-candidate optimize-btn" data-xp="${c}" style="width:auto;padding:6px 14px;font-size:13px;margin:2px">${c}</button>`
                ).join('');
                html += `</div>`;
                html += `
                        <div class="reverse-result warning" style="margin-top:var(--spacing-xs)">
                            <div class="reverse-result-title">⚠ Base XP Ambiguous</div>
                            <div class="reverse-result-detail">${xp.candidates.length} possible values (${Math.round(xp.bonus_xp_pct * 100)}% bonus XP from collectibles & service) — pick if you know, or calibrate:</div>
                            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:var(--spacing-xs)">${xpBtns}</div>
                            <div style="margin-top:var(--spacing-sm)">
                                <button class="btn-calibrate-xp optimize-btn" style="width:auto;padding:8px 16px;font-size:13px;background:#e67e22">🔍 Calibrate with gear</button>
                            </div>
                            <div class="ga-xp-calibration-area"></div>
                        </div>
                    `;
                return html;
            }

            // XP resolved
            if (r.computed_xp != null) {
                html += `<br/>✓ Base XP resolved: <strong>${r.computed_xp}</strong>`;
                if (xp && xp.bonus_xp_pct > 0) {
                    html += ` <span style="color:var(--text-secondary);font-size:12px">(adjusted for ${Math.round(xp.bonus_xp_pct * 100)}% bonus XP from collectibles & service)</span>`;
                }
            }
            html += `</div>`;
            return html;
        }
        if (r.ambiguous) {
            const candidateBtns = r.candidates.slice(0, 10).map(c =>
                `<button class="btn-pick-candidate optimize-btn" data-steps="${c}" style="width:auto;padding:6px 14px;font-size:13px;margin:2px">${c}</button>`
            ).join('');

            // Also show XP ambiguity note if applicable
            let xpNote = '';
            if (xp && xp.ambiguous && xp.candidates && xp.candidates.length > 1) {
                xpNote = `<div style="margin-top:var(--spacing-xs);color:var(--text-secondary);font-size:12px">ℹ Base XP is also ambiguous (${xp.candidates.length} candidates) — will resolve after you pick steps.</div>`;
            }

            return `
                    <div class="reverse-result warning">
                        <div class="reverse-result-title">⚠ Base Steps Ambiguous</div>
                        <div class="reverse-result-detail">${r.candidates.length} possible values — pick if you know, or calibrate:</div>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:var(--spacing-xs)">${candidateBtns}</div>
                        ${xpNote}
                        <div style="margin-top:var(--spacing-sm)">
                            <button class="btn-calibrate optimize-btn" style="width:auto;padding:8px 16px;font-size:13px;background:#e67e22">🔍 Calibrate with gear</button>
                        </div>
                        <div class="ga-calibration-area"></div>
                    </div>
                `;
        }
        return '<div class="reverse-result error">Could not determine base steps. Check your inputs.</div>';
    }

    _renderRequirementRows() {
        const FACTIONS = ['jarvonia', 'trellin', 'erdwise', 'syrenthia', 'halfling_rebels', 'wallisia', 'wrentmark'];
        const ALL_SKILLS = ['Agility', 'Carpentry', 'Cooking', 'Crafting', 'Fishing', 'Foraging', 'Hunting', 'Mining', 'Smithing', 'Tailoring', 'Trinketry', 'Woodcutting'];

        return this.requirementRows.map((r, i) => {
            let fields = '';
            if (r.type === 'keyword') {
                const kwDisplay = r.keyword || 'Select keyword...';
                // For custom keywords, show their emoji; for known keywords, show SVG icon
                const isCustomKw = r.keyword && this.customKeywordsFromDB.some(ck => ck.name.toLowerCase() === r.keyword.toLowerCase());
                const customKwData = isCustomKw ? this.customKeywordsFromDB.find(ck => ck.name.toLowerCase() === r.keyword.toLowerCase()) : null;
                const kwIconHtml = r.keyword ? (customKwData ? `<span style="font-size:14px;margin-right:2px;${window.emojiTintStyle(customKwData.icon_color)}">${window.emojiForPlatform(customKwData.icon || '🏷️')}</span>` : kwIcon(r.keyword)) : '';
                let kwItems = KNOWN_KEYWORDS.map(kw =>
                    `<div class="ga-req-dd-item ga-req-kw-item" data-value="${kw.value}" data-row="${i}">${kwIcon(kw.value)}<span>${kw.value}</span></div>`
                ).join('');
                // Add custom keywords section
                const customKws = (this.customKeywordsFromDB || []).filter(ck => !KNOWN_KEYWORDS.some(k => k.value.toLowerCase() === ck.name.toLowerCase()));
                if (customKws.length > 0) {
                    kwItems += `<div style="font-size:0.7rem;color:var(--text-muted);padding:6px 8px 2px;border-top:1px solid var(--border-color);margin-top:4px">Custom Keywords</div>`;
                    kwItems += customKws.map(ck => {
                        const colorStyle = ck.icon_color ? `${window.emojiTintStyle(ck.icon_color)}` : '';
                        return `<div class="ga-req-dd-item ga-req-kw-item" data-value="${ck.name}" data-row="${i}"><span style="font-size:14px;margin-right:4px;${colorStyle}">${ck.icon || '🏷️'}</span><span>${ck.name}</span></div>`;
                    }).join('');
                }
                fields = `
                        <div class="ga-req-kw-cell" style="position:relative;flex:1">
                            <div class="ga-req-dd-btn ga-req-kw-btn" data-row="${i}">${kwIconHtml}<span class="ga-req-dd-val">${kwDisplay}</span><span class="expand-arrow">▼</span></div>
                            <div class="ga-req-dd-dropdown ga-req-kw-dd" style="display:none">
                                <input type="text" class="ga-req-kw-search" placeholder="Search keywords..." style="width:calc(100% - 12px);margin:4px 6px;padding:4px 8px;font-size:12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)" />
                                <div class="ga-req-kw-list">${kwItems}</div>
                                <div style="border-top:1px solid var(--border-color);margin-top:4px;padding:4px 6px;display:flex;gap:4px;align-items:center">
                                    <button class="ga-req-kw-emoji-btn" data-row="${i}" style="background:none;border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;font-size:14px;cursor:pointer;flex-shrink:0" title="Pick emoji">${r.emoji || '🏷️'}</button>
                                    <input type="text" class="ga-req-kw-custom-input" placeholder="Custom keyword..." style="flex:1;min-width:0;padding:4px 6px;font-size:12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)" data-row="${i}" />
                                    <button class="ga-req-kw-custom-add optimize-btn" data-row="${i}" style="width:auto;padding:3px 8px;font-size:11px;flex-shrink:0">Add</button>
                                </div>
                            </div>
                        </div>
                        <span>×</span><input type="number" class="ga-req-count" value="${r.count || 1}" min="1" max="10" style="width:48px" inputmode="numeric" />
                    `;
            } else if (r.type === 'skill') {
                const skillDisplay = r.skill ? r.skill.charAt(0).toUpperCase() + r.skill.slice(1) : 'Select skill...';
                const skillItems = ALL_SKILLS.map(s => {
                    const sid = s.toLowerCase();
                    return `<div class="ga-req-dd-item ga-req-skill-item" data-value="${sid}" data-row="${i}">${skillIcon(s)}<span>${s}</span></div>`;
                }).join('');
                fields = `
                        <div class="ga-req-skill-cell" style="position:relative;flex:1">
                            <div class="ga-req-dd-btn ga-req-skill-btn" data-row="${i}">${skillIcon(skillDisplay)}<span class="ga-req-dd-val">${skillDisplay}</span><span class="expand-arrow">▼</span></div>
                            <div class="ga-req-dd-dropdown ga-req-skill-dd" style="display:none">${skillItems}</div>
                        </div>
                        <span>Lv</span><input type="number" class="ga-req-level" value="${r.level || 1}" min="1" max="99" style="width:52px" />
                    `;
            } else if (r.type === 'reputation') {
                const factionDisplay = r.faction ? r.faction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Select faction...';
                const factionItems = FACTIONS.map(f => {
                    const label = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    return `<div class="ga-req-dd-item ga-req-faction-item" data-value="${f}" data-row="${i}">${label}</div>`;
                }).join('');
                fields = `
                        <div class="ga-req-faction-cell" style="position:relative;flex:1">
                            <div class="ga-req-dd-btn ga-req-faction-btn" data-row="${i}"><span class="ga-req-dd-val">${factionDisplay}</span><span class="expand-arrow">▼</span></div>
                            <div class="ga-req-dd-dropdown ga-req-faction-dd" style="display:none">${factionItems}</div>
                        </div>
                        <span>≥</span><input type="number" class="ga-req-amount" value="${r.amount || 1}" min="1" style="width:60px" />
                    `;
            } else if (r.type === 'achievement_points') {
                fields = `<span>AP ≥</span><input type="number" class="ga-req-amount" value="${r.amount || 0}" min="0" style="width:70px" />`;
            } else if (r.type === 'input_keyword') {
                const kwDisplay = r.keyword || 'Select keyword...';
                const isCustomKw2 = r.keyword && this.customKeywordsFromDB.some(ck => ck.name.toLowerCase() === r.keyword.toLowerCase());
                const customKwData2 = isCustomKw2 ? this.customKeywordsFromDB.find(ck => ck.name.toLowerCase() === r.keyword.toLowerCase()) : null;
                const kwIconHtml = r.keyword ? (customKwData2 ? `<span style="font-size:14px;margin-right:2px;${window.emojiTintStyle(customKwData2.icon_color)}">${window.emojiForPlatform(customKwData2.icon || '🏷️')}</span>` : kwIcon(r.keyword)) : '';
                let kwItems = KNOWN_KEYWORDS.map(kw =>
                    `<div class="ga-req-dd-item ga-req-kw-item" data-value="${kw.value}" data-row="${i}">${kwIcon(kw.value)} ${kw.value}</div>`
                ).join('');
                const customKws2 = (this.customKeywordsFromDB || []).filter(ck => !KNOWN_KEYWORDS.some(k => k.value.toLowerCase() === ck.name.toLowerCase()));
                if (customKws2.length > 0) {
                    kwItems += `<div style="font-size:0.7rem;color:var(--text-muted);padding:6px 8px 2px;border-top:1px solid var(--border-color);margin-top:4px">Custom Keywords</div>`;
                    kwItems += customKws2.map(ck => {
                        const colorStyle = ck.icon_color ? `${window.emojiTintStyle(ck.icon_color)}` : '';
                        return `<div class="ga-req-dd-item ga-req-kw-item" data-value="${ck.name}" data-row="${i}"><span style="font-size:14px;margin-right:4px;${colorStyle}">${ck.icon || '🏷️'}</span><span>${ck.name}</span></div>`;
                    }).join('');
                }
                fields = `
                        <div class="ga-req-kw-cell" style="position:relative;flex:1">
                            <div class="ga-req-dd-btn ga-req-kw-btn" data-row="${i}"><span class="ga-req-dd-val">${kwIconHtml} ${kwDisplay}</span><span class="expand-arrow">▼</span></div>
                            <div class="ga-req-dd-dropdown ga-req-kw-dd" style="display:none">
                                <input type="text" class="ga-req-kw-search" placeholder="Search..." style="width:100%;box-sizing:border-box;padding:4px 6px;font-size:12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);margin-bottom:4px" />
                                <div class="ga-req-kw-list">${kwItems}</div>
                                <div style="border-top:1px solid var(--border-color);margin-top:4px;padding:4px 6px;display:flex;gap:4px;align-items:center">
                                    <button class="ga-req-kw-emoji-btn" data-row="${i}" style="background:none;border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;font-size:14px;cursor:pointer;flex-shrink:0" title="Pick emoji">${r.emoji || '🏷️'}</button>
                                    <input type="text" class="ga-req-kw-custom-input" placeholder="Custom keyword..." style="flex:1;min-width:0;padding:4px 6px;font-size:12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)" data-row="${i}" />
                                    <button class="ga-req-kw-custom-add optimize-btn" data-row="${i}" style="width:auto;padding:3px 8px;font-size:11px;flex-shrink:0">Add</button>
                                </div>
                            </div>
                        </div>
                        <span>×</span><input type="number" class="ga-req-count" value="${r.count || 1}" min="1" max="10" style="width:48px" />
                        <span style="font-size:11px;color:var(--text-secondary)">Lv</span><input type="number" class="ga-req-input-level" value="${r.input_level || 0}" min="0" max="99" style="width:48px" title="Minimum item level required (0 = any)" />
                        <label style="display:flex;align-items:center;gap:2px;font-size:11px;color:var(--text-secondary);white-space:nowrap" title="Optional input — not required"><input type="checkbox" class="ga-req-optional" ${r.optional ? 'checked' : ''} /> Opt</label>
                    `;
            } else if (r.type === 'input_item') {
                const itemDisplay = r.item_name || 'Enter item name...';
                fields = `
                        <input type="text" class="ga-req-input-item-name" value="${r.item_name || ''}" placeholder="Item name (e.g. Ectoplasm)" style="flex:1;padding:4px 6px;font-size:12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)" data-row="${i}" />
                        <span>×</span><input type="number" class="ga-req-count" value="${r.count || 1}" min="1" max="99" style="width:48px" />
                        <label style="display:flex;align-items:center;gap:2px;font-size:11px;color:var(--text-secondary);white-space:nowrap" title="Optional input — not required"><input type="checkbox" class="ga-req-optional" ${r.optional ? 'checked' : ''} /> Opt</label>
                    `;
            }

            const REQ_TYPES = [
                { value: '', label: 'Select type...' },
                { value: 'keyword', label: '🔑 Keyword (gear)' },
                { value: 'skill', label: '⚔️ Skill Level' },
                { value: 'reputation', label: '🏛️ Reputation' },
                { value: 'achievement_points', label: '⭐ Achievement Points' },
                { value: 'input_keyword', label: '📥 Input (keyword)' },
                { value: 'input_item', label: '📥 Input (item)' },
            ];
            const typeDisplay = REQ_TYPES.find(o => o.value === r.type)?.label || 'Select type...';
            const typeItems = REQ_TYPES.filter(o => o.value).map(o =>
                `<div class="ga-req-dd-item ga-req-type-item${o.value === r.type ? ' ga-req-dd-selected' : ''}" data-value="${o.value}" data-row="${i}">${o.label}</div>`
            ).join('');

            return `<div class="ga-req-row" data-index="${i}">
                    <div class="ga-req-type-cell" style="position:relative;min-width:160px">
                        <div class="ga-req-dd-btn ga-req-type-btn" data-row="${i}"><span class="ga-req-dd-val">${typeDisplay}</span><span class="expand-arrow">▼</span></div>
                        <div class="ga-req-dd-dropdown ga-req-type-dd" style="display:none">${typeItems}</div>
                    </div>
                    ${fields}
                    <button class="ga-req-remove" title="Remove">✕</button>
                </div>`;
        }).join('');
    }

    _syncRequirements() {
        // With custom dropdowns, type/keyword/skill/faction are already set in requirementRows
        // via click handlers. We just need to sync number inputs from the DOM.
        this.$element.find('.ga-req-row').each((idx, el) => {
            if (idx >= this.requirementRows.length) return;
            const r = this.requirementRows[idx];
            if (r.type === 'keyword') {
                r.count = parseInt($(el).find('.ga-req-count').val()) || 1;
            } else if (r.type === 'skill') {
                r.level = parseInt($(el).find('.ga-req-level').val()) || 1;
            } else if (r.type === 'reputation') {
                r.amount = parseInt($(el).find('.ga-req-amount').val()) || 1;
            } else if (r.type === 'achievement_points') {
                r.amount = parseInt($(el).find('.ga-req-amount').val()) || 0;
            } else if (r.type === 'input_keyword') {
                r.count = parseInt($(el).find('.ga-req-count').val()) || 1;
                r.input_level = parseInt($(el).find('.ga-req-input-level').val()) || 0;
                r.optional = $(el).find('.ga-req-optional').is(':checked');
            } else if (r.type === 'input_item') {
                r.item_name = $(el).find('.ga-req-input-item-name').val()?.trim() || '';
                r.count = parseInt($(el).find('.ga-req-count').val()) || 1;
                r.optional = $(el).find('.ga-req-optional').is(':checked');
            }
        });
    }

    _requirementsToJson() {
        this._syncRequirements();
        const result = { keyword_counts: {}, skill_requirements: {}, reputation: {}, achievement_points: 0, activity_completions: {}, input_items: [] };
        for (const r of this.requirementRows) {
            if (r.type === 'keyword' && r.keyword) {
                result.keyword_counts[r.keyword] = r.count || 1;
            } else if (r.type === 'skill' && r.skill) {
                result.skill_requirements[r.skill] = r.level || 1;
            } else if (r.type === 'reputation' && r.faction) {
                result.reputation[r.faction] = r.amount || 1;
            } else if (r.type === 'achievement_points') {
                result.achievement_points = r.amount || 0;
            } else if (r.type === 'input_keyword' && r.keyword) {
                const ii = { name: r.keyword, type: 'keyword', reference: r.keyword, quantity: r.count || 1 };
                if (r.input_level > 0) ii.level = r.input_level;
                if (r.optional) ii.optional = true;
                result.input_items.push(ii);
            } else if (r.type === 'input_item' && r.item_name) {
                const ii = { name: r.item_name, type: 'material', reference: r.item_name, quantity: r.count || 1 };
                if (r.optional) ii.optional = true;
                result.input_items.push(ii);
            }
        }
        if (!result.input_items.length) delete result.input_items;
        // Collect additional locations from dropdowns
        const extraLocs = [];
        for (const dd of this.additionalLocationDropdowns) {
            const loc = dd.getSelectedLocation();
            if (loc && loc.id) extraLocs.push(loc.id);
        }
        if (extraLocs.length) result.additional_locations = extraLocs;
        return JSON.stringify(result);
    }

    _jsonToRequirementRows(jsonStr) {
        let reqs;
        try {
            reqs = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : (jsonStr || {});
        } catch (e) { reqs = {}; }
        const rows = [];
        for (const [kw, count] of Object.entries(reqs.keyword_counts || {})) {
            rows.push({ type: 'keyword', keyword: kw, count });
        }
        for (const [skill, level] of Object.entries(reqs.skill_requirements || {})) {
            rows.push({ type: 'skill', skill, level });
        }
        for (const [faction, amount] of Object.entries(reqs.reputation || {})) {
            rows.push({ type: 'reputation', faction, amount });
        }
        if (reqs.achievement_points > 0) {
            rows.push({ type: 'achievement_points', amount: reqs.achievement_points });
        }
        for (const ii of (reqs.input_items || [])) {
            if (ii.type === 'keyword') {
                rows.push({ type: 'input_keyword', keyword: ii.name || ii.reference, count: ii.quantity || 1, input_level: ii.level || 0, optional: !!ii.optional });
            } else {
                rows.push({ type: 'input_item', item_name: ii.name, count: ii.quantity || 1, optional: !!ii.optional });
            }
        }
        return rows;
    }

    _jsonToSecondaryXpRows(jsonStr) {
        // secondary_xp_json is stored separately, but may also be passed as part of def
        return [];
    }

    _secondaryXpToJson() {
        this._syncSecondaryXp();
        const result = {};
        for (const r of this.secondaryXpRows) {
            if (r.skill && r.xp > 0) {
                result[r.skill.toLowerCase()] = r.xp;
            }
        }
        return JSON.stringify(result);
    }

    _openSecXpSkillDropdown($btn, $dd) {
        // Close any existing floating dropdown
        $('.ga-req-floating-dd').remove();
        $(document).off('click.ga-req-floating');

        const rect = $btn[0].getBoundingClientRect();
        const $floating = $('<div class="ga-req-floating-dd"></div>');
        $floating.html($dd.html());
        $floating.css({
            position: 'fixed', left: rect.left + 'px',
            width: Math.max(rect.width, 200) + 'px', maxHeight: '250px',
            overflowY: 'auto', zIndex: 99999,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        });
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        const openUp = spaceBelow < 250 && spaceAbove > spaceBelow;
        if (openUp) {
            $floating.css('bottom', (window.innerHeight - rect.top + 2) + 'px');
        } else {
            $floating.css('top', (rect.bottom + 2) + 'px');
        }
        $('body').append($floating);
        $floating.hide().slideDown(150);

        $floating.on('click', '.ga-sec-xp-skill-item', (ev) => {
            ev.stopPropagation();
            const val = $(ev.currentTarget).data('value');
            const row = this._secXpActiveRow;
            this._syncSecondaryXp();
            if (this.secondaryXpRows[row]) this.secondaryXpRows[row].skill = val;
            this.$element.find('.ga-sec-xp-rows').html(this._renderSecondaryXpRows());
            $floating.slideUp(150, () => $floating.remove());
            $btn.data('ga-sec-xp-open', false);
            $btn.find('.expand-arrow').removeClass('expanded');
            $(document).off('click.ga-sec-xp-floating');
        });

        setTimeout(() => {
            $(document).one('click.ga-sec-xp-floating', () => {
                $floating.slideUp(150, () => $floating.remove());
                $btn.data('ga-sec-xp-open', false);
                $btn.find('.expand-arrow').removeClass('expanded');
            });
        }, 10);
    }

    _syncSecondaryXp() {
        this.$element.find('.ga-sec-xp-row').each((idx, el) => {
            if (idx >= this.secondaryXpRows.length) return;
            this.secondaryXpRows[idx].xp = parseFloat($(el).find('.ga-sec-xp-value').val()) || 0;
        });
    }

    _renderSecondaryXpRows() {
        const ALL_SKILLS = ['Agility', 'Carpentry', 'Cooking', 'Crafting', 'Fishing', 'Foraging', 'Hunting', 'Mining', 'Smithing', 'Tailoring', 'Trinketry', 'Woodcutting'];
        const primary = (this.selectedSkill || '').toLowerCase();
        const usedSkills = new Set(this.secondaryXpRows.map(r => (r.skill || '').toLowerCase()));
        usedSkills.add(primary);

        return this.secondaryXpRows.map((r, i) => {
            const skillDisplay = r.skill ? `${skillIcon(r.skill.charAt(0).toUpperCase() + r.skill.slice(1))} ${r.skill.charAt(0).toUpperCase() + r.skill.slice(1)}` : 'Select skill...';
            // Build skill items excluding primary and already-selected
            const excludeSet = new Set([primary, ...this.secondaryXpRows.filter((_, j) => j !== i).map(x => (x.skill || '').toLowerCase())]);
            let skillItems = '';
            for (const s of ALL_SKILLS) {
                if (excludeSet.has(s.toLowerCase())) continue;
                skillItems += `<div class="ga-req-dd-item ga-sec-xp-skill-item" data-value="${s.toLowerCase()}" data-row="${i}">${skillIcon(s)} ${s}</div>`;
            }

            return `<div class="ga-sec-xp-row" data-index="${i}" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <div class="ga-req-kw-cell" style="position:relative;flex:1">
                    <div class="ga-sec-xp-skill-btn" data-row="${i}" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer"><span class="ga-req-dd-val" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${skillDisplay}</span><span class="expand-arrow">▼</span></div>
                    <div class="ga-req-dd-dropdown ga-sec-xp-skill-dd" style="display:none">${skillItems}</div>
                </div>
                <input type="number" class="ga-sec-xp-value" value="${r.xp || ''}" min="0" step="0.1" inputmode="decimal" placeholder="XP" style="width:70px" />
                <button class="ga-sec-xp-remove" data-row="${i}" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:16px" title="Remove">✕</button>
            </div>`;
        }).join('');
    }

    render() {
        // Destroy old location dropdowns before re-rendering
        if (this.locationDropdown) { this.locationDropdown.destroy(); this.locationDropdown = null; }
        if (this.currentLocationDropdown) { this.currentLocationDropdown.destroy(); this.currentLocationDropdown = null; }
        for (const dd of this.additionalLocationDropdowns) { dd.destroy(); }
        this.additionalLocationDropdowns = [];

        const isObs = this.inputMode === 'observed';
        const modeLabel = isObs ? 'Observed' : 'Known Base';
        const otherModeLabel = isObs ? 'Known Base' : 'Observed';

        const btnLabel = isObs ? 'Calculate' : '💾 Save';

        const html = `
            <div class="generic-activity-form activity-info-section">
                <div class="activity-info-header ga-collapse-header">
                    <span class="activity-info-title">🔧 Generic Activity</span>
                    <span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>
                </div>
                <div class="activity-info-content" style="display: ${this.isExpanded ? 'block' : 'none'}">
                    <div class="ga-row ga-saved-selector">
                        <label>Saved Definitions</label>
                        <div class="ga-saved-button">
                            <div class="ga-saved-value">${this._getSelectedDefName()}</div>
                            <button class="ga-saved-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="ga-saved-dropdown" style="display:none"></div>
                        <label class="ga-checkbox-label ga-community-row">
                            <input type="checkbox" id="ga-show-community" ${this.showCommunity ? 'checked' : ''} />
                            Show community definitions
                        </label>
                    </div>

                    ${this.currentDefId ? `<div class="ga-row" style="margin-bottom:var(--spacing-xs)"><button class="btn-view-generic optimize-btn" style="font-size:14px;background:#2196F3;width:100%">View Activity Info</button></div>` : ''}

                    <div class="ga-row ga-name-row">
                        <div class="ga-icon-picker">
                            <button class="ga-icon-btn" title="Click to pick icon" ${this.selectedIconColor ? `style="${window.emojiTintStyle(this.selectedIconColor)}"` : ''}>${window.emojiForPlatform(this.selectedIcon)}</button>
                            <div class="ga-icon-popup" style="display:none">
                                <div class="ga-icon-defaults">
                                    ${EMOJI_OPTIONS.map(e => `<span class="ga-emoji-option ${e === this.selectedIcon ? 'selected' : ''}" data-emoji="${e}">${e}</span>`).join('')}
                                </div>
                                <div style="display:flex;align-items:center;gap:6px;padding:4px 8px">
                                    <label style="font-size:12px;color:var(--text-secondary)">Tint:</label>
                                    <input type="color" class="ga-icon-color" value="${this.selectedIconColor || '#ffffff'}" style="width:32px;height:24px;border:none;cursor:pointer" />
                                    <button class="ga-color-clear" style="background:none;border:1px solid var(--border-color);border-radius:4px;color:var(--text-secondary);font-size:11px;padding:2px 6px;cursor:pointer">Clear</button>
                                </div>
                                <emoji-picker class="ga-full-picker"></emoji-picker>
                            </div>
                        </div>
                        <div class="ga-name-field">
                            <label>Name</label>
                            <input type="text" id="ga-name" value="${this._populatedName || ''}" />
                        </div>
                    </div>

                    <div class="ga-row ga-skill-selector">
                        <label>Skill</label>
                        <div class="ga-skill-button">
                            <div class="ga-skill-value">${this._getSelectedSkillDisplay()}</div>
                            <button class="ga-skill-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="ga-skill-dropdown" style="display:none"></div>
                    </div>

                    <div class="ga-row ga-locations-section">
                        <label>Locations</label>
                        <div id="ga-location-dropdown"></div>
                        <div class="ga-additional-locations">${this.additionalLocations.map((_, idx) => `<div class="ga-extra-loc-row" data-loc-idx="${idx}" style="display:flex;align-items:center;gap:4px;margin-top:4px"><div class="ga-extra-loc-dd" style="flex:1"></div><button class="ga-remove-loc" data-loc-idx="${idx}" title="Remove" style="background:none;border:1px solid var(--border-color);border-radius:4px;color:var(--text-secondary);cursor:pointer;padding:2px 6px;font-size:12px">✕</button></div>`).join('')}</div>
                        <button class="ga-add-location optimize-btn" style="width:auto;padding:4px 12px;font-size:12px;margin-top:var(--spacing-xs)">+ Add Location</button>
                    </div>

                    <div class="ga-row ga-mode-row">
                        <span>Input Mode: <strong class="ga-mode-label">${modeLabel}</strong></span>
                        <button class="btn-toggle-mode optimize-btn" style="width:auto;padding:6px 12px;font-size:13px">Switch to ${otherModeLabel}</button>
                    </div>

                    <div class="ga-row ga-current-loc-row" style="${isObs ? '' : 'display:none'}">
                        <div class="ga-current-loc-header">
                            <label>Current Location</label>
                            <button class="btn-copy-location optimize-btn" style="width:auto;padding:3px 10px;font-size:12px">📋 Same as activity</button>
                        </div>
                        <div class="ga-helper-text">Your in-game location for collectible lookup</div>
                        <div id="ga-current-loc-dropdown"></div>
                    </div>

                    <div class="ga-observed-fields" style="${isObs ? '' : 'display:none'}">
                        <div class="ga-row"><label>Observed Steps</label><div class="ga-helper-text">Steps shown in-game with no gear</div><input type="number" id="ga-obs-steps" min="1" inputmode="numeric" pattern="[0-9]*" /></div>
                        <div class="ga-row"><label>Observed XP</label><div class="ga-helper-text">XP shown in-game with no gear</div><input type="number" id="ga-obs-xp" min="0" step="0.1" inputmode="decimal" /></div>
                    </div>

                    <div class="ga-known-fields" style="${isObs ? 'display:none' : ''}">
                        <div class="ga-row"><label>Base Steps</label><div class="ga-helper-text">True base steps if already known</div><input type="number" id="ga-base-steps" min="1" inputmode="numeric" pattern="[0-9]*" value="${this._populatedBaseSteps || ''}" /></div>
                        <div class="ga-row"><label>Base XP</label><div class="ga-helper-text">True base XP if already known</div><input type="number" id="ga-base-xp" min="0" step="0.1" inputmode="decimal" value="${this._populatedBaseXp || ''}" /></div>
                    </div>

                    <div class="ga-row ga-sec-xp-section">
                        <label>Secondary Skill XP</label>
                        <div class="ga-sec-xp-rows">${this._renderSecondaryXpRows()}</div>
                        <button class="ga-add-sec-xp optimize-btn" style="width:auto;padding:4px 14px;font-size:12px;margin-top:var(--spacing-xs)">+ Add Skill XP</button>
                    </div>

                    <div class="ga-row">
                        <label>Max Efficiency</label>
                        <div class="ga-helper-text">Max WE shown in-game, e.g. 180% means 80% WE cap</div>
                        <div class="ga-slider-row">
                            <input type="range" id="ga-max-eff-slider" min="100" max="350" step="5" value="${this._populatedMaxEff || 160}" class="ga-slider" />
                            <div class="ga-slider-input-wrap">
                                <input type="number" id="ga-max-eff" min="100" value="${this._populatedMaxEff || 160}" class="ga-slider-input" />
                                <span class="ga-slider-pct">%</span>
                            </div>
                        </div>
                        <div class="ga-tick-container ga-tick-we"><div class="ga-tick-big" style="left:0.0%"><span class="ga-tick-label">100</span></div><div class="ga-tick-small" style="left:10.0%"></div><div class="ga-tick-big" style="left:20.0%"><span class="ga-tick-label">150</span></div><div class="ga-tick-small" style="left:30.0%"></div><div class="ga-tick-big" style="left:40.0%"><span class="ga-tick-label">200</span></div><div class="ga-tick-small" style="left:50.0%"></div><div class="ga-tick-big" style="left:60.0%"><span class="ga-tick-label">250</span></div><div class="ga-tick-small" style="left:70.0%"></div><div class="ga-tick-big" style="left:80.0%"><span class="ga-tick-label">300</span></div><div class="ga-tick-small" style="left:90.0%"></div><div class="ga-tick-big" style="left:100.0%"><span class="ga-tick-label">350</span></div></div>
                    </div>

                    <div class="ga-row">
                        <label>Required Level</label>
                        <div class="ga-slider-row">
                            <input type="range" id="ga-req-level-slider" min="1" max="99" step="1" value="${this._populatedReqLevel || 1}" class="ga-slider" />
                            <div class="ga-slider-input-wrap">
                                <input type="number" id="ga-req-level" min="1" max="99" value="${this._populatedReqLevel || 1}" class="ga-slider-input" />
                            </div>
                        </div>
                        <div class="ga-tick-container ga-tick-level"><div class="ga-tick-small" style="left:4.1%"></div><div class="ga-tick-big" style="left:9.2%"><span class="ga-tick-label">10</span></div><div class="ga-tick-small" style="left:14.3%"></div><div class="ga-tick-big" style="left:19.4%"><span class="ga-tick-label">20</span></div><div class="ga-tick-small" style="left:24.5%"></div><div class="ga-tick-big" style="left:29.6%"><span class="ga-tick-label">30</span></div><div class="ga-tick-small" style="left:34.7%"></div><div class="ga-tick-big" style="left:39.8%"><span class="ga-tick-label">40</span></div><div class="ga-tick-small" style="left:44.9%"></div><div class="ga-tick-big" style="left:50.0%"><span class="ga-tick-label">50</span></div><div class="ga-tick-small" style="left:55.1%"></div><div class="ga-tick-big" style="left:60.2%"><span class="ga-tick-label">60</span></div><div class="ga-tick-small" style="left:65.3%"></div><div class="ga-tick-big" style="left:70.4%"><span class="ga-tick-label">70</span></div><div class="ga-tick-small" style="left:75.5%"></div><div class="ga-tick-big" style="left:80.6%"><span class="ga-tick-label">80</span></div><div class="ga-tick-small" style="left:85.7%"></div><div class="ga-tick-big" style="left:90.8%"><span class="ga-tick-label">90</span></div><div class="ga-tick-small" style="left:95.9%"></div></div>
                    </div>

                    <div class="ga-row ga-req-section">
                        <label>Requirements</label>
                        <div class="ga-helper-text">Gear keywords, reputation, activity inputs, etc.</div>
                        <div class="ga-req-rows">${this._renderRequirementRows()}</div>
                        <button class="ga-add-req optimize-btn" style="width:auto;padding:4px 12px;font-size:12px;margin-top:var(--spacing-xs)">+ Add Requirement</button>
                    </div>

                    <div class="ga-row">
                        <label class="ga-checkbox-label">
                            <input type="checkbox" id="ga-share" checked />
                            Share with others
                        </label>
                    </div>

                    <div class="ga-reverse-result-container">${this._renderReverseResult()}</div>

                    <div class="ga-actions">
                        <button class="btn-save-generic optimize-btn" style="font-size:14px">${btnLabel}</button>
                        ${this.currentDefId ? '<button class="btn-delete-generic optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>' : ''}
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);

        // Create location dropdowns — always create both since both are in the DOM
        this.locationDropdown = new LocationDropdown(
            this.$element.find('#ga-location-dropdown'),
            { label: 'Activity', onSelect: () => { }, selectedLocation: this._populatedLocation || null }
        );
        // Create additional location dropdowns
        this.additionalLocationDropdowns = [];
        this.$element.find('.ga-extra-loc-dd').each((idx, el) => {
            const dd = new LocationDropdown($(el), {
                label: `Location ${idx + 2}`,
                onSelect: () => { },
                selectedLocation: this.additionalLocations[idx] || null
            });
            this.additionalLocationDropdowns.push(dd);
        });
        this.currentLocationDropdown = new LocationDropdown(
            this.$element.find('#ga-current-loc-dropdown'),
            { label: 'Current', onSelect: () => { } }
        );

        this.attachEvents();
    }

    attachEvents() {
        this.$element.off('click.ga change.ga input.ga keydown.ga');
        $(document).off('click.ga-saved');

        // Collapsible header
        this.$element.on('click.ga', '.ga-collapse-header', (e) => {
            this.isExpanded = !this.isExpanded;
            const $content = this.$element.find('.activity-info-content');
            const $arrow = this.$element.find('.ga-collapse-header .expand-arrow');
            if (this.isExpanded) {
                $arrow.addClass('expanded');
                $content.slideDown(150);
            } else {
                $arrow.removeClass('expanded');
                $content.slideUp(150);
            }
        });

        // Slider ↔ text input sync for Max Efficiency
        const updateSliderFill = ($slider) => {
            const min = parseInt($slider.attr('min')), max = parseInt($slider.attr('max'));
            const pct = ((parseInt($slider.val()) - min) / (max - min)) * 100;
            $slider.css('--slider-pct', pct + '%');
        };
        this.$element.on('input.ga', '#ga-max-eff-slider', (e) => {
            this.$element.find('#ga-max-eff').val($(e.target).val());
            updateSliderFill($(e.target));
        });
        this.$element.on('input.ga', '#ga-max-eff', (e) => {
            // Sync slider without clamping (let user type freely)
            const val = parseInt($(e.target).val()) || 100;
            const $slider = this.$element.find('#ga-max-eff-slider');
            $slider.val(Math.min(val, 350));
            updateSliderFill($slider);
        });
        this.$element.on('blur.ga', '#ga-max-eff', (e) => {
            let val = parseInt($(e.target).val()) || 100;
            if (val < 100) { val = 100; $(e.target).val(100); }
        });
        // Init slider fill
        updateSliderFill(this.$element.find('#ga-max-eff-slider'));

        // Level slider ↔ text input sync
        this.$element.on('input.ga', '#ga-req-level-slider', (e) => {
            this.$element.find('#ga-req-level').val($(e.target).val());
        });
        this.$element.on('input.ga', '#ga-req-level', (e) => {
            // Sync slider without clamping
            const val = parseInt($(e.target).val()) || 1;
            this.$element.find('#ga-req-level-slider').val(Math.min(Math.max(val, 1), 99));
        });
        this.$element.on('blur.ga', '#ga-req-level', (e) => {
            let val = parseInt($(e.target).val()) || 1;
            if (val < 1) { val = 1; $(e.target).val(1); }
            if (val > 99) { val = 99; $(e.target).val(99); }
            this.$element.find('#ga-req-level-slider').val(val);
        });

        this.$element.on('click.ga', '.btn-toggle-mode', (e) => {
            e.preventDefault();
            this.toggleInputMode();
        });

        // Skill dropdown
        this.$element.on('click.ga', '.ga-skill-button', (e) => {
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
        this.$element.on('click.ga', '.ga-skill-item', (e) => {
            e.stopPropagation();
            this.selectedSkill = $(e.currentTarget).data('skill');
            this.skillDropdownOpen = false;
            this.$element.find('.ga-skill-dropdown').slideUp(200);
            this.$element.find('.ga-skill-toggle .expand-arrow').removeClass('expanded');
            this.$element.find('.ga-skill-value').html(this._getSelectedSkillDisplay());
        });

        // Custom saved definitions dropdown
        this.$element.on('click.ga', '.ga-saved-button', (e) => {
            e.stopPropagation();
            this.savedDropdownOpen = !this.savedDropdownOpen;
            const $dd = this.$element.find('.ga-saved-dropdown');
            const $arrow = this.$element.find('.ga-saved-toggle .expand-arrow');
            if (this.savedDropdownOpen) {
                this.savedSearchText = '';
                $dd.html(this._renderSavedDropdownItems());
                $arrow.addClass('expanded');
                $dd.slideDown(200);
                // Auto-focus search after slideDown
                setTimeout(() => $dd.find('.ga-saved-search').focus(), 160);
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(200);
            }
        });
        this.$element.on('input.ga', '.ga-saved-search', (e) => {
            e.stopPropagation();
            this.savedSearchText = $(e.target).val();
            // Only update the list, not the search input (preserves cursor position)
            const fullHtml = this._renderSavedDropdownItems();
            const $temp = $('<div>').html(fullHtml);
            this.$element.find('.ga-saved-list').html($temp.find('.ga-saved-list').html());
        });
        this.$element.on('keydown.ga', '.ga-saved-search', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const $list = this.$element.find('.ga-saved-list');
            const $items = $list.find('.ga-saved-item:visible, .ga-saved-skill-header:visible');
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
        this.$element.on('click.ga', '.ga-saved-skill-header', (e) => {
            e.stopPropagation();
            const skill = $(e.currentTarget).data('skill');
            const $categoryHeader = $(e.currentTarget);
            const $category = $categoryHeader.parent();
            if (!this._expandedSavedSkills) this._expandedSavedSkills = new Set();

            if (this._expandedSavedSkills.has(skill)) {
                // Collapse
                this._expandedSavedSkills.delete(skill);
                $categoryHeader.find('.expand-arrow').removeClass('expanded');
                $category.find('.ga-saved-item').slideUp(150, function () { $(this).remove(); });
            } else {
                // Expand
                this._expandedSavedSkills.add(skill);
                $categoryHeader.find('.expand-arrow').addClass('expanded');

                const search = (this.savedSearchText || '').toLowerCase();
                const isCommunitySkill = skill.startsWith('community::');
                const actualSkill = isCommunitySkill ? skill.replace('community::', '') : skill;
                const sourceList = isCommunitySkill ? this.communityDefs : this.savedDefs;
                const savedIds = new Set(this.savedDefs.map(d => d.id));
                const defs = sourceList.filter(d => {
                    const s = (d.skill || 'other').replace(/^\w/, c => c.toUpperCase());
                    if (isCommunitySkill && savedIds.has(d.id)) return false;
                    return s === actualSkill && (!search || d.name.toLowerCase().includes(search));
                });

                const itemsHtml = defs.map(def => {
                    const loc = def.location ? ' (' + def.location.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ')' : '';
                    const dataId = isCommunitySkill ? `community::${def.id}` : def.id;
                    const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                    return `<div class="ga-saved-item recipe-item" data-id="${dataId}" style="display:none"><span>${iconHtml} ${def.name}${loc}</span></div>`;
                }).join('');

                $category.append(itemsHtml);
                const $items = $category.find('.ga-saved-item');
                $items.slideDown(150);

                // Scroll category header to top of dropdown
                $items.first().promise().done(() => {
                    const $dropdown = this.$element.find('.ga-saved-list');
                    const headerOffset = $categoryHeader.position().top;
                    const headerHeight = $categoryHeader.outerHeight();
                    $dropdown.animate({ scrollTop: $dropdown.scrollTop() + headerOffset - headerHeight }, 200);
                });
            }
        });
        this.$element.on('click.ga', '.ga-saved-item', (e) => {
            e.stopPropagation();
            const defId = $(e.currentTarget).data('id') || '';
            this.savedDropdownOpen = false;
            this.savedSearchText = '';
            this.$element.find('.ga-saved-dropdown').slideUp(200);
            this.$element.find('.ga-saved-toggle .expand-arrow').removeClass('expanded');

            // Hide the info section when switching definitions
            const $info = $('#activity-recipe-info');
            if ($info.children().length) {
                $info.slideUp(150, () => {
                    store.state.column3.selectedActivity = 'generic';
                    store._notifySubscribers('column3.selectedActivity');
                    $info.slideDown(0);
                });
            }

            if (!defId) {
                this.currentDefId = null;
                this.inputMode = 'observed';
                this.reverseResult = null;
                this.selectedIcon = '⚡';
                this.selectedIconColor = null;
                this.selectedSkill = '';
                this.requirementRows = [];
                this.secondaryXpRows = [];
                this._populatedName = '';
                this._populatedBaseSteps = '';
                this._populatedBaseXp = '';
                this._populatedMaxEff = 160;
                this._populatedReqLevel = 1;
                this._populatedIsPublic = true;
                this._populatedLocation = '';
                this._populatedSecondaryXp = [];
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
        this.$element.on('change.ga', '#ga-show-community', () => this.toggleCommunity());

        // Requirements
        this.$element.on('click.ga', '.ga-add-req', (e) => {
            e.preventDefault();
            this._syncRequirements();
            this.requirementRows.push({ type: '' });
            this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
            this.$element.find('.ga-req-row').last().hide().slideDown(150);
        });

        // Add/remove additional locations
        this.$element.on('click.ga', '.ga-add-location', (e) => {
            e.preventDefault();
            this.additionalLocations.push('');
            const idx = this.additionalLocations.length - 1;
            const rowHtml = `<div class="ga-extra-loc-row" data-loc-idx="${idx}" style="display:none;align-items:center;gap:4px;margin-top:4px"><div class="ga-extra-loc-dd" style="flex:1"></div><button class="ga-remove-loc" data-loc-idx="${idx}" title="Remove" style="background:none;border:1px solid var(--border-color);border-radius:4px;color:var(--text-secondary);cursor:pointer;padding:2px 6px;font-size:12px">✕</button></div>`;
            this.$element.find('.ga-additional-locations').append(rowHtml);
            const $newRow = this.$element.find(`.ga-extra-loc-row[data-loc-idx="${idx}"]`);
            const dd = new LocationDropdown($newRow.find('.ga-extra-loc-dd'), {
                label: `Location ${idx + 2}`,
                onSelect: () => { }
            });
            this.additionalLocationDropdowns.push(dd);
            $newRow.css('display', 'flex').hide().slideDown(150);
        });
        this.$element.on('click.ga', '.ga-remove-loc', (e) => {
            e.preventDefault();
            const idx = parseInt($(e.currentTarget).data('loc-idx'));
            const $row = $(e.currentTarget).closest('.ga-extra-loc-row');
            $row.slideUp(150, () => {
                $row.remove();
                if (this.additionalLocationDropdowns[idx]) {
                    this.additionalLocationDropdowns[idx].destroy();
                }
                this.additionalLocations.splice(idx, 1);
                this.additionalLocationDropdowns.splice(idx, 1);
                // Re-index remaining rows
                this.$element.find('.ga-extra-loc-row').each((i, el) => {
                    $(el).attr('data-loc-idx', i);
                    $(el).find('.ga-remove-loc').attr('data-loc-idx', i);
                });
            });
        });
        this.$element.on('click.ga', '.ga-req-remove', (e) => {
            e.preventDefault();
            const $row = $(e.currentTarget).closest('.ga-req-row');
            $row.slideUp(150, () => {
                const idx = $row.data('index');
                this._syncRequirements();
                this.requirementRows.splice(idx, 1);
                this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
            });
        });

        // Secondary skill XP
        this.$element.on('click.ga', '.ga-add-sec-xp', (e) => {
            e.preventDefault();
            this._syncSecondaryXp();
            this.secondaryXpRows.push({ skill: '', xp: 0 });
            this.$element.find('.ga-sec-xp-rows').html(this._renderSecondaryXpRows());
            this.$element.find('.ga-sec-xp-row').last().hide().slideDown(150);
        });
        this.$element.on('click.ga', '.ga-sec-xp-remove', (e) => {
            e.preventDefault();
            const $row = $(e.currentTarget).closest('.ga-sec-xp-row');
            $row.slideUp(150, () => {
                const idx = parseInt($row.data('index'));
                this._syncSecondaryXp();
                this.secondaryXpRows.splice(idx, 1);
                this.$element.find('.ga-sec-xp-rows').html(this._renderSecondaryXpRows());
            });
        });
        // Secondary XP skill dropdown — reuse the floating dropdown pattern from requirements
        this.$element.on('click.ga', '.ga-sec-xp-skill-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._secXpActiveRow = parseInt($btn.data('row'));
            const $dd = $btn.siblings('.ga-sec-xp-skill-dd');

            // Toggle: if already open, close it
            if ($btn.data('ga-sec-xp-open')) {
                $('.ga-req-floating-dd').slideUp(150, function () { $(this).remove(); });
                $btn.data('ga-sec-xp-open', false);
                $btn.find('.expand-arrow').removeClass('expanded');
                $(document).off('click.ga-sec-xp-floating');
                return;
            }

            // Close any existing floating dropdowns
            $('.ga-req-floating-dd').remove();
            $(document).off('click.ga-req-floating');
            $(document).off('click.ga-sec-xp-floating');

            this._openSecXpSkillDropdown($btn, $dd);
            $btn.data('ga-sec-xp-open', true);
            $btn.find('.expand-arrow').addClass('expanded');
        });
        // Custom dropdown toggles for requirements — body-appended floating dropdowns
        this.$element.on('click.ga', '.ga-req-dd-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const $dd = $btn.next('.ga-req-dd-dropdown');

            // Close any existing floating req dropdown
            $('.ga-req-floating-dd').slideUp(150, function () { $(this).remove(); });

            // If was already open, just close
            if ($btn.data('ga-req-open')) {
                $btn.data('ga-req-open', false);
                $btn.find('.expand-arrow').removeClass('expanded');
                return;
            }

            // Close all other buttons' open state
            this.$element.find('.ga-req-dd-btn').data('ga-req-open', false).find('.expand-arrow').removeClass('expanded');

            // Create floating dropdown appended to body
            const rect = $btn[0].getBoundingClientRect();
            const $floating = $('<div class="ga-req-floating-dd"></div>');
            $floating.html($dd.html());
            const maxH = 250;
            const spaceBelow = window.innerHeight - rect.bottom - 10;
            const spaceAbove = rect.top - 10;
            const openUp = spaceBelow < maxH && spaceAbove > spaceBelow;
            $floating.css({
                position: 'fixed',
                left: rect.left + 'px',
                width: Math.max(rect.width, 200) + 'px',
                minWidth: '200px',
                maxHeight: Math.min(maxH, openUp ? spaceAbove : spaceBelow) + 'px',
                overflowY: 'auto',
                zIndex: 99999,
                padding: '4px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            });
            if (openUp) {
                $floating.css('bottom', (window.innerHeight - rect.top + 2) + 'px');
            } else {
                $floating.css('top', (rect.bottom + 2) + 'px');
            }
            $('body').append($floating);
            $floating.hide().slideDown(150);
            $btn.data('ga-req-open', true);
            $btn.find('.expand-arrow').addClass('expanded');

            // Proxy clicks from floating dropdown to the real items
            $floating.on('click', '.ga-req-dd-item', (ev) => {
                ev.stopPropagation();
                const $item = $(ev.currentTarget);
                // Find the matching item class and trigger the right handler
                const val = $item.data('value');
                const row = $item.data('row');
                if ($item.hasClass('ga-req-type-item')) {
                    this._syncRequirements();
                    if (this.requirementRows[row]) this.requirementRows[row] = { type: val };
                    this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
                } else if ($item.hasClass('ga-req-kw-item')) {
                    this._syncRequirements();
                    if (this.requirementRows[row]) this.requirementRows[row].keyword = val;
                    this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
                } else if ($item.hasClass('ga-req-skill-item')) {
                    this._syncRequirements();
                    if (this.requirementRows[row]) this.requirementRows[row].skill = val;
                    this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
                } else if ($item.hasClass('ga-req-faction-item')) {
                    this._syncRequirements();
                    if (this.requirementRows[row]) this.requirementRows[row].faction = val;
                    this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
                }
                $floating.slideUp(150, () => $floating.remove());
                $btn.data('ga-req-open', false);
                $btn.find('.expand-arrow').removeClass('expanded');
            });

            // Keyword search filter inside floating dropdown
            $floating.on('input', '.ga-req-kw-search', (ev) => {
                ev.stopPropagation();
                const q = $(ev.target).val().toLowerCase();
                $floating.find('.ga-req-kw-item').each(function () {
                    const val = $(this).data('value').toLowerCase();
                    $(this).toggle(!q || val.includes(q));
                });
            });
            // Custom keyword add
            $floating.on('click', '.ga-req-kw-custom-add', (ev) => {
                ev.stopPropagation();
                const row = $(ev.currentTarget).data('row');
                const val = $floating.find('.ga-req-kw-custom-input').val().trim();
                if (!val) return;
                // Get emoji and color from the emoji picker button
                const emoji = $floating.find('.ga-req-kw-emoji-btn').text().trim() || '🏷️';
                const emojiColor = this.requirementRows[row]?.emojiColor || null;
                // Save custom keyword to DB
                api.saveCustomKeyword(val, emoji, false, emojiColor).then(() => this._loadCustomKeywords()).catch(e => console.error('Failed to save custom keyword:', e));
                this._syncRequirements();
                if (this.requirementRows[row]) {
                    this.requirementRows[row].keyword = val;
                    this.requirementRows[row].emoji = emoji;
                    this.requirementRows[row].emojiColor = emojiColor;
                }
                this.$element.find('.ga-req-rows').html(this._renderRequirementRows());
                $floating.remove();
                $btn.data('ga-req-open', false);
                $btn.find('.expand-arrow').removeClass('expanded');
            });
            $floating.on('keydown', '.ga-req-kw-custom-input', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    $floating.find('.ga-req-kw-custom-add').trigger('click');
                }
            });
            // Emoji picker for custom keyword — full picker (same as icon picker)
            $floating.on('click', '.ga-req-kw-emoji-btn', (ev) => {
                ev.stopPropagation();
                $('.ga-req-kw-emoji-floating').remove();
                $(document).off('click.ga-req-kw-emoji');

                const $emojiBtn = $(ev.currentTarget);
                const row = $emojiBtn.data('row');
                const currentEmoji = this.requirementRows[row]?.emoji || '🏷️';
                const quickGrid = EMOJI_OPTIONS.map(em =>
                    `<span class="ga-req-kw-emoji-opt ${em === currentEmoji ? 'selected' : ''}" data-emoji="${em}" data-row="${row}" style="font-size:20px;cursor:pointer;padding:3px;display:inline-block">${em}</span>`
                ).join('');
                const pickerHtml = `
                    <div style="display:flex;flex-wrap:wrap;gap:2px;padding:8px">${quickGrid}</div>
                    <div style="display:flex;align-items:center;gap:6px;padding:4px 8px">
                        <label style="font-size:12px;color:var(--text-secondary)">Tint:</label>
                        <input type="color" class="ga-req-kw-emoji-color" value="${this.requirementRows[row]?.emojiColor || '#ffffff'}" style="width:32px;height:24px;border:none;cursor:pointer" />
                        <button class="ga-req-kw-emoji-color-clear" style="background:none;border:1px solid var(--border-color);border-radius:4px;color:var(--text-secondary);font-size:11px;padding:2px 6px;cursor:pointer">Clear</button>
                    </div>
                    <emoji-picker class="ga-req-kw-full-picker"></emoji-picker>`;
                const $picker = $('<div class="ga-req-kw-emoji-floating"></div>').html(pickerHtml);
                $picker.css({ position: 'fixed', 'z-index': 200000, width: '340px', 'max-height': '70vh', 'overflow-y': 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', 'border-radius': '8px', 'box-shadow': '0 8px 32px rgba(0,0,0,0.5)', visibility: 'hidden', display: 'block' });
                $('body').append($picker);
                const rect = ev.currentTarget.getBoundingClientRect();
                const ph = Math.min($picker[0].scrollHeight, window.innerHeight * 0.7);
                const spaceBelow = window.innerHeight - rect.bottom - 8;
                const spaceAbove = rect.top - 8;
                let top = spaceBelow >= ph || spaceBelow >= spaceAbove ? rect.bottom + 4 : rect.top - Math.min(ph, spaceAbove) - 4;
                let left = rect.left;
                if (left + 340 > window.innerWidth) left = window.innerWidth - 348;
                if (left < 4) left = 4;
                $picker.css({ top: top + 'px', left: left + 'px', visibility: '', display: 'none' });
                $picker.slideDown(150);
                $picker.on('click', '.ga-req-kw-emoji-opt', (ev2) => {
                    ev2.stopPropagation();
                    const emoji = $(ev2.currentTarget).data('emoji');
                    const color = this.requirementRows[row]?.emojiColor || null;
                    const style = color ? `${window.emojiTintStyle(color)}` : '';
                    $emojiBtn.text(emoji).attr('style', style || '');
                    if (this.requirementRows[row]) this.requirementRows[row].emoji = emoji;
                    $picker.slideUp(100, () => $picker.remove());
                    $(document).off('click.ga-req-kw-emoji');
                });
                $picker.on('input', '.ga-req-kw-emoji-color', (ev2) => {
                    const color = $(ev2.target).val();
                    if (this.requirementRows[row]) this.requirementRows[row].emojiColor = color;
                    $emojiBtn.css(window.emojiTintCSS(color));
                });
                $picker.on('click', '.ga-req-kw-emoji-color-clear', () => {
                    if (this.requirementRows[row]) this.requirementRows[row].emojiColor = null;
                    $emojiBtn.css(window.emojiTintCSS(null));
                    $picker.find('.ga-req-kw-emoji-color').val('#ffffff');
                });
                const fpEl = $picker.find('emoji-picker')[0];
                if (fpEl) fpEl.addEventListener('emoji-click', (ev2) => {
                    const emoji = ev2.detail.unicode;
                    const color = this.requirementRows[row]?.emojiColor || null;
                    const style = color ? `${window.emojiTintStyle(color)}` : '';
                    $emojiBtn.text(emoji).attr('style', style || '');
                    if (this.requirementRows[row]) this.requirementRows[row].emoji = emoji;
                    $picker.slideUp(100, () => $picker.remove());
                    $(document).off('click.ga-req-kw-emoji');
                });
                setTimeout(() => {
                    $(document).one('click.ga-req-kw-emoji', (ev2) => {
                        if ($(ev2.target).closest('.ga-req-kw-emoji-floating, .ga-req-kw-emoji-btn').length) return;
                        $picker.slideUp(100, () => $picker.remove());
                    });
                }, 10);
            });
            // Focus search if it exists
            const $search = $floating.find('.ga-req-kw-search');
            if ($search.length) setTimeout(() => $search.focus(), 160);

            // Close on outside click
            setTimeout(() => {
                $(document).one('click.ga-req-floating', (ev) => {
                    if ($(ev.target).closest('.ga-req-floating-dd, .ga-req-dd-btn').length) return;
                    $floating.slideUp(150, () => $floating.remove());
                    $btn.data('ga-req-open', false);
                    $btn.find('.expand-arrow').removeClass('expanded');
                });
            }, 10);
        });

        this.$element.on('click.ga', '.btn-save-generic', (e) => {
            e.preventDefault();
            this.submitForm();
        });

        this.$element.on('click.ga', '.btn-view-generic', (e) => {
            e.preventDefault();
            if (!this.currentDefId) return;
            store.state.column3.selectedActivity = `generic::${this.currentDefId}`;
            store._notifySubscribers('column3.selectedActivity');
            // Smooth scroll to the info section
            setTimeout(() => {
                const $info = $('#activity-recipe-info');
                if ($info.length) {
                    const headerHeight = $('header').outerHeight() || 60;
                    $('html, body').animate({ scrollTop: $info.offset().top - headerHeight - 8 }, 300);
                }
            }, 200);
        });

        this.$element.on('click.ga', '.btn-delete-generic', (e) => {
            e.preventDefault();
            this.deleteDefinition();
        });

        this.$element.on('click.ga', '.btn-pick-candidate', (e) => {
            e.preventDefault();
            const steps = parseInt($(e.currentTarget).data('steps'));
            const data = this._readForm();
            data.base_steps = steps;

            // Check if XP is ambiguous — show XP picker instead of saving
            const xp = this.reverseResult?.xp_result;
            if (xp && xp.ambiguous && xp.candidates && xp.candidates.length > 1) {
                this.reverseResult.ambiguous = false;
                this.reverseResult.base_steps = steps;
                this.reverseResult.computed_xp = null; // Not yet resolved
                this.$element.find('.ga-reverse-result-container').html(this._renderReverseResult());
                return;
            }

            // XP resolved or no XP — save
            if (xp && xp.base_xp != null) {
                data.base_xp = xp.base_xp;
            } else if (data.observed_xp) {
                data.base_xp = data.observed_xp;
            }
            this._saveDefinition(data);
        });

        this.$element.on('click.ga', '.btn-pick-xp-candidate', (e) => {
            e.preventDefault();
            const xpVal = parseInt($(e.currentTarget).data('xp'));
            const data = this._readForm();
            data.base_steps = this.reverseResult.base_steps;
            data.base_xp = xpVal;
            this._saveDefinition(data);
        });

        this.$element.on('click.ga', '.btn-calibrate-xp', async (e) => {
            e.preventDefault();
            const xp = this.reverseResult?.xp_result;
            if (!xp || !xp.candidates) return;

            try {
                const data = this._readForm();
                const result = await api.getXpCalibrationGearset({
                    skill: data.skill,
                    location: data.location,
                });
                if (result.error) {
                    api.showError(result.error);
                    return;
                }

                const gearXpPct = result.total_bonus_xp_pct || 0;
                const gearXpAdd = result.total_bonus_xp_add || 0;
                const collectibleXpPct = xp.bonus_xp_pct || 0;
                const collectibleXpAdd = xp.bonus_xp_add || 0;
                const totalXpPct = collectibleXpPct + gearXpPct;
                const totalXpAdd = collectibleXpAdd + gearXpAdd;

                const itemsList = result.items.map(i => `<div style="padding:2px 0">${i.name} (Bonus XP: ${(i.bonus_xp_percent * 100).toFixed(1)}%)</div>`).join('');

                // Forward-calc what each candidate shows with this gear
                const calValues = xp.candidates.map(base => ({
                    base,
                    displayed: Math.round(base * (1 + totalXpPct) + totalXpAdd)
                }));

                // Check if the gear actually disambiguates
                const uniqueDisplayed = new Set(calValues.map(v => v.displayed));
                if (uniqueDisplayed.size < calValues.length) {
                    api.showError('No gear found that can disambiguate these XP values. Pick the one you think is correct.');
                    return;
                }

                const calButtons = calValues.map(({ base, displayed }) =>
                    `<button class="btn-pick-xp-candidate optimize-btn" data-xp="${base}" style="width:auto;padding:8px 14px;font-size:13px;margin:2px">
                        If you see <strong>${displayed}</strong> XP → base is <strong>${base}</strong>
                    </button>`
                ).join('');

                const html = `
                    <div style="margin-top:var(--spacing-sm);padding:var(--spacing-sm);background:var(--bg-tertiary);border-radius:8px">
                        <div style="font-weight:600;margin-bottom:4px">Equip this gear in-game:</div>
                        ${itemsList}
                        <div style="margin-top:var(--spacing-sm);font-weight:600">Then click what you see:</div>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">${calButtons}</div>
                    </div>
                `;
                this.$element.find('.ga-xp-calibration-area').html(html);
            } catch (err) {
                api.showError('Failed to build XP calibration gearset.');
            }
        });

        this.$element.on('click.ga', '.btn-calibrate', async (e) => {
            e.preventDefault();
            const data = this._readForm();
            try {
                const result = await api.getCalibrationGearset({
                    skill: data.skill,
                    location: data.location,
                });
                if (result.error) {
                    api.showError(result.error);
                    return;
                }
                // Pre-compute what each candidate would show with this gear
                const calWe = result.total_we || 0;
                const candidates = this.reverseResult.candidates;
                const itemsList = result.items.map(i => `<div style="padding:2px 0">${i.name} (WE: ${(i.work_efficiency * 100).toFixed(1)}%)</div>`).join('');

                // Call forward_calculate for each candidate with calibration gear
                const calResults = await Promise.all(candidates.map(async (base) => {
                    const r = await api.reverseCalculate({
                        observed_steps: data.observed_steps,
                        skill_level: store.state.character?.skills?.[data.skill] || 1,
                        required_level: data.required_level,
                        max_efficiency: data.max_efficiency,
                        calibration: {
                            observed_steps: 0, // dummy — we just need forward calc
                            stats: { work_efficiency: calWe, steps_add: result.total_flat || 0, steps_percent: result.total_pct || 0 },
                        },
                    });
                    return { base, calSteps: r.base_steps }; // won't work — need forward calc
                }));

                // Actually, we can compute forward locally: just show buttons
                // For each candidate, forward-calculate with the calibration WE added
                // The backend already has this — but we can approximate:
                // With extra WE, observed = ceil(base / (1 + total_we + cal_we))
                const skillLevel = store.state.character?.skills?.[data.skill] || 1;
                const levelsAbove = Math.max(0, skillLevel - data.required_level);
                const levelWe = Math.min(levelsAbove, 20) * 0.0125;
                const totalWeNogear = levelWe; // + collectibles (simplified)
                const totalWeWithCal = totalWeNogear + calWe;
                const maxEff = data.max_efficiency;

                const calButtons = candidates.map(base => {
                    const eff = 1.0 + totalWeWithCal;
                    const stepsEff = Math.ceil(base / eff);
                    const minSteps = Math.ceil(base / (1 + maxEff));
                    const calObs = Math.max(Math.max(stepsEff, minSteps), 10);
                    return `<button class="btn-pick-candidate optimize-btn" data-steps="${base}" style="width:auto;padding:8px 14px;font-size:13px;margin:2px">
                        If you see <strong>${calObs}</strong> steps → base is <strong>${base}</strong>
                    </button>`;
                }).join('');

                const html = `
                    <div style="margin-top:var(--spacing-sm);padding:var(--spacing-sm);background:var(--bg-tertiary);border-radius:8px">
                        <div style="font-weight:600;margin-bottom:4px">Equip this gear in-game:</div>
                        ${itemsList}
                        <div style="margin-top:var(--spacing-sm);font-weight:600">Then click what you see:</div>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">${calButtons}</div>
                    </div>
                `;
                this.$element.find('.ga-calibration-area').html(html);
            } catch (err) {
                api.showError('Failed to build calibration gearset.');
            }
        });

        this.$element.on('click.ga', '.btn-cal-solve', async (e) => {
            // No longer needed — calibration uses pick buttons now
            e.preventDefault();
        });

        this.$element.on('click.ga', '.btn-copy-location', (e) => {
            e.preventDefault();
            const activityLoc = this._getSelectedLocation();
            if (activityLoc && this.currentLocationDropdown) {
                this.currentLocationDropdown.selectLocation(activityLoc);
            } else {
                api.showInfo('Select an activity location first.');
            }
        });
        this.$element.on('click.ga', '.ga-icon-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Toggle floating icon popup
            if ($('.ga-icon-popup-floating').length) {
                $('.ga-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
                $(document).off('click.ga-icon-floating');
                return;
            }
            const $source = this.$element.find('.ga-icon-popup');
            const $floating = $('<div class="ga-icon-popup-floating"></div>');
            $floating.html($source.html());
            const rect = e.currentTarget.getBoundingClientRect();
            const popupW = 340;
            // Append hidden to measure actual height
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
            // Smart positioning: below or above
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const spaceAbove = rect.top - 8;
            const openAbove = spaceBelow < popupH && spaceAbove > spaceBelow;
            let top, left;
            if (openAbove) {
                top = rect.top - Math.min(popupH, spaceAbove) - 4;
            } else {
                top = rect.bottom + 4;
            }
            left = rect.left;
            if (left + popupW > window.innerWidth) left = window.innerWidth - popupW - 8;
            if (left < 4) left = 4;
            $floating.css({ top: top + 'px', left: left + 'px', visibility: '', display: 'none' });
            if (openAbove) {
                $floating.css({ 'transform-origin': 'bottom center' }).slideDown(150);
            } else {
                $floating.css({ 'transform-origin': 'top center' }).slideDown(150);
            }
            // Wire up events on floating popup
            $floating.on('click', '.ga-emoji-option', (ev) => {
                ev.stopPropagation();
                this.selectedIcon = $(ev.currentTarget).data('emoji');
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$element.find('.ga-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
                $(document).off('click.ga-icon-floating');
            });
            $floating.on('input', '.ga-icon-color', (ev) => {
                this.selectedIconColor = $(ev.target).val();
                this.$element.find('.ga-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
            });
            $floating.on('click', '.ga-color-clear', () => {
                this.selectedIconColor = null;
                this.$element.find('.ga-icon-btn').html(this.selectedIcon);
                $floating.find('.ga-icon-color').val('#ffffff');
            });
            const fpicker = $floating.find('emoji-picker')[0];
            if (fpicker) fpicker.addEventListener('emoji-click', (ev) => {
                this.selectedIcon = ev.detail.unicode;
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$element.find('.ga-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
                $(document).off('click.ga-icon-floating');
            });
            setTimeout(() => {
                $(document).on('click.ga-icon-floating', (ev) => {
                    if ($(ev.target).closest('.ga-icon-popup-floating, .ga-icon-btn').length) return;
                    $floating.slideUp(150, () => $floating.remove());
                    $(document).off('click.ga-icon-floating');
                });
            }, 10);
        });
        // Close saved dropdown on outside click
        $(document).off('click.ga-saved').on('click.ga-saved', (e) => {
            if (this.savedDropdownOpen && !$(e.target).closest('.ga-saved-selector').length) {
                this._closeSavedDropdown();
            }
        });
    }

    _closeSavedDropdown() {
        if (this.savedDropdownOpen) {
            this.savedDropdownOpen = false;
            this.$element.find('.ga-saved-dropdown').slideUp(200);
            this.$element.find('.ga-saved-toggle .expand-arrow').removeClass('expanded');
        }
    }

    destroy() {
        this.$element.off('click.ga change.ga input.ga keydown.ga');
        $('.ga-req-floating-dd').remove();
        $('.ga-icon-popup-floating').remove();
        $('.ga-req-kw-emoji-floating').remove();
        $(document).off('click.ga-req-floating');
        $(document).off('click.ga-icon-floating');
        $(document).off('click.ga-req-kw-emoji');
        $(document).off('click.ga-saved');
        if (this.locationDropdown) { this.locationDropdown.destroy(); this.locationDropdown = null; }
        if (this.currentLocationDropdown) { this.currentLocationDropdown.destroy(); this.currentLocationDropdown = null; }
        for (const dd of this.additionalLocationDropdowns) { dd.destroy(); }
        this.additionalLocationDropdowns = [];
        super.destroy();
    }
}

export default GenericActivityForm;
