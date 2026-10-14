/*
 * optimizer-chips.js — one reusable definition of the standard optimizer
 * option chips (Use consumables + its sub-options, Use pets + Use Ability,
 * Run locally), so every surface that shows them (Column 3, the goals/stats
 * report, future panels) shares ONE source of truth for icons, colors, labels,
 * and the sub-option structure. Change an icon here and it changes everywhere.
 *
 * Only the BINDINGS are configurable per call: each chip/sub-chip takes a
 * settingName, an optional `readOn()` (state source — omit to use the global
 * window.settingsModal via the framework's Persistence), and an `onToggle(on)`
 * (the host's persistence + side-effects). The visuals/structure are fixed.
 *
 * Usage:
 *   const { consumables, pets, runLocal } = createStandardOptimizerChips({
 *     settingType: 'optimization-settings',
 *     consumables: {
 *       settingName: 'includeConsumables', readOn, onToggle, collapsed,
 *       minOwned: { value, operator },              // seed for the inline controls
 *       sub: {
 *         fine:    { settingName, readOn, onToggle },
 *         minOwned:{ settingName, readOn, onToggle },
 *         hidden:  { settingName, readOn, onToggle },
 *       },
 *     },
 *     pets: { settingName, readOn, onToggle, collapsed,
 *             ability: { settingName, readOn, onToggle } },
 *     runLocal: { settingName, readOn, onToggle, infoHtml } | null,  // null omits it
 *     icons, colors,                                  // optional overrides
 *   });
 *
 * The min-owned inline <select>/<input> carry classes `opt-consumable-minowned-op`
 * and `opt-consumable-minowned-input`; the CALLER wires their change/blur handlers
 * on its own panel element (the framework leaves inner controls to the host).
 */
import { Toggle } from './settings-panel.js';

// Red eye as an <img> so the shared "grayscale when unselected" filter makes it
// gray -> red on select (matches the other icon chips).
const RED_EYE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e06666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E";

const DEFAULT_ICONS = {
  consumables: '/assets/icons/slots/consumable.svg',
  fine: '/assets/icons/keywords/fine_material.svg',
  minOwned: '/assets/icons/attributes/inventory_space.svg',
  hidden: RED_EYE,
  pets: '/assets/icons/keywords/pet_egg.svg',
  ability: '/assets/icons/keywords/ability.svg',
  runLocal: '/assets/icons/keywords/run_locally.svg',
};

const DEFAULT_COLORS = {
  consumables: '#3fbf5f',
  fine: 'var(--fine-color,#B1F7ED)',
  minOwned: '#c9a06a',
  hidden: '#e06666',
  pets: '#F68187',
  ability: '#B18DFC',
  runLocal: '#2189ff',
};

const RUN_LOCAL_INFO = "Runs the optimizer in your browser instead of on the server. On a reasonably modern phone or computer this is usually faster, and it reduces server load. Older or low-end devices may be slower than the server. Results are identical to a server run, and once finished they're saved to the server, so they're available on all your devices.";

function minOwnedSpan(value, operator) {
  const v = Number.isFinite(value) ? value : 5;
  const op = (operator === 'lte') ? 'lte' : 'lt';
  return `Ignore&nbsp;<select class="opt-consumable-minowned-op" aria-label="Comparator">` +
    `<option value="lt" ${op !== 'lte' ? 'selected' : ''}>&lt;</option>` +
    `<option value="lte" ${op === 'lte' ? 'selected' : ''}>\u2264</option></select>&nbsp;` +
    `<input type="number" class="opt-consumable-minowned-input" inputmode="numeric" pattern="[0-9]*" ` +
    `min="1" max="100" step="1" value="${v}" size="3" aria-label="Minimum owned quantity">&nbsp;owned`;
}

/**
 * Build the standard trio of optimizer chips. Returns Toggle instances; the
 * caller adds them to a SettingsPanel in whatever line layout it wants.
 * @returns {{consumables: Toggle, pets: Toggle, runLocal: (Toggle|null),
 *            subToggles: {fine: Toggle, minOwned: Toggle, hidden: Toggle, ability: Toggle}}}
 */
export function createStandardOptimizerChips(cfg) {
  const ST = cfg.settingType || null;
  const I = Object.assign({}, DEFAULT_ICONS, cfg.icons);
  const C = Object.assign({}, DEFAULT_COLORS, cfg.colors);
  const c = cfg.consumables;
  const p = cfg.pets;

  // --- consumables + its three sub-options ---
  const fine = new Toggle(I.fine, 'Include Fine', C.fine, ST, c.sub.fine.settingName,
    { defaultOn: true, readOn: c.sub.fine.readOn, onToggle: c.sub.fine.onToggle });
  const minOwn = new Toggle(I.minOwned, minOwnedSpan(c.minOwned && c.minOwned.value, c.minOwned && c.minOwned.operator),
    C.minOwned, ST, c.sub.minOwned.settingName,
    { readOn: c.sub.minOwned.readOn, onToggle: c.sub.minOwned.onToggle });
  const hidden = new Toggle(I.hidden, 'Use hidden', C.hidden, ST, c.sub.hidden.settingName,
    { readOn: c.sub.hidden.readOn, onToggle: c.sub.hidden.onToggle });
  const consumables = new Toggle(I.consumables, 'Use consumables', C.consumables, ST, c.settingName,
    { collapseKey: 'consumables', readOn: c.readOn, onToggle: c.onToggle });
  consumables.attachCollapsableOption(fine, minOwn, hidden);
  if (c.collapsed !== undefined) consumables._collapsed = !!c.collapsed;

  // --- pets + its ability sub-option ---
  const ability = new Toggle(I.ability, 'Use Ability', C.ability, ST, p.ability.settingName,
    { readOn: p.ability.readOn, onToggle: p.ability.onToggle });
  const pets = new Toggle(I.pets, 'Use pets', C.pets, ST, p.settingName,
    { collapseKey: 'pets', readOn: p.readOn, onToggle: p.onToggle });
  pets.attachCollapsableOption(ability);
  if (p.collapsed !== undefined) pets._collapsed = !!p.collapsed;

  // --- run locally (optional) ---
  let runLocal = null;
  if (cfg.runLocal) {
    const info = cfg.runLocal.infoHtml !== undefined ? cfg.runLocal.infoHtml : RUN_LOCAL_INFO;
    const span = info
      ? `Run locally <span class="travel-info-icon opt-simple-chip-info" role="button" tabindex="0" aria-label="About running locally" data-info="${info}">ⓘ</span>`
      : 'Run locally';
    runLocal = new Toggle(I.runLocal, span, C.runLocal, ST, cfg.runLocal.settingName,
      { readOn: cfg.runLocal.readOn, onToggle: cfg.runLocal.onToggle });
  }

  return { consumables, pets, runLocal, subToggles: { fine, minOwned: minOwn, hidden, ability } };
}

/**
 * Build the goals-report "Include unavailable" chip: a linked parent with four
 * sub-toggles (By Level / By Location / By Gear/Tools / By Inputs). The parent
 * uses the new `linkedSubs` collapse kind (see settings-panel.js): unchecking
 * every sub auto-unchecks the parent WITHOUT collapsing the box, and checking a
 * sub re-checks the parent. By Inputs defaults ON (preserves today's behavior);
 * the others default OFF. The caller supplies readOn/onToggle for the parent and
 * each sub (report-local state).
 *
 * @returns {{includeUnavailable: Toggle, subToggles: {level,location,gear,inputs}}}
 */
export function createIncludeUnavailableChip(cfg) {
  const ST = cfg.settingType || null;
  const I = Object.assign({
    parent: '/assets/icons/ui/include_unavailable.svg',
    level: '/assets/icons/ui/unavail_by_level.svg',
    location: '/assets/icons/ui/unavail_by_location.svg',
    gear: '/assets/icons/ui/unavail_by_gear.svg',
    inputs: '/assets/icons/ui/unavail_by_inputs.svg',
    other: '/assets/icons/ui/unavail_other.svg',
  }, cfg.icons);
  const C = Object.assign({
    parent: '#63AB3F',   // green open-padlock
    level: '#F0B541',    // orange-yellow
    location: '#E64539', // red roofs
    gear: '#8A4836',     // brown armor
    inputs: '#BF6F4A',   // light brown
    other: '#8C7BB0',    // slate/purple (rep + coin unlocks)
  }, cfg.colors);
  const s = cfg.sub;

  const level = new Toggle(I.level, 'By Level', C.level, ST, s.level.settingName,
    { readOn: s.level.readOn, onToggle: s.level.onToggle });

  // By Location carries an ⓘ adapted from the existing region-access wording.
  const locInfo = cfg.locationInfo !== undefined ? cfg.locationInfo
    : "Includes activities in regions you can't reach yet, and shows what unlocks them — e.g. Syrenthia needs diving gear; Myriadian Arc / Wrentmark need the Charter of the Drowned (and a camel to cross the desert).";
  const locSpan = `By Location <span class="travel-info-icon opt-simple-chip-info" role="button" tabindex="0" aria-label="About by-location" data-info="${locInfo}">ⓘ</span>`;
  const location = new Toggle(I.location, locSpan, C.location, ST, s.location.settingName,
    { readOn: s.location.readOn, onToggle: s.location.onToggle });

  const gear = new Toggle(I.gear, 'By Gear/Tools', C.gear, ST, s.gear.settingName,
    { readOn: s.gear.readOn, onToggle: s.gear.onToggle });

  const inputs = new Toggle(I.inputs, 'By Inputs', C.inputs, ST, s.inputs.settingName,
    { defaultOn: true, readOn: s.inputs.readOn, onToggle: s.inputs.onToggle });

  // "Other" = reputation + coin unlock requirements (the non-level/location/
  // gear/input gates). Carries a short ⓘ since "Other" is otherwise opaque.
  const otherInfo = cfg.otherInfo !== undefined ? cfg.otherInfo
    : "Includes activities locked behind faction reputation or a coin cost to unlock — anything that isn't a skill level, region access, gear/tool, or input item.";
  const otherSpan = `Other <span class="travel-info-icon opt-simple-chip-info" role="button" tabindex="0" aria-label="About other unlocks" data-info="${otherInfo}">ⓘ</span>`;
  const other = new Toggle(I.other, otherSpan, C.other, ST, s.other.settingName,
    { readOn: s.other.readOn, onToggle: s.other.onToggle });

  const parent = new Toggle(I.parent, 'Include unavailable', C.parent, ST, cfg.settingName,
    { defaultOn: true, linkedSubs: true, collapseKey: cfg.collapseKey || 'includeUnavailable',
      readOn: cfg.readOn, onToggle: cfg.onToggle });
  parent.attachCollapsableOption(level, location, gear, inputs, other);
  parent._collapsed = (cfg.collapsed !== undefined) ? !!cfg.collapsed : false; // default expanded

  return { includeUnavailable: parent, subToggles: { level, location, gear, inputs, other } };
}

export { minOwnedSpan };
