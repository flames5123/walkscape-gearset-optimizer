/**
 * AchievementsPage — FAC-gated Achievement Tracker.
 *
 * Full-screen overlay (mirrors SellForChipsPage): hash-routed at #achievements,
 * toggled by #achievements-nav-btn. Two views inside one container:
 *   - overview: 4 difficulty cards (colored progress ring + back-card icon + X/Y)
 *   - detail:   per-difficulty list (back-card header + count + progress bar +
 *               back arrow), one row per achievement with per-requirement
 *               checkboxes and an expandable reward panel.
 *
 * Data: GET /api/achievements  -> { order, groups, enabled }
 *       GET/PUT /api/achievements/progress -> { checked:{achId:{reqIdx:true}}, revealed:{achId:true} }
 *
 * v1 scope: visuals + manual per-requirement check-offs + reward reveal + server
 * persistence + ordering + slide/fade transition. Auto-detect from the imported
 * character, the custom-stat mirror + parent->child auto-check, and the per-shop
 * checklist for "Peddle To The Mettle" are layered on next.
 */

const DIFF_COLOR = { easy: '#8bd450', normal: '#5aa9e6', hard: '#e6c84f', extreme: '#e05aa9' };
const DIFF_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' };
const BACK_ICON = (d) => `/assets/icons/achievements/back/${d}.svg`;

// achievement_id <-> custom_stat_id (bidirectional mirror). Mirrors
// util/achievement_stat_links.py EQUIVALENCES. Toggling the achievement flips
// the custom stat the optimizer already reads (no optimizer changes).
const EQUIVALENCES = {
    wetlands_explorer: 'explored_realm_gdte',
    arctic_explorer: 'explored_realm_jarvonia',
};
// child achievement_id -> parent custom_stat_id (one-way: parent done => child auto-checked).
const PARENT_CHILD = {
    barbarian_village: 'explored_realm_jarvonia',
    'you_shall_not_pass!': 'explored_realm_gdte',
    not_in_al_kharid_anymore: 'explored_realm_wrentmark',
    trench_explorer: 'explored_realm_syrenthia',
    we_need_to_go_deeper: 'explored_realm_gdte',
};

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _pretty(slug) {
    return String(slug || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export class AchievementsPage {
    constructor(selector) {
        this._selector = selector;
        this._el = document.querySelector(selector);
        this._data = null;              // /api/achievements payload
        this._progress = { checked: {}, revealed: {} };
        this._shops = [];               // /api/shops (for the Peddle checklist)
        this._openChecklists = new Set();
        this._search = '';
        this._animateNext = false;      // slide-in on overview -> detail (from right)
        this._animateBack = false;      // slide-in on detail -> overview (from left)
        this._openRewards = new Set();  // which reward panels are expanded (transient)
        this._itemIndex = null;         // item id -> {name, icon}
        this._itemNameIndex = null;     // normalized name -> {name, icon}
        this._catalogById = null;       // item id -> full catalog dict (slot, rarity, ...)
        this._rainbowSet = null;        // last-computed Taste The Rainbow assignment
        this._view = 'overview';        // 'overview' | 'detail'
        this._activeDiff = null;
        this._open = false;
        this._loading = false;
        this._closeTimer = null;
        this._saveTimer = null;
        this._injectStyles();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                e.preventDefault();
                if (this._view === 'detail') { this._showOverview(); }
                else { this.close(); }
            }
        });
    }

    // ---- open / close -----------------------------------------------------

    open() {
        if (!this._el) this._el = document.querySelector(this._selector);
        if (!this._el) return;
        this._ensureDelegation();
        if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
        this._open = true;
        this._view = 'overview';
        this._el.classList.remove('closing');
        this._el.classList.add('opening');
        document.body.classList.add('achievements-open');
        // Body-scroll (mobile): open at top even if a column was scrolled.
        if (window.innerWidth <= 768) window.scrollTo(0, 0);
        document.getElementById('achievements-nav-btn')?.classList.add('active');
        this._render();
        this._fetchAndRender();
    }

    // Robust navigation: one delegated click listener on the stable container.
    // Survives every innerHTML re-render, so difficulty cards / back / close
    // always work even if a per-render listener didn't attach. The contains()
    // guard prevents double-firing — after a re-render the original target is
    // detached, so only the surviving handler acts.
    _ensureDelegation() {
        if (this._delegated || !this._el) return;
        this._delegated = true;
        this._el.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || !t.closest) return;
            const diffBtn = t.closest('[data-ach-diff]');
            if (diffBtn && this._el.contains(diffBtn)) {
                this._showDetail(diffBtn.getAttribute('data-ach-diff'));
                return;
            }
            const actionBtn = t.closest('[data-ach-action]');
            if (actionBtn && this._el.contains(actionBtn)) {
                const act = actionBtn.getAttribute('data-ach-action');
                if (act === 'close') this.close();
                else if (act === 'back') this._showOverview();
            }
        });
    }

    close() {
        this._open = false;
        document.getElementById('achievements-nav-btn')?.classList.remove('active');
        if (typeof window !== 'undefined' && window.location.hash === '#achievements') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        if (!this._el) { document.body.classList.remove('achievements-open'); return; }
        const wasVisible = getComputedStyle(this._el).display !== 'none';
        this._el.classList.remove('opening');
        if (wasVisible) {
            this._el.classList.add('closing');
            this._closeTimer = setTimeout(() => {
                this._el.classList.remove('closing');
                document.body.classList.remove('achievements-open');
                this._closeTimer = null;
            }, 260);
        } else {
            this._el.classList.remove('closing');
            document.body.classList.remove('achievements-open');
        }
    }

    isOpen() { return this._open; }

    // ---- data -------------------------------------------------------------

    async _fetchAndRender() {
        this._loading = true;
        this._render();
        try {
            const [aRes, pRes, sRes, iRes] = await Promise.all([
                fetch('/api/achievements').then(r => r.json()),
                fetch('/api/achievements/progress').then(r => r.json()).catch(() => ({})),
                fetch('/api/shops').then(r => r.json()).catch(() => ({})),
                fetch('/api/items').then(r => r.json()).catch(() => ({})),
            ]);
            this._data = aRes || { order: [], groups: {} };
            const prog = (pRes && pRes.progress) || {};
            this._progress = { checked: prog.checked || {}, revealed: prog.revealed || {} };
            this._shops = (sRes && sRes.shops) || [];
            this._buildItemIndexes((iRes && iRes.categories) || {});
        } catch (err) {
            console.error('[achievements] load failed', err);
            this._data = { error: String(err), order: [], groups: {} };
        } finally {
            this._loading = false;
            this._render();
            // Flush any pending scroll-to-achievement AFTER the render settles,
            // so an openToAchievement() that triggered this open lands on the
            // difficulty detail view + scrolls (instead of being clobbered by
            // this overview render).
            if (this._pendingScrollAch) this._tryScrollToPending(0);
        }
    }

    _saveProgress() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            fetch('/api/achievements/progress', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ progress: this._progress }),
            }).catch((e) => console.warn('[achievements] save failed', e));
        }, 500);
    }

    // ---- reward helpers ---------------------------------------------------

    _buildItemIndexes(cats) {
        const byId = {}, byName = {}, byIdFull = {};
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const walk = (node) => {
            if (Array.isArray(node)) {
                for (const it of node) {
                    if (it && (it.id || it.name)) {
                        const info = { name: it.name, icon: it.icon_path };
                        if (it.id) { byId[it.id] = info; if (!byIdFull[it.id]) byIdFull[it.id] = it; }
                        if (it.name) byName[norm(it.name)] = info;
                    }
                }
            } else if (node && typeof node === 'object') {
                for (const k of Object.keys(node)) walk(node[k]);
            }
        };
        walk(cats);
        this._itemIndex = byId;
        this._itemNameIndex = byName;
        this._catalogById = byIdFull;
    }
    _resolveItem(id) {
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const info = (this._itemIndex && this._itemIndex[id])
            || (this._itemNameIndex && this._itemNameIndex[norm(id)]) || null;
        return { name: (info && info.name) || _pretty(id), icon: info && info.icon };
    }
    _findAch(achId) {
        for (const list of Object.values((this._data && this._data.groups) || {})) {
            const found = (list || []).find(a => a.id === achId);
            if (found) return found;
        }
        return null;
    }

    // ---- Taste The Rainbow helper -----------------------------------------
    // Requires equipping ALL AT ONCE: >=5 common, >=4 uncommon, >=3 rare,
    // >=2 epic, >=1 legendary Loot items (15 total). Each owned Loot item fills
    // exactly one gear slot, so overlap (too few distinct-slot items of a tier)
    // can make it impossible. We solve it as a max-flow assignment over the
    // player's owned Loot items and their gear slots.
    _rainbowSolve() {
        const REQ = { common: 5, uncommon: 4, rare: 3, epic: 2, legendary: 1 };
        const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        const cat = this._catalogById;
        const itemsState = (window.store && window.store.state && window.store.state.items) || {};
        if (!cat) return { ready: false };

        // Owned Loot items only (type 'item' = dropped loot with a rarity tier;
        // crafted_item rarity is quality-based, not loot, so it's excluded).
        const owned = [];
        for (const id of Object.keys(itemsState)) {
            const st = itemsState[id];
            if (!st || !st.has) continue;
            const c = cat[id];
            if (!c || c.type !== 'item') continue;
            const rar = String(c.rarity || '').toLowerCase();
            if (!(rar in REQ)) continue;
            let slotType = String(c.slot || '').toLowerCase();
            if (slotType === 'tools') slotType = 'tool';
            if (slotType === 'rings') slotType = 'ring';
            if (!slotType || slotType === 'consumable' || slotType === 'pet' || slotType === 'input') continue;
            owned.push({ id, name: c.name, rarity: rar, slotType, cat: c });
        }

        // Physical gear slots (10 singles + 2 rings + unlocked tool slots).
        const ch = (window.store && window.store.state && window.store.state.character) || {};
        const lvl = (typeof window.calculateCharacterLevel === 'function')
            ? window.calculateCharacterLevel(ch) : (ch.character_level || 1);
        const nTools = lvl < 20 ? 3 : lvl < 50 ? 4 : lvl < 80 ? 5 : 6;
        const singles = ['head', 'cape', 'back', 'hands', 'chest', 'neck', 'primary', 'legs', 'secondary', 'feet'];
        const physical = singles.map(s => ({ slot: s, type: s }));
        physical.push({ slot: 'ring1', type: 'ring' }, { slot: 'ring2', type: 'ring' });
        for (let i = 0; i < nTools; i++) physical.push({ slot: 'tool' + i, type: 'tool' });
        const fits = (it, ps) => it.slotType === 'ring' ? ps.type === 'ring'
            : it.slotType === 'tool' ? ps.type === 'tool' : ps.type === it.slotType;

        // Flow graph: S -> rarity -> item -> slot -> T (all unit caps except S->rarity=REQ).
        const S = 0;
        const rarityNode = {}; TIERS.forEach((t, i) => rarityNode[t] = 1 + i);
        const itemBase = 1 + TIERS.length;
        const slotBase = itemBase + owned.length;
        const T = slotBase + physical.length;
        const N = T + 1;
        const g = Array.from({ length: N }, () => []);
        const addEdge = (u, v, c) => { g[u].push([v, c, g[v].length]); g[v].push([u, 0, g[u].length - 1]); };
        for (const t of TIERS) addEdge(S, rarityNode[t], REQ[t]);
        owned.forEach((it, i) => addEdge(rarityNode[it.rarity], itemBase + i, 1));
        owned.forEach((it, i) => physical.forEach((ps, j) => { if (fits(it, ps)) addEdge(itemBase + i, slotBase + j, 1); }));
        physical.forEach((ps, j) => addEdge(slotBase + j, T, 1));

        // Edmonds-Karp max flow.
        let flow = 0;
        for (;;) {
            const prevV = new Array(N).fill(-1), prevE = new Array(N).fill(-1);
            prevV[S] = S; const q = [S];
            while (q.length) {
                const u = q.shift();
                for (let ei = 0; ei < g[u].length; ei++) {
                    const e = g[u][ei];
                    if (e[1] > 0 && prevV[e[0]] === -1) { prevV[e[0]] = u; prevE[e[0]] = ei; if (e[0] === T) { q.length = 0; break; } q.push(e[0]); }
                }
            }
            if (prevV[T] === -1) break;
            let v = T, aug = Infinity;
            while (v !== S) { const u = prevV[v]; aug = Math.min(aug, g[u][prevE[v]][1]); v = u; }
            v = T;
            while (v !== S) { const u = prevV[v], ei = prevE[v]; g[u][ei][1] -= aug; g[v][g[u][ei][2]][1] += aug; v = u; }
            flow += aug;
        }

        const totalReq = TIERS.reduce((s, t) => s + REQ[t], 0);
        const placed = {};
        for (const t of TIERS) { const e = g[S].find(x => x[0] === rarityNode[t]); placed[t] = REQ[t] - e[1]; }
        const assignment = {};
        owned.forEach((it, i) => {
            for (const e of g[itemBase + i]) {
                if (e[0] >= slotBase && e[0] < slotBase + physical.length && e[1] === 0) {
                    const ps = physical[e[0] - slotBase];
                    if (!assignment[ps.slot]) { assignment[ps.slot] = it; break; }
                }
            }
        });
        return { ready: true, feasible: flow >= totalReq, req: REQ, placed, assignment, tiers: TIERS };
    }

    _rainbowBuild(container) {
        const res = this._rainbowSolve();
        if (!res || !res.ready) {
            container.innerHTML = `<div class="ach-rainbow-msg">Loading your item data — import your character and try again in a moment.</div>`;
            return;
        }
        if (res.feasible) {
            this._rainbowSet = res.assignment;
            const n = Object.keys(res.assignment).length;
            container.innerHTML = `<div class="ach-rainbow-msg ok">✓ Possible with your items — a valid set fills ${n} slots (5 common · 4 uncommon · 3 rare · 2 epic · 1 legendary Loot items).</div>`
                + `<button class="ach-rainbow-btn" data-ach-rainbow="equip">Equip complete gear set for achievement</button>`;
        } else {
            this._rainbowSet = null;
            const short = res.tiers
                .filter(t => (res.req[t] - (res.placed[t] || 0)) > 0)
                .map(t => `${res.req[t] - (res.placed[t] || 0)} more ${_pretty(t)}`);
            container.innerHTML = `<div class="ach-rainbow-msg bad">✗ Not possible with your current items.</div>`
                + `<div class="ach-rainbow-sub">You're short ${short.join(', ')}. You need enough distinct-slot Loot items of each rarity to equip all 15 at once (slot overlap blocks it).</div>`
                + `<button class="ach-rainbow-btn" data-ach-rainbow="build">Re-check</button>`;
        }
    }

    _rainbowEquip(container) {
        const set = this._rainbowSet;
        const store = window.store;
        if (!set || !Object.keys(set).length) { this._rainbowBuild(container); return; }
        if (!store || typeof store.updateGearSlotsBulk !== 'function') {
            container.innerHTML = `<div class="ach-rainbow-msg bad">Couldn't access your gear — open the optimizer and try again.</div>`;
            return;
        }
        const slotItems = {};
        for (const slot of Object.keys(set)) {
            const c = set[slot].cat;
            slotItems[slot] = { ...c, itemId: c.id };
        }
        store.updateGearSlotsBulk(slotItems);
        container.innerHTML = `<div class="ach-rainbow-msg ok">✓ Equipped a ${Object.keys(slotItems).length}-item rainbow set into your current gear. Open the gear/optimizer view to see it — the achievement should register in-game once these are equipped.</div>`;
        // Close the achievements overlay so the user lands on the gear view.
        this.close();
    }
    _rewardRevealed(achId, key) {
        const rev = this._progress.revealed[achId];
        return rev === true || !!(rev && typeof rev === 'object' && rev[key]);
    }
    _revealReward(achId, key) {
        let rev = this._progress.revealed[achId];
        if (rev === true) return;
        if (!rev || typeof rev !== 'object') { rev = {}; this._progress.revealed[achId] = rev; }
        rev[key] = true;
        this._saveProgress();
    }
    _wireRewardReveals(scope) {
        (scope || this._el).querySelectorAll('.ach-rw-hidden').forEach((row) => {
            if (row._rwWired) return;
            row._rwWired = true;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const achId = row.getAttribute('data-ach-id');
                this._revealReward(achId, row.getAttribute('data-ach-reward'));
                const panel = row.closest('.ach-rewards');
                const a = this._findAch(achId);
                if (panel && a) {
                    panel.insertAdjacentHTML('beforebegin', this._rewardsHtml(a));
                    const fresh = panel.previousElementSibling;
                    panel.remove();
                    this._wireRewardReveals(fresh);
                }
            });
        });
    }

    // ---- completion model (manual + auto-detect + mirror + parent/child) --

    _reqManual(achId, i) {
        const c = this._progress.checked[achId];
        return !!(c && c[i]);
    }
    _setReqManual(achId, i, done) {
        const checked = this._progress.checked;
        if (!checked[achId]) checked[achId] = {};
        if (done) checked[achId][i] = true; else delete checked[achId][i];
        if (Object.keys(checked[achId]).length === 0) delete checked[achId];
        this._saveProgress();
    }
    _reqManualValue(achId, i) {
        const c = this._progress.checked[achId];
        return c ? c[i] : undefined;
    }
    _setReqManualValue(achId, i, val) {
        const checked = this._progress.checked;
        if (!checked[achId]) checked[achId] = {};
        if (!val) delete checked[achId][i]; else checked[achId][i] = val;
        if (Object.keys(checked[achId]).length === 0) delete checked[achId];
        this._saveProgress();
    }
    _fmtNum(n) {
        n = Number(n) || 0;
        if (n >= 1e6) { const v = n / 1e6; return (v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '') + 'M'; }
        if (n >= 1e4) return Math.round(n).toLocaleString();
        return String(Math.round(n));
    }
    // {cur, target} for a numeric requirement, or null. Auto sources read the
    // character; manual count reqs read the stored number.
    _reqProgress(a, i) {
        const p = (a.parsed || [])[i] || {};
        const target = p.target || null;
        if (!target) return null;
        // "Have every skill at least level N": progress is the lowest skill level.
        const ptxt = (p.text || '').toLowerCase();
        if (ptxt.includes('every skill') && ptxt.includes('level')) {
            const min = this._minSkillLevel();
            return (min == null) ? null : { cur: Math.max(0, min), target };
        }
        let cur = null;
        const ch = window.store && window.store.state && window.store.state.character;
        if (p.auto_source && ch) {
            switch (p.auto_source) {
                case 'skill': cur = this._skillLevel(p.subject); break;
                case 'character_level': cur = (typeof window.calculateCharacterLevel === 'function') ? window.calculateCharacterLevel(ch) : (ch.character_level || 0); break;
                case 'wealth': cur = (ch.coins || 0) + (ch.inventory_value || 0); break;
                case 'steps': cur = ch.steps || 0; break;
                case 'item_has': cur = this._ownsItem(p.subject) ? target : 0; break;
            }
        } else if (!p.auto_source && p.type !== 'checklist') {
            const v = this._reqManualValue(a.id, i);
            cur = (typeof v === 'number') ? v : (v === true ? target : 0);
        }
        if (cur == null) return null;
        return { cur: Math.max(0, cur), target };
    }
    _customStatOn(id) {
        return !!(window.store && window.store.state && window.store.state.ui
            && window.store.state.ui.custom_stats && window.store.state.ui.custom_stats[id]);
    }
    _setCustomStat(id, val) {
        const store = window.store;
        if (!store || !store.state) return;
        if (!store.state.ui) store.state.ui = {};
        if (!store.state.ui.custom_stats) store.state.ui.custom_stats = {};
        store.state.ui.custom_stats[id] = !!val;
        if (typeof store.update === 'function') store.update('ui.custom_stats.' + id, !!val);
    }
    _skillLevel(name) {
        const s = window.store && window.store.state && window.store.state.character && window.store.state.character.skills;
        if (!s || !name) return null;
        const key = Object.keys(s).find(k => k.toLowerCase() === String(name).toLowerCase());
        if (!key) return null;
        const v = s[key];
        if (typeof v === 'number') return v;
        if (v && typeof v === 'object') return (v.level != null ? v.level : (v.lvl != null ? v.lvl : null));
        return null;
    }
    _ownsItem(name) {
        const ch = window.store && window.store.state && window.store.state.character;
        if (!ch || !name) return false;
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const want = norm(name);
        for (const list of [ch.owned_items, ch.raw_export_names]) {
            if (Array.isArray(list) && list.some(it => norm(it) === want)) return true;
        }
        return false;
    }
    _charAuto(p) {
        const ch = window.store && window.store.state && window.store.state.character;
        if (!ch || !p || !p.auto) return false;
        switch (p.auto_source) {
            case 'skill': { const lv = this._skillLevel(p.subject); return lv != null && p.target != null && lv >= p.target; }
            case 'character_level': { const cl = (typeof window.calculateCharacterLevel === 'function') ? window.calculateCharacterLevel(ch) : (ch.character_level || 0); return p.target != null && cl >= p.target; }
            case 'wealth': { const w = (ch.coins || 0) + (ch.inventory_value || 0); return p.target != null && w >= p.target; }
            case 'steps': { return p.target != null && (ch.steps || 0) >= p.target; }
            case 'item_has': return this._ownsItem(p.subject);
            default: return false;
        }
    }
    _findAch(achId) {
        const groups = (this._data && this._data.groups) || {};
        for (const d of Object.keys(groups)) {
            const hit = (groups[d] || []).find(a => a && a.id === achId);
            if (hit) return hit;
        }
        return null;
    }
    _shopCheckedCount(achId) {
        const c = this._progress.checked[achId] || {};
        return Object.keys(c).filter(k => k.indexOf('shop:') === 0).length;
    }
    _shopChecked(achId, shopId) {
        const c = this._progress.checked[achId];
        return !!(c && c['shop:' + shopId]);
    }
    _setShopChecked(achId, shopId, on) {
        const checked = this._progress.checked;
        if (!checked[achId]) checked[achId] = {};
        if (on) checked[achId]['shop:' + shopId] = true; else delete checked[achId]['shop:' + shopId];
        if (Object.keys(checked[achId]).length === 0) delete checked[achId];
        this._saveProgress();
    }
    _anySkillLeveled() {
        const s = window.store && window.store.state && window.store.state.character && window.store.state.character.skills;
        if (!s) return false;
        return Object.keys(s).some((k) => {
            const v = s[k];
            const lv = (typeof v === 'number') ? v : (v && (v.level != null ? v.level : v.lvl));
            return typeof lv === 'number' && lv > 1;
        });
    }
    // Lowest level across the 12 real leveled skills, or null if the character
    // isn't loaded or the export is missing skills. Used for "Have every skill
    // at least level N" achievements: the floor is what gates completion.
    _minSkillLevel() {
        const s = window.store && window.store.state && window.store.state.character && window.store.state.character.skills;
        if (!s || typeof s !== 'object') return null;
        const REAL = ['agility', 'carpentry', 'cooking', 'crafting', 'fishing', 'foraging',
            'hunting', 'mining', 'smithing', 'tailoring', 'trinketry', 'woodcutting'];
        const lvlOf = (v) => (typeof v === 'number') ? v : (v && (v.level != null ? v.level : (v.lvl != null ? v.lvl : null)));
        const byLower = {};
        for (const k of Object.keys(s)) byLower[k.toLowerCase()] = k;
        let min = null, counted = 0;
        for (const name of REAL) {
            const k = byLower[name];
            if (k === undefined) continue;
            const lv = lvlOf(s[k]);
            if (typeof lv !== 'number') continue;
            counted++;
            if (min == null || lv < min) min = lv;
        }
        // Only trust the floor when all 12 real skills are present, so a partial
        // export can't falsely auto-complete or mis-report the lowest level.
        if (counted < REAL.length) return null;
        return min;
    }
    _ownsAnyChest() {
        const st = window.store && window.store.state;
        const ch = st && st.character;
        // Chest ids are underscore-joined (e.g. "fishing_chest", "chest_of_erdwise"),
        // so match on tokens: any token exactly "chest". Avoids false hits like
        // "chestnut" and "chips" while catching every real chest id.
        const test = (x) => String(x || '').toLowerCase().split(/[^a-z0-9]+/).includes('chest');
        if (ch) {
            // owned_items is filtered server-side to equipment/tools/consumables/
            // materials — a raw chest gets dropped from it. owned_quantities and
            // raw_export_names keep the raw held ids, so scan those too.
            for (const list of [ch.owned_items, ch.raw_export_names, ch.collectibles]) {
                if (Array.isArray(list) && list.some(test)) return true;
            }
            if (ch.owned_quantities && typeof ch.owned_quantities === 'object'
                && Object.keys(ch.owned_quantities).some(test)) return true;
        }
        // Canonical owned map (itemId -> {has, ...}).
        const items = st && st.items;
        if (items && typeof items === 'object') {
            for (const id of Object.keys(items)) {
                if (items[id] && items[id].has && test(id)) return true;
            }
        }
        return false;
    }
    /** {done, auto, mirror} for requirement i of achievement a. */
    _reqSatisfied(a, i) {
        const eq = EQUIVALENCES[a.id];
        if (eq != null) return { done: this._customStatOn(eq), auto: false, mirror: eq };
        const parent = PARENT_CHILD[a.id];
        if (parent && this._customStatOn(parent)) return { done: true, auto: true, mirror: null };
        const p = (a.parsed || [])[i] || {};
        // Special text-based auto rules (one-directional).
        const txt = (p.text || '').toLowerCase();
        if (txt.includes('level up any skill') && this._anySkillLeveled()) return { done: true, auto: true, mirror: null };
        if (txt.includes('gain a chest') && txt.includes('activity') && (this._ownsAnyChest() || this._anySkillLeveled())) return { done: true, auto: true, mirror: null };
        if (txt.includes('every skill') && txt.includes('level') && p.target) {
            const min = this._minSkillLevel();
            if (min != null) return { done: min >= p.target, auto: true, mirror: null };
        }
        if (p.type === 'checklist') {
            const cnt = this._shopCheckedCount(a.id);
            return { done: p.target ? cnt >= p.target : cnt > 0, auto: false, mirror: null, checklist: true };
        }
        // Auto-tracked from the imported character (skill / character level /
        // wealth / steps / item ownership): always read-only and shows the
        // current value as progress, even when incomplete — never a manual 0.
        if (p.auto && ['skill', 'character_level', 'wealth', 'steps', 'item_has'].includes(p.auto_source)) {
            return { done: this._charAuto(p), auto: true, mirror: null };
        }
        const target = p.target || 0;
        const val = this._reqManualValue(a.id, i);
        if (target > 1) {
            const cur = (typeof val === 'number') ? val : (val === true ? target : 0);
            return { done: cur >= target, auto: false, mirror: null, count: true };
        }
        return { done: !!val, auto: false, mirror: null };
    }
    _achComplete(a) {
        const n = (a.parsed || []).length;
        if (!n) return false;
        for (let i = 0; i < n; i++) if (!this._reqSatisfied(a, i).done) return false;
        return true;
    }
    _diffCounts(diff) {
        const list = (this._data.groups && this._data.groups[diff]) || [];
        let done = 0;
        for (const a of list) if (this._achComplete(a)) done++;
        return { done, total: list.length };
    }
    // Fractional completion of one achievement: each requirement is an equal
    // share (1/N); count reqs contribute cur/target within their share.
    _achFraction(a) {
        const n = (a.parsed || []).length;
        if (!n) return 0;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const st = this._reqSatisfied(a, i);
            if (st.done) { sum += 1; continue; }
            const prog = this._reqProgress(a, i);
            if (prog && prog.target) sum += Math.min(1, prog.cur / prog.target);
        }
        return sum / n;
    }
    _diffFraction(diff) {
        const list = (this._data.groups && this._data.groups[diff]) || [];
        let frac = 0;
        for (const a of list) frac += this._achFraction(a);
        return frac;
    }

    // ---- rendering --------------------------------------------------------

    _render() {
        if (!this._el) return;
        if (!this._data) {
            this._el.innerHTML = `<div class="ach-loading">Loading achievements…</div>`;
            return;
        }
        if (this._data && this._data.error) {
            this._el.innerHTML = `<div class="ach-error">Could not load achievements.<br><span>${_esc(this._data.error)}</span></div>`;
            return;
        }
        if (this._view === 'detail' && this._activeDiff) this._renderDetail();
        else this._renderOverview();
    }

    _renderOverview() {
        const order = (this._data.order && this._data.order.length) ? this._data.order : ['easy', 'normal', 'hard', 'extreme'];
        const cards = order.map((d) => {
            const { done, total } = this._diffCounts(d);
            const pct = total ? Math.round(done / total * 100) : 0;
            const color = DIFF_COLOR[d] || '#888';
            return `
              <button class="ach-card" data-ach-diff="${_esc(d)}">
                <div class="ach-ring" style="--ach-c:${color};--ach-pct:${pct}">
                  <img class="ach-ring-icon" src="${BACK_ICON(d)}" alt="">
                </div>
                <div class="ach-card-label" style="color:${color}">${DIFF_LABEL[d] || _pretty(d)}</div>
                <div class="ach-card-count"><b style="color:${color}">${done}</b>/${total}</div>
              </button>`;
        }).join('');
        this._el.innerHTML = `
          <div class="ach-wrap">
            <div class="ach-sticky"><div class="ach-topbar">
              <div class="ach-title"><img src="/assets/icons/achievements.svg" width="26" height="26" alt=""> Achievements</div>
              <button class="ach-x" data-ach-action="close" title="Close (Esc)">✕</button>
            </div></div>
            <div class="ach-overview${this._animateBack ? ' ach-slide-back' : ''}">${cards}</div>
          </div>`;
        this._animateBack = false;
        this._el.querySelectorAll('[data-ach-diff]').forEach((btn) => {
            btn.addEventListener('click', () => this._showDetail(btn.getAttribute('data-ach-diff')));
        });
        this._el.querySelector('[data-ach-action="close"]')?.addEventListener('click', () => this.close());
    }

    _renderDetail() {
        const d = this._activeDiff;
        const color = DIFF_COLOR[d] || '#888';
        const list = ((this._data.groups && this._data.groups[d]) || []).slice();
        // Incomplete first, completed sink to bottom; each sorted A->Z by name.
        list.sort((a, b) => {
            const ca = this._achComplete(a) ? 1 : 0, cb = this._achComplete(b) ? 1 : 0;
            if (ca !== cb) return ca - cb;
            return (a.name || '').localeCompare(b.name || '');
        });
        const { done, total } = this._diffCounts(d);
        const pct = total ? Math.round(done / total * 100) : 0;
        const rows = list.map((a) => this._rowHtml(a, color)).join('');
        const savedScroll = this._el.scrollTop;
        this._el.innerHTML = `
          <div class="ach-wrap">
            <div class="ach-sticky">
              <div class="ach-topbar">
                <button class="ach-back" data-ach-action="back" title="Back">‹</button>
                <div class="ach-detail-head">
                  <img src="${BACK_ICON(d)}" width="26" height="34" alt="">
                  <span style="color:${color}">${DIFF_LABEL[d] || _pretty(d)} (${done}/${total})</span>
                </div>
                <button class="ach-x" data-ach-action="close" title="Close (Esc)">✕</button>
              </div>
              <div class="ach-detail-progress"><span style="width:${pct}%;background:${color}"></span></div>
              <input class="ach-search" type="text" placeholder="Search achievements…" value="${_esc(this._search)}">
            </div>
            <div class="ach-list${this._animateNext ? ' ach-slide-in' : ''}">${rows}</div>
          </div>`;
        this._animateNext = false;
        this._el.scrollTop = savedScroll;
        this._el.querySelector('[data-ach-action="back"]')?.addEventListener('click', () => this._showOverview());
        this._el.querySelector('[data-ach-action="close"]')?.addEventListener('click', () => this.close());
        const searchEl = this._el.querySelector('.ach-search');
        if (searchEl) {
            searchEl.addEventListener('input', () => { this._search = searchEl.value; this._applySearchFilter(); });
        }
        this._el.querySelectorAll('.ach-check[data-ach-req]').forEach((box) => {
            if (box.hasAttribute('data-ach-count-toggle')) return; // handled below
            box.addEventListener('click', (e) => {
                e.stopPropagation();
                const achId = box.getAttribute('data-ach-id');
                const i = parseInt(box.getAttribute('data-ach-req'), 10);
                const mirror = box.getAttribute('data-ach-mirror');
                const auto = box.getAttribute('data-ach-auto') === '1';
                if (mirror) {
                    // Two-way mirror: flip the equivalent custom stat (optimizer reads it).
                    this._setCustomStat(mirror, !this._customStatOn(mirror));
                } else if (auto) {
                    return; // auto-detected (character/parent) — authoritative, not toggleable
                } else {
                    this._setReqManual(achId, i, !this._reqManual(achId, i));
                }
                this._renderDetail();
            });
        });
        this._el.querySelectorAll('[data-ach-shop]').forEach((box) => {
            box.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const achId = box.getAttribute('data-ach-id');
                const shopId = box.getAttribute('data-ach-shop');
                const a = this._findAch(achId);
                const wasComplete = a ? this._achComplete(a) : false;
                const on = !this._shopChecked(achId, shopId);
                this._setShopChecked(achId, shopId, on);
                const isComplete = a ? this._achComplete(a) : false;
                // Only a completion flip needs a full re-render (card flips +
                // list reorders). Otherwise update in place so the expanded shop
                // list and scroll position are preserved (no jump-to-top).
                if (!a || wasComplete !== isComplete) {
                    this._renderDetail();
                    return;
                }
                box.classList.toggle('on', on);
                box.textContent = on ? '✓' : '';
                const row = box.closest('.ach-row');
                if (row) {
                    const cnt = this._shopCheckedCount(achId);
                    const p = (a.parsed || []).find(x => x && x.type === 'checklist') || {};
                    const target = p.target || 0;
                    const done = target ? cnt >= target : cnt > 0;
                    const header = row.querySelector('.ach-checklist > .ach-check');
                    if (header) {
                        header.classList.toggle('on', done);
                        header.textContent = done ? '✓' : '';
                        header.setAttribute('title', `${cnt}/${target} shops`);
                    }
                    const cntEl = row.querySelector('.ach-checklist-body .ach-req-text b');
                    if (cntEl) cntEl.textContent = `(${cnt}/${target})`;
                    const bar = row.querySelector('.ach-ach-bar span');
                    if (bar) bar.style.width = Math.round(this._achFraction(a) * 100) + '%';
                }
            });
        });
        this._el.querySelectorAll('[data-ach-shoptoggle]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-ach-shoptoggle');
                const list = this._el.querySelector('.ach-shop-list[data-ach-shoplist="' + id + '"]');
                const $ = window.$ || window.jQuery;
                const nowOpen = !this._openChecklists.has(id);
                if (nowOpen) this._openChecklists.add(id); else this._openChecklists.delete(id);
                btn.classList.toggle('open', nowOpen);
                if (list) {
                    if ($) $(list).stop(true, true).slideToggle(180);
                    else list.style.display = nowOpen ? 'block' : 'none';
                }
            });
        });
        this._el.querySelectorAll('.ach-count').forEach((inp) => {
            inp.addEventListener('change', () => {
                const achId = inp.getAttribute('data-ach-id');
                const i = parseInt(inp.getAttribute('data-ach-req'), 10);
                let v = parseInt(inp.value, 10);
                if (isNaN(v) || v < 0) v = 0;
                const mx = parseInt(inp.max, 10);
                if (!isNaN(mx) && v > mx) v = mx; // cap at the required amount
                this._setReqManualValue(achId, i, v);
                this._renderDetail();
            });
        });
        this._el.querySelectorAll('.ach-check[data-ach-count-toggle]').forEach((box) => {
            box.addEventListener('click', (e) => {
                e.stopPropagation();
                const achId = box.getAttribute('data-ach-id');
                const i = parseInt(box.getAttribute('data-ach-req'), 10);
                const target = parseInt(box.getAttribute('data-ach-count-target'), 10) || 0;
                const v = this._reqManualValue(achId, i);
                const cur = (typeof v === 'number') ? v : (v === true ? target : 0);
                // Toggle: if already at/above target, clear to 0; else fill to target.
                this._setReqManualValue(achId, i, cur >= target ? 0 : target);
                this._renderDetail();
            });
        });
        this._el.querySelectorAll('[data-ach-reveal]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const achId = btn.getAttribute('data-ach-reveal');
                const body = btn.parentElement;
                const existing = body ? body.querySelector('.ach-rewards') : null;
                const $ = window.$ || window.jQuery;
                const now = !this._openRewards.has(achId);
                if (now) {
                    this._openRewards.add(achId);
                    const a = this._findAch(achId);
                    btn.insertAdjacentHTML('afterend', this._rewardsHtml(a || { id: achId }));
                    const panel = btn.nextElementSibling;
                    btn.textContent = 'Hide rewards';
                    this._wireRewardReveals(panel);
                    if ($ && panel) $(panel).hide().slideDown(180);
                } else {
                    this._openRewards.delete(achId);
                    btn.textContent = 'Show rewards';
                    if (existing) { if ($) $(existing).slideUp(180, () => existing.remove()); else existing.remove(); }
                }
            });
        });
        this._wireRewardReveals(this._el);
        this._el.querySelectorAll('.ach-rainbow').forEach((container) => {
            container.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('[data-ach-rainbow]');
                if (!btn || !container.contains(btn)) return;
                e.preventDefault();
                e.stopPropagation();
                if (btn.getAttribute('data-ach-rainbow') === 'equip') this._rainbowEquip(container);
                else this._rainbowBuild(container);
            });
        });
        this._applySearchFilter();
    }

    _applySearchFilter() {
        const q = (this._search || '').trim().toLowerCase();
        this._el.querySelectorAll('.ach-row').forEach((row) => {
            const hay = row.getAttribute('data-ach-search') || '';
            row.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
        });
    }

    _rowHtml(a, color) {
        const complete = this._achComplete(a);
        const parsed = a.parsed || [];
        const reqs = parsed.map((p, i) => {
            if (p && p.type === 'checklist') return this._checklistHtml(a, i, p);
            const st = this._reqSatisfied(a, i);
            const target = p.target || 0;
            const isCount = !st.auto && !st.mirror && target > 1;
            const prog = target > 1 ? this._reqProgress(a, i) : null;
            // Every requirement gets a checkbox on the left. Count reqs get a
            // toggle that marks all `target` actions done (or clears back to 0).
            let checkbox;
            if (isCount) {
                checkbox = `<span class="ach-check ${st.done ? 'on' : ''}" data-ach-id="${_esc(a.id)}" data-ach-req="${i}" data-ach-count-toggle="1" data-ach-count-target="${target}" title="Check off — marks all ${this._fmtNum(target)} done">${st.done ? '✓' : ''}</span>`;
            } else {
                const autoCls = st.auto ? ' auto' : '';
                const title = st.auto ? 'Auto-detected from your imported character'
                    : (st.mirror ? 'Synced with the matching custom stat' : 'Click to toggle');
                checkbox = `<span class="ach-check ${st.done ? 'on' : ''}${autoCls}" data-ach-id="${_esc(a.id)}" data-ach-req="${i}" data-ach-mirror="${st.mirror ? _esc(st.mirror) : ''}" data-ach-auto="${st.auto ? '1' : ''}" title="${title}">${st.done ? '✓' : ''}</span>`;
            }
            // Progress line (below the text): editable count for manual count
            // reqs, read-only chip for auto-tracked ones.
            let progHtml = '';
            if (isCount) {
                const v = this._reqManualValue(a.id, i);
                const num = (typeof v === 'number') ? v : (v === true ? target : 0);
                progHtml = `<span class="ach-chip ach-chip-count"><input class="ach-count" type="number" min="0" max="${target}" value="${num || ''}" placeholder="0" data-ach-id="${_esc(a.id)}" data-ach-req="${i}" title="Enter your current progress"><span class="ach-chip-sep">/ ${this._fmtNum(target)}</span></span>`;
            } else if (prog) {
                progHtml = `<span class="ach-chip">${this._fmtNum(prog.cur)}/${this._fmtNum(prog.target)}</span>`;
            }
            return `
              <div class="ach-req">
                <div class="ach-req-line">${checkbox}<span class="ach-req-text">${_esc(p.text)}</span></div>
                ${progHtml ? `<div class="ach-req-prog">${progHtml}</div>` : ''}
              </div>`;
        }).join('');
        const rev = !!this._openRewards.has(a.id);
        const rewardPanel = rev ? this._rewardsHtml(a) : '';
        // Locked (incomplete) achievements show their OWN card back (color varies
        // per achievement); unlocked ones show the achievement's front card.
        const iconHtml = complete
            ? (a.icon ? `<img class="ach-row-front" src="${_esc(a.icon)}" alt="">` : '')
            : `<img class="ach-row-back" src="${_esc(a.back || BACK_ICON(a.difficulty))}" alt="">`;
        const titleHtml = complete ? _esc(a.name) : 'Locked achievement';
        const searchText = ((a.name || '') + ' ' + parsed.map(p => p.text || '').join(' ')).toLowerCase();
        // Achievement-level progress bar (spans the full card width): each
        // requirement is an equal share; count reqs contribute cur/target.
        const achPct = Math.round(this._achFraction(a) * 100);
        const achBar = `<div class="ach-ach-bar" title="${achPct}% complete"><span style="width:${achPct}%;background:${color}"></span></div>`;
        // Taste The Rainbow: gear-set helper (find/equip a set that satisfies it).
        const rainbowHtml = (a.id === 'taste_the_rainbow')
            ? `<div class="ach-rainbow"><button class="ach-rainbow-btn" data-ach-rainbow="build">🌈 Build a gear set for this achievement</button></div>`
            : '';
        return `
          <div class="ach-row ${complete ? 'complete' : ''}" data-ach-id="${_esc(a.id)}" data-ach-search="${_esc(searchText)}">
            <div class="ach-row-icon">${iconHtml}</div>
            <div class="ach-row-body">
              <div class="ach-row-title" style="color:${complete ? color : ''}">${titleHtml}</div>
              <div class="ach-reqs">${reqs}</div>
              ${rainbowHtml}
              <button class="ach-reveal-btn" data-ach-reveal="${_esc(a.id)}">${rev ? 'Hide rewards' : 'Show rewards'}</button>
              ${rewardPanel}
            </div>
            ${achBar}
          </div>`;
    }

    _rewardsHtml(a) {
        const r = (a && a.rewards) || {};
        const achId = a.id;
        const AP_ICON = '/assets/icons/text/general_icons/achievement_points.svg';
        const COIN_ICON = '/assets/icons/items/coins.svg';
        const rows = [];
        // Achievement points — always shown.
        if (r.points != null) {
            rows.push(`<div class="ach-rw"><img class="ach-rw-icon" src="${AP_ICON}" alt=""><span class="ach-rw-lbl">Achievement points</span><span class="ach-rw-val">${r.points}</span></div>`);
        }
        // XP — always shown (when we have it). Not published by the wiki Rewards
        // column today, so usually empty.
        for (const x of (r.xp || [])) {
            const sk = String(x.skill || '').toLowerCase().replace(/ /g, '_');
            rows.push(`<div class="ach-rw"><img class="ach-rw-icon" src="/assets/icons/text/skill_icons/${_esc(sk)}.svg" alt=""><span class="ach-rw-lbl">Experience</span><span class="ach-rw-val">+${x.amount} ${_esc(_pretty(x.skill))}</span></div>`);
        }
        // Coins — hidden until revealed.
        if (r.coins != null) {
            const shown = this._rewardRevealed(achId, 'coins');
            rows.push(`<div class="ach-rw ${shown ? '' : 'ach-rw-hidden'}" data-ach-reward="coins" data-ach-id="${_esc(achId)}">
                ${shown ? `<img class="ach-rw-icon" src="${COIN_ICON}" alt="">` : `<span class="ach-rw-icon ach-rw-qmark">?</span>`}
                <span class="ach-rw-lbl">Coins</span>
                <span class="ach-rw-val">${shown ? Number(r.coins).toLocaleString() : 'Unknown'}</span></div>`);
        }
        // Items — hidden until revealed.
        (r.items || []).forEach((it, idx) => {
            const key = 'item:' + idx;
            const shown = this._rewardRevealed(achId, key);
            const info = this._resolveItem(it.id);
            const q = it.quantity ? `${it.quantity}× ` : '';
            const val = _esc(q + info.name) + (it.quality ? ` <span class="ach-rw-q">(${_esc(_pretty(it.quality))})</span>` : '');
            rows.push(`<div class="ach-rw ${shown ? '' : 'ach-rw-hidden'}" data-ach-reward="${key}" data-ach-id="${_esc(achId)}">
                ${shown && info.icon ? `<img class="ach-rw-icon" src="${_esc(info.icon)}" alt="">` : `<span class="ach-rw-icon ach-rw-qmark">?</span>`}
                <span class="ach-rw-lbl">Item</span>
                <span class="ach-rw-val">${shown ? val : 'Unknown'}</span></div>`);
        });
        return `<div class="ach-rewards">${rows.join('')}</div>`;
    }

    _checklistHtml(a, i, p) {
        const cnt = this._shopCheckedCount(a.id);
        const target = p.target || 0;
        const done = target ? cnt >= target : cnt > 0;
        const shops = this._shops || [];
        let inner;
        if (!shops.length) {
            inner = `<div class="ach-shop-loading">Loading shops…</div>`;
        } else {
            const byLoc = {};
            for (const s of shops) {
                const loc = s.location || 'Other';
                (byLoc[loc] = byLoc[loc] || []).push(s);
            }
            inner = Object.keys(byLoc).sort().map((loc) => {
                const rows = byLoc[loc].map((s) => {
                    const on = this._shopChecked(a.id, s.id);
                    return `<label class="ach-shop"><span class="ach-check ${on ? 'on' : ''}" data-ach-shop="${_esc(s.id)}" data-ach-id="${_esc(a.id)}">${on ? '✓' : ''}</span>${_esc(s.name)}</label>`;
                }).join('');
                return `<div class="ach-shop-loc">${_esc(loc)}</div>${rows}`;
            }).join('');
        }
        const isOpen = this._openChecklists.has(a.id);
        return `
          <div class="ach-req ach-checklist">
            <span class="ach-check ${done ? 'on' : ''}" title="${cnt}/${target} shops">${done ? '✓' : ''}</span>
            <div class="ach-checklist-body">
              <div class="ach-req-text">${_esc(p.text)} <b>(${cnt}/${target})</b></div>
              <button class="ach-shop-toggle ${isOpen ? 'open' : ''}" data-ach-shoptoggle="${_esc(a.id)}"><span class="ach-shop-arr">▸</span> Track by shop</button>
              <div class="ach-shop-list" data-ach-shoplist="${_esc(a.id)}" style="display:${isOpen ? 'block' : 'none'}">${inner}</div>
            </div>
          </div>`;
    }

    // ---- view transitions -------------------------------------------------

    _showDetail(diff) {
        this._activeDiff = diff;
        this._view = 'detail';
        this._animateNext = true;
        this._renderDetail();
    }
    _showOverview() {
        this._view = 'overview';
        this._activeDiff = null;
        this._animateBack = true;
        this._renderOverview();
    }

    // ---- external navigation (from item "sources" section) ----------------

    /**
     * Open the tracker to the difficulty page that contains `achId`, then
     * scroll to and briefly highlight that achievement's row. Used by the
     * item "sources" section when a user clicks an achievement-reward source.
     * Routes through the #achievements hash so the other full-screen overlays
     * (crafting tree, goals report, sell-for-chips) mutually close.
     */
    openToAchievement(achId) {
        if (!achId) return;
        this._pendingScrollAch = achId;
        if (typeof window === 'undefined') return;
        // Already open on the achievements hash → navigate + scroll now.
        if (this._open && window.location.hash === '#achievements') {
            this._tryScrollToPending(0);
            return;
        }
        // Otherwise OPEN the page and let the render pipeline flush the pending
        // scroll AFTER the final render. We must NOT scroll synchronously here:
        // open() -> _fetchAndRender() re-fetches and re-renders (as overview)
        // on every open, and on a 2nd click _data is already cached so a sync
        // _tryScrollToPending would render detail first, only to be clobbered
        // by open()'s async overview render — the "2nd click only shows the
        // base page, no difficulty/scroll" bug. _fetchAndRender's finally block
        // calls _tryScrollToPending once the real render has settled.
        if (window.location.hash !== '#achievements') {
            // handleHashChange() opens us + closes competing overlays.
            window.location.hash = '#achievements';
        } else {
            this.open();
        }
    }

    /**
     * Poll until achievement data is loaded and the target row is rendered,
     * switching to its difficulty detail view, then scroll + flash it.
     */
    _tryScrollToPending(attempt) {
        attempt = attempt || 0;
        const achId = this._pendingScrollAch;
        if (!achId || !this._el) return;
        if (!this._data || !this._data.groups) {
            if (attempt < 60) setTimeout(() => this._tryScrollToPending(attempt + 1), 75);
            return;
        }
        const ach = this._findAch(achId);
        if (!ach) { this._pendingScrollAch = null; return; }
        const diff = String(ach.difficulty || 'normal').toLowerCase();
        if (this._view !== 'detail' || this._activeDiff !== diff) {
            this._animateNext = false;
            this._activeDiff = diff;
            this._view = 'detail';
            this._renderDetail();
        }
        let row = null;
        try {
            row = this._el.querySelector(`.ach-row[data-ach-id="${(window.CSS && CSS.escape) ? CSS.escape(achId) : achId}"]`);
        } catch (_e) {
            row = Array.from(this._el.querySelectorAll('.ach-row'))
                .find(r => r.getAttribute('data-ach-id') === achId) || null;
        }
        if (!row) {
            if (attempt < 60) setTimeout(() => this._tryScrollToPending(attempt + 1), 75);
            return;
        }
        this._pendingScrollAch = null;
        // Scroll the row as high as possible — just below the sticky detail
        // header (block:'center' previously left it mid-screen). Compute
        // against the scroll container so the sticky header doesn't cover it.
        try {
            const sticky = this._el.querySelector('.ach-sticky');
            const headerH = sticky ? sticky.getBoundingClientRect().height : 0;
            const elRect = this._el.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const target = this._el.scrollTop + (rowRect.top - elRect.top) - headerH - 10;
            this._el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        } catch (_e) {
            try { row.scrollIntoView({ block: 'start' }); } catch (_e2) { row.scrollIntoView(); }
        }
        row.classList.remove('ach-row-flash');
        // reflow so re-adding the class restarts the animation
        void row.offsetWidth;
        row.classList.add('ach-row-flash');
        setTimeout(() => row.classList.remove('ach-row-flash'), 2200);
    }

    // ---- styles -----------------------------------------------------------

    _injectStyles() {
        if (document.getElementById('ach-styles')) return;
        const s = document.createElement('style');
        s.id = 'ach-styles';
        s.textContent = `
.ach-loading,.ach-error{padding:60px;text-align:center;opacity:.8}
.ach-row-flash{animation:achRowFlash 2.2s ease-out}
@keyframes achRowFlash{0%,15%{outline:2px solid #e6c84f;outline-offset:2px;box-shadow:0 0 16px 3px rgba(230,200,79,.65)}100%{outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 0 transparent}}
.ach-wrap{max-width:720px;margin:0 auto;padding:0 12px 80px}
.ach-topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 0}
.ach-sticky{position:sticky;top:0;z-index:3;background:var(--bg-primary,#060c0f)}
.ach-title{display:flex;align-items:center;gap:10px;font-size: max(var(--min-text, 5px), calc(20px * var(--text-scale, 1)));font-weight:700}
.ach-x,.ach-back{background:#1f2228;border:1px solid #3a3e47;color:#e8eaef;border-radius:8px;cursor:pointer;font-size: max(var(--min-text, 5px), calc(18px * var(--text-scale, 1)));line-height:1;padding:6px 12px}
.ach-back{font-size: max(var(--min-text, 5px), calc(24px * var(--text-scale, 1)));padding:2px 14px}
.ach-x:hover,.ach-back:hover{background:#2a2e37}
.ach-overview{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin:12px 0 40px}
.ach-card{background:#171a20;border:1px solid #262a33;border-radius:14px;padding:14px 10px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px}
.ach-card:hover{background:#1d212a}
.ach-ring{--ach-pct:0;width:92px;height:92px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:conic-gradient(var(--ach-c) calc(var(--ach-pct)*1%), #2a2e37 0)}
.ach-ring::before{content:'';position:absolute;width:78px;height:78px;border-radius:50%;background:#171a20}
.ach-ring{position:relative}
.ach-ring-icon{position:relative;width:26px;height:40px;object-fit:contain;image-rendering:pixelated}
.ach-card-label{font-size: max(var(--min-text, 5px), calc(16px * var(--text-scale, 1)));font-weight:700}
.ach-card-count{font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)));opacity:.85}
.ach-detail-head{display:flex;align-items:center;gap:8px;font-size: max(var(--min-text, 5px), calc(18px * var(--text-scale, 1)));font-weight:700}
.ach-detail-progress{height:4px;background:#262a33;margin:0 0 8px;border-radius:2px;overflow:hidden}
.ach-detail-progress span{display:block;height:100%}
.ach-search{display:block;width:100%;box-sizing:border-box;margin:0;padding:8px 12px;border-radius:8px;border:1px solid #2a2e37;background:#12151b;color:#e8eaef;font-size: max(var(--min-text, 5px), calc(15px * var(--text-scale, 1)))}
.ach-list{margin:12px 0 40px;display:flex;flex-direction:column;gap:12px}
.ach-slide-in{animation:achSlide .22s ease}
@keyframes achSlide{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
.ach-slide-back{animation:achSlideBack .22s ease}
@keyframes achSlideBack{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)}}
.ach-row{display:flex;flex-wrap:wrap;gap:12px;background:#12151b;border:1px solid #222732;border-radius:12px;padding:12px}
.ach-row.complete{border-color:#2f5a2f;background:#121a14}
.ach-row-icon{width:68px;height:100px;flex:0 0 auto;display:flex;align-items:center;justify-content:center}
.ach-row-back,.ach-row-front{width:68px;height:100px;object-fit:contain;image-rendering:pixelated}
.ach-row-body{flex:1;min-width:0;display:inline-grid}
.ach-row-title{font-weight:700;margin-bottom:6px}
.ach-reqs{display:flex;flex-direction:column;gap:6px}
.ach-req{display:flex;flex-direction:column;gap:4px;font-size: max(var(--min-text, 5px), calc(14px * var(--text-scale, 1)));line-height:1.4}
.ach-req-line{display:flex;align-items:center;gap:8px}
.ach-chip{flex:0 0 auto;background:#1a1d24;border:1px solid #2a2e37;border-radius:10px;padding:1px 8px;font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));color:#cdd2da;white-space:nowrap}
.ach-req-bar{height:5px;background:#262a33;border-radius:3px;overflow:hidden}
.ach-req-bar span{display:block;height:100%;background:#c8d97a}
.ach-req-prog{display:flex;align-items:center;gap:8px;padding-left:28px}
.ach-chip-count{display:inline-flex;align-items:center;gap:2px;padding:1px 8px}
.ach-chip-count .ach-count{width:auto;min-width:34px;max-width:64px;border:none;background:transparent;color:#e8eaef;padding:0;font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));text-align:right}
.ach-chip-sep{color:#cdd2da;opacity:.9}
.ach-ach-bar{flex:0 0 100%;height:6px;background:#262a33;border-radius:3px;overflow:hidden;margin-top:2px}
.ach-ach-bar span{display:block;height:100%;border-radius:3px;transition:width .2s ease}
.ach-count{width:60px;flex:0 0 auto;padding:3px 6px;border-radius:6px;border:1px solid #444a55;background:#1a1d24;color:#e8eaef;font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)))}
.ach-check{flex:0 0 auto;width:20px;height:20px;border-radius:5px;border:1px solid #444a55;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#e05a5a;font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));background:#1a1d24}
.ach-check.on{color:#8bd450;border-color:#3f7a3f;background:#14241a}
.ach-check.auto{cursor:default;border-style:dashed}
.ach-checklist{flex-direction:row;align-items:flex-start;gap:8px}
.ach-checklist-body{flex:1;min-width:0}
.ach-shop-toggle{margin-top:4px;background:none;border:none;color:#8b7fff;font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));cursor:pointer;padding:0}
.ach-shop-toggle.open{opacity:.85}
.ach-shop-arr{display:inline-block;transition:transform .18s ease;font-size: max(var(--min-text, 5px), calc(15px * var(--text-scale, 1)));line-height:1;vertical-align:-2px}
.ach-shop-toggle.open .ach-shop-arr{transform:rotate(90deg)}
.ach-shop-list{margin-top:6px;display:flex;flex-direction:column;gap:3px;max-height:280px;overflow:auto;padding-right:6px}
.ach-shop-loc{font-size: max(var(--min-text, 5px), calc(11px * var(--text-scale, 1)));text-transform:uppercase;letter-spacing:.04em;opacity:.6;margin-top:6px}
.ach-shop{display:flex;align-items:center;gap:8px;font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)));color:#cdd2da;cursor:pointer}
.ach-shop .ach-check{width:18px;height:18px;font-size: max(var(--min-text, 5px), calc(11px * var(--text-scale, 1)))}
.ach-req-text{color:#cdd2da;flex:1;min-width:0}
.ach-reveal-btn{margin-top:8px;align-self:end;width:fit-content;background:#1f2228;border:1px solid #3a3e47;color:#cdd2da;border-radius:8px;padding:4px 10px;font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));cursor:pointer}
.ach-reveal-btn:hover{background:#2a2e37}
.ach-rainbow{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.ach-rainbow-btn{align-self:flex-start;background:linear-gradient(90deg,#e05a5a,#e6c84f,#8bd450,#5aa9e6,#8b7fff);color:#0b0d10;font-weight:700;border:none;border-radius:8px;padding:6px 12px;font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));cursor:pointer}
.ach-rainbow-btn:hover{filter:brightness(1.08)}
.ach-rainbow-msg{font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)));color:#dfe2e8}
.ach-rainbow-msg.ok{color:#8bd450}
.ach-rainbow-msg.bad{color:#e0776a}
.ach-rainbow-sub{font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));color:#aeb4bf}
.ach-rewards{margin-top:8px;display:flex;flex-direction:column;gap:6px;background:#0d1014;border:1px solid #222732;border-radius:8px;padding:8px 10px}
.ach-rw{display:flex;align-items:center;gap:10px;font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)));color:#dfe2e8;padding:6px 8px;background:#12151b;border-radius:6px}
.ach-rw-hidden{cursor:pointer}
.ach-rw-hidden:hover{background:#171a20}
.ach-rw-icon{width:24px;height:24px;flex:0 0 auto;object-fit:contain;image-rendering:pixelated;display:inline-flex;align-items:center;justify-content:center}
span.ach-rw-qmark{color:#e6c84f;font-weight:700;font-size: max(var(--min-text, 5px), calc(16px * var(--text-scale, 1)))}
.ach-rw-lbl{font-size: max(var(--min-text, 5px), calc(11px * var(--text-scale, 1)));letter-spacing:.04em;opacity:.6;text-transform:uppercase}
.ach-rw-val{margin-left:auto;font-weight:600;text-align:right}
.ach-rw-q{opacity:.7;font-weight:400}
@media(max-width:360px){.ach-overview{grid-template-columns:1fr}}
`;
        document.head.appendChild(s);
    }
}

export default AchievementsPage;
