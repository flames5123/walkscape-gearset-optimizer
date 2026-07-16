/**
 * GenericRecipeForm — form for creating/editing generic recipes.
 *
 * Rendered inside Column 3 when "🔧 Generic" is selected from the
 * RecipeSelectorDropdown. Follows the same patterns as GenericActivityForm.
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import GenericServiceForm from './generic-service-form.js';
import LocationDropdown from './location-dropdown.js';

const EMOJI_OPTIONS = ['⚡', '⚔️', '🎯', '🏹', '🛡️', '🔥', '💎', '🌊', '🌲', '⛏️', '🎣', '🍳', '🪚', '🧵', '🐾', '🏔️', '❄️', '☀️', '🌙', '⭐'];

const CRAFTING_SKILLS = ['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring'];


const SKILL_ICON_FALLBACK = {
    'traveling': '🧭',
};
function skillIcon(name) {
    const skillId = name.toLowerCase().replace(' ', '_');
    const fallback = SKILL_ICON_FALLBACK[skillId];
    if (fallback) return `<span class="ga-skill-icon-emoji">${fallback}</span>`;
    return `<img src="/assets/icons/text/skill_icons/${skillId}.svg" class="ga-skill-icon" />`;
}

class GenericRecipeForm extends Component {
    constructor(element, props = {}) {
        super(element, props);
        this.inputMode = 'observed';    // 'observed' | 'known'
        this.showCommunity = store.state.column3?.showGenericRecipeCommunity || false;
        this.savedDefs = [];
        this.communityDefs = [];
        this.currentDefId = null;
        this.reverseResult = null;
        this.selectedIcon = '⚡';
        this.selectedIconColor = null;
        this.selectedSkill = '';
        this.skillDropdownOpen = false;
        this.selectedSkill = '';
        this.skillDropdownOpen = false;
        this.isExpanded = true;

        // Service data
        this.servicesData = [];
        this.selectedServiceId = null;
        this.serviceDropdownOpen = false;
        this.savedSearchText = '';
        this.serviceSearchText = '';

        // Generic service form (shown when "Generic Service" is selected)
        this.genericServiceForm = null;
        this.currentLocationDropdown = null;

        // Requirements rows
        this.requirementRows = [];

        this._autoPopulateDone = false;
        this._loadServices();
        this._loadSavedDefinitions();
    }

    // ------------------------------------------------------------------
    // DATA LOADING
    // ------------------------------------------------------------------

    async _loadServices() {
        try {
            const data = await $.get('/api/services');
            this.servicesData = data.services || [];
            this.render();
        } catch (e) {
            console.error('GenericRecipeForm: failed to load services', e);
        }
    }

    async _loadSavedDefinitions(skipRender = false) {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            const defs = await api.getGenericDefinitions(uuid);
            this.savedDefs = defs.recipes || [];
            store.state.column3.savedGenericRecipes = this.savedDefs;
            if (this.showCommunity) await this._loadCommunity();
            if (!skipRender) this.render();

            // Auto-populate from saved selection on reload
            this._tryAutoPopulate();
        } catch (e) {
            console.error('GenericRecipeForm: failed to load saved defs', e);
        }
    }

    _tryAutoPopulate() {
        if (this._autoPopulateDone) return;
        const selectedId = store.state.column3?.selectedRecipe;
        if (!selectedId || typeof selectedId !== 'string' || !selectedId.startsWith('generic::')) return;
        if (this.currentDefId) return;
        const defId = selectedId.replace('generic::', '');
        const def = (this.savedDefs || []).find(d => d.id === defId)
            || (this.communityDefs || []).find(d => d.id === defId);
        if (def) {
            this._autoPopulateDone = true;
            this.populateFromSaved(def);
            // Restore service from session state (not saved in DB)
            const sessionService = store.state.column3?.genericRecipeServiceId;
            if (sessionService && !this.selectedServiceId) {
                this.selectedServiceId = sessionService;
                // Will show correct name after _loadServices completes and re-renders
            }
        }
    }

    async _loadCommunity() {
        try {
            const defs = await api.getCommunityDefinitions();
            this.communityDefs = defs.recipes || [];
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

        this.$element.find('.gr-mode-label').text(isObs ? 'Observed' : 'Known Base');
        this.$element.find('.btn-toggle-mode').text(isObs ? 'Switch to Known Base' : 'Switch to Observed');

        if (isObs) {
            this.$element.find('.gr-current-loc-row').slideDown(150);
            this.$element.find('.gr-observed-fields').slideDown(150);
            this.$element.find('.gr-known-fields').slideUp(150);
        } else {
            this.$element.find('.gr-current-loc-row').slideUp(150);
            this.$element.find('.gr-observed-fields').slideUp(150);
            this.$element.find('.gr-known-fields').slideDown(150);
        }

        this.$element.find('.btn-save-generic').text(isObs ? 'Calculate' : '💾 Save');
        this.$element.find('.gr-reverse-result-container').empty();
    }

    async toggleCommunity() {
        this.showCommunity = !this.showCommunity;
        store.state.column3.showGenericRecipeCommunity = this.showCommunity;
        store._saveColumn3Selection();
        if (this.showCommunity && this.communityDefs.length === 0) {
            await this._loadCommunity();
        }
        this.$element.find('.gr-saved-dropdown').html(this._renderSavedDropdownItems());
    }

    populateFromSaved(def) {
        this.currentDefId = def.id;
        this.selectedIcon = def.icon || '⚡';
        this.selectedIconColor = def.icon_color || null;
        this.inputMode = 'known';
        this.reverseResult = null;
        this.selectedServiceId = def.service_id || null;
        this.requirementRows = this._jsonToRequirementRows(def.requirements_json);
        // Store values in state so render() can use them
        this._populatedName = def.name || '';
        this._populatedBaseSteps = def.base_steps || '';
        this._populatedBaseXp = def.base_xp || 0;
        this._populatedMaxEff = Math.round((def.max_efficiency || 0) * 100) + 100;
        this._populatedReqLevel = def.required_level || 1;
        this._populatedIsPublic = !!def.is_public;
        this._populatedIsQualityItem = !!def.is_quality_item;
        this.selectedSkill = def.skill ? def.skill.charAt(0).toUpperCase() + def.skill.slice(1).toLowerCase() : '';
        this.render();
        this.$element.find('#gr-name').val(this._populatedName);
        this.$element.find('#gr-base-steps').val(this._populatedBaseSteps);
        this.$element.find('#gr-base-xp').val(this._populatedBaseXp);
        this.$element.find('#gr-max-eff').val(this._populatedMaxEff);
        this.$element.find('#gr-max-eff-slider').val(Math.min(this._populatedMaxEff, 350));
        this.$element.find('#gr-req-level').val(this._populatedReqLevel);
        this.$element.find('#gr-req-level-slider').val(this._populatedReqLevel);
        this.$element.find('#gr-share').prop('checked', this._populatedIsPublic);
        this.$element.find('#gr-quality-item').prop('checked', this._populatedIsQualityItem);
        this._updateServiceForm();
    }

    _readForm() {
        const maxEffRaw = parseFloat(this.$element.find('#gr-max-eff').val()) || 0;
        const maxEff = maxEffRaw > 100 ? (maxEffRaw - 100) / 100 : maxEffRaw / 100;
        const skill = this.selectedSkill || '';
        return {
            name: (this.$element.find('#gr-name').val() || '').trim(),
            skill: skill.toLowerCase(),
            base_steps: parseInt(this.$element.find('#gr-base-steps').val()) || 0,
            base_xp: parseFloat(this.$element.find('#gr-base-xp').val()) || 0,
            max_efficiency: maxEff,
            required_level: parseInt(this.$element.find('#gr-req-level').val()) || 1,
            is_public: this.$element.find('#gr-share').is(':checked'),
            is_quality_item: this.$element.find('#gr-quality-item').is(':checked'),
            observed_steps: parseInt(this.$element.find('#gr-obs-steps').val()) || 0,
            observed_xp: parseFloat(this.$element.find('#gr-obs-xp').val()) || 0,
            service_id: this.selectedServiceId || null,
            icon: this.selectedIcon,
            icon_color: this.selectedIconColor || null,
            requirements_json: this._requirementsToJson(),
        };
    }

    async submitForm() {
        const data = this._readForm();
        if (!data.name) { api.showError('Name is required.'); return; }
        if (!data.skill) { api.showError('Skill is required.'); return; }

        // If generic service is selected, save it first
        if (this.selectedServiceId === 'generic' && this.genericServiceForm) {
            const svcData = this.genericServiceForm.readForm();
            if (!svcData.name) { api.showError('Service name is required.'); return; }
            const uuid = store.state.session?.uuid;
            if (uuid) {
                try {
                    const savedSvc = await api.saveGenericDefinition(uuid, {
                        type: 'service', ...svcData
                    });
                    data.service_id = `generic::${savedSvc.id}`;
                    this.selectedServiceId = data.service_id;
                } catch (e) {
                    api.showError('Failed to save generic service.');
                    return;
                }
            }
        }

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

                // If a generic service is selected, extract its WE for step calculation
                const svcId = data.service_id || this.selectedServiceId || null;
                if (svcId === 'generic' && this.genericServiceForm) {
                    const svcData = this.genericServiceForm.readForm();
                    const svcStats = svcData.stats || {};
                    reversePayload.service_we = (svcStats.work_efficiency || 0) / 100;
                } else if (svcId) {
                    // Backend will load service WE from the service_id
                    reversePayload.service_id_for_we = svcId;
                }

                // Send observed XP for reverse calculation (accounts for collectible bonuses)
                if (data.observed_xp) {
                    reversePayload.observed_xp = data.observed_xp;
                    reversePayload.skill = data.skill;
                    reversePayload.service_id = svcId;
                }
                const result = await api.reverseCalculate(reversePayload);
                this.reverseResult = result;
                if (!result.ambiguous && result.base_steps) {
                    data.base_steps = result.base_steps;

                    // Check XP ambiguity — block save if ambiguous
                    const xpResult = result.xp_result;
                    if (xpResult && xpResult.ambiguous) {
                        this.reverseResult.computed_xp = null;
                        this.$element.find('.gr-reverse-result-container').html(this._renderReverseResult());
                        return;
                    }

                    // Use reverse-calculated base XP if available, otherwise fall back to observed
                    if (xpResult && xpResult.base_xp != null) {
                        data.base_xp = xpResult.base_xp;
                    } else if (data.observed_xp) {
                        data.base_xp = data.observed_xp;
                    }
                    this.reverseResult.computed_xp = data.base_xp != null ? data.base_xp : null;
                    this.$element.find('.gr-reverse-result-container').html(this._renderReverseResult());
                } else {
                    this.$element.find('.gr-reverse-result-container').html(this._renderReverseResult());
                    return;
                }
            } catch (e) {
                api.showError('Reverse calculation failed.');
                return;
            }
        }

        if (data.base_steps < 10) { api.showError('Base steps must be at least 10.'); return; }
        this._saveDefinition(data);
    }

    async _saveDefinition(data) {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            const isNew = !this.currentDefId;
            if (this.currentDefId) {
                await api.updateGenericDefinition(uuid, this.currentDefId, {
                    type: 'recipe', ...data
                });
            } else {
                const saved = await api.saveGenericDefinition(uuid, {
                    type: 'recipe', ...data
                });
                this.currentDefId = saved.id;
            }
            await this._loadSavedDefinitions(true);

            store.state.column3.selectedRecipe = `generic::${this.currentDefId}`;
            store.state.column3.genericRecipe = data;
            store._notifySubscribers('column3.selectedRecipe');
            store._notifySubscribers('column3.genericRecipe');
            store._saveColumn3Selection();

            // Update UI without re-rendering
            this.$element.find('.gr-saved-value').html(this._getSelectedDefName());
            this.$element.find('.gr-reverse-result-container').empty();
            this.reverseResult = null;

            // Switch to Known Base mode and show saved values
            if (this.inputMode === 'observed') {
                this.inputMode = 'known';
                this.$element.find('.gr-mode-label').text('Known Base');
                this.$element.find('.btn-toggle-mode').text('Switch to Observed');
                this.$element.find('.gr-current-loc-row').slideUp(150);
                this.$element.find('.gr-observed-fields').slideUp(150);
                this.$element.find('.gr-known-fields').slideDown(150);
                this.$element.find('.btn-save-generic').text('💾 Save');
            }
            this.$element.find('#gr-base-steps').val(data.base_steps);
            this.$element.find('#gr-base-xp').val(data.base_xp);

            api.showSuccess(isNew ? 'Generic recipe saved.' : 'Generic recipe updated.');

            // Show View button if not already present
            if (!this.$element.find('.btn-view-generic').length) {
                const viewBtn = `<div class="gr-row gr-view-btn-row" style="margin-bottom:var(--spacing-xs)"><button class="btn-view-generic optimize-btn" style="font-size:14px;background:#2196F3;width:100%">View Recipe Info</button></div>`;
                this.$element.find('.gr-saved-selector').after(viewBtn);
            }

            // Show Delete button if not already present
            if (!this.$element.find('.btn-delete-generic').length) {
                this.$element.find('.gr-actions').append('<button class="btn-delete-generic optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>');
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
            await api.deleteGenericDefinition(uuid, this.currentDefId, 'recipe');
            api.showSuccess('Generic recipe deleted.');
            this.currentDefId = null;
            this.reverseResult = null;
            await this._loadSavedDefinitions();

            store.state.column3.selectedRecipe = null;
            store.state.column3.genericRecipe = null;
            store._notifySubscribers('column3.selectedRecipe');
            store._saveColumn3Selection();

            this.render();
        } catch (e) { /* handled */ }
    }

    _updateServiceForm() {
        const $container = this.$element.find('.gr-service-form-container');
        if (this.selectedServiceId === 'generic') {
            if (!this.genericServiceForm) {
                this.genericServiceForm = new GenericServiceForm($container);
            }
            this.genericServiceForm.render();
            $container.slideDown(200);
        } else {
            if (this.genericServiceForm) {
                this.genericServiceForm.destroy();
                this.genericServiceForm = null;
                this.currentLocationDropdown = null;
            }
            $container.slideUp(200);
        }
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    _getSelectedDefName() {
        if (!this.currentDefId) return '+ New Generic Recipe';
        const def = this.savedDefs.find(d => d.id === this.currentDefId);
        if (!def) return '+ New Generic Recipe';
        const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
        return `${iconHtml} ${def.name}`;
    }

    _renderSavedDropdownItems() {
        const savedIds = new Set(this.savedDefs.map(d => d.id));
        const search = (this.savedSearchText || '').toLowerCase();
        if (!this._expandedSavedSkills) this._expandedSavedSkills = new Set();

        let searchBox = '<input type="text" class="gr-saved-search" placeholder="Search..." value="' + (this.savedSearchText || '') + '" />';

        let items = '<div class="gr-saved-item gr-saved-new" data-id=""><span>+ New Generic Recipe</span></div>';

        // Group saved defs by skill
        const bySkill = {};
        for (const def of this.savedDefs) {
            if (search && !def.name.toLowerCase().includes(search)) continue;
            const skill = (def.skill || 'Other').replace(/^\w/, c => c.toUpperCase());
            if (!bySkill[skill]) bySkill[skill] = [];
            bySkill[skill].push(def);
        }

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
                    <div class="category-header gr-saved-skill-header" data-skill="${skill}">
                        ${skillIconHtml}
                        <span class="skill-name">${skill}</span>
                        ${arrowIcon}
                    </div>`;

            if (isExpanded) {
                for (const def of bySkill[skill]) {
                    const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                    items += `<div class="gr-saved-item recipe-item" data-id="${def.id}"><span>${iconHtml} ${def.name}</span></div>`;
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
                items += '<div class="gr-saved-divider">Community</div>';
                for (const skill of Object.keys(communityBySkill).sort()) {
                    const isExpanded = this._expandedSavedSkills.has('community::' + skill);
                    const skillIconHtml = skillIcon(skill);
                    const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;
                    items += `
                        <div class="recipe-category">
                            <div class="category-header gr-saved-skill-header" data-skill="community::${skill}">
                                ${skillIconHtml}
                                <span class="skill-name">${skill}</span>
                                ${arrowIcon}
                            </div>`;
                    if (isExpanded) {
                        for (const def of communityBySkill[skill]) {
                            const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                            items += `<div class="gr-saved-item recipe-item" data-id="community::${def.id}"><span>${iconHtml} ${def.name}</span></div>`;
                        }
                    }
                    items += `</div>`;
                }
            }
        }
        return searchBox + '<div class="gr-saved-list recipe-list">' + items + '</div>';
    }

    _getSelectedSkillDisplay() {
        if (!this.selectedSkill) return 'Select skill...';
        const skillId = this.selectedSkill.toLowerCase().replace(' ', '_');
        return `${skillIcon(this.selectedSkill)} ${this.selectedSkill}`;
    }

    _renderSkillDropdownItems() {
        const CRAFTING_SKILLS = ['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring'];
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

    _getSelectedSkillDisplay() {
        if (!this.selectedSkill) return 'Select skill...';
        const skillId = this.selectedSkill.toLowerCase().replace(' ', '_');
        return `${skillIcon(this.selectedSkill)} ${this.selectedSkill}`;
    }

    _renderSkillDropdownItems() {
        const CRAFTING_SKILLS = ['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring'];
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

    _renderSkillOptions() {
        return CRAFTING_SKILLS.map(name =>
            `<option value="${name}">${name}</option>`
        ).join('');
    }

    _getSelectedServiceName() {
        if (!this.selectedServiceId) return 'No service';
        if (this.selectedServiceId === 'generic') return '🔧 Generic Service';
        const svc = this.servicesData.find(s => s.id === this.selectedServiceId);
        if (svc) return svc.display_name;
        // Fallback: show the ID if services haven't loaded yet
        if (this.selectedServiceId) return 'Loading service...';
        return 'No service';
    }

    _renderServiceDropdownItems() {
        // Filter services by selected skill category
        const selectedSkill = (this.selectedSkill || '').toLowerCase();
        let filtered = selectedSkill
            ? this.servicesData.filter(svc => (svc.category || '').toLowerCase() === selectedSkill)
            : this.servicesData;

        // Filter by search text
        const search = (this.serviceSearchText || '').toLowerCase();
        if (search) {
            filtered = filtered.filter(svc =>
                svc.name.toLowerCase().includes(search) ||
                (svc.location?.name || '').toLowerCase().includes(search) ||
                (svc.display_name || '').toLowerCase().includes(search)
            );
        }

        const searchBox = `<input type="text" class="gr-svc-search" placeholder="Search services..." value="${this.serviceSearchText}" />`;

        let items = searchBox + '<div class="gr-svc-item gr-svc-none" data-id=""><span>No service</span></div>';

        if (filtered.length === 0 && selectedSkill) {
            items += `<div class="gr-svc-divider">No ${this.selectedSkill} services found</div>`;
        } else {
            // Group by category
            const byCategory = {};
            for (const svc of filtered) {
                const cat = svc.category || 'Other';
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(svc);
            }

            for (const [cat, svcs] of Object.entries(byCategory).sort()) {
                items += `<div class="gr-svc-divider">${cat}</div>`;
                for (const svc of svcs) {
                    const locIcon = svc.location?.icon_name ? `/assets/icons/locations/${svc.location.icon_name}` : '';
                    const locImg = locIcon ? `<img src="${locIcon}" class="gr-svc-loc-icon" alt="" />` : '';
                    const locName = svc.location?.name || '';
                    items += `<div class="gr-svc-item" data-id="${svc.id}">
                        ${locImg}
                        <div class="gr-svc-item-text">
                            <span class="gr-svc-name">${svc.name}</span>
                            ${locName ? `<span class="gr-svc-loc">${locName}</span>` : ''}
                        </div>
                    </div>`;
                }
            }
        }

        items += '<div class="gr-svc-divider">Custom</div>';
        items += '<div class="gr-svc-item gr-svc-generic" data-id="generic"><span>🔧 Generic Service</span></div>';

        return `<div class="gr-svc-list">${items}</div>`;
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
                        <div class="gr-xp-calibration-area"></div>
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
                    <div class="gr-calibration-area"></div>
                </div>
            `;
        }
        return '<div class="reverse-result error">Could not determine base steps. Check your inputs.</div>';
    }

    _renderRequirementRows() {
        const FACTIONS = ['jarvonia', 'trellin', 'erdwise', 'syrenthia', 'halfling_rebels', 'wallisia', 'wrentmark'];
        const COMMON_KEYWORDS = [
            'hatchet', 'pickaxe', 'fishing rod', 'fishing net', 'fishing spear',
            'fishing tool', 'bug catching net', 'sickle', 'carpentry tool', 'skis',
            'diving gear', 'advanced diving gear', 'light source',
            'camel', 'spectral gear'
        ];
        const ALL_SKILLS = ['Agility', 'Carpentry', 'Cooking', 'Crafting', 'Fishing', 'Foraging', 'Hunting', 'Mining', 'Smithing', 'Tailoring', 'Trinketry', 'Woodcutting'];

        return this.requirementRows.map((r, i) => {
            let fields = '';
            if (r.type === 'keyword') {
                const kwOptions = COMMON_KEYWORDS.map(kw =>
                    `<option value="${kw}" ${kw === r.keyword ? 'selected' : ''}>${kw}</option>`
                ).join('');
                fields = `
                    <select class="gr-req-keyword" style="flex:1;font-size:12px;padding:4px">
                        <option value="">Select keyword...</option>
                        ${kwOptions}
                        <option value="_custom" ${r.keyword && !COMMON_KEYWORDS.includes(r.keyword) ? 'selected' : ''}>Custom...</option>
                    </select>
                    ${r.keyword && !COMMON_KEYWORDS.includes(r.keyword) ? `<input type="text" class="gr-req-keyword-custom" value="${r.keyword}" placeholder="Custom keyword" style="flex:1;font-size:12px;padding:4px" />` : ''}
                    <span>×</span><input type="number" class="gr-req-count" value="${r.count || 1}" min="1" max="10" style="width:48px" />
                `;
            } else if (r.type === 'reputation') {
                const factionOptions = FACTIONS.map(f => {
                    const label = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    return `<option value="${f}" ${f === r.faction ? 'selected' : ''}>${label}</option>`;
                }).join('');
                fields = `
                    <select class="gr-req-faction" style="flex:1;font-size:12px;padding:4px">
                        <option value="">Select faction...</option>
                        ${factionOptions}
                    </select>
                    <span>≥</span><input type="number" class="gr-req-amount" value="${r.amount || 1}" min="1" style="width:60px" />
                `;
            } else if (r.type === 'achievement_points') {
                fields = `<span>AP ≥</span><input type="number" class="gr-req-amount" value="${r.amount || 0}" min="0" style="width:70px" />`;
            }

            const typeOptions = [
                { value: '', label: 'Select type...' },
                { value: 'keyword', label: 'Keyword (gear)' },
                { value: 'reputation', label: 'Reputation' },
                { value: 'achievement_points', label: 'Achievement Points' },
            ];
            const typeSelect = typeOptions.map(o =>
                `<option value="${o.value}" ${o.value === r.type ? 'selected' : ''}>${o.label}</option>`
            ).join('');

            return `<div class="gr-req-row" data-index="${i}" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <select class="gr-req-type" style="min-width:130px;font-size:12px;padding:4px">${typeSelect}</select>
                ${fields}
                <button class="gr-req-remove" title="Remove" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:16px">✕</button>
            </div>`;
        }).join('');
    }

    _syncRequirements() {
        const reqs = [];
        this.$element.find('.gr-req-row').each(function () {
            const type = $(this).find('.gr-req-type').val();
            if (!type) return;
            const row = { type };
            if (type === 'keyword') {
                let kw = $(this).find('.gr-req-keyword').val();
                if (kw === '_custom') kw = $(this).find('.gr-req-keyword-custom').val();
                row.keyword = kw || '';
                row.count = parseInt($(this).find('.gr-req-count').val()) || 1;
            } else if (type === 'reputation') {
                row.faction = $(this).find('.gr-req-faction').val();
                row.amount = parseInt($(this).find('.gr-req-amount').val()) || 1;
            } else if (type === 'achievement_points') {
                row.amount = parseInt($(this).find('.gr-req-amount').val()) || 0;
            }
            reqs.push(row);
        });
        this.requirementRows = reqs;
    }

    _requirementsToJson() {
        this._syncRequirements();
        const result = { keyword_counts: {}, reputation: {}, achievement_points: 0 };
        for (const r of this.requirementRows) {
            if (r.type === 'keyword' && r.keyword) {
                result.keyword_counts[r.keyword] = r.count || 1;
            } else if (r.type === 'reputation' && r.faction) {
                result.reputation[r.faction] = r.amount || 1;
            } else if (r.type === 'achievement_points') {
                result.achievement_points = r.amount || 0;
            }
        }
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
        for (const [faction, amount] of Object.entries(reqs.reputation || {})) {
            rows.push({ type: 'reputation', faction, amount });
        }
        if (reqs.achievement_points > 0) {
            rows.push({ type: 'achievement_points', amount: reqs.achievement_points });
        }
        return rows;
    }

    _renderEmojiPicker() {
        return EMOJI_OPTIONS.map(e =>
            `<span class="gr-emoji-option ${e === this.selectedIcon ? 'selected' : ''}" data-emoji="${e}">${e}</span>`
        ).join('');
    }

    render() {
        // Destroy old generic service form before re-rendering
        if (this.genericServiceForm) {
            this.genericServiceForm.destroy(); this.genericServiceForm = null;
            this.currentLocationDropdown = null;
        }

        const isObs = this.inputMode === 'observed';
        const modeLabel = isObs ? 'Observed' : 'Known Base';
        const otherModeLabel = isObs ? 'Known Base' : 'Observed';
        const btnLabel = isObs ? 'Calculate' : '💾 Save';

        const html = `
            <div class="generic-recipe-form activity-info-section">
                <div class="activity-info-header gr-collapse-header">
                    <span class="activity-info-title">🔧 Generic Recipe</span>
                    <span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>
                </div>
                <div class="activity-info-content" style="display: ${this.isExpanded ? 'block' : 'none'}">
                    <div class="gr-row gr-saved-selector">
                        <label>Saved Definitions</label>
                        <div class="gr-saved-button">
                            <div class="gr-saved-value">${this._getSelectedDefName()}</div>
                            <button class="gr-saved-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="gr-saved-dropdown" style="display:none"></div>
                        <label class="gr-checkbox-label gr-community-row">
                            <input type="checkbox" id="gr-show-community" ${this.showCommunity ? 'checked' : ''} />
                            Show community definitions
                        </label>
                    </div>

                    ${this.currentDefId ? `<div class="gr-row" style="margin-bottom:var(--spacing-xs)"><button class="btn-view-generic optimize-btn" style="font-size:14px;background:#2196F3;width:100%">View Recipe Info</button></div>` : ''}

                    <div class="gr-row gr-name-row">
                        <div class="gr-icon-picker">
                            <button class="gr-icon-btn" title="Click to pick icon" ${this.selectedIconColor ? `style="${window.emojiTintStyle(this.selectedIconColor)}"` : ''}>${window.emojiForPlatform(this.selectedIcon)}</button>
                            <div class="gr-icon-popup" style="display:none">
                                <div class="gr-icon-defaults">
                                    ${this._renderEmojiPicker()}
                                </div>
                                <div style="display:flex;align-items:center;gap:6px;padding:4px 8px">
                                    <label style="font-size:12px;color:var(--text-secondary)">Tint:</label>
                                    <input type="color" class="gr-icon-color" value="${this.selectedIconColor || '#ffffff'}" style="width:32px;height:24px;border:none;cursor:pointer" />
                                    <button class="gr-color-clear" style="background:none;border:1px solid var(--border-color);border-radius:4px;color:var(--text-secondary);font-size:11px;padding:2px 6px;cursor:pointer">Clear</button>
                                </div>
                                <emoji-picker class="gr-full-picker"></emoji-picker>
                            </div>
                        </div>
                        <div class="gr-name-field">
                            <label>Name</label>
                            <input type="text" id="gr-name" value="${this._populatedName || ''}" />
                        </div>
                    </div>

                    <div class="gr-row ga-skill-selector">
                        <label>Skill</label>
                        <div class="ga-skill-button">
                            <div class="ga-skill-value">${this._getSelectedSkillDisplay()}</div>
                            <button class="ga-skill-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="ga-skill-dropdown" style="display:none"></div>
                    </div>

                    <div class="gr-row gr-mode-row">
                        <span>Input Mode: <strong class="gr-mode-label">${modeLabel}</strong></span>
                        <button class="btn-toggle-mode optimize-btn" style="width:auto;padding:6px 12px;font-size:13px">Switch to ${otherModeLabel}</button>
                    </div>

                    <div class="gr-row gr-svc-selector">
                        <label>Service</label>
                        <div class="gr-helper-text">Service at your location for calculated step difference</div>
                        <div class="gr-svc-button">
                            <div class="gr-svc-value">${this._getSelectedServiceName()}</div>
                            <button class="gr-svc-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="gr-svc-dropdown" style="display:none"></div>
                    </div>

                    <div class="gr-service-form-container" style="display:none"></div>

                    <div class="gr-current-loc-row" style="${isObs ? '' : 'display:none'}">
                        <div class="gr-row">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                                <label>Current Location</label>
                                <button class="btn-copy-svc-location optimize-btn" style="width:auto;padding:3px 10px;font-size:12px">📋 Same as service</button>
                            </div>
                            <div class="gr-helper-text">Your in-game location for collectible lookup</div>
                            <div id="gr-current-loc-dropdown"></div>
                        </div>
                    </div>

                    <div class="gr-observed-fields" style="${isObs ? '' : 'display:none'}">
                        <div class="gr-row"><label>Observed Steps</label><div class="gr-helper-text">Steps shown in-game with no gear</div><input type="number" id="gr-obs-steps" min="1" inputmode="numeric" pattern="[0-9]*" /></div>
                        <div class="gr-row"><label>Observed XP</label><div class="gr-helper-text">XP shown in-game with no gear</div><input type="number" id="gr-obs-xp" min="0" step="0.1" inputmode="decimal" /></div>
                    </div>

                    <div class="gr-known-fields" style="${isObs ? 'display:none' : ''}">
                        <div class="gr-row"><label>Base Steps</label><div class="gr-helper-text">True base steps if already known</div><input type="number" id="gr-base-steps" min="1" inputmode="numeric" pattern="[0-9]*" value="${this._populatedBaseSteps || ''}" /></div>
                        <div class="gr-row"><label>Base XP</label><div class="gr-helper-text">True base XP if already known</div><input type="number" id="gr-base-xp" min="0" step="0.1" inputmode="decimal" value="${this._populatedBaseXp || ''}" /></div>
                    </div>

                    <div class="gr-row">
                        <label>Max Efficiency</label>
                        <div class="gr-helper-text">Max WE shown in-game, e.g. 180% means 80% WE cap</div>
                        <div class="ga-slider-row">
                            <input type="range" id="gr-max-eff-slider" min="100" max="350" step="5" value="${this._populatedMaxEff || 160}" class="ga-slider" />
                            <div class="ga-slider-input-wrap">
                                <input type="number" id="gr-max-eff" min="100" value="${this._populatedMaxEff || 160}" class="ga-slider-input" />
                                <span class="ga-slider-pct">%</span>
                            </div>
                        </div>
                        <div class="ga-tick-container ga-tick-we"><div class="ga-tick-big" style="left:0.0%"><span class="ga-tick-label">100</span></div><div class="ga-tick-small" style="left:10.0%"></div><div class="ga-tick-big" style="left:20.0%"><span class="ga-tick-label">150</span></div><div class="ga-tick-small" style="left:30.0%"></div><div class="ga-tick-big" style="left:40.0%"><span class="ga-tick-label">200</span></div><div class="ga-tick-small" style="left:50.0%"></div><div class="ga-tick-big" style="left:60.0%"><span class="ga-tick-label">250</span></div><div class="ga-tick-small" style="left:70.0%"></div><div class="ga-tick-big" style="left:80.0%"><span class="ga-tick-label">300</span></div><div class="ga-tick-small" style="left:90.0%"></div><div class="ga-tick-big" style="left:100.0%"><span class="ga-tick-label">350</span></div></div>
                    </div>

                    <div class="gr-row">
                        <label>Required Level</label>
                        <div class="ga-slider-row">
                            <input type="range" id="gr-req-level-slider" min="1" max="99" step="1" value="${this._populatedReqLevel || 1}" class="ga-slider" />
                            <div class="ga-slider-input-wrap">
                                <input type="number" id="gr-req-level" min="1" max="99" value="${this._populatedReqLevel || 1}" class="ga-slider-input" />
                            </div>
                        </div>
                        <div class="ga-tick-container ga-tick-level"><div class="ga-tick-small" style="left:4.1%"></div><div class="ga-tick-big" style="left:9.2%"><span class="ga-tick-label">10</span></div><div class="ga-tick-small" style="left:14.3%"></div><div class="ga-tick-big" style="left:19.4%"><span class="ga-tick-label">20</span></div><div class="ga-tick-small" style="left:24.5%"></div><div class="ga-tick-big" style="left:29.6%"><span class="ga-tick-label">30</span></div><div class="ga-tick-small" style="left:34.7%"></div><div class="ga-tick-big" style="left:39.8%"><span class="ga-tick-label">40</span></div><div class="ga-tick-small" style="left:44.9%"></div><div class="ga-tick-big" style="left:50.0%"><span class="ga-tick-label">50</span></div><div class="ga-tick-small" style="left:55.1%"></div><div class="ga-tick-big" style="left:60.2%"><span class="ga-tick-label">60</span></div><div class="ga-tick-small" style="left:65.3%"></div><div class="ga-tick-big" style="left:70.4%"><span class="ga-tick-label">70</span></div><div class="ga-tick-small" style="left:75.5%"></div><div class="ga-tick-big" style="left:80.6%"><span class="ga-tick-label">80</span></div><div class="ga-tick-small" style="left:85.7%"></div><div class="ga-tick-big" style="left:90.8%"><span class="ga-tick-label">90</span></div><div class="ga-tick-small" style="left:95.9%"></div></div>
                    </div>

                    <div class="gr-row">
                        <label class="gr-checkbox-label">
                            <input type="checkbox" id="gr-quality-item" />
                            Quality item (shows crafting odds table)
                        </label>
                    </div>

                    <div class="gr-row">
                        <label class="gr-checkbox-label">
                            <input type="checkbox" id="gr-share" checked />
                            Share with others
                        </label>
                    </div>

                    <div class="gr-reverse-result-container">${this._renderReverseResult()}</div>

                    <div class="gr-actions">
                        <button class="btn-save-generic optimize-btn" style="font-size:14px">${btnLabel}</button>
                        ${this.currentDefId ? '<button class="btn-delete-generic optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>' : ''}
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);

        // Create current location dropdown
        this.currentLocationDropdown = new LocationDropdown(
            this.$element.find('#gr-current-loc-dropdown'),
            { label: 'Current', onSelect: () => { } }
        );

        // Show generic service form if selected
        if (this.selectedServiceId === 'generic') {
            this._updateServiceForm();
        }

        this.attachEvents();
    }

    attachEvents() {
        this.$element.off('click.gr change.gr input.gr keydown.gr');
        $(document).off('click.gr-saved');

        // Collapsible header
        this.$element.on('click.gr', '.gr-collapse-header', (e) => {
            this.isExpanded = !this.isExpanded;
            const $content = this.$element.find('.activity-info-content');
            const $arrow = this.$element.find('.gr-collapse-header .expand-arrow');
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
        this.$element.on('input.gr', '#gr-max-eff-slider', (e) => {
            this.$element.find('#gr-max-eff').val($(e.target).val());
            updateSliderFill($(e.target));
        });
        this.$element.on('input.gr', '#gr-max-eff', (e) => {
            const val = parseInt($(e.target).val()) || 100;
            const $slider = this.$element.find('#gr-max-eff-slider');
            $slider.val(Math.min(val, 350));
            updateSliderFill($slider);
        });
        this.$element.on('blur.gr', '#gr-max-eff', (e) => {
            let val = parseInt($(e.target).val()) || 100;
            if (val < 100) { val = 100; $(e.target).val(100); }
        });
        updateSliderFill(this.$element.find('#gr-max-eff-slider'));

        // Level slider ↔ text input sync
        this.$element.on('input.gr', '#gr-req-level-slider', (e) => {
            this.$element.find('#gr-req-level').val($(e.target).val());
        });
        this.$element.on('input.gr', '#gr-req-level', (e) => {
            const val = parseInt($(e.target).val()) || 1;
            this.$element.find('#gr-req-level-slider').val(Math.min(Math.max(val, 1), 99));
        });
        this.$element.on('blur.gr', '#gr-req-level', (e) => {
            let val = parseInt($(e.target).val()) || 1;
            if (val < 1) { val = 1; $(e.target).val(1); }
            if (val > 99) { val = 99; $(e.target).val(99); }
            this.$element.find('#gr-req-level-slider').val(val);
        });

        this.$element.on('click.gr', '.btn-toggle-mode', (e) => {
            e.preventDefault();
            this.toggleInputMode();
        });

        // Skill dropdown
        this.$element.on('click.gr', '.ga-skill-button', (e) => {
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
        this.$element.on('click.gr', '.ga-skill-item', (e) => {
            e.stopPropagation();
            this.selectedSkill = $(e.currentTarget).data('skill');
            this.skillDropdownOpen = false;
            this.$element.find('.ga-skill-dropdown').slideUp(200);
            this.$element.find('.ga-skill-toggle .expand-arrow').removeClass('expanded');
            this.$element.find('.ga-skill-value').html(this._getSelectedSkillDisplay());
        });

        // Custom saved definitions dropdown
        this.$element.on('click.gr', '.gr-saved-button', (e) => {
            e.stopPropagation();
            this.savedDropdownOpen = !this.savedDropdownOpen;
            const $dd = this.$element.find('.gr-saved-dropdown');
            const $arrow = this.$element.find('.gr-saved-toggle .expand-arrow');
            if (this.savedDropdownOpen) {
                this.savedSearchText = '';
                $dd.html(this._renderSavedDropdownItems());
                $arrow.addClass('expanded');
                $dd.slideDown(200);
                // Auto-focus search after slideDown
                setTimeout(() => $dd.find('.gr-saved-search').focus(), 160);
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(200);
            }
        });
        this.$element.on('input.gr', '.gr-saved-search', (e) => {
            e.stopPropagation();
            this.savedSearchText = $(e.target).val();
            const fullHtml = this._renderSavedDropdownItems();
            const $temp = $('<div>').html(fullHtml);
            this.$element.find('.gr-saved-list').html($temp.find('.gr-saved-list').html());
        });
        this.$element.on('keydown.gr', '.gr-saved-search', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const $list = this.$element.find('.gr-saved-list');
            const $items = $list.find('.gr-saved-item:visible, .gr-saved-skill-header:visible');
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
        this.$element.on('click.gr', '.gr-saved-skill-header', (e) => {
            e.stopPropagation();
            const skill = $(e.currentTarget).data('skill');
            const $categoryHeader = $(e.currentTarget);
            const $category = $categoryHeader.parent();
            if (!this._expandedSavedSkills) this._expandedSavedSkills = new Set();

            if (this._expandedSavedSkills.has(skill)) {
                // Collapse
                this._expandedSavedSkills.delete(skill);
                $categoryHeader.find('.expand-arrow').removeClass('expanded');
                $category.find('.gr-saved-item').slideUp(150, function () { $(this).remove(); });
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
                    const dataId = isCommunitySkill ? `community::${def.id}` : def.id;
                    const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                    return `<div class="gr-saved-item recipe-item" data-id="${dataId}" style="display:none"><span>${iconHtml} ${def.name}</span></div>`;
                }).join('');

                $category.append(itemsHtml);
                const $items = $category.find('.gr-saved-item');
                $items.slideDown(150);

                // Scroll category header to top of dropdown
                $items.first().promise().done(() => {
                    const $dropdown = this.$element.find('.gr-saved-list');
                    const headerOffset = $categoryHeader.position().top;
                    const headerHeight = $categoryHeader.outerHeight();
                    $dropdown.animate({ scrollTop: $dropdown.scrollTop() + headerOffset - headerHeight }, 200);
                });
            }
        });
        this.$element.on('click.gr', '.gr-saved-item', (e) => {
            e.stopPropagation();
            const defId = $(e.currentTarget).data('id') || '';
            this.savedDropdownOpen = false;
            this.$element.find('.gr-saved-dropdown').slideUp(200);
            this.$element.find('.gr-saved-toggle .expand-arrow').removeClass('expanded');

            // Hide the info section when switching definitions
            const $info = $('#activity-recipe-info');
            if ($info.children().length) {
                $info.slideUp(150, () => {
                    // Clear the recipe from the info section
                    store.state.column3.selectedRecipe = 'generic';
                    store._notifySubscribers('column3.selectedRecipe');
                    $info.slideDown(0); // Reset display for future renders
                });
            }

            if (!defId) {
                this.currentDefId = null;
                this.selectedServiceId = null;
                this.inputMode = 'observed';
                this.reverseResult = null;
                this.selectedIcon = '⚡';
                this.selectedIconColor = null;
                this.selectedSkill = '';
                this.requirementRows = [];
                this._populatedName = '';
                this._populatedBaseSteps = '';
                this._populatedBaseXp = '';
                this._populatedMaxEff = 160;
                this._populatedReqLevel = 1;
                this._populatedIsPublic = true;
                this._populatedIsQualityItem = false;
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
        this.$element.on('change.gr', '#gr-show-community', () => this.toggleCommunity());

        // Service search
        this.$element.on('input.gr', '.gr-svc-search', (e) => {
            e.stopPropagation();
            this.serviceSearchText = $(e.target).val();
            // Re-render just the list, not the search box
            const $list = this.$element.find('.gr-svc-dropdown');
            $list.html(this._renderServiceDropdownItems());
            // Re-focus search and restore cursor
            const $search = this.$element.find('.gr-svc-search');
            $search.focus();
            $search[0].setSelectionRange($search.val().length, $search.val().length);
        });

        // Custom service dropdown
        this.$element.on('click.gr', '.gr-svc-button', (e) => {
            e.stopPropagation();
            this.serviceDropdownOpen = !this.serviceDropdownOpen;
            const $dd = this.$element.find('.gr-svc-dropdown');
            const $arrow = this.$element.find('.gr-svc-toggle .expand-arrow');
            if (this.serviceDropdownOpen) {
                $dd.html(this._renderServiceDropdownItems());
                $arrow.addClass('expanded');
                $dd.slideDown(200);
                // Auto-focus search after slideDown
                setTimeout(() => $dd.find('.gr-svc-search').focus(), 160);
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(200);
            }
        });
        // Service search arrow key navigation
        this.$element.on('keydown.gr', '.gr-svc-search', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const $list = this.$element.find('.gr-svc-list');
            const $items = $list.find('.gr-svc-item:visible');
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
        this.$element.on('click.gr', '.gr-svc-item', (e) => {
            e.stopPropagation();
            const svcId = $(e.currentTarget).data('id');
            this.selectedServiceId = svcId || null;
            this.serviceDropdownOpen = false;
            this.serviceSearchText = '';
            this.$element.find('.gr-svc-dropdown').slideUp(200);
            this.$element.find('.gr-svc-toggle .expand-arrow').removeClass('expanded');
            this.$element.find('.gr-svc-value').text(this._getSelectedServiceName());
            // Save to session state for reload persistence
            if (store.state.column3) {
                store.state.column3.genericRecipeServiceId = this.selectedServiceId;
                store._saveColumn3Selection();
            }
            this._updateServiceForm();
        });

        this.$element.on('click.gr', '.btn-save-generic', (e) => {
            e.preventDefault();
            this.submitForm();
        });

        this.$element.on('click.gr', '.btn-view-generic', (e) => {
            e.preventDefault();
            if (!this.currentDefId) return;
            store.state.column3.selectedRecipe = `generic::${this.currentDefId}`;
            store._notifySubscribers('column3.selectedRecipe');
            // Smooth scroll to the info section
            setTimeout(() => {
                const $info = $('#activity-recipe-info');
                if ($info.length) {
                    const headerHeight = $('header').outerHeight() || 60;
                    $('html, body').animate({ scrollTop: $info.offset().top - headerHeight - 8 }, 300);
                }
            }, 200);
        });

        this.$element.on('click.gr', '.btn-delete-generic', (e) => {
            e.preventDefault();
            this.deleteDefinition();
        });

        this.$element.on('click.gr', '.btn-copy-svc-location', (e) => {
            e.preventDefault();
            // Try to get the selected service's location
            if (this.selectedServiceId && this.selectedServiceId !== 'generic') {
                const svc = this.servicesData.find(s => s.id === this.selectedServiceId);
                if (svc && svc.location && this.currentLocationDropdown) {
                    this.currentLocationDropdown.selectLocation(svc.location.id);
                    return;
                }
            }
            // Check if generic service has a location selected
            if (this.selectedServiceId === 'generic' && this.genericServiceForm) {
                const loc = this.genericServiceForm._getSelectedLocation();
                if (loc && this.currentLocationDropdown) {
                    this.currentLocationDropdown.selectLocation(loc);
                    return;
                }
            }
            // Check if it's a saved generic service
            if (this.selectedServiceId && this.selectedServiceId.startsWith('generic::') && this.currentLocationDropdown) {
                // The service was saved — try to get its location from saved defs
                api.showInfo('Use the service location dropdown to set location.');
                return;
            }
            api.showInfo('Select a service first.');
        });

        this.$element.on('click.gr', '.btn-pick-candidate', (e) => {
            e.preventDefault();
            const steps = parseInt($(e.currentTarget).data('steps'));
            const data = this._readForm();
            data.base_steps = steps;

            // Check if XP is ambiguous — show XP picker instead of saving
            const xp = this.reverseResult?.xp_result;
            if (xp && xp.ambiguous && xp.candidates && xp.candidates.length > 1) {
                this.reverseResult.ambiguous = false;
                this.reverseResult.base_steps = steps;
                this.reverseResult.computed_xp = null;
                this.$element.find('.gr-reverse-result-container').html(this._renderReverseResult());
                return;
            }

            if (xp && xp.base_xp != null) {
                data.base_xp = xp.base_xp;
            } else if (data.observed_xp) {
                data.base_xp = data.observed_xp;
            }
            this._saveDefinition(data);
        });

        this.$element.on('click.gr', '.btn-pick-xp-candidate', (e) => {
            e.preventDefault();
            const xpVal = parseInt($(e.currentTarget).data('xp'));
            const data = this._readForm();
            data.base_steps = this.reverseResult.base_steps;
            data.base_xp = xpVal;
            this._saveDefinition(data);
        });

        this.$element.on('click.gr', '.btn-calibrate-xp', async (e) => {
            e.preventDefault();
            const xp = this.reverseResult?.xp_result;
            if (!xp || !xp.candidates) return;

            try {
                const data = this._readForm();
                const result = await api.getXpCalibrationGearset({
                    skill: data.skill,
                    location: '',
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

                // Check if the gear actually disambiguates (produces different displayed values)
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
                this.$element.find('.gr-xp-calibration-area').html(html);
            } catch (err) {
                api.showError('Failed to build XP calibration gearset.');
            }
        });

        this.$element.on('click.gr', '.btn-calibrate', async (e) => {
            e.preventDefault();
            const data = this._readForm();
            try {
                const result = await api.getCalibrationGearset({ skill: data.skill, location: '' });
                if (result.error) { api.showError(result.error); return; }
                const calWe = result.total_we || 0;
                const candidates = this.reverseResult.candidates;
                const itemsList = result.items.map(i => `<div style="padding:2px 0">${i.name} (WE: ${(i.work_efficiency * 100).toFixed(1)}%)</div>`).join('');

                // Pre-compute what each candidate shows with calibration gear
                const skillLevel = store.state.character?.skills?.[data.skill] || 1;
                const levelsAbove = Math.max(0, skillLevel - data.required_level);
                const levelWe = Math.min(levelsAbove, 20) * 0.0125;
                const totalWeWithCal = levelWe + calWe;
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

                this.$element.find('.gr-calibration-area').html(`
                    <div style="margin-top:var(--spacing-sm);padding:var(--spacing-sm);background:var(--bg-tertiary);border-radius:8px">
                        <div style="font-weight:600;margin-bottom:4px">Equip this gear in-game:</div>
                        ${itemsList}
                        <div style="margin-top:var(--spacing-sm);font-weight:600">Then click what you see:</div>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">${calButtons}</div>
                    </div>
                `);
            } catch (err) { api.showError('Failed to build calibration gearset.'); }
        });

        this.$element.on('click.gr', '.btn-cal-solve', async (e) => {
            e.preventDefault();
            const calSteps = parseInt(this.$element.find('#gr-cal-steps').val());
            if (!calSteps || calSteps <= 0) { api.showError('Enter the calibration step count.'); return; }
            const data = this._readForm();
            try {
                const result = await api.reverseCalculate({
                    observed_steps: data.observed_steps,
                    skill_level: store.state.character?.skills?.[data.skill] || 1,
                    required_level: data.required_level,
                    max_efficiency: data.max_efficiency,
                    calibration: { observed_steps: calSteps, stats: this._calibrationStats },
                });
                if (result.base_steps) {
                    data.base_steps = result.base_steps;
                    if (data.observed_xp) data.base_xp = data.observed_xp;
                    this._saveDefinition(data);
                } else { api.showError(result.details || 'Could not resolve. Try different gear.'); }
            } catch (err) { api.showError('Calibration failed.'); }
        });

        // Emoji picker — body-appended floating with smart positioning
        this.$element.on('click.gr', '.gr-icon-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ($('.gr-icon-popup-floating').length) {
                $('.gr-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
                $(document).off('click.gr-icon-floating');
                return;
            }
            const $source = this.$element.find('.gr-icon-popup');
            const $floating = $('<div class="gr-icon-popup-floating"></div>');
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
            $floating.on('click', '.gr-emoji-option', (ev) => {
                ev.stopPropagation();
                this.selectedIcon = $(ev.currentTarget).data('emoji');
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$element.find('.gr-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
                $(document).off('click.gr-icon-floating');
            });
            $floating.on('input', '.gr-icon-color', (ev) => {
                this.selectedIconColor = $(ev.target).val();
                this.$element.find('.gr-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
            });
            $floating.on('click', '.gr-color-clear', () => {
                this.selectedIconColor = null;
                this.$element.find('.gr-icon-btn').html(this.selectedIcon);
                $floating.find('.gr-icon-color').val('#ffffff');
            });
            const fpicker = $floating.find('emoji-picker')[0];
            if (fpicker) fpicker.addEventListener('emoji-click', (ev) => {
                this.selectedIcon = ev.detail.unicode;
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$element.find('.gr-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
                $(document).off('click.gr-icon-floating');
            });
            setTimeout(() => {
                $(document).on('click.gr-icon-floating', (ev) => {
                    if ($(ev.target).closest('.gr-icon-popup-floating, .gr-icon-btn').length) return;
                    $floating.slideUp(150, () => $floating.remove());
                    $(document).off('click.gr-icon-floating');
                });
            }, 10);
        });

        // Close saved dropdown on outside click
        $(document).off('click.gr-saved').on('click.gr-saved', (e) => {
            if (this.savedDropdownOpen && !$(e.target).closest('.gr-saved-selector').length) {
                this._closeSavedDropdown();
            }
        });
    }

    _closeSavedDropdown() {
        if (this.savedDropdownOpen) {
            this.savedDropdownOpen = false;
            this.$element.find('.gr-saved-dropdown').slideUp(200);
            this.$element.find('.gr-saved-toggle .expand-arrow').removeClass('expanded');
        }
    }

    destroy() {
        this.$element.off('click.gr change.gr input.gr keydown.gr');
        $(document).off('click.gr-saved');
        if (this.genericServiceForm) {
            this.genericServiceForm.destroy(); this.genericServiceForm = null;
            this.currentLocationDropdown = null;
        }
        super.destroy();
    }
}

export default GenericRecipeForm;
