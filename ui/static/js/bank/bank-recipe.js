/**
 * bank-recipe.js — Recipe → category/tab generator (Phase 1, one-click).
 *
 * Builds a tab whose per-stage categories collect a recipe's materials (by depth
 * in the crafting tree), each using an engine `item_id` filter. Data comes from
 * the existing crafting-tree endpoints. Node shape is read defensively (best-effort
 * pending live validation).
 *
 * Spec: .kiro/BANK_LAYOUT_SPEC.md §7/§15.
 */
import { getBankItems } from './bank-adapter.js';

function sessionUuid() {
    return (window.store && window.store.state && window.store.state.session && window.store.state.session.uuid)
        || (document.cookie.match(/session_uuid=([^;]+)/) || [])[1] || null;
}
function rid(p) { return p + Math.random().toString(36).slice(2, 7); }

export async function listRecipeItems() {
    try {
        const r = await fetch('/api/crafting-tree/items');
        if (!r.ok) return [];
        const d = await r.json();
        return (d.items || []).map((i) => ({ id: i.item_id || i.id, name: i.name || i.item_id || i.id }));
    } catch (_e) { return []; }
}

const CHILD_KEYS = ['children', 'inputs', 'materials', 'material_nodes', 'inputs_detail'];
const idOf = (n) => n && (n.item_id || n.id || n.itemId || n.output_item_id);

export async function generateRecipeTab(itemId, displayName) {
    const body = { item_id: itemId };
    const su = sessionUuid();
    if (su) body.session_uuid = su;
    const r = await fetch('/api/crafting-tree/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('build ' + r.status);
    const data = await r.json();
    const nodes = data.nodes || [];

    // Collect material ids grouped by tree depth (root/target = depth 0, excluded).
    const byDepth = new Map();
    (function walk(list, depth) {
        for (const n of (list || [])) {
            const id = idOf(n);
            if (id && depth > 0) {
                if (!byDepth.has(depth)) byDepth.set(depth, new Set());
                byDepth.get(depth).add(id);
            }
            for (const k of CHILD_KEYS) if (Array.isArray(n[k])) walk(n[k], depth + 1);
        }
    })(nodes, 0);

    const depths = [...byDepth.keys()].sort((a, b) => b - a); // deepest (raw) first
    const cats = depths.map((depth, i) => {
        const ids = [...byDepth.get(depth)];
        return {
            id: rid('stage'), name: `Stage ${i + 1} (${ids.length})`,
            color: '#7b9cff', bgShape: 'circle',
            filters: [{ type: 'item_id', value: ids }],
        };
    });

    return {
        id: rid('recipe'), name: `Recipe: ${displayName || itemId}`,
        color: '#7b9cff', bgShape: 'diamond', icon: '', filters: [],
        categories: cats.length ? cats : [
            { id: rid('mats'), name: 'Materials', color: '#7b9cff', bgShape: 'circle', filters: [{ type: 'item_id', value: [] }] },
        ],
    };
}

/**
 * Flat, de-duped list of every material item-id in a recipe's FULL crafting
 * tree (the target/output at depth 0 is excluded). Used by the category
 * "Recipe" filter so all of a recipe's materials auto-collect into that
 * category.
 *
 * NOTE: /api/crafting-tree/build returns a FLAT node list (each node has a
 * `depth` and `parent_id`), NOT nested children — materials are the nodes with
 * depth > 0. Each node's `item_id` is a dotted ref (e.g. "Material.BIRCH_LOGS"),
 * which does NOT match the bank/catalog item ids (slugs like "birch_logs"), so
 * we map via the display name: prefer an exact name→id hit from the live bank
 * catalog, and fall back to the catalog's slug formula (catalog.py _name_to_id).
 *
 * @param {string} outputItemId  the recipe's output item ref (e.g. "Material.PINE_PLANK"),
 *                               i.e. the crafting-tree `item_id` — NOT the recipe id.
 * @returns {Promise<string[]>}  material item-ids (may be empty)
 */
function _nameToId(name) {
    // Mirror catalog.py ItemCatalog._name_to_id exactly.
    return String(name || '').toLowerCase()
        .replace(/ /g, '_').replace(/\(/g, '').replace(/\)/g, '').replace(/-/g, '_').replace(/'/g, '');
}

export async function resolveRecipeMaterialIds(outputItemId) {
    const body = { item_id: outputItemId };
    const su = sessionUuid();
    if (su) body.session_uuid = su;
    const r = await fetch('/api/crafting-tree/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('build ' + r.status);
    const data = await r.json();
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];

    // Exact name→id map from the live bank catalog (best); slug fallback covers
    // anything not present (or when only sample data is loaded).
    const byName = new Map();
    try { for (const it of getBankItems()) byName.set(String(it.name || '').toLowerCase(), it.id); } catch (_e) { /* sample only */ }

    const ids = new Set();
    for (const n of nodes) {
        if (!n || (n.depth || 0) <= 0) continue;                 // skip the target (depth 0)
        const nm = n.item_name || (n.item_id ? String(n.item_id).split('.').pop().replace(/_/g, ' ') : '');
        if (!nm) continue;
        const id = byName.get(nm.toLowerCase()) || _nameToId(nm);
        if (id) ids.add(id);
    }
    return [...ids];
}
