#!/usr/bin/env node
/**
 * walkdle_best_guess.mjs — find the best OPENING guess for the Walkdle daily
 * puzzle, and quantify how the category-aware Skills change moved the optimum.
 *
 * Metric: with no prior information, a guess G partitions the whole answer pool
 * into buckets by the colored hint pattern it would produce. The information a
 * guess gives is how finely it splits the pool. We rank guesses by
 *   expected remaining candidates  E[rem] = Σ (bucket_size^2) / N
 * (lower is better — a smaller expected surviving set means a more informative
 * guess), and also report Shannon entropy in bits (higher is better) as a
 * cross-check. Uniform prior over the N pool entries (the same universe the
 * daily seed and Scoredle's remainingCounts use).
 *
 * Fidelity: the "NEW" pattern is verified cell-for-cell against the real engine
 * compareGuess() on a random sample before scoring, so the fast comparator is
 * proven to match the shipped logic (including the category-aware Skills
 * yellow). The "OLD" pattern is identical except the Skills column uses the
 * pre-change plain-set rule (yellow only on a direct shared token), which is
 * exactly what the yellow change replaced — so the NEW-vs-OLD ranking delta is
 * attributable solely to this feature.
 *
 * Usage:
 *   node util/walkdle_best_guess.mjs [catalog.json] [--top N]
 * (Generate catalog.json first: python3 util/walkdle_dump_catalog.py catalog.json)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';

import { compareGuess, WALKDLE_COLUMNS } from '../ui/static/js/walkdle-engine.js';

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
let catalogPath = 'walkdle_catalog.json';
let TOP = 15;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top') TOP = parseInt(args[++i], 10) || TOP;
    else catalogPath = args[i];
}
const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(isAbsolute(catalogPath) ? catalogPath : resolve(process.cwd(), catalogPath), 'utf8'));
const N = items.length;

// ---- category mapping (mirrors walkdle-engine SKILL_CATEGORY_MEMBERS) ------
const SKILL_CATEGORY_MEMBERS = {
    gathering: ['fishing', 'foraging', 'hunting', 'mining', 'woodcutting'],
    artisan: ['carpentry', 'cooking', 'crafting', 'smithing', 'tailoring', 'trinketry'],
    utility: ['agility'],
};
function skillsRelated(a, b) {
    if (a === b) return true;
    if (a === 'global' || b === 'global') return true;
    if ((SKILL_CATEGORY_MEMBERS[a] || []).includes(b)) return true;
    if ((SKILL_CATEGORY_MEMBERS[b] || []).includes(a)) return true;
    return false;
}

// ---- precompute per-item fields -------------------------------------------
const P = items.map((it) => ({
    tier: it.tier_index ?? 0,
    slot: (it.slot || ''),
    sources: it.sources || [],
    srcSet: new Set(it.sources || []),
    skills: it.skills || [],
    skillSet: new Set(it.skills || []),
    stat: it.stat_count ?? 0,
    level: it.level_req ?? 0,
    levelKind: it.level_kind || 'none',
    value: it.value ?? 0,
    keywords: it.keywords || [],
    kwSet: new Set(it.keywords || []),
}));

// ---- fast comparators (states as single-char tokens) ----------------------
function ordTok(g, t) {           // ordinal: G / Bu / Bd / A
    if (g == null || t == null) return 'A';
    if (g === t) return 'G';
    return t > g ? 'Bu' : 'Bd';
}
function setEq(gs, ts) { if (gs.size !== ts.size) return false; for (const x of gs) if (!ts.has(x)) return false; return true; }
function intersects(gArr, ts) { for (const x of gArr) if (ts.has(x)) return true; return false; }
function setTok(gArr, gs, tArr, ts) { if (setEq(gs, ts)) return 'G'; return intersects(gArr, ts) ? 'Y' : 'R'; }
function related(gArr, tArr) { for (const x of gArr) for (const y of tArr) if (skillsRelated(x, y)) return true; return false; }
function skillsTokNew(g, t) { if (setEq(g.skillSet, t.skillSet)) return 'G'; if (intersects(g.skills, t.skillSet)) return 'Y'; return related(g.skills, t.skills) ? 'Y' : 'R'; }
function skillsTokOld(g, t) { if (setEq(g.skillSet, t.skillSet)) return 'G'; return intersects(g.skills, t.skillSet) ? 'Y' : 'R'; }

// Signature builder. mode='new' uses category-aware skills; mode='old' uses plain set.
function sig(g, t, mode) {
    let tierT = ordTok(g.tier, t.tier);
    let slotT = g.slot === t.slot ? 'G' : 'R';
    let srcT = setTok(g.sources, g.srcSet, t.sources, t.srcSet);
    let skT = mode === 'new' ? skillsTokNew(g, t) : skillsTokOld(g, t);
    let statT = ordTok(g.stat, t.stat);
    // level: ordinal + kind (equal value but different kind -> yellow, per engine)
    let lvlT;
    if (g.level === t.level) lvlT = (g.levelKind !== t.levelKind) ? 'Y' : 'G';
    else lvlT = t.level > g.level ? 'Bu' : 'Bd';
    let valT = ordTok(g.value, t.value);
    let kwT = setTok(g.keywords, g.kwSet, t.keywords, t.kwSet);
    return tierT + '|' + slotT + '|' + srcT + '|' + skT + '|' + statT + '|' + lvlT + '|' + valT + '|' + kwT;
}

// ---- verify the fast NEW comparator against the real engine ----------------
function engineSig(gi, ti) {
    return compareGuess(items[gi], items[ti]).cells.map((c) => {
        if (c.state === 'blue') return 'B' + (c.dir === 'up' ? 'u' : 'd');
        if (c.state === 'green') return 'G';
        if (c.state === 'yellow') return 'Y';
        if (c.state === 'absent') return 'A';
        return 'R';
    }).join('|');
}
let checked = 0, mismatches = 0;
const SAMPLES = Math.min(4000, N * N);
for (let s = 0; s < SAMPLES; s++) {
    const gi = (Math.random() * N) | 0, ti = (Math.random() * N) | 0;
    checked++;
    if (sig(P[gi], P[ti], 'new') !== engineSig(gi, ti)) {
        mismatches++;
        if (mismatches <= 3) console.error(`MISMATCH g=${items[gi].id} t=${items[ti].id}\n  fast=${sig(P[gi], P[ti], 'new')}\n  eng =${engineSig(gi, ti)}`);
    }
}
if (mismatches > 0) { console.error(`FATAL: fast comparator disagrees with engine on ${mismatches}/${checked} samples`); process.exit(1); }
console.log(`✓ fast comparator matches engine compareGuess on ${checked} random pairs\n`);

// ---- score every guess for both modes -------------------------------------
function score(mode) {
    const out = [];
    for (let gi = 0; gi < N; gi++) {
        const buckets = new Map();
        const g = P[gi];
        for (let ti = 0; ti < N; ti++) {
            const k = sig(g, P[ti], mode);
            buckets.set(k, (buckets.get(k) || 0) + 1);
        }
        let sumSq = 0, ent = 0;
        for (const c of buckets.values()) { sumSq += c * c; const p = c / N; ent -= p * Math.log2(p); }
        out.push({ gi, id: items[gi].id, name: items[gi].name, expRem: sumSq / N, entropy: ent, buckets: buckets.size });
    }
    // lower expected-remaining first; tie-break higher entropy, then id for stability
    out.sort((a, b) => a.expRem - b.expRem || b.entropy - a.entropy || a.id.localeCompare(b.id));
    return out;
}
console.log(`Scoring ${N} candidate guesses over ${N} possible answers (uniform prior)...`);
const t0 = Date.now();
const NEW = score('new');
const OLD = score('old');
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// rank lookups by id
const newRank = new Map(NEW.map((r, i) => [r.id, i]));
const oldRank = new Map(OLD.map((r, i) => [r.id, i]));

function fmt(r) {
    return `${r.name} (${r.id})  E[rem]=${r.expRem.toFixed(2)}  entropy=${r.entropy.toFixed(3)} bits  patterns=${r.buckets}  skills=[${(items[r.gi].skills || []).join(',') || '—'}]`;
}

console.log(`================ BEST OPENING GUESS — NEW (category-aware Skills) ================`);
NEW.slice(0, TOP).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${fmt(r)}   (was #${oldRank.get(r.id) + 1} under OLD)`));

console.log(`\n================ BEST OPENING GUESS — OLD (plain-set Skills) ================`);
OLD.slice(0, TOP).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${fmt(r)}   (now #${newRank.get(r.id) + 1} under NEW)`));

console.log(`\n================ DID THE YELLOW CHANGE MOVE THE OPTIMUM? ================`);
const bestNew = NEW[0], bestOld = OLD[0];
console.log(`NEW #1: ${bestNew.name} (${bestNew.id})  E[rem]=${bestNew.expRem.toFixed(2)}`);
console.log(`OLD #1: ${bestOld.name} (${bestOld.id})  E[rem]=${bestOld.expRem.toFixed(2)}`);
if (bestNew.id === bestOld.id) {
    console.log(`→ Top pick UNCHANGED (${bestNew.name}).`);
} else {
    console.log(`→ Top pick CHANGED: OLD picked ${bestOld.name}, NEW picks ${bestNew.name}.`);
    console.log(`  ${bestOld.name} is now #${newRank.get(bestOld.id) + 1} under NEW; ${bestNew.name} was #${oldRank.get(bestNew.id) + 1} under OLD.`);
}
// How much did rankings shuffle overall + biggest movers?
let moved = 0;
for (const r of NEW) if (newRank.get(r.id) !== oldRank.get(r.id)) moved++;
console.log(`\n${moved}/${N} guesses changed rank between OLD and NEW (${(100 * moved / N).toFixed(1)}%).`);
const movers = NEW.map((r) => ({ id: r.id, name: r.name, delta: oldRank.get(r.id) - newRank.get(r.id), newRank: newRank.get(r.id) + 1, skills: items[r.gi].skills || [] }))
    .filter((m) => m.skills.length > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);
console.log(`\nBiggest rank movers (improved = climbed under NEW), skill-bearing items:`);
movers.forEach((m) => console.log(`  ${m.delta >= 0 ? '+' : ''}${m.delta}  ${m.name} → NEW #${m.newRank}  skills=[${m.skills.join(',')}]`));
