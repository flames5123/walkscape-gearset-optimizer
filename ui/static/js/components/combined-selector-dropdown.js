/**
 * CombinedSelectorDropdown Component
 *
 * A single searchable dropdown that lists BOTH activities and recipes at once,
 * used in the main optimizer's Column 3 when the "Combine activity & recipe
 * search" Misc UI setting is enabled (default off).
 *
 * Design notes
 * ------------
 * This component is a thin UI layer: it does NOT own the column-3 selection
 * state. When the user picks an entry it delegates to the existing, well-tested
 * `window.activitySelector` / `window.recipeSelector` instances (which stay
 * alive but hidden while combined mode is on). Those instances already handle
 * the store mutation, mutual exclusion (activity <-> recipe), non-owned
 * alternative clearing, session auto-save, and generic-form show/hide. We just
 * subscribe to the same store paths to keep our own button label in sync.
 *
 * This has NO effect on the crafting tree, which uses its own decoupled
 * RecipeSelectorDropdown (decoupleColumn3:true).
 *
 * Structure reuses the `.activity-*` CSS classes so styling matches the
 * standalone dropdowns exactly.
 */

import Component from './base.js';
import store from '../state.js';
import KeyboardNavigator from '../utils/keyboard-navigation.js';
import { buildCombinedCategories, findCombinedEntry, sortCombinedEntries, parseSearchQuery } from '../utils/combined-search.js';
import { heartHtml, normalizeFavorites, dragHandleHtml } from '../utils/favorites-ui.js';
import { attachFavoritesDrag } from '../utils/favorites-reorder.js';

const FAVORITES_KEY = '__favorites__';

class CombinedSelectorDropdown extends Component {
    constructor(element, props = {}) {
        super(element, props);

        // UI state
        this.isOpen = false;
        this.searchText = '';
        this.expandedCategories = new Set();
        // Favorites drag-reorder edit mode (Favorites category only).
        this.favoritesEditMode = false;

        // Data caches (own copies; also reused from the sibling selectors when available)
        this.activitiesData = null;
        this.recipesData = null;

        this.keyboardNav = null;

        // Personalization: order by level (shared with the standalone dropdowns)
        const saved = localStorage.getItem('orderActivitiesByLevel');
        this.orderByLevel = saved === null ? true : saved === 'true';
        this._onOrderByLevel = (e) => {
            this.orderByLevel = e.detail.value;
            if (this.isOpen) this.updateList();
        };
        window.addEventListener('orderByLevelChanged', this._onOrderByLevel);

        // Keep our label in sync with whatever the underlying selectors set.
        this.subscribe('column3.selectedActivity', () => this.render());
        this.subscribe('column3.selectedRecipe', () => this.render());
        // Favorites drive the heart states + Favorites category. Refresh the
        // open list on change (incl. undo/redo).
        this.subscribe('ui.favorites', () => this.onFavoritesChange());

        this.loadData();
    }

    /**
     * Load activities + recipes. Reuse the sibling selectors' already-fetched
     * data when present; otherwise fetch directly.
     */
    async loadData() {
        try {
            if (window.activitySelector?.activitiesData) {
                this.activitiesData = window.activitySelector.activitiesData;
            }
            if (window.recipeSelector?.recipesData) {
                this.recipesData = window.recipeSelector.recipesData;
            }
            const jobs = [];
            if (!this.activitiesData) {
                jobs.push($.get('/api/activities').then(r => { this.activitiesData = r; }));
            }
            if (!this.recipesData) {
                jobs.push($.get('/api/recipes').then(r => { this.recipesData = r; }));
            }
            if (jobs.length) await Promise.all(jobs);
        } catch (err) {
            console.error('[CombinedSelector] Failed to load activities/recipes:', err);
        }
        this.render();
    }

    // ---- data helpers -------------------------------------------------------

    getFilteredCategories() {
        return buildCombinedCategories(this.activitiesData, this.recipesData, {
            searchText: this.searchText,
            orderByLevel: this.orderByLevel,
        });
    }

    getSelectedEntry() {
        const col3 = store.state.column3 || {};
        if (col3.selectedActivity) {
            if (col3.selectedActivity === 'generic' || String(col3.selectedActivity).startsWith('generic::')) {
                return { type: 'activity', name: '🔧 Generic Activity', icon_path: null, generic: true };
            }
            return findCombinedEntry(this.activitiesData, this.recipesData, 'activity', col3.selectedActivity);
        }
        if (col3.selectedRecipe) {
            if (col3.selectedRecipe === 'generic' || String(col3.selectedRecipe).startsWith('generic::')) {
                return { type: 'recipe', name: '🔧 Generic Recipe', icon_path: null, generic: true };
            }
            return findCombinedEntry(this.activitiesData, this.recipesData, 'recipe', col3.selectedRecipe);
        }
        return null;
    }

    getSelectedName() {
        const entry = this.getSelectedEntry();
        return entry ? entry.name : 'Search activities & recipes';
    }

    // ---- selection (delegates to the standalone selectors) ------------------

    selectEntry(type, id) {
        if (type === 'activity' && window.activitySelector) {
            window.activitySelector.selectActivity(id);
        } else if (type === 'recipe' && window.recipeSelector) {
            window.recipeSelector.selectRecipe(id);
        }
        this.isOpen = false;
        this.render();
    }

    clearSelection() {
        // Clear both surfaces so neither an activity nor a recipe remains.
        window.activitySelector?.clearSelection();
        window.recipeSelector?.clearSelection();
        this.isOpen = false;
        this.render();
    }

    // ---- open/close ---------------------------------------------------------

    closeDropdown() {
        if (!this.isOpen) return;
        this.isOpen = false;
        if (this.keyboardNav) { this.keyboardNav.detach(); this.keyboardNav = null; }
        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
        const $dropdown = this.$element.find('.activity-dropdown');
        $arrow.removeClass('expanded');
        $dropdown.slideUp(200);
    }

    toggleDropdown() {
        if (!this.isOpen) {
            $(document).trigger('dropdown:opening', { source: 'combined' });
        }
        this.isOpen = !this.isOpen;
        this.searchText = '';

        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
        const $dropdown = this.$element.find('.activity-dropdown');

        if (this.isOpen) {
            this.expandedCategories.clear();
            $dropdown.html(this.renderDropdownContent());
            $arrow.addClass('expanded');
            $dropdown.slideDown(200);
            setTimeout(() => {
                const $searchInput = this.$element.find('.activity-search');
                if ($searchInput.length > 0) {
                    $searchInput.focus();
                    this.initKeyboardNav();
                }
            }, 250);
        } else {
            if (this.keyboardNav) { this.keyboardNav.detach(); this.keyboardNav = null; }
            $arrow.removeClass('expanded');
            $dropdown.slideUp(200);
        }
    }

    initKeyboardNav() {
        const $dropdown = this.$element.find('.activity-dropdown');
        if (this.keyboardNav) this.keyboardNav.detach();
        this.keyboardNav = new KeyboardNavigator($dropdown, {
            itemSelector: '.activity-item, .category-header',
            categorySelector: '.category-header',
            onSelect: ($item) => {
                if ($item.hasClass('none-option')) {
                    this.clearSelection();
                } else if ($item.hasClass('activity-item')) {
                    this.selectEntry($item.data('type'), $item.data('id'));
                }
            },
            onCategoryToggle: ($item) => this.toggleCategory($item.data('skill')),
            getVisibleItems: () => this.$element.find('.activity-item:visible, .category-header:visible'),
        });
        this.keyboardNav.attach();
    }

    // ---- search & categories ------------------------------------------------

    updateSearch(text) {
        this.searchText = text;
        if (text) {
            this.autoExpandMatchingCategories();
        } else {
            this.expandedCategories.clear();
        }
        this.updateList();
        if (this.keyboardNav) this.keyboardNav.reset();
    }

    autoExpandMatchingCategories() {
        const filtered = this.getFilteredCategories();
        this.expandedCategories = new Set(Object.keys(filtered));
    }

    toggleCategory(skill) {
        const $categoryHeader = this.$element.find(`.category-header[data-skill="${skill}"]`);
        const $category = $categoryHeader.parent();

        if (this.expandedCategories.has(skill)) {
            // Collapse — slide up then remove the items (matches the standalone dropdowns).
            this.expandedCategories.delete(skill);
            $categoryHeader.find('.expand-arrow').removeClass('expanded');
            if (skill === FAVORITES_KEY) {
                this.favoritesEditMode = false;
                $categoryHeader.find('.fav-edit-btn').remove();
            }
            $category.find('.activity-item').slideUp(150, function () {
                $(this).remove();
            });
        } else {
            // Expand — append hidden items then slide them down.
            this.expandedCategories.add(skill);
            $categoryHeader.find('.expand-arrow').addClass('expanded');

            // Favorites: inject the Reorder button now that we're expanding via
            // the animation path (the header rendered collapsed without it).
            if (skill === FAVORITES_KEY && !$categoryHeader.find('.fav-edit-btn').length) {
                $(this._favEditBtnHtml()).insertBefore($categoryHeader.find('.expand-arrow'));
            }

            const entries = skill === FAVORITES_KEY
                ? this.getFavoritedEntries()
                : (this.getFilteredCategories()[skill] || []);
            const editable = skill === FAVORITES_KEY && this.favoritesEditMode;
            const itemsHtml = entries.map(e => this.renderEntry(e, { hidden: true, editable })).join('');
            $category.append(itemsHtml);

            const $items = $category.find('.activity-item');
            $items.slideDown(150);

            // Scroll the newly-expanded header into view after its first item settles.
            $items.first().promise().done(() => {
                const $dropdown = this.$element.find('.activity-dropdown');
                const categoryHeaderOffset = $categoryHeader.position().top;
                $dropdown.animate({
                    scrollTop: $dropdown.scrollTop() + categoryHeaderOffset
                }, 200);
            });
        }
    }

    updateList() {
        if (!this.isOpen) return;
        this.$element.find('.activity-list').html(this.renderListInner());
    }

    // ---- rendering ----------------------------------------------------------

    renderTypeChip(type) {
        const label = type === 'recipe' ? 'Recipe' : 'Activity';
        return `<span class="dropdown-type-chip type-${type}">${label}</span>`;
    }

    renderEntry(entry, opts = {}) {
        const { hidden = false, editable = false } = opts;
        const charSkills = store.state.character?.skills || {};
        const charLevel = charSkills[entry.skill?.toLowerCase()] || 1;
        const canDo = charLevel >= (entry.level || 1);
        const levelClass = canDo ? 'level-ok' : 'level-too-high';
        const iconHtml = entry.icon_path
            ? `<img src="${entry.icon_path}" alt="${entry.name}" class="activity-icon" />`
            : '';
        const hiddenStyle = hidden ? ' style="display: none;"' : '';
        const dragAttrs = editable
            ? ` draggable="true" data-fav-type="${entry.type}" data-fav-id="${entry.id}"`
            : '';
        const handle = editable ? dragHandleHtml() : '';
        return `
            <div class="activity-item combined-item${editable ? ' fav-editable' : ''}" data-id="${entry.id}" data-type="${entry.type}"${dragAttrs}${hiddenStyle}>
                ${handle}
                ${iconHtml}
                <span class="activity-name">${entry.name}</span>
                ${this.renderTypeChip(entry.type)}
                ${heartHtml(entry.type, entry.id, store.isFavorite(entry.type, entry.id))}
                <span class="dropdown-level-badge ${levelClass}">Lv. ${entry.level || 1}</span>
            </div>
        `;
    }

    /**
     * Favorited entries (activities + recipes) in MANUAL (favorites-list) order.
     * Search-filtered (incl. the activity/recipe type keyword) unless in edit
     * mode, which shows the full set so a reorder can't drop hidden entries.
     */
    getFavoritedEntries() {
        const fav = normalizeFavorites(store.state.ui?.favorites);
        if (fav.length === 0) return [];
        const { typeFilter, terms } = this.favoritesEditMode
            ? { typeFilter: null, terms: [] }
            : parseSearchQuery(this.searchText);
        const out = [];
        for (const { type, id } of fav) {
            const entry = findCombinedEntry(this.activitiesData, this.recipesData, type, id);
            if (!entry) continue;
            if (typeFilter && entry.type !== typeFilter) continue;
            if (terms.length) {
                const n = entry.name.toLowerCase();
                if (!terms.every(t => n.includes(t))) continue;
            }
            out.push(entry);
        }
        return out; // manual order — NOT sorted
    }

    /**
     * Render the Favorites pseudo-category (collapsed by default, below "None").
     * When expanded, shows a Reorder toggle that turns on drag-to-reorder.
     */
    _favEditBtnHtml() {
        return `<button class="fav-edit-btn${this.favoritesEditMode ? ' active' : ''}" title="Drag to reorder favorites">${this.favoritesEditMode ? 'Done' : 'Reorder'}</button>`;
    }

    renderFavoritesCategory() {
        const favorites = this.getFavoritedEntries();
        if (favorites.length === 0) return '';
        const isExpanded = this.expandedCategories.has(FAVORITES_KEY);
        const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;
        const editBtn = isExpanded ? this._favEditBtnHtml() : '';
        const editable = this.favoritesEditMode;
        const items = isExpanded ? favorites.map(e => this.renderEntry(e, { editable })).join('') : '';
        return `
            <div class="activity-category favorites-category${editable ? ' fav-edit-active' : ''}">
                <div class="category-header favorites-category-header" data-skill="${FAVORITES_KEY}">
                    <span class="fav-cat-icon">♥</span>
                    <span class="skill-name">Favorites</span>
                    ${editBtn}
                    ${arrowIcon}
                </div>
                ${items}
            </div>
        `;
    }

    /**
     * Favorites changed (toggle or undo/redo): refresh the open list.
     */
    onFavoritesChange() {
        if (this.isOpen) this.updateList();
    }

    renderCategory(skill, entries) {
        const isExpanded = this.expandedCategories.has(skill);
        const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;
        const skillId = skill.toLowerCase().replace(' ', '_');
        const skillIconPath = `/assets/icons/text/skill_icons/${skillId}.svg`;
        const SKILL_EMOJI_FALLBACK = { traveling: '🧭' };
        const emojiFallback = SKILL_EMOJI_FALLBACK[skillId];
        const skillIconHtml = emojiFallback
            ? `<img src="${skillIconPath}" alt="${skill}" class="skill-icon" onerror="this.outerHTML='<span class=\\'skill-icon-emoji\\' style=\\'transform:scale(2);display:inline-block\\'>${emojiFallback}</span>'" />`
            : `<img src="${skillIconPath}" alt="${skill}" class="skill-icon" />`;

        const items = isExpanded ? entries.map(e => this.renderEntry(e)).join('') : '';
        return `
            <div class="activity-category">
                <div class="category-header" data-skill="${skill}">
                    ${skillIconHtml}
                    <span class="skill-name">${skill}</span>
                    ${arrowIcon}
                </div>
                ${items}
            </div>
        `;
    }

    renderListInner() {
        const filtered = this.getFilteredCategories();
        const sortedSkills = Object.keys(filtered).sort();
        const categories = sortedSkills.map(skill => this.renderCategory(skill, filtered[skill])).join('');
        const genericHtml = window._featureFlags?.generic ? `
            <div class="activity-item generic-option" data-id="generic" data-type="activity">
                <span class="activity-icon generic-icon">🔧</span>
                <span class="activity-name">Generic Activity</span>
            </div>
            <div class="activity-item generic-option" data-id="generic" data-type="recipe">
                <span class="activity-icon generic-icon">🔧</span>
                <span class="activity-name">Generic Recipe</span>
            </div>` : '';
        return `
            <div class="activity-item none-option">
                <span class="activity-name">None</span>
            </div>
            ${this.renderFavoritesCategory()}
            ${categories}
            ${genericHtml}
        `;
    }

    renderDropdownContent() {
        return `
            <input
                type="text"
                class="activity-search"
                placeholder="Search activities & recipes..."
                value="${this.searchText}"
            />
            <div class="activity-list">
                ${this.renderListInner()}
            </div>
        `;
    }

    renderDropdown() {
        const content = this.isOpen ? this.renderDropdownContent() : '';
        return `<div class="activity-dropdown" style="display: none;">${content}</div>`;
    }

    render() {
        const entry = this.getSelectedEntry();
        const selectedName = this.getSelectedName();
        const arrowIcon = `<span class="expand-arrow ${this.isOpen ? 'expanded' : ''}">▼</span>`;
        const dropdownHtml = this.renderDropdown();

        let valueHtml;
        if (entry && entry.icon_path) {
            valueHtml = `
                <img src="${entry.icon_path}" alt="${entry.name}" class="dropdown-activity-icon" />
                <span>${selectedName}</span>
            `;
        } else {
            valueHtml = `<span>${selectedName}</span>`;
        }

        const html = `
            <div class="activity-selector-dropdown combined-selector-dropdown" data-pin-id="combined-selector">
                <div class="dropdown-label-header">Activity / Recipe</div>
                <div class="dropdown-button">
                    <div class="dropdown-value">${valueHtml}</div>
                    <button class="dropdown-toggle">${arrowIcon}</button>
                </div>
                ${dropdownHtml}
            </div>
        `;
        this.$element.html(html);
        this.attachEvents();
    }

    attachEvents() {
        this.$element.off('click');
        this.$element.off('input');

        this.$element.on('click', '.dropdown-toggle', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });
        this.$element.on('click', '.dropdown-button', (e) => {
            if (!$(e.target).hasClass('dropdown-toggle')) this.toggleDropdown();
        });
        this.$element.on('input', '.activity-search', (e) => {
            e.stopPropagation();
            this.updateSearch($(e.target).val());
        });
        this.$element.on('click', '.category-header', (e) => {
            e.stopPropagation();
            this.toggleCategory($(e.currentTarget).data('skill'));
        });
        // Generic options first (more specific), then regular items.
        this.$element.on('click', '.generic-option', (e) => {
            e.stopPropagation();
            this.selectEntry($(e.currentTarget).data('type'), 'generic');
        });
        // Heart click — toggle favorite without selecting the row
        this.$element.on('click', '.dropdown-fav-heart', (e) => {
            e.stopPropagation();
            const $h = $(e.currentTarget);
            store.toggleFavorite($h.attr('data-fav-type'), $h.attr('data-fav-id'));
        });
        // Favorites "Edit" toggle — enter/exit drag-reorder mode
        this.$element.on('click', '.fav-edit-btn', (e) => {
            e.stopPropagation();
            this.favoritesEditMode = !this.favoritesEditMode;
            if (this.favoritesEditMode) this.expandedCategories.add(FAVORITES_KEY);
            this.updateList();
        });
        this.$element.on('click', '.fav-drag-handle', (e) => e.stopPropagation());
        attachFavoritesDrag(this.$element, {
            ns: '.favdrag-combined',
            isActive: () => this.favoritesEditMode,
            onReorder: (entries) => store.reorderFavoritesAll(entries)
        });
        this.$element.on('click', '.activity-item:not(.none-option):not(.generic-option)', (e) => {
            e.stopPropagation();
            this.selectEntry($(e.currentTarget).data('type'), $(e.currentTarget).data('id'));
        });
        this.$element.on('click', '.none-option', (e) => {
            e.stopPropagation();
            this.clearSelection();
        });

        $(document).on('click.combined-dropdown', (e) => {
            if (this.isOpen && !$(e.target).closest('.combined-selector-dropdown').length) {
                this.closeDropdown();
            }
        });
        $(document).on('dropdown:opening.combined-dropdown', (e, data) => {
            if (data.source !== 'combined') this.closeDropdown();
        });
    }

    destroy() {
        if (this.keyboardNav) { this.keyboardNav.detach(); this.keyboardNav = null; }
        window.removeEventListener('orderByLevelChanged', this._onOrderByLevel);
        $(document).off('click.combined-dropdown');
        $(document).off('dropdown:opening.combined-dropdown');
        super.destroy();
    }
}

export default CombinedSelectorDropdown;
