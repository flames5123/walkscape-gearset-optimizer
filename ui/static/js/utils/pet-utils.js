/**
 * Pet utility functions shared across components.
 */

/** Valid pet color variants */
export const PET_VARIANTS = ['normal', 'light', 'dark', 'rare'];

/**
 * Species that ship in a single colour only — no light/dark/rare colour
 * variants. The Pixie is the first such pet (it also cannot be rare), so its
 * owned-items row shows no colour-variant dropdown. Add a species here if a
 * future pet is likewise single-colour.
 */
export const SINGLE_VARIANT_SPECIES = new Set(['pixie']);

/**
 * Colour variants available for a given pet. Single-colour species (see
 * SINGLE_VARIANT_SPECIES) return ['normal']; every other pet supports the full
 * normal/light/dark/rare set.
 *
 * @param {Object|string} petOrName - pet catalog item ({species, name}) or a name/species string
 * @returns {string[]}
 */
export function getPetVariants(petOrName) {
    let species = '';
    if (typeof petOrName === 'string') species = petOrName;
    else if (petOrName) species = petOrName.species || petOrName.name || '';
    species = String(species).toLowerCase();
    if (SINGLE_VARIANT_SPECIES.has(species)) return ['normal'];
    return PET_VARIANTS;
}

/**
 * Smelting recipes — the subset of Smithing recipes the Tortoise's ability applies to.
 * Matches the Smelting Keyword wiki page.
 */
export const SMELTING_RECIPE_NAMES = new Set([
    'Smelt a copper bar',
    'Create a copper bar (Scrap)',
    'Smelt a silver bar',
    'Smelt a bronze bar',
    'Create a bronze bar (Scrap)',
    'Smelt a gold bar',
    'Smelt an iron bar',
    'Create an iron bar (Scrap)',
    'Smelt a steel bar',
    'Create a steel bar (Scrap)',
    'Smelt a tarsilium bar',
    'Create a tarsilium bar (Scrap)',
    'Smelt a hydrilium bar',
    'Smelt a farganite bar',
    'Smelt into ectoplasm',
    'Smelt an adamant bar',
    'Smelt a violite bar',
]);

/**
 * Get the correct icon path for a pet based on its level and variant.
 * Level 0 = egg, 1 to (maxLevel-1) = juvenile, maxLevel = adult.
 * Falls back to level <= 2 = juvenile if maxLevel is unknown.
 * 
 * @param {string} petName - Pet name (will be lowercased)
 * @param {number} level - Current pet level (0-4)
 * @param {string} [variant='normal'] - Color variant: normal, light, dark, rare
 * @param {number} [maxLevel=0] - Pet's max level (0 = unknown, use fallback)
 * @returns {string} Icon path
 */
export function getPetIconPath(petName, level, variant = 'normal', maxLevel = 0) {
    const base = petName.toLowerCase();
    const v = (variant || 'normal').toLowerCase();
    if (level === 0) return `/assets/icons/items/pet_eggs/${base}_egg.svg`;
    const isAdult = maxLevel > 0 ? level >= maxLevel : level >= 3;
    if (isAdult) return `/assets/icons/items/pets/${base}_adult_${v}.svg`;
    return `/assets/icons/items/pets/${base}_juvenile_${v}.svg`;
}

/**
 * Get the stage label for a pet level.
 * @param {number} level - Pet level
 * @param {number} [maxLevel=0] - Pet's max level (0 = unknown, use fallback)
 * @returns {string} Stage label
 */
export function getPetStageLabel(level, maxLevel = 0) {
    if (level === 0) return 'Egg';
    const isAdult = maxLevel > 0 ? level >= maxLevel : level >= 3;
    if (isAdult) return 'Adult';
    return 'Juvenile';
}

/**
 * Get the instant-actions pet for a given skill type, if the user owns it
 * at the required level and it is not hidden.
 *
 * Checks three eligibility conditions (all must be true):
 *   1. The pet catalog has an instant-actions ability for the given skill type
 *   2. The user owns the pet at the required level (level 4+)
 *   3. The pet is not hidden (eye-icon toggle in Column 1 Owned Items)
 *
 * @param {string} skillType - lowercase skill name, e.g. "foraging", "smelting"
 * @param {Object} ownedItems - store.state.items (itemId → {has, hide, level, ...})
 * @param {Array}  petCatalog - array of pet catalog entries from /api/catalog
 * @returns {{ petName: string, species: string, abilityName: string, effect: string,
 *             cooldown: string|null, charges: number|null, requiredLevel: number,
 *             count: number, petId: string }|null}
 *   Pet info if eligible, or null if not eligible.
 */
export function getInstantActionsPet(skillType, ownedItems, petCatalog, userOverrideItems = {}) {
    if (!skillType || !ownedItems || !petCatalog) return null;

    const skill = skillType.toLowerCase();

    // Skill aliases: some pet abilities reference sub-skills that map to a parent skill
    // e.g. Tortoise's "Smelting" ability applies when the recipe skill is "smithing"
    const SKILL_ALIASES = {
        'smelting': 'smithing',
        'smithing': 'smelting',  // also match smelting pets when smithing is selected
    };

    for (const petEntry of petCatalog) {
        if (!petEntry || petEntry.type !== 'pet') continue;

        const levels = petEntry.levels || {};
        for (const [levelStr, levelData] of Object.entries(levels)) {
            const abilities = levelData.abilities || [];
            for (const ability of abilities) {
                if (!ability.instant_actions) continue;

                const abilitySkill = (ability.instant_actions_skill || '').toLowerCase();
                // Match if skill matches directly OR via alias
                const skillMatches = abilitySkill === skill || SKILL_ALIASES[abilitySkill] === skill;
                if (!skillMatches) continue;

                // Found a matching instant-actions ability at this level
                const requiredLevel = parseInt(levelStr, 10);
                const petId = (petEntry.id || petEntry.name || '').toLowerCase();

                // Check ownership from store.state.items (character import path)
                const itemState = ownedItems[petId] || ownedItems[petEntry.id] || null;
                // Also check user_overrides (manual ownership path — set via pet level dropdown)
                const overrideState = userOverrideItems[petId] || userOverrideItems[petEntry.id] || null;

                // Determine owned level: prefer override, fall back to itemState
                const ownedLevel = (overrideState?.level != null)
                    ? overrideState.level
                    : (itemState?.level || 0);

                // Determine has: either itemState.has or overrideState.has
                const isOwned = !!(itemState?.has || overrideState?.has);

                if (!isOwned || ownedLevel < requiredLevel) continue;

                // Check visibility: pet must not be hidden
                const isHidden = !!(itemState?.hide || overrideState?.hide);
                if (isHidden) continue;

                return {
                    petName: petEntry.name,
                    species: petEntry.species || petId,
                    abilityName: ability.name || '',
                    effect: ability.effect || '',
                    cooldown: ability.cooldown || null,
                    charges: ability.charges || null,
                    requiredLevel,
                    count: ability.instant_actions_count || 5,
                    petId,
                    // The actual skill key used for backend matching
                    skillKey: abilitySkill,
                };
            }
        }
    }

    return null;
}

/**
 * Get the ability-stats pet for a given skill type, if the user owns it at the
 * required level and it is not hidden.
 *
 * Unlike getInstantActionsPet (chicken/tortoise — instant actions), this finds
 * a pet whose activatable ability grants flat stats (work efficiency / double
 * action / steps) for the given skill while active. Currently this is the
 * Tiger's "The Hunt Is On" ability for Hunting.
 *
 * Eligibility (all must be true):
 *   1. A pet ability has `ability_stats` keyed for the given skill
 *   2. The user owns the pet at the required level (level 4+)
 *   3. The pet is not hidden (eye-icon toggle in Column 1 Owned Items)
 *
 * @param {string} skillType - lowercase skill name, e.g. "hunting"
 * @param {Object} ownedItems - store.state.items (itemId → {has, hide, level, ...})
 * @param {Array}  petCatalog - array of pet catalog entries from /api/catalog
 * @param {Object} [userOverrideItems] - store.state.ui.user_overrides.items
 * @returns {{ petName: string, species: string, abilityName: string, effect: string,
 *             duration: number|null, cooldown: string|null, charges: number|null,
 *             requiredLevel: number, petId: string, abilityStats: Object,
 *             skillKey: string }|null}
 *   Pet info if eligible, or null if not eligible.
 */
export function getAbilityStatsPet(skillType, ownedItems, petCatalog, userOverrideItems = {}) {
    if (!skillType || !ownedItems || !petCatalog) return null;

    const skill = skillType.toLowerCase();

    for (const petEntry of petCatalog) {
        if (!petEntry || petEntry.type !== 'pet') continue;

        const levels = petEntry.levels || {};
        for (const [levelStr, levelData] of Object.entries(levels)) {
            const abilities = levelData.abilities || [];
            for (const ability of abilities) {
                const abilityStats = ability.ability_stats;
                if (!abilityStats || Object.keys(abilityStats).length === 0) continue;
                // The ability must grant stats for the current skill
                if (!(skill in abilityStats)) continue;

                const requiredLevel = parseInt(levelStr, 10);
                const petId = (petEntry.id || petEntry.name || '').toLowerCase();

                const itemState = ownedItems[petId] || ownedItems[petEntry.id] || null;
                const overrideState = userOverrideItems[petId] || userOverrideItems[petEntry.id] || null;

                const ownedLevel = (overrideState?.level != null)
                    ? overrideState.level
                    : (itemState?.level || 0);
                const isOwned = !!(itemState?.has || overrideState?.has);
                if (!isOwned || ownedLevel < requiredLevel) continue;

                const isHidden = !!(itemState?.hide || overrideState?.hide);
                if (isHidden) continue;

                return {
                    petName: petEntry.name,
                    species: petEntry.species || petId,
                    abilityName: ability.name || '',
                    effect: ability.effect || '',
                    duration: ability.duration || null,
                    durationUnit: ability.duration_unit || null,
                    cooldown: ability.cooldown || null,
                    charges: ability.charges || null,
                    requiredLevel,
                    petId,
                    abilityStats,
                    skillKey: skill,
                };
            }
        }
    }

    return null;
}
