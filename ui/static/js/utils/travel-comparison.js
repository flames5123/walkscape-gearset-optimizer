/**
 * Pure builder for the Traveling gearset-comparison view.
 *
 * Extracted from GearsetComparisonSection so it can be unit-tested in node
 * without dragging in jQuery/store/LocationDropdown. Given two /api/travel/stats
 * responses (one per gearset) it returns:
 *   - a totals comparison table (Total Steps / WE / DA), and
 *   - a per-segment route breakdown rendered as the same Steps/WE/DA "pills"
 *     used in the single-view TravelInfoSection (.stats-grid > .info-stat-row).
 *
 * Direction of "better":
 *   - Steps          → LOWER is better (fewer steps to travel the route)
 *   - Work Efficiency → HIGHER is better
 *   - Double Action  → HIGHER is better
 *
 * Fixes bug d74be782 (travel comparison view) + follow-up polish.
 */

import { formatFixed } from './number-format.js';

const STEPS_ICON = '/assets/icons/attributes/steps_required.svg';
const WE_ICON = '/assets/icons/attributes/work_efficiency.svg';
const DA_ICON = '/assets/icons/attributes/double_action.svg';

/**
 * @param {Object|null} stats1 - /api/travel/stats response for gearset 1
 * @param {Object|null} stats2 - /api/travel/stats response for gearset 2
 * @returns {string} HTML, or a fallback message div
 */
export function renderTravelComparisonTable(stats1, stats2) {
    const s1 = stats1;
    const s2 = stats2;
    if (!s1 || !s2 || !s1.total || !s2.total) {
        return '<div class="travel-no-route">Could not calculate travel stats for both gearsets.</div>';
    }

    const icon = (src) => `<img src="${src}" alt="" class="comparison-stat-icon" onerror="this.style.display='none'" />`;
    const cls = (a, b, lowerBetter) => {
        if (a === b) return '';
        return (lowerBetter ? a < b : a > b) ? 'comparison-better' : 'comparison-worse';
    };

    const t1 = s1.total;
    const t2 = s2.total;

    // Steps: single value when no variance, else "min - max (~avg)".
    const stepsDisplay = (t) => {
        if (t.steps_min === t.steps_max) return `${t.steps_max} (~${t.steps_max})`;
        return `${t.steps_min} - ${t.steps_max} (~${t.steps_avg})`;
    };
    // WE offset by 100; game rule floors total efficiency at 1%.
    const weDisplay = (t) => {
        const mn = t.work_efficiency_min + 100;
        const mx = t.work_efficiency_max + 100;
        const f = (v) => formatFixed(v, 1);
        if (mn < 1) {
            return f(mn) === f(mx) ? `1 (${f(mn)}%)` : `1 (${f(mn)}%) - ${f(mx)}%`;
        }
        return f(mn) === f(mx) ? `${f(mn)}%` : `${f(mn)} - ${f(mx)}%`;
    };
    const daDisplay = (t) => {
        const mn = formatFixed(t.double_action_min, 1);
        const mx = formatFixed(t.double_action_max, 1);
        return mn === mx ? `${mn}%` : `${mn} - ${mx}%`;
    };

    let rows = '';
    // Total Steps (lower better) — compared on expected average. The subtitle
    // "(MIN - MAX STEPS, ~AVERAGE)" goes on its own line under the label.
    rows += `<tr>
                <td>
                    <div class="comparison-label" style="white-space:normal">${icon(STEPS_ICON)} Total Steps</div>
                    <div class="travel-cmp-steps-subtitle">(MIN - MAX STEPS, ~AVERAGE)</div>
                </td>
                <td class="${cls(t1.steps_avg, t2.steps_avg, true)}">${stepsDisplay(t1)}</td>
                <td class="${cls(t2.steps_avg, t1.steps_avg, true)}">${stepsDisplay(t2)}</td></tr>`;
    // Work efficiency (higher better) — compared on max.
    const we1Neg = (t1.work_efficiency_max + 100) < 1;
    const we2Neg = (t2.work_efficiency_max + 100) < 1;
    rows += `<tr><td><div class="comparison-label">${icon(WE_ICON)} Work Efficiency</div></td>
            <td class="${we1Neg ? 'stat-value-negative' : cls(t1.work_efficiency_max, t2.work_efficiency_max, false)}">${weDisplay(t1)}</td>
            <td class="${we2Neg ? 'stat-value-negative' : cls(t2.work_efficiency_max, t1.work_efficiency_max, false)}">${weDisplay(t2)}</td></tr>`;
    // Double action (higher better) — compared on max.
    rows += `<tr><td><div class="comparison-label">${icon(DA_ICON)} Double Action</div></td>
            <td class="${cls(t1.double_action_max, t2.double_action_max, false)}">${daDisplay(t1)}</td>
            <td class="${cls(t2.double_action_max, t1.double_action_max, false)}">${daDisplay(t2)}</td></tr>`;

    const table = `
        <table class="comparison-table">
            <thead><tr><th></th><th>Gear set 1</th><th>Gear set 2</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;

    return table + renderRouteSegments(s1.segments || [], s2.segments || []);
}

/**
 * Whole-route DROPS comparison, as its OWN section (matching activities/
 * recipes). Uses each gearset's /api/travel/stats drops_total (the Agility
 * chest + every item-finding category the gear/location provides).
 *
 * Rendered with the same markup activities use so it inherits their styling +
 * interactions:
 *   - .comparison-drop-label-inner[data-drop-name] → hover/click popover
 *     (Agility chest = container popover; item-finding categories = item
 *     popover by name, graceful no-op when unresolved). Wired by the section's
 *     _wireComparisonDropPopovers().
 *   - .comparison-steps-fill[data-gs][data-steps-value] → click fills the
 *     calculator's Steps field for that gear set.
 *
 * steps/item is lower-better; coins / AG tokens per 1k steps are higher-better.
 * Returns '' when neither gearset has drops (older payloads without drops_total).
 */
export function renderTravelDropsComparisonTable(s1, s2) {
    const dt1 = (s1 && s1.drops_total) || {};
    const dt2 = (s2 && s2.drops_total) || {};
    const dl1 = Array.isArray(dt1.drops) ? dt1.drops : [];
    const dl2 = Array.isArray(dt2.drops) ? dt2.drops : [];

    const esc = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // steps/item: a missing (null) drop means the gearset can't find it at all
    // (effectively infinite steps) — so it is NEVER the "better" side.
    const clsSpi = (a, b) => {
        const av = a == null ? Infinity : a;
        const bv = b == null ? Infinity : b;
        if (av === bv) return '';
        return av < bv ? 'comparison-better' : 'comparison-worse';
    };
    const clsHigher = (a, b) => {
        if (a === b) return '';
        return a > b ? 'comparison-better' : 'comparison-worse';
    };

    const byTarget = new Map();
    const order = [];
    const add = (d, key) => {
        if (!d || d.target == null) return;
        let e = byTarget.get(d.target);
        if (!e) {
            e = { target: d.target, name: d.name || d.target, spi1: null, spi2: null };
            byTarget.set(d.target, e);
            order.push(d.target);
        }
        if (d.name && (!e.name || e.name === d.target)) e.name = d.name;
        e[key] = (d.steps_per_item != null && isFinite(d.steps_per_item)) ? d.steps_per_item : null;
    };
    dl1.forEach((d) => add(d, 'spi1'));
    dl2.forEach((d) => add(d, 'spi2'));

    const stepsCell = (spi, otherSpi, gsNum) => {
        if (spi == null) {
            return '<td class="comparison-drop-cell"><div class="comparison-drop-steps">&mdash;</div></td>';
        }
        const disp = spi < 100 ? formatFixed(spi, 1, { trim: true }) : Math.ceil(spi).toLocaleString();
        return `<td class="comparison-drop-cell">
            <div class="comparison-drop-steps comparison-steps-fill ${clsSpi(spi, otherSpi)}" data-gs="${gsNum}" data-steps-value="${spi}" role="button" tabindex="0" title="Click to fill the calculator (Gear set ${gsNum}) with this step count" style="cursor:pointer;">
                <img src="${STEPS_ICON}" alt="Steps" class="comparison-steps-icon" onerror="this.style.display='none'" />
                <span>${disp}</span>
            </div></td>`;
    };

    let dropRows = '';
    for (const target of order) {
        const e = byTarget.get(target);
        const isChest = e.target === 'cat:chests';
        const popName = isChest ? 'Agility chest' : e.name;
        const containerAttr = isChest ? ' data-drop-container="1"' : '';
        dropRows += `<tr class="comparison-drop-row">
            <td class="comparison-drop-label">
                <div class="comparison-drop-label-inner drop-card-interactive" data-drop-name="${esc(popName)}"${containerAttr} title="${esc(e.name)}">${esc(e.name)}</div>
            </td>
            ${stepsCell(e.spi1, e.spi2, 1)}
            ${stepsCell(e.spi2, e.spi1, 2)}</tr>`;
    }

    // Currency-per-1k summary rows (higher-better).
    const coins1 = dt1.coins_per_1k || 0;
    const coins2 = dt2.coins_per_1k || 0;
    const agt1 = dt1.agt_per_1k || 0;
    const agt2 = dt2.agt_per_1k || 0;
    const curRow = (label, v1, v2, digits) =>
        `<tr class="comparison-drop-row">
            <td class="comparison-drop-label"><div class="comparison-label">${label}</div></td>
            <td class="comparison-drop-cell ${clsHigher(v1, v2)}">${formatFixed(v1, digits)}</td>
            <td class="comparison-drop-cell ${clsHigher(v2, v1)}">${formatFixed(v2, digits)}</td></tr>`;
    let currencyRows = '';
    if (coins1 > 0 || coins2 > 0) currencyRows += curRow('Coins / 1k steps', coins1, coins2, 2);
    if (agt1 > 0 || agt2 > 0) currencyRows += curRow('AG Tokens / 1k steps', agt1, agt2, 3);

    if (!dropRows && !currencyRows) return '';

    return `
        <table class="comparison-table comparison-drops-table travel-cmp-drops-table">
            <thead><tr><th></th><th>Gear set 1</th><th>Gear set 2</th></tr></thead>
            <tbody>${currencyRows}${dropRows}</tbody>
        </table>`;
}

/**
 * Per-segment route breakdown. Each segment is a bubble (matching the single
 * view's .travel-segment-bubble) with the start→end header and, for each
 * gearset, a .stats-grid of Steps / WE / DA pills. Better/worse coloring is
 * applied to each pill's value so the comparison stays useful.
 */
function renderRouteSegments(segs1, segs2) {
    if (!segs1.length && !segs2.length) return '';

    const pill = (iconSrc, valueHtml, valueClass) => `
        <div class="info-stat-row">
            <img src="${iconSrc}" alt="" class="stat-icon" onerror="this.style.display='none'" />
            <span class="${valueClass}">${valueHtml}</span>
        </div>`;

    // Expected steps for a segment (mirrors single-view renderSegmentBubble).
    const segSteps = (seg) => {
        if (seg.double_action === 0) return seg.steps_max;
        if (seg.double_action >= 100) return seg.steps_min;
        return seg.steps_avg;
    };
    const segWeRaw = (seg) => (seg.work_efficiency || 0) + 100;
    const segWeDisplay = (seg) => {
        const raw = segWeRaw(seg);
        return raw < 1 ? `1 (${formatFixed(raw, 1)}%)` : `${formatFixed(raw, 1)}%`;
    };

    // Build one gearset's pill group for a segment, colored vs the other
    // gearset's matching segment (missing counterpart => em-dash).
    const pillGroup = (seg, other) => {
        if (!seg) {
            return '<div class="travel-cmp-seg-empty">&mdash;</div>';
        }
        // Steps — lower better.
        const st = segSteps(seg);
        let stepsCls = 'stat-value';
        if (other) {
            const ost = segSteps(other);
            if (st < ost) stepsCls = 'comparison-better';
            else if (st > ost) stepsCls = 'comparison-worse';
        }
        // WE — higher better; negative floors red.
        const weRaw = segWeRaw(seg);
        let weCls;
        if (weRaw < 1) {
            weCls = 'stat-value-negative';
        } else {
            weCls = 'stat-value';
            if (other) {
                const oraw = segWeRaw(other);
                if (weRaw > oraw) weCls = 'comparison-better';
                else if (weRaw < oraw) weCls = 'comparison-worse';
            }
        }
        // DA — higher better.
        const da = seg.double_action || 0;
        let daCls = 'stat-value';
        if (other) {
            const oda = other.double_action || 0;
            if (da > oda) daCls = 'comparison-better';
            else if (da < oda) daCls = 'comparison-worse';
        }
        return `
            <div class="stats-grid">
                ${pill(STEPS_ICON, `~${st}`, stepsCls)}
                ${pill(WE_ICON, segWeDisplay(seg), weCls)}
                ${pill(DA_ICON, `${formatFixed(da, 1)}%`, daCls)}
            </div>`;
    };

    const n = Math.max(segs1.length, segs2.length);
    let bubbles = '';
    for (let i = 0; i < n; i++) {
        const a = segs1[i] || null;
        const b = segs2[i] || null;
        const ref = a || b; // header source (start/end names are gearset-independent)
        const startIcon = ref.start_icon
            ? `<img src="/assets/icons/locations/${ref.start_icon}" alt="" class="segment-location-icon" onerror="this.style.display='none'" />`
            : '';
        const endIcon = ref.end_icon
            ? `<img src="/assets/icons/locations/${ref.end_icon}" alt="" class="segment-location-icon" onerror="this.style.display='none'" />`
            : '';
        bubbles += `
            <div class="travel-segment-bubble">
                <div class="segment-header">${startIcon}${ref.start_name || ref.start} &rarr; ${endIcon}${ref.end_name || ref.end}</div>
                <div class="travel-cmp-seg-cols">
                    <div class="travel-cmp-seg-col">
                        <div class="travel-cmp-seg-gs-label">Gear set 1</div>
                        ${pillGroup(a, b)}
                    </div>
                    <div class="travel-cmp-seg-col">
                        <div class="travel-cmp-seg-gs-label">Gear set 2</div>
                        ${pillGroup(b, a)}
                    </div>
                </div>
            </div>`;
    }

    return `
        <div class="comparison-inline-header travel-cmp-segments-header">ROUTE SEGMENTS</div>
        <div class="travel-cmp-segments">${bubbles}</div>`;
}
