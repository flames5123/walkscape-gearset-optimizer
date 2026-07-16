/**
 * CleanupModal component
 * 
 * Modal for detecting and cleaning up duplicate gear sets.
 * Groups gear sets with identical equipment loadouts and lets
 * the user delete duplicates, keeping the most recently modified.
 */

import Component from './base.js';
import api from '../api.js';
import store from '../state.js';

class CleanupModal extends Component {
    constructor(element, props = {}) {
        super(element, props);
        this.groups = [];
        this.loading = false;
        this.expandedGroups = new Set();
        this.isOpen = false;
        this.render();
        this.attachEvents();
    }

    async _loadDuplicates() {
        this.loading = true;
        this.expandedGroups.clear();
        this._updateContent();
        try {
            const uuid = store.state.session?.uuid;
            if (!uuid) {
                this.groups = [];
                return;
            }
            const data = await api.getDuplicateGearSets(uuid);
            this.groups = data.groups || [];
            // Expand all groups by default
            this.groups.forEach((_, i) => this.expandedGroups.add(i));
        } catch (e) {
            this.groups = [];
        } finally {
            this.loading = false;
            this._updateContent();
        }
    }

    _renderGroups() {
        if (this.loading) {
            return '<div class="cleanup-loading">Scanning for duplicates...</div>';
        }
        if (!this.groups.length) {
            return '<div class="cleanup-empty">No duplicate gear sets found</div>';
        }

        return this.groups.map((group, i) => {
            const expanded = this.expandedGroups.has(i);
            const arrow = expanded ? '▼' : '▶';
            const count = group.gear_sets.length;

            const rows = group.gear_sets.map(gs => {
                const isKeep = gs.id === group.keep_id;
                const rowClass = isKeep ? 'cleanup-keep' : 'cleanup-delete';
                const label = isKeep ? 'Keep' : 'Delete';

                if (isKeep) {
                    return `
                        <div class="cleanup-gear-set-row ${rowClass}">
                            <span class="cleanup-label">${label}</span>
                            <input type="text" class="cleanup-rename-input" 
                                   data-group="${i}" data-id="${gs.id}" 
                                   value="${gs.name.replace(/"/g, '&quot;')}" />
                        </div>`;
                }
                return `
                    <div class="cleanup-gear-set-row ${rowClass}">
                        <span class="cleanup-label">${label}</span>
                        <span class="cleanup-name">${gs.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                    </div>`;
            }).join('');

            const keepGs = group.gear_sets.find(gs => gs.id === group.keep_id);
            const keepName = keepGs ? keepGs.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

            return `
                <div class="cleanup-group" data-group="${i}">
                    <div class="cleanup-group-header" data-group="${i}">
                        <span class="cleanup-arrow">${arrow}</span>
                        <span class="cleanup-group-count">${keepName} — ${count} duplicates</span>
                        <button class="cleanup-group-btn" data-group="${i}">Clean Up</button>
                    </div>
                    <div class="cleanup-group-body" style="${expanded ? '' : 'display:none'}">
                        ${rows}
                    </div>
                </div>`;
        }).join('');
    }

    _updateContent() {
        const $content = this.$element.find('.cleanup-modal-content');
        if (!$content.length) return;

        const hasGroups = !this.loading && this.groups.length > 0;
        const cleanAllHtml = hasGroups
            ? '<button class="cleanup-all-btn">Clean Up All</button>'
            : '';

        $content.html(`${cleanAllHtml}${this._renderGroups()}`);
    }

    render() {
        const html = `
            <div class="cleanup-modal-overlay" style="display:none;">
                <div class="modal cleanup-modal">
                    <div class="modal-header">
                        <h2>Clean Up Gear Sets</h2>
                        <button class="cleanup-close-btn">×</button>
                    </div>
                    <div class="cleanup-modal-content">
                    </div>
                </div>
            </div>`;
        this.$element.html(html);
    }

    open() {
        this.isOpen = true;
        const $overlay = this.$element.find('.cleanup-modal-overlay');
        $overlay.css('display', 'flex');
        requestAnimationFrame(() => $overlay.addClass('show'));
        this._loadDuplicates();
    }

    close() {
        this.isOpen = false;
        const $overlay = this.$element.find('.cleanup-modal-overlay');
        $overlay.removeClass('show');
        setTimeout(() => $overlay.css('display', 'none'), 200);
    }

    async _cleanupGroup(groupIndex) {
        const group = this.groups[groupIndex];
        if (!group) return;

        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            const result = await api.cleanupGearSets(uuid, group.delete_ids);
            const count = result.deleted_count || group.delete_ids.length;
            api.showSuccess(`Deleted ${count} duplicate gear set${count !== 1 ? 's' : ''}`);

            // Remove group from list
            this.groups.splice(groupIndex, 1);
            // Rebuild expanded set
            this.expandedGroups.clear();
            this.groups.forEach((_, i) => this.expandedGroups.add(i));

            this._updateContent();
            this._refreshGearSets();
        } catch (e) {
            // Error already shown by api.handleError
        }
    }

    async _cleanupAll() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        const allDeleteIds = this.groups.flatMap(g => g.delete_ids);
        if (!allDeleteIds.length) return;

        try {
            const result = await api.cleanupGearSets(uuid, allDeleteIds);
            const count = result.deleted_count || allDeleteIds.length;
            api.showSuccess(`Deleted ${count} duplicate gear set${count !== 1 ? 's' : ''}`);

            this.groups = [];
            this.expandedGroups.clear();
            this._updateContent();
            this._refreshGearSets();
        } catch (e) {
            // Error already shown by api.handleError
        }
    }

    async _renameGearSet(gearSetId, newName) {
        const uuid = store.state.session?.uuid;
        if (!uuid || !newName.trim()) return;

        try {
            // Find the gear set in saved state to get its slots
            const saved = store.state.gearsets?.saved || {};
            const existing = saved[gearSetId];
            const slots = existing ? existing.slots : {};

            await $.ajax({
                url: `/api/session/${uuid}/gearsets`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ id: gearSetId, name: newName.trim(), slots })
            });
        } catch (e) {
            api.showError('Failed to rename gear set');
        }
    }

    _refreshGearSets() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        $.ajax({
            url: `/api/session/${uuid}/gearsets`,
            method: 'GET'
        }).done(gearSets => {
            // Follow the same pattern as state.js _loadGearSets — mutate directly + notify
            store.state.gearsets.saved = {};
            gearSets.forEach(gs => {
                store.state.gearsets.saved[gs.id] = {
                    name: gs.name,
                    slots: gs.slots_json,
                    export_string: gs.export_string,
                    is_optimized: gs.is_optimized
                };
            });

            // If active gear set was deleted, load the first available
            const currentId = store.state.gearsets.selectedId;
            if (currentId && !store.state.gearsets.saved[currentId]) {
                const firstId = Object.keys(store.state.gearsets.saved)[0];
                if (firstId) {
                    store.loadGearSet(firstId);
                }
            }

            store._notifySubscribers('gearsets.saved');
        });
    }

    attachEvents() {
        // Close button
        this.$element.on('click', '.cleanup-close-btn', () => this.close());

        // Backdrop click
        this.$element.on('click', '.cleanup-modal-overlay', (e) => {
            if ($(e.target).hasClass('cleanup-modal-overlay')) this.close();
        });

        // Escape key
        $(document).on('keydown.cleanupModal', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });

        // Toggle group expand/collapse
        this.$element.on('click', '.cleanup-group-header', (e) => {
            // Don't toggle if clicking the button
            if ($(e.target).hasClass('cleanup-group-btn')) return;
            const idx = parseInt($(e.currentTarget).data('group'));
            const $body = this.$element.find(`.cleanup-group[data-group="${idx}"] .cleanup-group-body`);
            if (this.expandedGroups.has(idx)) {
                this.expandedGroups.delete(idx);
                $body.slideUp(200);
                $(e.currentTarget).find('.cleanup-arrow').text('▶');
            } else {
                this.expandedGroups.add(idx);
                $body.slideDown(200);
                $(e.currentTarget).find('.cleanup-arrow').text('▼');
            }
        });

        // Per-group cleanup
        this.$element.on('click', '.cleanup-group-btn', (e) => {
            e.stopPropagation();
            const idx = parseInt($(e.currentTarget).data('group'));
            this._cleanupGroup(idx);
        });

        // Clean up all
        this.$element.on('click', '.cleanup-all-btn', () => this._cleanupAll());

        // Inline rename on blur or Enter
        this.$element.on('blur', '.cleanup-rename-input', (e) => {
            const id = $(e.target).data('id');
            const newName = $(e.target).val();
            this._renameGearSet(id, newName);
        });
        this.$element.on('keydown', '.cleanup-rename-input', (e) => {
            if (e.key === 'Enter') {
                $(e.target).blur();
            }
        });
    }

    destroy() {
        $(document).off('keydown.cleanupModal');
        super.destroy();
    }
}

export default CleanupModal;
