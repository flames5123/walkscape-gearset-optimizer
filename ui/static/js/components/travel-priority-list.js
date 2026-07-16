/**
 * Travel Priority List
 *
 * The column-3 traveling optimizer's priority panel — the travel analogue of
 * xy-activity-priority-list.js, deliberately kept small because travel exposes
 * only TWO metrics:
 *
 *   - Total Steps          (key 'total_steps', minimize, single)
 *   - Steps / Target Item  (key 'travel_steps_per_target', minimize, duplicable)
 *                          with a target = Chests + any cat:if:* item-finding
 *                          category that can trigger while traveling.
 *
 * Data model: entries are stored/emitted as the backend tuple shape
 *   [metric_key, weight (0-100), target|null]
 * which is exactly what /api/optimization-settings persists under
 * ui_config['optimize_sorting_travel'] and what travel_optimize_worker.py
 * parses into SortingEntry objects. Weighted-blend semantics are identical to
 * the activity optimizer (order = priority, weight = floor/blend).
 *
 * Rendering reuses the same CSS classes as the inline activity/recipe panels
 * (.sort-item, .weight-slider, .target-dropdown-button, .inline-floating-dropdown,
 * .xy-reorder-strip, .sort-add-btn, etc.) so it matches visually without new CSS.
 */

import { wireInfoIcons } from '../info-popover.js';
import { ensureXyStyles } from './xy-recipe-priority-list.js';

// ----------------------------------------------------------------------------
// Metric + target catalogs
// ----------------------------------------------------------------------------

// The two travel metrics. `duplicable` mirrors the Sorting enum flags.
export const TRAVEL_METRICS = [
    { key: 'total_steps',            name: 'Total Steps',      duplicable: false, hasTarget: false },
    { key: 'travel_steps_per_target', name: 'Steps/Target Item', duplicable: true,  hasTarget: true },
];

const TRAVEL_METRIC_BY_KEY = Object.fromEntries(TRAVEL_METRICS.map(m => [m.key, m]));

// Target categories for "Steps / Target Item". Chests (chest_finding driven)
// plus every item-finding category — all of these can trigger on any travel
// action (item finding is global). Kept in sync with the cat:if:* list in
// xy-activity-priority-list.js / optimize-button.js.
export const TRAVEL_TARGETS = [
    { value: 'cat:chests',                       name: 'Chests',                    icon: '/assets/icons/keywords/chest.svg' },
    { value: 'cat:if:adventurers_guild_tokens',  name: "Adventurers' Guild Tokens", icon: "/assets/icons/items/adventurers'_guild_token.svg" },
    { value: 'cat:if:bird_nest',                 name: 'Bird Nest',                 icon: '/assets/icons/items/containers/bird_nest.svg' },
    { value: 'cat:if:crustacean',                name: 'Crustacean',                icon: '/assets/icons/keywords/crustacean.svg' },
    { value: 'cat:if:crustacean_fine',           name: 'Crustacean (Fine)',         icon: '/assets/icons/keywords/crustacean.svg', isFine: true },
    { value: 'cat:if:ectoplasm',                 name: 'Ectoplasm',                 icon: '/assets/icons/items/materials/ectoplasm.svg' },
    { value: 'cat:if:ectoplasm_fine',            name: 'Ectoplasm (Fine)',          icon: '/assets/icons/items/materials/ectoplasm.svg', isFine: true },
    { value: 'cat:if:fibrous_plant',             name: 'Fibrous Plant',             icon: '/assets/icons/keywords/fibrous_plant.svg' },
    { value: 'cat:if:fibrous_plant_fine',        name: 'Fibrous Plant (Fine)',      icon: '/assets/icons/keywords/fibrous_plant.svg', isFine: true },
    { value: 'cat:if:fishing_bait',              name: 'Fishing Bait',              icon: '/assets/icons/keywords/fishing.svg' },
    { value: 'cat:if:fishing_bait_fine',         name: 'Fishing Bait (Fine)',       icon: '/assets/icons/keywords/fishing.svg', isFine: true },
    { value: 'cat:if:gold_nugget',               name: 'Gold Nugget',               icon: '/assets/icons/items/materials/gold_nugget.svg' },
    { value: 'cat:if:gold_nugget_fine',          name: 'Gold Nugget (Fine)',        icon: '/assets/icons/items/materials/gold_nugget.svg', isFine: true },
    { value: 'cat:if:random_gem',                name: 'Random Gem',                icon: '/assets/icons/keywords/gem.svg' },
    { value: 'cat:if:random_gem_fine',           name: 'Random Gem (Fine)',         icon: '/assets/icons/keywords/gem.svg', isFine: true },
    { value: 'cat:if:random_piece_of_junk',      name: 'Random Piece of Junk',      icon: '/assets/icons/keywords/trash.svg' },
    { value: 'cat:if:random_piece_of_junk_fine', name: 'Random Piece of Junk (Fine)', icon: '/assets/icons/keywords/trash.svg', isFine: true },
    { value: 'cat:if:sea_shells',                name: 'Sea Shells',                icon: '/assets/icons/items/materials/sea_shell.svg' },
    { value: 'cat:if:skill_chest',               name: 'Random Skill Chest',        icon: '/assets/icons/keywords/skilling_chest.svg' },
];

const TRAVEL_TARGET_BY_VALUE = Object.fromEntries(TRAVEL_TARGETS.map(t => [t.value, t]));

// Default = single "Total Steps" priority (identical to the pre-panel behaviour).
export function defaultTravelEntries() {
    return [['total_steps', 100, null]];
}

function clampWeight(n) {
    const v = parseInt(n, 10);
    if (isNaN(v)) return 100;
    return Math.max(0, Math.min(100, v));
}

// Normalize an arbitrary saved value into clean [key, weight, target] tuples,
// dropping unknown keys and de-duping non-duplicable metrics.
export function normalizeTravelEntries(raw) {
    const out = [];
    const seen = new Set();
    for (const entry of (Array.isArray(raw) ? raw : [])) {
        let key, weight, target;
        if (Array.isArray(entry)) {
            key = entry[0];
            weight = clampWeight(entry.length >= 2 ? entry[1] : 100);
            target = entry.length >= 3 ? (entry[2] || null) : null;
        } else if (typeof entry === 'string') {
            key = entry; weight = 100; target = null;
        } else {
            continue;
        }
        const metric = TRAVEL_METRIC_BY_KEY[key];
        if (!metric) continue;
        if (!metric.hasTarget) target = null;
        const dedup = target ? `${key}::${target}` : key;
        if (seen.has(dedup) && !metric.duplicable) continue;
        seen.add(dedup);
        out.push([key, weight, target]);
    }
    return out.length ? out : defaultTravelEntries();
}

function targetDisplay(value) {
    const t = TRAVEL_TARGET_BY_VALUE[value];
    return t ? t.name : (value || 'Select target…');
}
function targetIcon(value) {
    const t = TRAVEL_TARGET_BY_VALUE[value];
    return t ? t.icon : null;
}

// ----------------------------------------------------------------------------
// Mount
// ----------------------------------------------------------------------------

/**
 * Mount the travel priority list.
 *
 * @param {jQuery|HTMLElement} mount - container
 * @param {Object} opts
 * @param {Array}  opts.entries  - initial [key,weight,target] tuples
 * @param {'quick'|'detailed'} opts.mode - quick hides reorder/add affordances
 *        by default but still allows weight + target edits; detailed shows
 *        the full editor (add / duplicate / remove / reorder).
 * @param {Function} opts.onChange - called with the new tuple list on any edit
 * @returns controller { destroy, getEntries, setEntries }
 */
export function mountTravelPriorityList(mount, opts = {}) {
    const $mount = (mount && mount.jquery) ? mount : $(mount);
    if (!$mount || !$mount.length) return { destroy() {}, getEntries() { return []; }, setEntries() {} };

    const mode = opts.mode === 'detailed' ? 'detailed' : 'quick';
    let entries = normalizeTravelEntries(opts.entries);
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

    const emit = () => onChange(entries.map(e => [e[0], e[1], e[2] || null]));

    function availableToAdd() {
        // Total Steps can appear at most once; Steps/Target Item is always addable.
        const hasTotal = entries.some(e => e[0] === 'total_steps');
        return TRAVEL_METRICS.filter(m => m.duplicable || !(m.key === 'total_steps' && hasTotal));
    }

    function renderRow(entry, index) {
        const [key, weight, target] = entry;
        const metric = TRAVEL_METRIC_BY_KEY[key];
        if (!metric) return '';
        const atTop = index === 0;
        const atBottom = index === entries.length - 1;
        const isSingle = entries.length <= 1;

        const reorder = mode === 'detailed' ? `
            <div class="xy-reorder-strip">
                <button class="xy-move-up" ${atTop ? 'disabled' : ''} title="Move up" data-index="${index}" tabindex="-1">▲</button>
                <span class="drag-handle" title="Priority order">☰</span>
                <button class="xy-move-down" ${atBottom ? 'disabled' : ''} title="Move down" data-index="${index}" tabindex="-1">▼</button>
            </div>` : '';

        let targetControl = '';
        if (metric.hasTarget) {
            const disp = targetDisplay(target);
            const icon = targetIcon(target);
            const isFine = !!(TRAVEL_TARGET_BY_VALUE[target] && TRAVEL_TARGET_BY_VALUE[target].isFine);
            const iconClass = isFine ? 'target-dropdown-icon fine-icon' : 'target-dropdown-icon';
            const iconHtml = icon ? `<img src="${icon}" alt="${disp}" class="${iconClass}" onerror="this.style.display='none'" />` : '';
            targetControl = `
                <div class="travel-target-control" data-index="${index}" style="margin-top:6px;">
                    <div class="target-label" style="font-size:0.8em;margin-bottom:2px;">Target</div>
                    <div class="target-dropdown-button travel-target-btn" style="padding:6px 10px;">
                        <div class="target-dropdown-value" style="gap:6px;">
                            ${iconHtml}<span style="font-size:0.9em;">${disp}</span>
                        </div>
                        <button class="target-dropdown-toggle"><span class="expand-arrow">▼</span></button>
                    </div>
                </div>`;
        }

        const dupBtn = (mode === 'detailed' && metric.duplicable)
            ? `<button class="sort-duplicate-btn" title="Duplicate this priority" data-index="${index}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                        <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                    </svg>
               </button>`
            : (mode === 'detailed' ? `<span class="sort-duplicate-placeholder"></span>` : '');

        const removeBtn = mode === 'detailed'
            ? `<button class="sort-remove-btn" ${isSingle ? 'disabled' : ''} title="Remove this priority" data-index="${index}">✕</button>`
            : '';

        // Weight is only editable in Detailed — Quick mirrors the activity/recipe
        // Quick panel which shows NO weight slider (weight lives in Detailed).
        const weightRow = mode === 'detailed' ? `
                    <div class="sort-weight-row">
                        <input type="range" class="weight-slider" min="0" max="100" value="${weight}" data-index="${index}" />
                        <input type="number" class="weight-input" min="0" max="100" value="${weight}" data-index="${index}" />
                        <span class="weight-pct">%</span>
                    </div>` : '';
        // Priority position badge in Quick (matches the activity Quick panel).
        const priorityBadge = mode !== 'detailed'
            ? `<span class="xy-priority-badge" title="Priority position">#${index + 1}</span>`
            : '';

        // Row root + name wrapper mirror the activity/recipe panels EXACTLY so
        // spacing matches: Quick rows are slim flat rows (.xy-priority-entry-quick,
        // no .sort-item card padding/border/cursor); Detailed rows are cards
        // (.sort-item .xy-priority-entry). The metric name uses the same
        // .xy-row-compact/.xy-compact-label structure as the xy compact label.
        const rootClass = mode !== 'detailed'
            ? 'xy-priority-entry xy-priority-entry-quick'
            : 'sort-item xy-priority-entry';

        return `
            <div class="${rootClass}" data-index="${index}" data-key="${key}"${mode === 'detailed' ? ' draggable="true"' : ''}>
                ${reorder}
                <div class="sort-item-content">
                    <div class="xy-row-compact"><span class="xy-compact-label">${metric.name}</span></div>
                    ${weightRow}
                    ${targetControl}
                </div>
                ${priorityBadge}
                ${dupBtn}
                ${removeBtn}
            </div>`;
    }

    function renderAddButton() {
        if (mode !== 'detailed') return '';
        const opts = availableToAdd();
        if (!opts.length) return '';
        const optionsHtml = opts.map(m => `<option value="${m.key}">${m.name}</option>`).join('');
        return `
            <div class="sort-add-wrapper">
                <button class="sort-add-btn" title="Add optimization priority">+ Add Optimization Priority</button>
                <select class="sort-add-dropdown" style="display:none;">
                    <option value="">Select a metric…</option>
                    ${optionsHtml}
                </select>
            </div>`;
    }

    function render() {
        ensureXyStyles();
        const rows = entries.map((e, i) => renderRow(e, i)).join('');
        const listCls = mode === 'detailed'
            ? 'sort-list xy-sort-list travel-sort-list'
            : 'sort-list xy-sort-list-quick travel-sort-list';
        $mount.html(`
            <div class="travel-priority-list" data-mode="${mode}">
                ${renderAddButton()}
                <div class="${listCls}">${rows}</div>
            </div>
        `);
        $mount.find('.weight-slider').each(function () {
            updateSliderTrack(this);
        });
        if (mode === 'detailed') attachDrag();
    }

    // HTML5 drag-and-drop reorder for the Detailed panel (mirrors the activity/
    // recipe inline dnd). Rows carry their ORIGINAL data-index; on drop we read
    // the new DOM order of those indices and rebuild `entries` accordingly.
    let _dragged = null;
    function attachDrag() {
        const $list = $mount.find('.travel-sort-list');
        if (!$list.length) return;
        $list.find('.sort-item').attr('draggable', 'true');
        $list.off('dragstart.tpdrag dragover.tpdrag drop.tpdrag dragend.tpdrag');
        // Don't start an item-drag when the gesture begins on an interactive
        // control (weight slider / number input / a button).
        $list.on('mousedown.tpdrag', 'input, button', function () {
            const el = $(this).closest('.sort-item');
            el.attr('draggable', 'false');
            $(document).one('mouseup', () => el.attr('draggable', 'true'));
        });
        $list.on('dragstart.tpdrag', '.sort-item', function (e) {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'button') { e.preventDefault(); return; }
            _dragged = this;
            $(this).addClass('dragging');
            try { e.originalEvent.dataTransfer.effectAllowed = 'move'; } catch (_) { /* noop */ }
        });
        $list.on('dragend.tpdrag', '.sort-item', function () {
            if (_dragged) $(_dragged).removeClass('dragging');
            _dragged = null;
        });
        $list.on('dragover.tpdrag', '.sort-item', function (e) {
            e.preventDefault();
            if (!_dragged || this === _dragged) return;
            const r = this.getBoundingClientRect();
            const mid = r.top + r.height / 2;
            if (e.originalEvent.clientY < mid) $(this).before($(_dragged));
            else $(this).after($(_dragged));
        });
        $list.on('drop.tpdrag', '.sort-item', function (e) {
            e.preventDefault();
            const order = [];
            $list.find('.sort-item').each(function () {
                order.push(parseInt($(this).attr('data-index'), 10));
            });
            const next = order.map(i => entries[i]).filter(Boolean);
            if (next.length === entries.length) {
                entries = next;
                render();
                emit();
            }
        });
        // Touch reorder via the drag-handle (HTML5 dnd isn't triggered by touch).
        $list.on('touchstart.tpdrag', '.drag-handle', function (e) {
            _dragged = $(e.currentTarget).closest('.sort-item')[0];
            if (_dragged) $(_dragged).addClass('dragging');
        });
        $list.on('touchmove.tpdrag', function (e) {
            if (!_dragged) return;
            e.preventDefault();
            const y = e.originalEvent.touches[0].clientY;
            $list.find('.sort-item').not('.dragging').each(function () {
                const r = this.getBoundingClientRect();
                if (y >= r.top && y <= r.bottom) {
                    const mid = r.top + r.height / 2;
                    if (y < mid) $(this).before($(_dragged)); else $(this).after($(_dragged));
                    return false;
                }
            });
        });
        $list.on('touchend.tpdrag touchcancel.tpdrag', function () {
            if (!_dragged) return;
            $(_dragged).removeClass('dragging');
            const order = [];
            $list.find('.sort-item').each(function () {
                order.push(parseInt($(this).attr('data-index'), 10));
            });
            const next = order.map(i => entries[i]).filter(Boolean);
            _dragged = null;
            if (next.length === entries.length) { entries = next; render(); emit(); }
        });
    }

    function updateSliderTrack(el) {
        const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
        el.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${pct}%, var(--bg-primary) ${pct}%, var(--bg-primary) 100%)`;
    }

    // ---- events (delegated on $mount) ----
    const ns = '.travelpriority';

    $mount.on('input' + ns, '.weight-slider', function () {
        const idx = parseInt($(this).data('index'), 10);
        const val = clampWeight(this.value);
        if (entries[idx]) entries[idx][1] = val;
        $(this).closest('.sort-item').find('.weight-input').val(val);
        updateSliderTrack(this);
        emit();
    });
    $mount.on('change' + ns, '.weight-input', function () {
        const idx = parseInt($(this).data('index'), 10);
        const val = clampWeight(this.value);
        $(this).val(val);
        if (entries[idx]) entries[idx][1] = val;
        const $sl = $(this).closest('.sort-item').find('.weight-slider');
        $sl.val(val);
        if ($sl.length) updateSliderTrack($sl[0]);
        emit();
    });

    $mount.on('click' + ns, '.sort-add-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        const $dd = $(this).closest('.sort-add-wrapper').find('.sort-add-dropdown');
        $dd.val('').toggle();
    });
    $mount.on('change' + ns, '.sort-add-dropdown', function () {
        const key = $(this).val();
        if (!key) return;
        const metric = TRAVEL_METRIC_BY_KEY[key];
        // Insert at position #1 (top) — matches the activity/recipe "+" UX.
        entries.unshift([key, 100, metric && metric.hasTarget ? 'cat:chests' : null]);
        render(); emit();
    });

    $mount.on('click' + ns, '.sort-duplicate-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        const idx = parseInt($(this).data('index'), 10);
        const src = entries[idx];
        if (!src) return;
        entries.splice(idx + 1, 0, [src[0], src[1], src[2] || null]);
        render(); emit();
    });
    $mount.on('click' + ns, '.sort-remove-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        if ($(this).prop('disabled')) return;
        const idx = parseInt($(this).data('index'), 10);
        if (entries.length <= 1) return;
        entries.splice(idx, 1);
        render(); emit();
    });
    $mount.on('click' + ns, '.xy-move-up, .xy-move-down', function (e) {
        e.preventDefault(); e.stopPropagation();
        if ($(this).prop('disabled')) return;
        const idx = parseInt($(this).data('index'), 10);
        const isUp = $(this).hasClass('xy-move-up');
        const target = isUp ? idx - 1 : idx + 1;
        if (target < 0 || target >= entries.length) return;
        const [moved] = entries.splice(idx, 1);
        entries.splice(target, 0, moved);
        render(); emit();
    });

    // Target dropdown (floating, mirrors optimize-button.js inline pattern)
    $mount.on('click' + ns, '.travel-target-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        const $btn = $(this);
        const $control = $btn.closest('.travel-target-control');
        const idx = parseInt($control.data('index'), 10);
        const $arrow = $btn.find('.expand-arrow');

        // Close any other open dropdown
        $mount.find('.inline-floating-dropdown').slideUp(150, function () { $(this).remove(); });
        $mount.find('.travel-target-btn .expand-arrow.expanded').not($arrow).removeClass('expanded');

        const already = $mount.find(`.inline-floating-dropdown[data-index="${idx}"]`);
        if (already.length && already.is(':visible')) {
            $arrow.removeClass('expanded');
            already.slideUp(150, function () { $(this).remove(); });
            return;
        }

        const optionsHtml = TRAVEL_TARGETS.map(t => {
            const fineClass = t.isFine ? 'fine-item' : '';
            const iconCls = t.isFine ? 'target-icon fine-icon' : 'target-icon';
            return `<div class="target-item ${fineClass}" data-value="${t.value}">
                        <img src="${t.icon}" alt="${t.name}" class="${iconCls}" onerror="this.style.display='none'" />
                        <span>${t.name}</span>
                    </div>`;
        }).join('');

        const btnRect = $btn[0].getBoundingClientRect();
        const listRect = $mount[0].getBoundingClientRect();
        const top = btnRect.bottom - listRect.top;
        const left = btnRect.left - listRect.left;
        const width = btnRect.width;
        $mount.css('position', 'relative');
        $mount.append(`<div class="inline-floating-dropdown target-dropdown" data-index="${idx}" style="display:none;position:absolute;top:${top}px;left:${left}px;width:${width}px;z-index:3000;">${optionsHtml}</div>`);
        const $dd = $mount.find(`.inline-floating-dropdown[data-index="${idx}"]`);
        wireInfoIcons($dd[0]);
        $arrow.addClass('expanded');
        $dd.slideDown(150);
    });
    $mount.on('click' + ns, '.inline-floating-dropdown .target-item', function (e) {
        e.preventDefault(); e.stopPropagation();
        const $dd = $(this).closest('.inline-floating-dropdown');
        const idx = parseInt($dd.data('index'), 10);
        const value = $(this).data('value');
        if (entries[idx]) entries[idx][2] = value;
        $mount.find('.travel-target-btn .expand-arrow.expanded').removeClass('expanded');
        $dd.slideUp(150, function () { $(this).remove(); });
        render(); emit();
    });

    const outsideHandler = (e) => {
        if (!$(e.target).closest('.inline-floating-dropdown, .travel-target-btn').length) {
            const $open = $mount.find('.inline-floating-dropdown');
            if ($open.length) {
                $mount.find('.travel-target-btn .expand-arrow.expanded').removeClass('expanded');
                $open.slideUp(150, function () { $(this).remove(); });
            }
        }
    };
    $(document).on('click' + ns, outsideHandler);

    render();

    return {
        destroy() {
            $mount.off(ns);
            $(document).off(ns);
            $mount.empty();
        },
        getEntries() { return entries.map(e => [e[0], e[1], e[2] || null]); },
        setEntries(next) { entries = normalizeTravelEntries(next); render(); },
        /** Add a duplicable "Steps / Target Item" priority at position #1 (used
         *  by the Quick header "+" button, mirroring the activity/recipe panels). */
        addPriorityFirst() {
            entries.unshift(['travel_steps_per_target', 100, 'cat:chests']);
            render();
            emit();
        },
    };
}
