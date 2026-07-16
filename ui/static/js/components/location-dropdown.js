/**
 * LocationDropdown Component
 * 
 * Searchable dropdown for selecting a location, grouped by region.
 * Uses a floating dropdown appended to <body> to escape overflow:hidden containers.
 * Matches ActivitySelectorDropdown styling and interaction patterns.
 * 
 * Features:
 * - Search box with auto-expand matching regions
 * - Collapsible region sections with slide animations
 * - Location icons next to each location name
 * - Keyboard navigation (arrow keys, Enter, Escape)
 */

import Component from './base.js';

// Module-level cache for /api/locations data. First instance to mount
// triggers the fetch; subsequent mounts read synchronously from the cache
// so the button renders fully populated (icon + "Best → X" label) on the
// FIRST frame. Without this, every LocationDropdown mount was an empty
// container → 50–200ms fetch → populated button, which reads as a flicker
// every time the tree re-renders after Optimize.
let _LOCATIONS_CACHE = null;
let _LOCATIONS_PROMISE = null;

function _getLocationsData() {
    if (_LOCATIONS_CACHE) return Promise.resolve(_LOCATIONS_CACHE);
    if (_LOCATIONS_PROMISE) return _LOCATIONS_PROMISE;
    console.log('[CT-LOC-DROPDOWN] fetching /api/locations (first caller)');
    _LOCATIONS_PROMISE = $.get('/api/locations')
        .then((response) => {
            _LOCATIONS_CACHE = response;
            // Flag on window so other components can detect cache warmth
            // without importing from this module.
            window._LOCATIONS_CACHE_HAS_DATA = true;
            console.log('[CT-LOC-DROPDOWN] /api/locations response cached', {
                regionCount: response && response.regions ? response.regions.length : 0,
            });
            return response;
        })
        .catch((err) => {
            _LOCATIONS_PROMISE = null; // allow retry on next mount
            console.warn('[CT-LOC-DROPDOWN] /api/locations fetch failed', err);
            throw err;
        });
    return _LOCATIONS_PROMISE;
}

/**
 * Preload the locations dataset into the module cache. Safe to call
 * multiple times — only issues one network request. Callers use this
 * at init time (e.g. CraftingTreeView construction) so the first
 * LocationDropdown mounted after the tree arrives renders synchronously
 * with icon + label in place.
 */
export function preloadLocationsData() {
    return _getLocationsData();
}

class LocationDropdown extends Component {
    /**
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props
     * @param {string} props.label - Dropdown label (e.g. "Crafting location")
     * @param {Function} props.onSelect - Callback; receives full location object or null
     * @param {string|null} props.selectedLocation - Initially selected location ID
     */
    constructor(element, props = {}) {
        super(element, props);

        this.label = props.label !== undefined ? props.label : 'Location';
        this.onSelectCallback = props.onSelect || (() => { });
        this.selectedLocation = props.selectedLocation || null;
        // Label for the "no selection" option. Default "None".
        // Crafting tree uses "Best (auto)" semantics.
        this.noneLabel = props.noneLabel || 'None';
        // Optional: when nothing is selected, show this name prefixed with "Best → ".
        // Used by the crafting tree to reflect the post-optimization best location.
        this.bestResolvedName = props.bestResolvedName || null;
        // Optional flat-list mode: when true, no region grouping is rendered —
        // all locations appear in a single flat list. Used for activity nodes
        // that have a small fixed set of valid locations (e.g. "Cut spruce
        // trees" → [Witched Woods, Halfmaw Hideout]).
        this.flat = !!props.flat;
        // Optional allowlist: when set (Set<string> of pretty location names,
        // case-insensitive), only locations whose name matches are rendered.
        // Used to scope the dropdown to an activity's valid locations.
        this.allowedNames = null;
        if (Array.isArray(props.allowedLocationNames) && props.allowedLocationNames.length > 0) {
            this.allowedNames = new Set(
                props.allowedLocationNames.map(n => String(n).toLowerCase())
            );
        }

        this.isOpen = false;
        this.searchText = '';
        this.expandedRegions = new Set();
        // Seed from the module cache if a prior mount already fetched
        // /api/locations. When this is non-null, render() can paint the
        // full button (icon + resolved name) on the very first frame.
        this.locationsData = _LOCATIONS_CACHE;
        this._$floating = null;

        if (this.locationsData) {
            // Synchronous first paint when data is already cached.
            this.render();
        } else {
            this.loadLocations();
        }
    }

    async loadLocations() {
        try {
            const response = await _getLocationsData();
            this.locationsData = response;
            this.render();
        } catch (error) {
            console.error('Failed to load locations:', error);
        }
    }

    getSelectedLocation() {
        if (!this.selectedLocation || !this.locationsData) return null;
        for (const region of this.locationsData.regions) {
            const loc = region.locations.find(l => l.id === this.selectedLocation);
            if (loc) return { ...loc, regionId: region.id, regionName: region.name };
        }
        return null;
    }

    getSelectedLocationName() {
        const loc = this.getSelectedLocation();
        if (loc) return loc.name;
        // When nothing is selected but the optimizer has resolved a best location,
        // show "Best → LocationName" (like the service dropdown does).
        if (this.bestResolvedName) {
            return `${this.noneLabel === 'None' ? 'Best' : this.noneLabel.replace(/ *\(auto\) *$/, '')} → ${this.bestResolvedName}`;
        }
        // If no location is selected, show the noneLabel (e.g. "Best (auto)")
        // instead of "Select location".
        if (this.noneLabel && this.noneLabel !== 'None') return this.noneLabel;
        return `Select ${this.label.toLowerCase()}`;
    }

    /**
     * Update the "best resolved" name (post-optimization). Re-renders the button label.
     * Only affects the display when no explicit selection is set.
     */
    setBestResolvedName(name) {
        this.bestResolvedName = name || null;
        if (!this.selectedLocation) {
            // Update button label (text). Also swap the icon src to the
            // newly-resolved location so the pin matches the name.
            const $label = this.$element.find('.dropdown-value span');
            if ($label.length) $label.text(this.getSelectedLocationName());
            const $icon = this.$element.find('.dropdown-value img.dropdown-activity-icon');
            if (this.locationsData) {
                let iconLoc = null;
                if (this.bestResolvedName) {
                    const target = String(this.bestResolvedName).toLowerCase().replace(/\s+/g, '_').replace(/'/g, '');
                    for (const region of this.locationsData.regions) {
                        const loc = region.locations.find(l =>
                            l.id === target
                            || (l.name && String(l.name).toLowerCase() === String(this.bestResolvedName).toLowerCase())
                        );
                        if (loc) { iconLoc = loc; break; }
                    }
                }
                if (iconLoc && iconLoc.icon_name) {
                    const src = `/assets/icons/locations/${iconLoc.icon_name}`;
                    if ($icon.length) {
                        $icon.attr('src', src).attr('alt', iconLoc.name || '');
                    } else {
                        // No icon element in the button yet — the initial
                        // render ran before bestResolvedName was known. Full
                        // re-render so the layout picks up the icon slot.
                        this.render();
                    }
                } else if ($icon.length) {
                    // Resolved name no longer maps to an icon — drop it.
                    $icon.remove();
                }
            }
        }
    }

    // ========================================================================
    // FLOATING DROPDOWN OPEN / CLOSE
    // ========================================================================

    closeDropdown() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.$element.find('.dropdown-toggle .expand-arrow').removeClass('expanded');
        this._destroyFloating();
    }

    _destroyFloating() {
        if (this._$floating) {
            this._$floating.remove();
            this._$floating = null;
        }
        $(document).off('mousedown.loc-floating');
    }

    toggleDropdown() {
        if (!this.isOpen) {
            $(document).trigger('dropdown:opening', { source: `location-${this.label}` });
        }

        this.isOpen = !this.isOpen;
        this.searchText = '';

        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');

        if (this.isOpen) {
            this.expandedRegions.clear();
            this._createFloating();
            $arrow.addClass('expanded');
        } else {
            $arrow.removeClass('expanded');
            this._destroyFloating();
        }
    }

    _createFloating() {
        // Remove any stale floating dropdown
        this._destroyFloating();

        const $btn = this.$element.find('.dropdown-button');
        const rect = $btn[0].getBoundingClientRect();

        // Use custom floating width if provided (e.g., comparison view uses parent section width)
        let floatingLeft = rect.left;
        let floatingWidth = rect.width;
        if (this.props.floatingWidthElement) {
            const $parent = $(this.props.floatingWidthElement);
            if ($parent.length) {
                const parentRect = $parent[0].getBoundingClientRect();
                floatingLeft = parentRect.left;
                floatingWidth = parentRect.width;
            }
        }

        const MAX_HEIGHT = 350;
        const GAP = 4;

        // Determine whether to open above or below the button
        const spaceBelow = window.innerHeight - rect.bottom - GAP;
        const spaceAbove = rect.top - GAP;
        const openAbove = spaceBelow < MAX_HEIGHT && spaceAbove > spaceBelow;

        // Store positioning info so region expand/collapse can re-anchor
        this._buttonRect = rect;
        this._openAbove = openAbove;
        this._gap = GAP;
        this._maxHeight = MAX_HEIGHT;

        const $f = $('<div class="loc-dd-floating activity-dropdown"></div>');
        $f.html(this.renderDropdownContent());

        // Place off-screen first to measure actual content height
        $f.css({
            position: 'fixed',
            top: '-9999px',
            left: floatingLeft + 'px',
            width: floatingWidth + 'px',
            overflowY: 'scroll',
            zIndex: 100000,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            visibility: 'hidden',
            display: 'block'
        });
        $('body').append($f);
        this._$floating = $f;

        // Measure natural height (capped at MAX_HEIGHT and available space)
        const naturalHeight = $f[0].scrollHeight;
        let finalTop, initialHeight, roomForGrowth;
        if (openAbove) {
            roomForGrowth = Math.min(MAX_HEIGHT, spaceAbove);
            initialHeight = Math.min(naturalHeight, roomForGrowth);
            finalTop = rect.top - initialHeight - GAP;
        } else {
            roomForGrowth = Math.min(MAX_HEIGHT, Math.max(spaceBelow, 150));
            initialHeight = Math.min(naturalHeight, roomForGrowth);
            finalTop = rect.bottom + GAP;
        }

        // Apply final positioning. Use roomForGrowth as maxHeight so that expanding
        // regions can grow the dropdown up to the available space limit.
        $f.css({
            top: finalTop + 'px',
            maxHeight: roomForGrowth + 'px',
            visibility: 'visible',
            display: 'none'
        });

        if (openAbove) {
            // Slide UP animation: start anchored just above the button with 0 height,
            // then grow upward (top moves up, height increases).
            $f.css({
                top: (rect.top - GAP) + 'px',
                height: '0px',
                overflow: 'hidden',
                display: 'block'
            });
            $f.animate({
                top: finalTop + 'px',
                height: initialHeight + 'px'
            }, 200, function () {
                $(this).css({
                    height: '',  // Remove explicit height so content determines actual height
                    overflowY: 'scroll',
                    overflow: ''
                });
            });
        } else {
            $f.slideDown(200);
        }

        this._wireFloatingEvents();

        // Close on outside click
        setTimeout(() => {
            $(document).on('mousedown.loc-floating', (ev) => {
                if (!$(ev.target).closest('.loc-dd-floating, .dropdown-button').length) {
                    this.closeDropdown();
                }
            });
        }, 50);

        // Focus search input quickly so arrow keys work immediately
        setTimeout(() => {
            const $search = $f.find('.activity-search');
            if ($search.length) $search.focus();
        }, 50);
    }

    // ========================================================================
    // FLOATING EVENT WIRING
    // ========================================================================

    _wireFloatingEvents() {
        const $f = this._$floating;
        if (!$f) return;

        // Location item click
        $f.on('click', '.activity-item:not(.none-option)', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('id');
            if (id) this.selectLocation(id);
        });

        // None option
        $f.on('click', '.none-option', (e) => {
            e.stopPropagation();
            this.clearSelection();
        });

        // Region header click — expand/collapse with animation
        $f.on('click', '.category-header', (e) => {
            e.stopPropagation();
            const regionId = $(e.currentTarget).data('skill');
            this._toggleRegionInFloating(regionId);
        });

        // Search input
        $f.on('input', '.activity-search', (e) => {
            e.stopPropagation();
            this.searchText = $(e.target).val();
            this.autoExpandMatchingRegions();
            // Re-render just the list portion. Flat mode renders the
            // matching locations as a single flat list; region mode
            // renders region groups (with auto-expand for matches).
            let listInnerHtml;
            if (this.flat) {
                const flat = this.getFlatLocations();
                listInnerHtml = flat.map(loc => {
                    const iconPath = loc.icon_name ? `/assets/icons/locations/${loc.icon_name}` : '';
                    const iconHtml = iconPath
                        ? `<img src="${iconPath}" alt="${loc.name}" class="activity-icon" />`
                        : '';
                    return `
                        <div class="activity-item" data-id="${loc.id}">
                            ${iconHtml}
                            <span class="activity-name">${loc.name}</span>
                        </div>
                    `;
                }).join('');
            } else {
                const regions = this.getFilteredRegions();
                listInnerHtml = regions.map(r => this.renderRegion(r)).join('');
            }
            $f.find('.activity-list').html(`
                <div class="activity-item none-option">
                    <span class="activity-name">${this.noneLabel}</span>
                </div>
                ${listInnerHtml}
            `);
            // Re-anchor after content changes
            this._reanchorIfAbove(true);
        });

        // Keyboard navigation — bind directly on the input element (not delegated)
        // to avoid any interference from document-level keydown handlers
        const $search = $f.find('.activity-search');
        if ($search.length) {
            $search[0].addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeDropdown();
                    return;
                }
                const isNav = e.key === 'ArrowDown' || e.key === 'ArrowUp';
                const isActivate = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
                if (!isNav && !isActivate) return;
                e.preventDefault();
                e.stopImmediatePropagation();

                // Include both locations and region headers in navigation so arrow keys
                // move over categories too (matches activity/recipe selector behavior).
                const $items = $f.find('.activity-item:visible, .category-header:visible');
                if (!$items.length) return;

                const $active = $items.filter('.keyboard-active');
                let idx = $active.length ? $items.index($active) : -1;

                if (e.key === 'ArrowDown') {
                    $items.removeClass('keyboard-active');
                    idx = idx < $items.length - 1 ? idx + 1 : 0;
                    $items.eq(idx).addClass('keyboard-active');
                    this._scrollItemIntoView($f, $items.eq(idx));
                } else if (e.key === 'ArrowUp') {
                    $items.removeClass('keyboard-active');
                    idx = idx > 0 ? idx - 1 : $items.length - 1;
                    $items.eq(idx).addClass('keyboard-active');
                    this._scrollItemIntoView($f, $items.eq(idx));
                } else if (isActivate && $active.length) {
                    // Enter/Space on a category header toggles open/close;
                    // on a location item it selects. Both are handled by the
                    // existing delegated click handlers, so just fire a click.
                    $active.trigger('click');
                }
            }, true);  // useCapture = true to get the event first
        }
    }

    _scrollItemIntoView($container, $el) {
        const el = $el[0];
        if (!el) return;
        const elTop = el.offsetTop;
        const elBottom = elTop + el.offsetHeight;
        const viewTop = $container[0].scrollTop;
        const viewBottom = viewTop + $container[0].clientHeight;
        if (elBottom > viewBottom) $container[0].scrollTop += elBottom - viewBottom;
        else if (elTop < viewTop) $container[0].scrollTop = elTop;
    }

    /**
     * Re-anchor the dropdown's top position after content height changes,
     * keeping the bottom edge anchored just above the button (for openAbove mode).
     * @param {boolean} [animate=true] - Whether to animate the reposition
     */
    _reanchorIfAbove(animate = true) {
        if (!this._openAbove || !this._$floating || !this._buttonRect) return;

        const $f = this._$floating;
        // Measure actual content height (scrollHeight reflects full content)
        const contentHeight = $f[0].scrollHeight;
        const spaceAbove = this._buttonRect.top - this._gap;
        const actualHeight = Math.min(contentHeight, this._maxHeight, spaceAbove);
        const newTop = this._buttonRect.top - actualHeight - this._gap;

        $f.css('maxHeight', actualHeight + 'px');
        if (animate) {
            $f.stop(true, false).animate({ top: newTop + 'px' }, 150);
        } else {
            $f.css('top', newTop + 'px');
        }
    }

    // ========================================================================
    // REGION EXPAND / COLLAPSE (animated, in floating dropdown)
    // ========================================================================

    _toggleRegionInFloating(regionId) {
        const $f = this._$floating;
        if (!$f) return;

        const $header = $f.find(`.category-header[data-skill="${regionId}"]`);
        const $category = $header.parent();

        if (this.expandedRegions.has(regionId)) {
            // Collapse
            this.expandedRegions.delete(regionId);
            $header.find('.expand-arrow').removeClass('expanded');
            $category.find('.activity-item').slideUp(150, () => {
                $category.find('.activity-item').remove();
                // Re-anchor after content shrinks
                this._reanchorIfAbove(true);
            });
        } else {
            // Expand
            this.expandedRegions.add(regionId);
            $header.find('.expand-arrow').addClass('expanded');

            const region = this.locationsData.regions.find(r => r.id === regionId);
            if (!region) return;

            const locations = this.searchText
                ? region.locations.filter(l => l.name.toLowerCase().includes(this.searchText.toLowerCase()))
                : region.locations;

            const itemsHtml = locations.map(loc => {
                const iconPath = loc.icon_name ? `/assets/icons/locations/${loc.icon_name}` : '';
                const iconHtml = iconPath
                    ? `<img src="${iconPath}" alt="${loc.name}" class="activity-icon" />`
                    : '';
                return `
                    <div class="activity-item" data-id="${loc.id}" style="display: none;">
                        ${iconHtml}
                        <span class="activity-name">${loc.name}</span>
                    </div>
                `;
            }).join('');

            $category.append(itemsHtml);
            const $items = $category.find('.activity-item');
            $items.slideDown(150);

            // Re-anchor in parallel with the slide animation so bottom stays pinned to button
            this._reanchorIfAbove(true);

            // Scroll region header into view (only when opening downward, to avoid
            // fighting with the re-anchor animation in openAbove mode)
            if (!this._openAbove) {
                $items.first().promise().done(() => {
                    if ($header.length && $header.position()) {
                        $f.animate({
                            scrollTop: $f.scrollTop() + $header.position().top
                        }, 200);
                    }
                });
            }
        }
    }

    autoExpandMatchingRegions() {
        if (!this.locationsData || !this.searchText) return;
        const searchLower = this.searchText.toLowerCase();
        this.expandedRegions.clear();
        for (const region of this.locationsData.regions) {
            if (region.locations.some(l => l.name.toLowerCase().includes(searchLower))) {
                this.expandedRegions.add(region.id);
            }
        }
    }

    // ========================================================================
    // SELECTION (no full re-render — just update button + close floating)
    // ========================================================================

    /**
     * Programmatically set the selected location (e.g., from session restore).
     * Updates the button display without triggering the onSelect callback.
     * @param {string|null} locationId
     */
    setSelectedLocation(locationId) {
        this.selectedLocation = locationId;
        this._updateButtonDisplay();
    }

    selectLocation(locationId) {
        console.log('[LOC-FLICKER] LocationDropdown.selectLocation called', { locationId, label: this.label, hadBestResolved: this.bestResolvedName });
        this.selectedLocation = locationId;
        // User picked an explicit location — clear any stale "best resolved"
        // name so the button doesn't briefly flash "Best → <previous>" while
        // the parent component is recalculating in the background.
        this.bestResolvedName = null;
        this.isOpen = false;
        this._updateButtonDisplay();
        this.$element.find('.dropdown-toggle .expand-arrow').removeClass('expanded');
        this._destroyFloating();

        const loc = this.getSelectedLocation();
        console.log('[LOC-FLICKER] LocationDropdown about to call onSelectCallback', { loc });
        this.onSelectCallback(loc);
    }

    clearSelection() {
        console.log('[LOC-FLICKER] LocationDropdown.clearSelection called', { label: this.label, hadBestResolved: this.bestResolvedName });
        this.selectedLocation = null;
        // Clearing back to "Best (auto)" should drop any previously resolved
        // best name too, otherwise the button flashes "Best → <prev>" until
        // the next recalculate populates stats.location.
        this.bestResolvedName = null;
        this.isOpen = false;
        this._updateButtonDisplay();
        this.$element.find('.dropdown-toggle .expand-arrow').removeClass('expanded');
        this._destroyFloating();

        console.log('[LOC-FLICKER] LocationDropdown clearSelection about to call onSelectCallback(null)');
        this.onSelectCallback(null);
    }

    _updateButtonDisplay() {
        const selectedLoc = this.getSelectedLocation();
        const selectedName = this.getSelectedLocationName();
        let html = '';
        if (selectedLoc && selectedLoc.icon_name) {
            html = `
                <img src="/assets/icons/locations/${selectedLoc.icon_name}" alt="${selectedLoc.name}" class="dropdown-activity-icon" />
                <span>${selectedName}</span>
            `;
        } else {
            html = `<span>${selectedName}</span>`;
        }
        this.$element.find('.dropdown-value').html(html);
    }

    // ========================================================================
    // FILTERING
    // ========================================================================

    getFilteredRegions() {
        if (!this.locationsData) return [];
        const searchLower = this.searchText.toLowerCase();
        const passesAllowlist = (loc) => {
            if (!this.allowedNames) return true;
            return this.allowedNames.has(String(loc.name).toLowerCase());
        };
        const passesSearch = (loc) => {
            if (!searchLower) return true;
            return l_name_lc(loc).includes(searchLower);
        };
        function l_name_lc(loc) { return String(loc.name || '').toLowerCase(); }
        return this.locationsData.regions
            .map(region => {
                const matching = region.locations.filter(l => passesAllowlist(l) && passesSearch(l));
                return matching.length > 0 ? { ...region, locations: matching } : null;
            })
            .filter(Boolean);
    }

    /**
     * Flat list of every location matching the allowlist + current search,
     * with no region grouping. Used when this.flat === true. Sorted A-Z.
     */
    getFlatLocations() {
        if (!this.locationsData) return [];
        const searchLower = this.searchText.toLowerCase();
        const out = [];
        for (const region of this.locationsData.regions) {
            for (const loc of region.locations) {
                if (this.allowedNames && !this.allowedNames.has(String(loc.name).toLowerCase())) continue;
                if (searchLower && !String(loc.name).toLowerCase().includes(searchLower)) continue;
                out.push({ ...loc, regionId: region.id, regionName: region.name });
            }
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return out;
    }

    // ========================================================================
    // RENDERING
    // ========================================================================

    renderRegion(region) {
        const isExpanded = this.expandedRegions.has(region.id);
        const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;

        const locationItems = isExpanded ? region.locations.map(loc => {
            const iconPath = loc.icon_name ? `/assets/icons/locations/${loc.icon_name}` : '';
            const iconHtml = iconPath
                ? `<img src="${iconPath}" alt="${loc.name}" class="activity-icon" />`
                : '';
            return `
                <div class="activity-item" data-id="${loc.id}">
                    ${iconHtml}
                    <span class="activity-name">${loc.name}</span>
                </div>
            `;
        }).join('') : '';

        return `
            <div class="activity-category">
                <div class="category-header" data-skill="${region.id}">
                    <img src="${region.icon}" alt="${region.name}" class="skill-icon" />
                    <span class="skill-name">${region.name}</span>
                    ${arrowIcon}
                </div>
                ${locationItems}
            </div>
        `;
    }

    renderDropdownContent() {
        // Flat mode: skip region grouping, render every matching location
        // as a single flat list. Used for activity nodes with a small set
        // of valid locations.
        if (this.flat) {
            const flat = this.getFlatLocations();
            const items = flat.map(loc => {
                const iconPath = loc.icon_name ? `/assets/icons/locations/${loc.icon_name}` : '';
                const iconHtml = iconPath
                    ? `<img src="${iconPath}" alt="${loc.name}" class="activity-icon" />`
                    : '';
                return `
                    <div class="activity-item" data-id="${loc.id}">
                        ${iconHtml}
                        <span class="activity-name">${loc.name}</span>
                    </div>
                `;
            }).join('');
            return `
                <input
                    type="text"
                    class="activity-search"
                    placeholder="Search locations..."
                    value="${this.searchText}"
                />
                <div class="activity-list">
                    <div class="activity-item none-option">
                        <span class="activity-name">${this.noneLabel}</span>
                    </div>
                    ${items}
                </div>
            `;
        }

        const filteredRegions = this.getFilteredRegions();
        const regionsHtml = filteredRegions.map(r => this.renderRegion(r)).join('');

        return `
            <input 
                type="text" 
                class="activity-search" 
                placeholder="Search locations..."
                value="${this.searchText}"
            />
            <div class="activity-list">
                <div class="activity-item none-option">
                    <span class="activity-name">${this.noneLabel}</span>
                </div>
                ${regionsHtml}
            </div>
        `;
    }

    render() {
        const selectedLoc = this.getSelectedLocation();
        const selectedName = this.getSelectedLocationName();
        const arrowIcon = `<span class="expand-arrow">▼</span>`;

        // Look up icon for display: prefer the explicit selection, then fall
        // back to the resolved "Best → X" location (post-optimization) so the
        // tree-node and other callers show an icon consistently with how the
        // service dropdown renders its auto-resolved selection.
        let iconLoc = selectedLoc;
        if (!iconLoc && this.bestResolvedName && this.locationsData) {
            const target = String(this.bestResolvedName).toLowerCase().replace(/\s+/g, '_').replace(/'/g, '');
            for (const region of this.locationsData.regions) {
                const loc = region.locations.find(l =>
                    l.id === target
                    || (l.name && String(l.name).toLowerCase() === String(this.bestResolvedName).toLowerCase())
                );
                if (loc) { iconLoc = loc; break; }
            }
        }
        console.log('[CT-LOC-DROPDOWN] render', {
            label: this.label,
            selectedLocation: this.selectedLocation,
            bestResolvedName: this.bestResolvedName,
            selectedName,
            hasLocationsData: !!this.locationsData,
            iconLocFound: !!iconLoc,
            iconLocName: iconLoc ? iconLoc.name : null,
        });

        let dropdownValueHtml = '';
        if (iconLoc && iconLoc.icon_name) {
            dropdownValueHtml = `
                <img src="/assets/icons/locations/${iconLoc.icon_name}" alt="${iconLoc.name || selectedName}" class="dropdown-activity-icon" />
                <span>${selectedName}</span>
            `;
        } else {
            dropdownValueHtml = `<span>${selectedName}</span>`;
        }

        const labelHtml = this.label ? `<div class="dropdown-label-header">${this.label}</div>` : '';

        const html = `
            <div class="activity-selector-dropdown" data-pin-id="location-picker">
                ${labelHtml}
                <div class="dropdown-button">
                    <div class="dropdown-value">${dropdownValueHtml}</div>
                    <button class="dropdown-toggle">${arrowIcon}</button>
                </div>
            </div>
        `;

        this.$element.html(html);
        this.attachEvents();
    }

    // ========================================================================
    // EVENTS (on the button only — floating has its own wiring)
    // ========================================================================

    attachEvents() {
        this.$element.off('click');

        this.$element.on('click', '.dropdown-toggle', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        this.$element.on('click', '.dropdown-button', (e) => {
            if (!$(e.target).hasClass('dropdown-toggle') && !$(e.target).closest('.dropdown-toggle').length) {
                this.toggleDropdown();
            }
        });

        // Close when other dropdowns open
        const eventNs = `location-dropdown-${this.label}`;
        $(document).off(`dropdown:opening.${eventNs}`);
        $(document).on(`dropdown:opening.${eventNs}`, (_, data) => {
            if (data.source !== `location-${this.label}`) {
                this.closeDropdown();
            }
        });
    }

    destroy() {
        this._destroyFloating();
        const eventNs = `location-dropdown-${this.label}`;
        $(document).off(`dropdown:opening.${eventNs}`);
        super.destroy();
    }
}

export default LocationDropdown;
