/**
 * GenericItemForm — popup modal for creating/editing generic equipment items.
 * Gated behind window._featureFlags?.generic.
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const STAT_TYPES = [
    { value: 'work_efficiency', label: 'Work Efficiency (%)', svg: '/assets/icons/attributes/work_efficiency.svg', group: 'base' },
    { value: 'double_action', label: 'Double Action (%)', svg: '/assets/icons/attributes/double_action.svg', group: 'base' },
    { value: 'double_rewards', label: 'Double Rewards (%)', svg: '/assets/icons/attributes/double_rewards.svg', group: 'base' },
    { value: 'bonus_xp_add', label: 'Bonus XP (flat)', svg: '/assets/icons/attributes/bonus_experience.svg', group: 'base' },
    { value: 'bonus_xp_percent', label: 'Bonus XP (%)', svg: '/assets/icons/attributes/bonus_experience.svg', group: 'base' },
    { value: 'chest_finding', label: 'Chest Finding (%)', svg: '/assets/icons/attributes/chest_finding.svg', group: 'base' },
    { value: 'find_bird_nests', label: 'Find Bird Nests (%)', svg: '/assets/icons/attributes/find_bird_nests.svg', group: 'base' },
    { value: 'find_coin_pouch', label: 'Find Coin Pouch (%)', svg: '/assets/icons/attributes/item_finding.svg', group: 'base' },
    { value: 'find_collectibles', label: 'Find Collectibles (%)', svg: '/assets/icons/attributes/find_collectibles.svg', group: 'base' },
    { value: 'find_gems', label: 'Find Gems (%)', svg: '/assets/icons/attributes/find_gems.svg', group: 'base' },
    { value: 'fine_material_finding', label: 'Fine Material Finding (%)', svg: '/assets/icons/attributes/fine_material_finding.svg', group: 'base' },
    { value: 'inventory_space', label: 'Inventory Space', svg: '/assets/icons/attributes/inventory_space.svg', group: 'base' },
    { value: 'no_materials_consumed', label: 'No Material Consumed (%)', svg: '/assets/icons/attributes/no_materials_consumed.svg', group: 'base' },
    { value: 'quality_outcome', label: 'Quality Outcome', svg: '/assets/icons/attributes/quality_outcome.svg', group: 'base' },
    { value: 'steps_add', label: 'Steps (flat)', svg: '/assets/icons/attributes/steps_required.svg', group: 'base' },
    { value: 'steps_percent', label: 'Steps (%)', svg: '/assets/icons/attributes/steps_required.svg', group: 'base' },
    // Item Finding categories
    { value: 'ItemFindingCategory.ADVENTURERS_GUILD_TOKENS', label: "Adventurers' Guild Tokens", svg: '/assets/icons/attributes/find_adventurers_guild_token.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.CRUSTACEAN', label: 'Crustacean', svg: '/assets/icons/attributes/find_crustacean.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.ECTOPLASM', label: 'Ectoplasm', svg: '/assets/icons/attributes/find_ectoplasm.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.FISHING_BAIT', label: 'Fishing Bait', svg: '/assets/icons/attributes/find_fishing_bait.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.GOLD_NUGGET', label: 'Gold Nugget', svg: '/assets/icons/attributes/find_gold_nugget.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.GOLD_PIECES', label: 'Gold Pieces', svg: '/assets/icons/attributes/find_gold_pieces.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.RANDOM_GEM', label: 'Random Gem', svg: '/assets/icons/attributes/find_random_gem.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.RANDOM_PIECE_OF_JUNK', label: 'Random Piece of Junk', svg: '/assets/icons/attributes/find_random_piece_of_junk.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.SEA_SHELLS', label: 'Sea Shells', svg: '/assets/icons/attributes/find_sea_shells.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.FIBROUS_PLANT', label: 'Fibrous Plant', svg: '/assets/icons/attributes/find_fibrous_plant.svg', group: 'item_finding' },
    { value: 'ItemFindingCategory.SKILL_CHEST', label: 'Skill Chest', svg: '/assets/icons/attributes/find_skill_chest.svg', group: 'item_finding' },
];

const VALID_SLOTS = [
    { value: 'head', label: 'Head', emoji: '🪖' },
    { value: 'cape', label: 'Cape', emoji: '🧣' },
    { value: 'back', label: 'Back', emoji: '🎒' },
    { value: 'chest', label: 'Chest', emoji: '👕' },
    { value: 'hands', label: 'Hands', emoji: '🧤' },
    { value: 'legs', label: 'Legs', emoji: '👖' },
    { value: 'neck', label: 'Neck', emoji: '📿' },
    { value: 'feet', label: 'Feet', emoji: '👢' },
    { value: 'ring', label: 'Ring', emoji: '💍' },
    { value: 'tool', label: 'Tool', emoji: '🔧' },
    { value: 'primary', label: 'Primary', emoji: '⚔️' },
    { value: 'secondary', label: 'Secondary', emoji: '🛡️' },
    { value: 'consumable', label: 'Consumable', emoji: '🍞' },
    { value: 'collectible', label: 'Collectible', emoji: '🏆' },
    { value: 'input', label: 'Input', emoji: '📥' },
    { value: 'pet', label: 'Pet', emoji: '🐾' },
];

function slotIcon(val) {
    const s = VALID_SLOTS.find(v => v.value === val);
    const fb = s ? s.emoji : '❓';
    return `<img src="/assets/icons/slots/${val}.svg" class="gi-slot-icon" onerror="this.outerHTML='<span class=\\'gi-slot-icon-emoji\\'>${fb}</span>'" />`;
}

const RARITIES = [
    { value: 'common', label: 'Common', css: 'var(--rarity-common, #b0b0b0)' },
    { value: 'uncommon', label: 'Uncommon', css: 'var(--rarity-uncommon, #4caf50)' },
    { value: 'rare', label: 'Rare', css: 'var(--rarity-rare, #2196f3)' },
    { value: 'epic', label: 'Epic', css: 'var(--rarity-epic, #9c27b0)' },
    { value: 'legendary', label: 'Legendary', css: 'var(--rarity-legendary, #ff9800)' },
    { value: 'ethereal', label: 'Ethereal', css: 'var(--rarity-ethereal, #e91e63)' },
];

const QUALITY_NAMES = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
const CONSUMABLE_QUALITY_NAMES = ['Normal', 'Fine'];
const PET_LEVEL_NAMES = ['Egg', 'Level 1', 'Level 2', 'Level 3'];
const PET_LEVEL_NAMES_MAX = ['Egg', 'Level 1', 'Level 2', 'Level 3', 'Level 4'];
const QUALITY_TO_RARITY = {
    'Normal': 'common', 'Good': 'uncommon', 'Great': 'rare',
    'Excellent': 'epic', 'Perfect': 'legendary', 'Eternal': 'ethereal',
    'Fine': 'fine',
};

const SKILL_CATEGORIES = [
    { group: 'Gathering', skills: ['Fishing', 'Foraging', 'Hunting', 'Mining', 'Woodcutting'] },
    { group: 'Artisan', skills: ['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring', 'Trinketry'] },
    { group: 'Utility', skills: ['Agility', 'Traveling'] },
];

const LOCATION_GROUPS = [
    { group: 'Global', items: [{ value: 'global', label: 'Global', icon: '🌐' }] },
    {
        group: 'Regions', items: [
            { value: 'jarvonia', label: 'Jarvonia', svg: '/assets/icons/factions/jarvonia.svg' },
            { value: 'gdte', label: 'GDTE', svg: '/assets/icons/regions/gdte.svg' },
            { value: 'trellin', label: 'Trellin', svg: '/assets/icons/factions/trellin.svg' },
            { value: 'erdwise', label: 'Erdwise', svg: '/assets/icons/factions/erdwise.svg' },
            { value: 'halfling_rebels', label: 'Halfling Rebels', svg: '/assets/icons/factions/halfling_rebels.svg' },
            { value: 'syrenthia', label: 'Syrenthia', svg: '/assets/icons/factions/syrenthia.svg' },
            { value: 'wallisia', label: 'Wallisia', svg: '/assets/icons/factions/wallisia.svg' },
            { value: 'wrentmark', label: 'Wrentmark', svg: '/assets/icons/factions/wrentmark.svg' },
        ]
    },
    {
        group: 'Keywords', items: [
            { value: 'underwater', label: 'Underwater', svg: '/assets/icons/keywords/underwater.svg' },
            { value: 'spectral', label: 'Spectral', svg: '/assets/icons/keywords/spectral.svg' },
        ]
    },
];

const EMOJI_OPTIONS = ['⚡', '⚔️', '🎯', '🏹', '🛡️', '🔥', '💎', '🌊', '🌲', '⛏️', '🎣', '🍳', '🪚', '🧵', '🐾', '🏔️', '❄️', '☀️', '🌙', '⭐', '🪖', '👕', '👖', '👢', '🧤', '💍', '📿', '🎒', '🧣'];

const KNOWN_KEYWORDS = [
    { value: 'Achievement reward', icon: '🏆' },
    { value: 'Advanced diving gear', icon: '🤿' },
    { value: 'Adventuring tool set', icon: '🧰' },
    { value: 'Alcohol', icon: '🍺' },
    { value: 'Amulet', icon: '📿' },
    { value: 'Arrows', icon: '🏹' },
    { value: 'Bar', icon: '🔩' },
    { value: 'Basket', icon: '🧺' },
    { value: 'Bellows', icon: '💨' },
    { value: 'Beverage', icon: '🥤' },
    { value: 'Birdhouse', icon: '🏠' },
    { value: 'Bug catching net', icon: '🪲' },
    { value: 'Carpentry tool', icon: '🪚' },
    { value: 'Chisel', icon: '🪨' },
    { value: 'Climbing gear', icon: '🧗' },
    { value: 'Cooked fish', icon: '🐟' },
    { value: 'Cooking knife', icon: '🔪' },
    { value: 'Cooking pan', icon: '🍳' },
    { value: 'Cooking pot', icon: '🍲' },
    { value: 'Cooking recipe', icon: '📋' },
    { value: 'Cooking tool', icon: '🍳' },
    { value: 'Crafting tool', icon: '🔧' },
    { value: 'Crustacean', icon: '🦀' },
    { value: 'Currency', icon: '🪙' },
    { value: 'Cursed', icon: '💀' },
    { value: 'Cut gem', icon: '💎' },
    { value: 'Cutting board', icon: '🪵' },
    { value: 'Cutting mat', icon: '✂️' },
    { value: 'Desert location', icon: '🏜️' },
    { value: 'Diving gear', icon: '🤿' },
    { value: 'Expert diving gear', icon: '🤿' },
    { value: 'Fabric', icon: '🧵' },
    { value: 'Faction reward', icon: '🏅' },
    { value: 'Fish', icon: '🐟' },
    { value: 'Fishing cage', icon: '🪤' },
    { value: 'Fishing lure', icon: '🪝' },
    { value: 'Fishing net', icon: '🥅' },
    { value: 'Fishing rod', icon: '🎣' },
    { value: 'Fishing spear', icon: '🔱' },
    { value: 'Fishing tool', icon: '🎣' },
    { value: 'Fishing', icon: '🎣' },
    { value: 'Food', icon: '🍽️' },
    { value: 'Forge', icon: '🔥' },
    { value: 'Foraging tool', icon: '🌿' },
    { value: 'Fruit', icon: '🍎' },
    { value: 'Gem', icon: '💎' },
    { value: 'Gold pan', icon: '🥘' },
    { value: 'Hatchet', icon: '🪓' },
    { value: 'Heat resistant', icon: '🔥' },
    { value: 'Heavy', icon: '⚖️' },
    { value: 'Hunting bow', icon: '🏹' },
    { value: 'Hunting net', icon: '🥅' },
    { value: 'Hunting trap', icon: '🪤' },
    { value: 'Ingredient', icon: '🌿' },
    { value: 'Kitchen', icon: '🍳' },
    { value: 'Knife', icon: '🔪' },
    { value: 'Life vest', icon: '🦺' },
    { value: 'Light source', icon: '💡' },
    { value: 'Light', icon: '💡' },
    { value: 'Local map', icon: '🗺️' },
    { value: 'Log splitter', icon: '🪓' },
    { value: 'Log', icon: '🪵' },
    { value: 'Magnetic', icon: '🧲' },
    { value: 'Magnifying lens', icon: '🔍' },
    { value: 'Memosphere', icon: '🔮' },
    { value: 'Mining ores', icon: '⛏️' },
    { value: 'Mining tool', icon: '⛏️' },
    { value: 'Misc.', icon: '❓' },
    { value: 'Mushroom', icon: '🍄' },
    { value: 'Needle', icon: '🪡' },
    { value: 'Nugget', icon: '🪙' },
    { value: 'Offcut', icon: '✂️' },
    { value: 'Ore', icon: '🪨' },
    { value: 'Pet egg', icon: '🥚' },
    { value: 'Pickaxe', icon: '⛏️' },
    { value: 'Pins', icon: '📌' },
    { value: 'Plank', icon: '🪵' },
    { value: 'Plant foraging', icon: '🌿' },
    { value: 'Plant', icon: '🌱' },
    { value: 'Pliers', icon: '🔧' },
    { value: 'Processed', icon: '⚙️' },
    { value: 'Proper gear', icon: '👔' },
    { value: 'Regional', icon: '🗺️' },
    { value: 'Ring', icon: '💍' },
    { value: 'Rough gem', icon: '💎' },
    { value: 'Ruler', icon: '📏' },
    { value: 'Sander', icon: '🪵' },
    { value: 'Sandwich recipe', icon: '📋' },
    { value: 'Sandwich', icon: '🥪' },
    { value: 'Saw', icon: '🪚' },
    { value: 'Sawmill', icon: '🪚' },
    { value: 'Scissors', icon: '✂️' },
    { value: 'Screwdriver', icon: '🪛' },
    { value: 'Shield', icon: '🛡️' },
    { value: 'Sickle', icon: '🌾' },
    { value: 'Skill book', icon: '📖' },
    { value: 'Skis', icon: '⛷️' },
    { value: 'Skydisc', icon: '🛸' },
    { value: 'Smelting', icon: '🔥' },
    { value: 'Smithing hammer', icon: '🔨' },
    { value: 'Smithing tool', icon: '🔨' },
    { value: 'Socks', icon: '🧦' },
    { value: 'Spectral location', icon: '👻' },
    { value: 'Spectral', icon: '👻' },
    { value: 'Spices', icon: '🌶️' },
    { value: 'Tailoring tool', icon: '🧵' },
    { value: 'Tool', icon: '🔧' },
    { value: 'Toolbox', icon: '🧰' },
    { value: 'Trash', icon: '🗑️' },
    { value: 'Treasure hunter set', icon: '💰' },
    { value: 'Trinket', icon: '💎' },
    { value: 'Trinketry bench', icon: '💎' },
    { value: 'Trinketry tool', icon: '💎' },
    { value: 'Ultra light', icon: '🪶' },
    { value: 'Underwater', icon: '🌊' },
    { value: 'Water', icon: '💧' },
    { value: 'Weapon', icon: '⚔️' },
    { value: 'Woodcutting tool', icon: '🪓' },
    { value: 'Woodcutting trees', icon: '🌲' },
    { value: 'Workshop', icon: '🔧' },
    { value: 'Wrench', icon: '🔧' },
];

function skillIcon(name) {
    const id = name.toLowerCase().replace(' ', '_');
    if (id === 'traveling') return `<img src="/assets/icons/activities/agility/traveling.svg" class="ga-skill-icon" />`;
    return `<img src="/assets/icons/text/skill_icons/${id}.svg" class="ga-skill-icon" />`;
}

function kwIcon(value) {
    const id = value.toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
    return `<img src="/assets/icons/keywords/${id}.svg" class="gi-kw-icon" onerror="this.style.display='none'" />`;
}

function rarityColor(val) {
    const r = RARITIES.find(v => v.value === val);
    return r ? r.css : 'var(--rarity-common)';
}

function rarityBorderColor(val) {
    if (val === 'fine') return 'var(--fine-color)';
    return `var(--rarity-${val}-border, var(--rarity-${val}))`;
}

// ============================================================================
// CLASS
// ============================================================================

class GenericItemForm {
    constructor() {
        this._reset();
        this.$overlay = null;
        this._floatingOpenBtn = null;
        this.savedDefs = [];
        this.communityDefs = [];
        this.customKeywordsFromDB = []; // Loaded from /api/custom-keywords
        this.showCommunity = store.state.column3?.showGenericItemCommunity ?? false;
        this.savedSearchText = '';
        this._isCommunityEdit = false; // True when editing a community item in-place
        this._loadCustomKeywords();
    }

    _reset() {
        this.currentDefId = null;
        this.currentDefName = '';
        this._isCommunityEdit = false;
        this.selectedIcon = '⚡';
        this.selectedIconColor = null;
        this.iconPath = '';
        this.selectedSlot = '';
        this.isCrafted = false;
        this.selectedRarity = 'common';
        this.keywords = [];
        this.customKwEmojis = {}; // {keyword: emoji} for user-created keywords
        this.customKwColors = {}; // {keyword: color} for user-created keyword tints
        this.statRows = [];
        this.requirementRows = [];
        this.qualityStatRows = {};
        for (const q of QUALITY_NAMES) this.qualityStatRows[q] = [];
        for (const q of CONSUMABLE_QUALITY_NAMES) if (!this.qualityStatRows[q]) this.qualityStatRows[q] = [];
        for (const q of PET_LEVEL_NAMES_MAX) if (!this.qualityStatRows[q]) this.qualityStatRows[q] = [];
        this.activeQualityTab = 'Normal';
        this._wasAutoConsumableCrafted = false;
        this.duration = 1000;
        this.itemValue = 0;
        this.qualityValues = {};
        for (const q of QUALITY_NAMES) this.qualityValues[q] = 0;
        for (const q of CONSUMABLE_QUALITY_NAMES) if (this.qualityValues[q] === undefined) this.qualityValues[q] = 0;
        for (const q of PET_LEVEL_NAMES_MAX) if (this.qualityValues[q] === undefined) this.qualityValues[q] = 0;
        // Pet-specific state
        this.petHasLevel4 = false;
        this.petXpRequirements = {}; // {levelName: xpValue} e.g. {'Level 1': 50000}
        this.petXpReqRows = []; // [{type: 'location'|'skill', value: '', not: false}]
        // Gated stats: {ap: {threshold: {skill: {loc: {stat: val}}}}, set_pieces: {keyword: {count: {skill: {loc: {stat: val}}}}}}
        this.gatedStats = {};
    }

    // ------------------------------------------------------------------
    // SHOW / HIDE
    // ------------------------------------------------------------------

    show(defData = null) {
        if (!window._featureFlags?.generic) return;
        this._reset();
        this._autoEquipSlot = defData?._autoEquipSlot || null;
        // Load custom keywords — populate emojis from DB when ready
        this._loadCustomKeywords().then(() => {
            // Re-render keyword tags once DB keywords are loaded
            if (this.$overlay) {
                this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
            }
        });
        if (defData) this._populateFrom(defData);
        // Apply slot-specific defaults even if _populateFrom didn't set them
        // (handles case where defData is just { slot: 'consumable' } without is_crafted)
        if (this._isConsumableSlot() && !this.isCrafted) {
            this.isCrafted = true;
            this.activeQualityTab = 'Normal';
        } else if (this._isInputSlot() && !this.isCrafted) {
            this.isCrafted = true;
            this.activeQualityTab = 'Normal';
        } else if (this._isCollectibleSlot()) {
            this.isCrafted = false;
            this.selectedRarity = 'common';
            this.keywords = [];
        } else if (this._isPetSlot()) {
            this.isCrafted = true; // Use quality tabs system for level tabs
            this.activeQualityTab = 'Egg';
            this.selectedRarity = 'common';
            this.keywords = [];
        }
        this._render();
        requestAnimationFrame(() => this.$overlay.addClass('show'));
        $('body').addClass('modal-open');
        this._loadSavedDefinitions();
    }

    hide() {
        if (!this.$overlay) return;
        this.$overlay.removeClass('show');
        $('.gi-floating-dd').remove();
        $('.gi-icon-popup-floating').remove();
        setTimeout(() => { if (this.$overlay) { this.$overlay.remove(); this.$overlay = null; } }, 200);
        $('body').removeClass('modal-open');
    }

    _populateFrom(def) {
        this.currentDefId = def.id || null;
        this.currentDefName = def.name || '';
        this.selectedIcon = def.icon || '⚡';
        this.selectedIconColor = def.icon_color || null;
        this.iconPath = def.icon_path || '';
        // If icon field contains a path (from sheet data), treat it as icon_path
        if (this.selectedIcon.includes('/') || this.selectedIcon.endsWith('.svg') || this.selectedIcon.endsWith('.png')) {
            this.iconPath = this.selectedIcon;
            this.selectedIcon = '⚡';
        }
        this.selectedSlot = def.slot || '';
        this.isCrafted = !!def.is_crafted;
        this.selectedRarity = def.rarity || 'common';

        // Apply slot-specific defaults
        if (this._isConsumableSlot()) {
            this.isCrafted = true;
            this.duration = def.duration || 1000;
        } else if (this._isInputSlot()) {
            this.isCrafted = true;
        } else if (this._isCollectibleSlot()) {
            this.isCrafted = false;
            this.selectedRarity = 'common';
        } else if (this._isPetSlot()) {
            this.isCrafted = true;
            this.activeQualityTab = 'Egg';
            this.selectedRarity = 'common';
        }

        this.keywords = Array.isArray(def.keywords) ? [...def.keywords] : [];
        const stats = typeof def.stats === 'string' ? JSON.parse(def.stats) : (def.stats || {});
        this.statRows = this._nestedToRows(stats);
        this.requirementRows = Array.isArray(def.requirements) ? def.requirements.map(r => ({ ...r })) : [];
        if (this.isCrafted && def.quality_stats) {
            const qs = typeof def.quality_stats === 'string' ? JSON.parse(def.quality_stats) : def.quality_stats;
            for (const q of [...QUALITY_NAMES, ...CONSUMABLE_QUALITY_NAMES, ...PET_LEVEL_NAMES_MAX]) {
                if (qs[q]) this.qualityStatRows[q] = this._nestedToRows(qs[q]);
            }
            // Detect if pet has Level 4
            if (this._isPetSlot() && qs['Level 4']) {
                this.petHasLevel4 = true;
            }
        }
        // Restore values
        this.itemValue = def.value || 0;
        if (def.quality_values) {
            const qv = typeof def.quality_values === 'string' ? JSON.parse(def.quality_values) : def.quality_values;
            for (const [q, v] of Object.entries(qv)) this.qualityValues[q] = v || 0;
        }
        // Restore pet XP requirements (stored in quality_values)
        if (this._isPetSlot()) {
            const qv = def.quality_values || {};
            if (qv._pet_xp_requirements) {
                this.petXpRequirements = typeof qv._pet_xp_requirements === 'string' ? JSON.parse(qv._pet_xp_requirements) : { ...qv._pet_xp_requirements };
            }
            if (qv._pet_xp_req_rows) {
                this.petXpReqRows = (typeof qv._pet_xp_req_rows === 'string' ? JSON.parse(qv._pet_xp_req_rows) : qv._pet_xp_req_rows).map(r => ({ ...r }));
            }
        }
        // Restore gated stats
        if (def.gated_stats) {
            this.gatedStats = typeof def.gated_stats === 'string' ? JSON.parse(def.gated_stats) : { ...def.gated_stats };
        }
    }

    _nestedToRows(nested) {
        const rows = [];
        for (const [skill, locs] of Object.entries(nested))
            for (const [loc, stats] of Object.entries(locs))
                for (const [stat, val] of Object.entries(stats))
                    rows.push({ skill, location: loc, type: stat, value: val });
        return rows;
    }

    _rowsToNested(rows) {
        const n = {};
        for (const r of rows) {
            if (!r.type) continue; // Skip rows with no stat type
            const sk = r.skill || 'global', loc = r.location || 'global';
            if (!n[sk]) n[sk] = {};
            if (!n[sk][loc]) n[sk][loc] = {};
            n[sk][loc][r.type] = parseFloat(r.value) || 0;
        }
        return n;
    }

    // ------------------------------------------------------------------
    // DATA
    // ------------------------------------------------------------------

    async _loadSavedDefinitions() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            const defs = await api.getGenericDefinitions(uuid);
            this.savedDefs = defs.items || [];
            if (this.showCommunity) {
                const c = await api.getCommunityDefinitions();
                this.communityDefs = c.items || [];
            }
            this._updateSavedDropdown();
        } catch (e) { console.error('GenericItemForm: load failed', e); }
    }

    async _loadCustomKeywords() {
        try {
            const data = await api.getCustomKeywords();
            // Deduplicate by lowercase name (keep first occurrence), sentence-case names
            const seen = new Set();
            this.customKeywordsFromDB = (data.keywords || []).filter(kw => {
                const key = kw.name.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).map(kw => ({ ...kw, name: kw.name.charAt(0).toUpperCase() + kw.name.slice(1).toLowerCase() }));
            // Populate customKwEmojis from DB keywords
            for (const kw of this.customKeywordsFromDB) {
                if (kw.icon) this.customKwEmojis[kw.name] = kw.icon;
                if (kw.icon_color) this.customKwColors[kw.name] = kw.icon_color;
            }
        } catch (e) { this.customKeywordsFromDB = []; }
    }

    async save() {
        const name = (this.$overlay?.find('#gi-name').val() || '').trim();
        if (!name) { api.showError('Item name is required.'); return; }
        if (!this.selectedSlot) { api.showError('Slot is required.'); return; }
        this._syncRows();
        this._syncRequirements();
        this._syncGatedStats();
        // Sync current quality's value for crafted items
        if (this.isCrafted) {
            this.qualityValues[this.activeQualityTab] = parseInt(this.$overlay?.find('#gi-quality-value').val()) || 0;
        }
        // Sync pet XP
        if (this._isPetSlot()) {
            this.petXpRequirements[this.activeQualityTab] = parseInt(this.$overlay?.find('#gi-pet-xp').val()) || 0;
        }
        const isPet = this._isPetSlot();
        const stats = this.isCrafted ? {} : this._rowsToNested(this.statRows);
        let qs = null;
        if (this.isCrafted) { qs = {}; for (const q of this._getQualityNames()) qs[q] = this._rowsToNested(this.qualityStatRows[q] || []); }
        const payload = {
            type: 'item', name, icon: this.selectedIcon, icon_color: this.selectedIconColor,
            slot: this.selectedSlot, keywords: isPet ? [] : this.keywords, stats, quality_stats: qs,
            rarity: (this.isCrafted || isPet) ? 'common' : this.selectedRarity, is_crafted: this.isCrafted,
            is_public: this.$overlay?.find('#gi-share').is(':checked') ?? true,
            requirements: isPet ? [] : this.requirementRows.filter(r => r.type),
            export_item_name: (this.$overlay?.find('#gi-export-name').val() || '').trim() || undefined,
            icon_path: (this.$overlay?.find('#gi-icon-path').val() || '').trim() || undefined,
            duration: this._isConsumableSlot() ? this.duration : undefined,
            value: this.isCrafted && !isPet ? 0 : (parseInt(this.$overlay?.find('#gi-item-value').val()) || 0),
            quality_values: this.isCrafted ? this.qualityValues : undefined,
            gated_stats: this.gatedStats || {},
        };
        // Compute data_status for crafted items (track which qualities have stats)
        if (this.isCrafted && qs && !isPet) {
            const dsMap = {};
            for (const q of this._getQualityNames()) {
                const rows = this.qualityStatRows[q] || [];
                const hasStats = rows.some(r => r.stat && r.value !== '' && r.value !== undefined);
                dsMap[q] = hasStats ? 'complete' : 'missing_qualities';
            }
            payload.data_status = JSON.stringify(dsMap);
        }
        // Add pet-specific fields — pack into quality_values for storage
        if (isPet) {
            if (!payload.quality_values) payload.quality_values = {};
            payload.quality_values._pet_xp_requirements = this.petXpRequirements;
            payload.quality_values._pet_xp_req_rows = this.petXpReqRows.filter(r => r.type);
        }
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            if (this.currentDefId) { await api.updateGenericDefinition(uuid, this.currentDefId, payload); api.showSuccess(this._isCommunityEdit ? 'Community item updated. Thanks for contributing!' : 'Generic item updated.'); }
            else { const s = await api.saveGenericDefinition(uuid, payload); this.currentDefId = s.id; api.showSuccess('Generic item saved.'); }
            await this._reloadItems(uuid);
            // Refresh community defs if we just edited one
            if (this._isCommunityEdit) {
                try { const c = await api.getCommunityDefinitions(); this.communityDefs = c.items || []; } catch (e) { /* ignore */ }
            }
            // Auto-equip to the slot that triggered the form (from popup "Create Generic Item")
            if (this._autoEquipSlot && this.currentDefId) {
                const gi = (store.state.genericItems || []).find(g => g.id === this.currentDefId);
                if (gi) {
                    const stateId = `generic::item::${gi.id}`;
                    store.updateGearSlot(this._autoEquipSlot, {
                        itemId: stateId, uuid: stateId, name: gi.name,
                        icon: gi.icon, icon_color: gi.icon_color,
                        rarity: gi.rarity || 'common', slot: gi.slot,
                        keywords: gi.keywords || [], is_generic: true,
                    });
                }
                this._autoEquipSlot = null;
            }
            this.hide();
        } catch (e) { /* api shows toast */ }
    }

    async delete() {
        if (!this.currentDefId) return;
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try { await api.deleteGenericDefinition(uuid, this.currentDefId, 'item'); api.showSuccess('Generic item deleted.'); await this._reloadItems(uuid); this.hide(); } catch (e) { }
    }

    async _reloadItems(uuid) {
        try { const d = await api.getGenericDefinitions(uuid); store.state.genericItems = d.items || []; store._notifySubscribers('genericItems'); } catch (e) { }
    }

    /** Get the quality names for the current slot type */
    _getQualityNames() {
        if (this._isPetSlot()) return this.petHasLevel4 ? PET_LEVEL_NAMES_MAX : PET_LEVEL_NAMES;
        return (this.selectedSlot === 'consumable' || this.selectedSlot === 'input') ? CONSUMABLE_QUALITY_NAMES : QUALITY_NAMES;
    }

    /** Whether the current slot hides keywords/crafted/rarity/requirements */
    _isCollectibleSlot() { return this.selectedSlot === 'collectible'; }
    _isConsumableSlot() { return this.selectedSlot === 'consumable'; }
    _isInputSlot() { return this.selectedSlot === 'input'; }
    _isPetSlot() { return this.selectedSlot === 'pet'; }
    _isConsumableLikeSlot() { return this._isConsumableSlot() || this._isInputSlot(); }

    _syncRows() {
        if (!this.$overlay) return;
        const rows = [];
        this.$overlay.find('.gi-stat-rows .gi-stat-row').each(function () {
            // Skip stat rows inside gated stat cards
            if ($(this).closest('.gi-gated-row').length) return;
            rows.push({ skill: $(this).find('.gi-stat-skill').val(), location: $(this).find('.gi-stat-location').val(), type: $(this).find('.gi-stat-type').val(), value: parseFloat($(this).find('.gi-stat-value').val()) || 0 });
        });
        if (this.isCrafted) this.qualityStatRows[this.activeQualityTab] = rows;
        else this.statRows = rows;
    }

    _syncRequirements() {
        if (!this.$overlay) return;
        const reqs = [];
        this.$overlay.find('.gi-req-row').each(function () {
            const type = $(this).find('.gi-req-type').val();
            if (!type) return;
            const row = { type };
            if (type === 'skill') {
                row.skill = $(this).find('.gi-req-skill').val();
                row.level = parseInt($(this).find('.gi-req-level').val()) || 1;
            } else if (type === 'reputation') {
                row.faction = $(this).find('.gi-req-faction').val();
                row.amount = parseInt($(this).find('.gi-req-amount').val()) || 1;
            } else if (type === 'character_level') {
                row.level = parseInt($(this).find('.gi-req-level').val()) || 1;
            } else if (type === 'achievement_points') {
                row.amount = parseInt($(this).find('.gi-req-amount').val()) || 0;
            } else if (type === 'activity_completion') {
                row.activity = $(this).find('.gi-req-activity').val();
                row.completions = parseInt($(this).find('.gi-req-completions').val()) || 1;
            } else if (type === 'category_level_percent') {
                row.category = $(this).find('.gi-req-category').val();
                row.percent = parseInt($(this).find('.gi-req-percent').val()) || 10;
            }
            reqs.push(row);
        });
        this.requirementRows = reqs;
    }

    // ------------------------------------------------------------------
    // RENDER HELPERS
    // ------------------------------------------------------------------

    _renderIconContent() {
        // If selectedIcon looks like a file path, render as <img>; otherwise render as emoji
        const icon = this.iconPath || this.selectedIcon || '⚡';
        if (icon.includes('/') || icon.endsWith('.svg') || icon.endsWith('.png')) {
            return `<img src="${icon}" style="width:24px;height:24px" onerror="this.outerHTML='⚡'" />`;
        }
        return this.selectedIcon || '⚡';
    }

    _slotDisplay() {
        if (!this.selectedSlot) return 'Select slot...';
        const s = VALID_SLOTS.find(v => v.value === this.selectedSlot);
        return s ? `${slotIcon(s.value)} ${s.label}` : this.selectedSlot;
    }

    _slotDropdownHtml() {
        return VALID_SLOTS.map(s =>
            `<div class="gi-dd-item gi-slot-item" data-value="${s.value}">${slotIcon(s.value)} <span>${s.label}</span></div>`
        ).join('');
    }

    _rarityDisplay() {
        const r = RARITIES.find(v => v.value === this.selectedRarity);
        return r ? r.label : 'Common';
    }

    _rarityDropdownHtml() {
        return RARITIES.map(r =>
            `<div class="gi-dd-item gi-rarity-item" data-value="${r.value}" style="background:${r.css};color:#fff">${r.label}</div>`
        ).join('');
    }

    _skillDropdownHtml(selected) {
        let html = `<div class="gi-dd-item gi-skill-item" data-value="global">🌐 <span>Global</span></div>`;
        for (const cat of SKILL_CATEGORIES) {
            const catVal = cat.group.toLowerCase();
            const catIcon = `<img src="/assets/icons/text/skill_types/${catVal}.svg" class="ga-skill-icon" />`;
            const catSel = catVal === selected ? ' gi-dd-selected' : '';
            html += `<div class="gi-dd-group-header">${catIcon} ${cat.group}</div>`;
            html += `<div class="gi-dd-item gi-skill-item gi-skill-cat${catSel}" data-value="${catVal}">${catIcon} <span>All ${cat.group}</span></div>`;
            for (const s of cat.skills) {
                const val = s.toLowerCase();
                const sel = val === selected ? ' gi-dd-selected' : '';
                html += `<div class="gi-dd-item gi-skill-item${sel}" data-value="${val}">${skillIcon(s)} <span>${s}</span></div>`;
            }
        }
        return html;
    }

    _locationDropdownHtml(selected) {
        let html = '';
        for (const group of LOCATION_GROUPS) {
            // Global group is always expanded, others collapsed by default
            const isGlobal = group.group === 'Global';
            const expanded = isGlobal;
            html += `<div class="gi-dd-group-header gi-loc-group-header" data-group="${group.group}"><span class="expand-arrow ${expanded ? 'expanded' : ''}">▼</span> ${group.group}</div>`;
            html += `<div class="gi-loc-group-items" data-group="${group.group}" ${expanded ? '' : 'style="display:none"'}>`;
            for (const loc of group.items) {
                const sel = loc.value === selected ? ' gi-dd-selected' : '';
                const iconHtml = loc.svg ? `<img src="${loc.svg}" class="gi-loc-icon" />` : (loc.icon || '');
                html += `<div class="gi-dd-item gi-loc-item${sel}" data-value="${loc.value}">${iconHtml} ${loc.label}</div>`;
            }
            html += '</div>';
        }
        return html;
    }

    _skillDisplay(val) {
        if (!val || val === 'global') return '🌐 Global';
        // Check if it's a category
        const cat = SKILL_CATEGORIES.find(c => c.group.toLowerCase() === val);
        if (cat) {
            return `<img src="/assets/icons/text/skill_types/${val}.svg" class="ga-skill-icon" /> All ${cat.group}`;
        }
        const name = val.charAt(0).toUpperCase() + val.slice(1);
        return `${skillIcon(name)} ${name}`;
    }

    _statTypeDisplay(val) {
        const st = STAT_TYPES.find(s => s.value === val);
        if (!st) return val || 'Select...';
        return `<img src="${st.svg}" class="gi-stat-type-icon" /> ${st.label}`;
    }

    _statTypeDropdownHtml(selected) {
        const baseStats = STAT_TYPES.filter(s => s.group === 'base').sort((a, b) => a.label.localeCompare(b.label));
        const itemFinding = STAT_TYPES.filter(s => s.group === 'item_finding').sort((a, b) => a.label.localeCompare(b.label));
        let html = '<input type="text" class="gi-stat-type-search" placeholder="Search stats..." />';
        html += '<div class="gi-stat-type-list">';
        for (const st of baseStats) {
            const sel = st.value === selected ? ' gi-dd-selected' : '';
            html += `<div class="gi-dd-item${sel}" data-value="${st.value}"><img src="${st.svg}" class="gi-stat-type-icon" /> ${st.label}</div>`;
        }
        html += `<div class="gi-dd-group-header gi-stat-type-group-header" data-group="item_finding"><span class="expand-arrow">▼</span> Item Finding</div>`;
        html += `<div class="gi-stat-type-group-items" data-group="item_finding" style="display:none">`;
        for (const st of itemFinding) {
            const sel = st.value === selected ? ' gi-dd-selected' : '';
            html += `<div class="gi-dd-item${sel}" data-value="${st.value}"><img src="${st.svg}" class="gi-stat-type-icon" /> ${st.label}</div>`;
        }
        html += '</div></div>';
        return html;
    }

    _locationDisplay(val) {
        if (!val || val === 'global') return '🌐 Global';
        for (const g of LOCATION_GROUPS) {
            const loc = g.items.find(l => l.value === val);
            if (loc) {
                const iconHtml = loc.svg ? `<img src="${loc.svg}" class="gi-loc-icon" />` : (loc.icon || '');
                return `${iconHtml} ${loc.label}`;
            }
        }
        return val;
    }

    _syncGatedStats() {
        if (!this.$overlay) return;
        const gs = {};
        this.$overlay.find('.gi-gated-row').each(function () {
            const $row = $(this);
            const gateType = $row.data('gate-type');
            const stat = $row.find('.gi-gated-stat-val').val() || 'work_efficiency';
            const val = parseFloat($row.find('.gi-gated-value').val()) || 0;
            const skill = $row.find('.gi-gated-skill-val').val() || 'global';
            const loc = $row.find('.gi-gated-loc-val').val() || 'global';
            if (!stat || !gateType) return;

            if (gateType === 'achievement_points' || gateType === 'total_skill_level') {
                const threshold = parseInt($row.find('.gi-gated-threshold').val()) || 0;
                if (!gs[gateType]) gs[gateType] = {};
                if (!gs[gateType][threshold]) gs[gateType][threshold] = {};
                if (!gs[gateType][threshold][skill]) gs[gateType][threshold][skill] = {};
                if (!gs[gateType][threshold][skill][loc]) gs[gateType][threshold][skill][loc] = {};
                gs[gateType][threshold][skill][loc][stat] = val;
            } else if (gateType === 'set_pieces') {
                const keyword = $row.find('.gi-gated-keyword-val').val() || $row.find('.gi-gated-keyword').val() || '';
                const count = parseInt($row.find('.gi-gated-count').val()) || 1;
                if (!keyword) return;
                if (!gs.set_pieces) gs.set_pieces = {};
                if (!gs.set_pieces[keyword]) gs.set_pieces[keyword] = {};
                if (!gs.set_pieces[keyword][count]) gs.set_pieces[keyword][count] = {};
                if (!gs.set_pieces[keyword][count][skill]) gs.set_pieces[keyword][count][skill] = {};
                if (!gs.set_pieces[keyword][count][skill][loc]) gs.set_pieces[keyword][count][skill][loc] = {};
                gs.set_pieces[keyword][count][skill][loc][stat] = val;
            } else if (gateType === 'skill_level') {
                const gateSkill = $row.find('.gi-gated-gate-skill-val').val() || '';
                const level = parseInt($row.find('.gi-gated-threshold').val()) || 1;
                if (!gateSkill) return;
                if (!gs.skill_level) gs.skill_level = {};
                if (!gs.skill_level[gateSkill]) gs.skill_level[gateSkill] = {};
                if (!gs.skill_level[gateSkill][level]) gs.skill_level[gateSkill][level] = {};
                if (!gs.skill_level[gateSkill][level][skill]) gs.skill_level[gateSkill][level][skill] = {};
                if (!gs.skill_level[gateSkill][level][skill][loc]) gs.skill_level[gateSkill][level][skill][loc] = {};
                gs.skill_level[gateSkill][level][skill][loc][stat] = val;
            } else if (gateType === 'item_ownership') {
                const itemName = $row.find('.gi-gated-item-name').val() || '';
                if (!itemName) return;
                if (!gs.item_ownership) gs.item_ownership = {};
                if (!gs.item_ownership[itemName]) gs.item_ownership[itemName] = {};
                if (!gs.item_ownership[itemName][skill]) gs.item_ownership[itemName][skill] = {};
                if (!gs.item_ownership[itemName][skill][loc]) gs.item_ownership[itemName][skill][loc] = {};
                gs.item_ownership[itemName][skill][loc][stat] = val;
            } else if (gateType === 'activity_completion') {
                const actName = $row.find('.gi-gated-activity-name').val() || '';
                const count = parseInt($row.find('.gi-gated-threshold').val()) || 1;
                if (!actName) return;
                if (!gs.activity_completion) gs.activity_completion = {};
                if (!gs.activity_completion[actName]) gs.activity_completion[actName] = {};
                if (!gs.activity_completion[actName][count]) gs.activity_completion[actName][count] = {};
                if (!gs.activity_completion[actName][count][skill]) gs.activity_completion[actName][count][skill] = {};
                if (!gs.activity_completion[actName][count][skill][loc]) gs.activity_completion[actName][count][skill][loc] = {};
                gs.activity_completion[actName][count][skill][loc][stat] = val;
            } else if (gateType === 'activity') {
                const actName = $row.find('.gi-gated-activity-name').val() || '';
                if (!actName) return;
                if (!gs.activity) gs.activity = {};
                if (!gs.activity[actName]) gs.activity[actName] = {};
                if (!gs.activity[actName][skill]) gs.activity[actName][skill] = {};
                if (!gs.activity[actName][skill][loc]) gs.activity[actName][skill][loc] = {};
                gs.activity[actName][skill][loc][stat] = val;
            }
        });
        this.gatedStats = gs;
    }

    _gatedStatsHtml() {
        const rows = this._gatedStatsToRows();
        return rows.map((r, i) => this._gatedRowHtml(r, i)).join('');
    }

    /** Convert nested gated_stats dict to flat row array for rendering */
    _gatedStatsToRows() {
        const gs = this.gatedStats || {};
        const rows = [];
        const GATE_TYPES = {
            ap: (threshold, skill, loc, stat, val) => ({ gateType: 'achievement_points', threshold, skill, location: loc, stat, value: val }),
            set_pieces: null, // handled specially
            total_skill_level: (threshold, skill, loc, stat, val) => ({ gateType: 'total_skill_level', threshold, skill, location: loc, stat, value: val }),
            skill_level: null, // handled specially
            item_ownership: null, // handled specially
            activity_completion: null, // handled specially
            activity: null, // handled specially
        };
        // AP and total_skill_level: {threshold: {skill: {loc: {stat: val}}}}
        for (const gateType of ['achievement_points', 'total_skill_level']) {
            // Also check 'ap' for backward compatibility
            const keys = gateType === 'achievement_points' ? ['achievement_points', 'ap'] : [gateType];
            for (const key of keys) {
                const data = gs[key] || {};
                for (const [threshold, skills] of Object.entries(data)) {
                    for (const [skill, locs] of Object.entries(skills)) {
                        for (const [loc, statMap] of Object.entries(locs)) {
                            for (const [stat, val] of Object.entries(statMap)) {
                                rows.push({ gateType, threshold: Number(threshold), skill, location: loc, stat, value: val });
                            }
                        }
                    }
                }
            }
        }
        // set_pieces: {keyword: {count: {skill: {loc: {stat: val}}}}}
        for (const [keyword, counts] of Object.entries(gs.set_pieces || {})) {
            for (const [count, skills] of Object.entries(counts)) {
                for (const [skill, locs] of Object.entries(skills)) {
                    for (const [loc, statMap] of Object.entries(locs)) {
                        for (const [stat, val] of Object.entries(statMap)) {
                            rows.push({ gateType: 'set_pieces', keyword, count: Number(count), skill, location: loc, stat, value: val });
                        }
                    }
                }
            }
        }
        // skill_level: {skillName: {level: {skill: {loc: {stat: val}}}}}
        for (const [gateSkill, levels] of Object.entries(gs.skill_level || {})) {
            for (const [level, skills] of Object.entries(levels)) {
                for (const [skill, locs] of Object.entries(skills)) {
                    for (const [loc, statMap] of Object.entries(locs)) {
                        for (const [stat, val] of Object.entries(statMap)) {
                            rows.push({ gateType: 'skill_level', gateSkill, threshold: Number(level), skill, location: loc, stat, value: val });
                        }
                    }
                }
            }
        }
        // item_ownership: {itemName: {skill: {loc: {stat: val}}}}
        for (const [itemName, skills] of Object.entries(gs.item_ownership || {})) {
            for (const [skill, locs] of Object.entries(skills)) {
                for (const [loc, statMap] of Object.entries(locs)) {
                    for (const [stat, val] of Object.entries(statMap)) {
                        rows.push({ gateType: 'item_ownership', itemName, skill, location: loc, stat, value: val });
                    }
                }
            }
        }
        // activity_completion: {activityName: {count: {skill: {loc: {stat: val}}}}}
        for (const [actName, counts] of Object.entries(gs.activity_completion || {})) {
            for (const [count, skills] of Object.entries(counts)) {
                for (const [skill, locs] of Object.entries(skills)) {
                    for (const [loc, statMap] of Object.entries(locs)) {
                        for (const [stat, val] of Object.entries(statMap)) {
                            rows.push({ gateType: 'activity_completion', activityName: actName, threshold: Number(count), skill, location: loc, stat, value: val });
                        }
                    }
                }
            }
        }
        // activity: {activityName: {skill: {loc: {stat: val}}}}
        for (const [actName, skills] of Object.entries(gs.activity || {})) {
            for (const [skill, locs] of Object.entries(skills)) {
                for (const [loc, statMap] of Object.entries(locs)) {
                    for (const [stat, val] of Object.entries(statMap)) {
                        rows.push({ gateType: 'activity', activityName: actName, skill, location: loc, stat, value: val });
                    }
                }
            }
        }
        return rows;
    }

    _gatedRowHtml(r, i) {
        const GATE_TYPE_OPTIONS = [
            { value: 'achievement_points', label: '⭐ Achievement Points ≥' },
            { value: 'set_pieces', label: '🔑 Keyword (set pieces) ×' },
            { value: 'skill_level', label: '⚔️ Skill Level ≥' },
            { value: 'total_skill_level', label: '📊 Total Skill Level ≥' },
            { value: 'item_ownership', label: '🎒 Owns Item' },
            { value: 'activity_completion', label: '✅ Activity Completions ≥' },
            { value: 'activity', label: '🎯 While Doing Activity' },
        ];
        const gateLabel = GATE_TYPE_OPTIONS.find(o => o.value === r.gateType)?.label || '⭐ Achievement Points ≥';
        const gateTypeItems = GATE_TYPE_OPTIONS.map(o =>
            `<div class="gi-dd-item gi-gated-type-item" data-value="${o.value}">${o.label}</div>`
        ).join('');

        let gateFields = '';
        if (r.gateType === 'achievement_points') {
            gateFields = `<input type="number" class="gi-gated-threshold" value="${r.threshold || 0}" min="0" style="width:60px" placeholder="AP">`;
        } else if (r.gateType === 'total_skill_level') {
            gateFields = `<input type="number" class="gi-gated-threshold" value="${r.threshold || 0}" min="0" style="width:60px" placeholder="Level">`;
        } else if (r.gateType === 'set_pieces') {
            const kwDisplay = r.keyword ? `${kwIcon(r.keyword)} ${r.keyword}` : 'Select keyword...';
            const kwItems = KNOWN_KEYWORDS.map(kw =>
                `<div class="gi-dd-item gi-gated-kw-item" data-value="${kw.value}">${kwIcon(kw.value)} ${kw.value}</div>`
            ).join('');
            // Include custom keywords from loaded list
            const customKwHtml = (this.customKwEmojis && Object.keys(this.customKwEmojis).length > 0)
                ? '<div class="gi-dd-group-header">Custom Keywords</div>' + Object.entries(this.customKwEmojis).map(([name, emoji]) => {
                    const tint = this.customKwColors?.[name] || '';
                    const iconHtml = tint ? `<span style="${window.emojiTintStyle(tint)}">${window.emojiForPlatform(emoji)}</span>` : emoji;
                    return `<div class="gi-dd-item gi-gated-kw-item" data-value="${name}">${iconHtml} ${name}</div>`;
                }).join('') : '';
            gateFields = `<div class="gi-dd-button gi-gated-kw-btn" data-row="${i}" style="flex:1;min-width:0"><div class="gi-dd-value">${kwDisplay}</div><span class="expand-arrow">▼</span></div>
                <div class="gi-dd-dropdown gi-gated-kw-dd" style="display:none">
                    <input type="text" class="gi-gated-kw-search" placeholder="Search or type new keyword..." style="width:100%;box-sizing:border-box;margin-bottom:4px;padding:4px;font-size:12px" />
                    ${kwItems}${customKwHtml}
                    <div class="gi-kw-new-form gi-kw-custom-entry gi-gated-kw-custom-entry" style="border-top:1px solid var(--border-color);margin-top:4px;padding-top:4px">
                        <div class="gi-kw-new-row">
                            <span>🏷️</span>
                            <input type="text" class="gi-gated-kw-custom-name" placeholder="New keyword name..." style="flex:1;min-width:0" />
                            <button class="gi-gated-kw-custom-add optimize-btn" data-row="${i}" style="width:auto;padding:2px 10px;font-size:11px">Add</button>
                        </div>
                    </div>
                </div>
                <input type="hidden" class="gi-gated-keyword-val" value="${r.keyword || ''}" />
                <span style="font-size:0.75rem;color:var(--text-muted)">×</span>
                <input type="number" class="gi-gated-count" value="${r.count || 1}" min="1" max="10" style="width:44px">`;
        } else if (r.gateType === 'skill_level') {
            gateFields = `<div class="gi-dd-button gi-gated-gate-skill-btn" data-row="${i}" style="flex:1;min-width:0"><div class="gi-dd-value">${this._skillDisplay(r.gateSkill || 'global')}</div><span class="expand-arrow">▼</span></div>
                <div class="gi-dd-dropdown gi-gated-gate-skill-dd" style="display:none">${this._skillDropdownHtml(r.gateSkill || 'global')}</div>
                <input type="hidden" class="gi-gated-gate-skill-val" value="${r.gateSkill || 'global'}" />
                <span style="font-size:0.75rem;color:var(--text-muted)">≥</span>
                <input type="number" class="gi-gated-threshold" value="${r.threshold || 1}" min="1" style="width:50px">`;
        } else if (r.gateType === 'item_ownership') {
            gateFields = `<input type="text" class="gi-gated-item-name" value="${r.itemName || ''}" placeholder="item name" style="flex:1">`;
        } else if (r.gateType === 'activity_completion') {
            gateFields = `<input type="text" class="gi-gated-activity-name" value="${r.activityName || ''}" placeholder="activity" style="flex:1">
                <span style="font-size:0.75rem;color:var(--text-muted)">×</span>
                <input type="number" class="gi-gated-threshold" value="${r.threshold || 1}" min="1" style="width:50px">`;
        } else if (r.gateType === 'activity') {
            gateFields = `<input type="text" class="gi-gated-activity-name" value="${r.activityName || ''}" placeholder="activity" style="flex:1">`;
        }

        return `<div class="gi-gated-row" data-index="${i}" data-gate-type="${r.gateType}" style="margin-bottom:8px;padding:6px;background:var(--bg-secondary);border-radius:6px">
            <div class="gi-stat-row" style="margin-bottom:4px">
                <div class="gi-stat-cell gi-stat-skill-cell" style="flex:1.3">
                    <div class="gi-dd-button gi-gated-skill-btn" data-row="${i}">
                        <div class="gi-dd-value">${this._skillDisplay(r.skill || 'global')}</div>
                        <span class="expand-arrow">▼</span>
                    </div>
                    <div class="gi-dd-dropdown gi-gated-skill-dd" style="display:none">${this._skillDropdownHtml(r.skill || 'global')}</div>
                    <input type="hidden" class="gi-gated-skill-val" value="${r.skill || 'global'}" />
                </div>
                <div class="gi-stat-cell gi-stat-loc-cell" style="flex:1.3">
                    <div class="gi-dd-button gi-gated-loc-btn" data-row="${i}">
                        <div class="gi-dd-value">${this._locationDisplay(r.location || 'global')}</div>
                        <span class="expand-arrow">▼</span>
                    </div>
                    <div class="gi-dd-dropdown gi-gated-loc-dd" style="display:none">${this._locationDropdownHtml(r.location || 'global')}</div>
                    <input type="hidden" class="gi-gated-loc-val" value="${r.location || 'global'}" />
                </div>
                <div class="gi-stat-cell gi-stat-type-cell" style="flex:1.5">
                    <div class="gi-dd-button gi-gated-stat-btn" data-row="${i}" style="padding:4px 6px;font-size:12px">
                        <div class="gi-dd-value">${this._statTypeDisplay(r.stat || 'work_efficiency')}</div>
                        <span class="expand-arrow">▼</span>
                    </div>
                    <div class="gi-dd-dropdown gi-gated-stat-dd" style="display:none">${this._statTypeDropdownHtml(r.stat || 'work_efficiency')}</div>
                    <input type="hidden" class="gi-gated-stat-val" value="${r.stat || 'work_efficiency'}" />
                </div>
                <input type="number" class="gi-gated-value" value="${r.value || 0}" step="0.1" style="flex:0 0 50px;min-width:0" />
                <button class="gi-stat-remove gi-gated-remove" title="Remove">✕</button>
            </div>
            <div class="gi-gated-gate-line" style="display:flex;gap:4px;align-items:center">
                <span style="font-size:0.7rem;color:var(--text-muted);min-width:36px">Gate:</span>
                <div class="gi-dd-button gi-gated-type-btn" data-row="${i}" style="flex:0 0 auto;min-width:180px"><div class="gi-dd-value">${gateLabel}</div><span class="expand-arrow">▼</span></div>
                <div class="gi-dd-dropdown gi-gated-type-dd" style="display:none">${gateTypeItems}</div>
                ${gateFields}
            </div>
        </div>`;
    }

    _locationOptionsHtml(selected) {
        let html = '<option value="global"' + (selected === 'global' ? ' selected' : '') + '>Global</option>';
        const locations = ['jarvonia', 'trellin', 'erdwise', 'halfling_rebels', 'syrenthia', 'underwater', 'gdte', 'wallisia', 'wrentmark', 'spectral'];
        for (const loc of locations) {
            const label = loc.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            html += `<option value="${loc}"${loc === selected ? ' selected' : ''}>${label}</option>`;
        }
        return html;
    }

    /** Rebuild gatedStats dict from flat row array */
    _rebuildGatedStatsFromRows(rows) {
        const gs = {};
        for (const r of rows) {
            const skill = r.skill || 'global';
            const loc = r.location || 'global';
            const stat = r.stat || 'work_efficiency';
            const val = r.value || 0;
            if (r.gateType === 'achievement_points' || r.gateType === 'total_skill_level') {
                const t = r.threshold || 0;
                if (!gs[r.gateType]) gs[r.gateType] = {};
                if (!gs[r.gateType][t]) gs[r.gateType][t] = {};
                if (!gs[r.gateType][t][skill]) gs[r.gateType][t][skill] = {};
                if (!gs[r.gateType][t][skill][loc]) gs[r.gateType][t][skill][loc] = {};
                gs[r.gateType][t][skill][loc][stat] = val;
            } else if (r.gateType === 'set_pieces') {
                const kw = r.keyword || '';
                const cnt = r.count || 1;
                if (!gs.set_pieces) gs.set_pieces = {};
                if (!gs.set_pieces[kw]) gs.set_pieces[kw] = {};
                if (!gs.set_pieces[kw][cnt]) gs.set_pieces[kw][cnt] = {};
                if (!gs.set_pieces[kw][cnt][skill]) gs.set_pieces[kw][cnt][skill] = {};
                if (!gs.set_pieces[kw][cnt][skill][loc]) gs.set_pieces[kw][cnt][skill][loc] = {};
                gs.set_pieces[kw][cnt][skill][loc][stat] = val;
            } else if (r.gateType === 'skill_level') {
                const gs2 = r.gateSkill || '';
                const lv = r.threshold || 1;
                if (!gs.skill_level) gs.skill_level = {};
                if (!gs.skill_level[gs2]) gs.skill_level[gs2] = {};
                if (!gs.skill_level[gs2][lv]) gs.skill_level[gs2][lv] = {};
                if (!gs.skill_level[gs2][lv][skill]) gs.skill_level[gs2][lv][skill] = {};
                if (!gs.skill_level[gs2][lv][skill][loc]) gs.skill_level[gs2][lv][skill][loc] = {};
                gs.skill_level[gs2][lv][skill][loc][stat] = val;
            } else if (r.gateType === 'item_ownership') {
                const name = r.itemName || '';
                if (!gs.item_ownership) gs.item_ownership = {};
                if (!gs.item_ownership[name]) gs.item_ownership[name] = {};
                if (!gs.item_ownership[name][skill]) gs.item_ownership[name][skill] = {};
                if (!gs.item_ownership[name][skill][loc]) gs.item_ownership[name][skill][loc] = {};
                gs.item_ownership[name][skill][loc][stat] = val;
            } else if (r.gateType === 'activity_completion') {
                const name = r.activityName || '';
                const cnt = r.threshold || 1;
                if (!gs.activity_completion) gs.activity_completion = {};
                if (!gs.activity_completion[name]) gs.activity_completion[name] = {};
                if (!gs.activity_completion[name][cnt]) gs.activity_completion[name][cnt] = {};
                if (!gs.activity_completion[name][cnt][skill]) gs.activity_completion[name][cnt][skill] = {};
                if (!gs.activity_completion[name][cnt][skill][loc]) gs.activity_completion[name][cnt][skill][loc] = {};
                gs.activity_completion[name][cnt][skill][loc][stat] = val;
            } else if (r.gateType === 'activity') {
                const name = r.activityName || '';
                if (!gs.activity) gs.activity = {};
                if (!gs.activity[name]) gs.activity[name] = {};
                if (!gs.activity[name][skill]) gs.activity[name][skill] = {};
                if (!gs.activity[name][skill][loc]) gs.activity[name][skill][loc] = {};
                gs.activity[name][skill][loc][stat] = val;
            }
        }
        this.gatedStats = gs;
    }

    _skillOptionsHtml(selected) {
        let html = '<option value="global"' + (selected === 'global' ? ' selected' : '') + '>Global</option>';
        for (const cat of SKILL_CATEGORIES) {
            for (const s of cat.skills) {
                html += `<option value="${s.toLowerCase()}"${s.toLowerCase() === selected ? ' selected' : ''}>${s}</option>`;
            }
        }
        return html;
    }

    _statTypeOptionsHtml(selected) {
        const types = ['work_efficiency', 'double_action', 'double_rewards', 'steps_required', 'no_materials_consumed',
            'quality_outcome', 'bonus_xp_percent', 'chest_finding', 'fine_material_finding', 'find_collectibles',
            'find_gems', 'double_action', 'steps_add'];
        return types.map(t => `<option value="${t}"${t === selected ? ' selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join('');
    }

    _reqRowsHtml() {
        const FACTIONS = ['jarvonia', 'trellin', 'erdwise', 'syrenthia', 'halfling_rebels', 'wallisia', 'wrentmark'];
        const REQ_SKILLS = SKILL_CATEGORIES.flatMap(c => c.skills).filter(s => s !== 'Traveling').sort();
        return this.requirementRows.map((r, i) => {
            let fields = '';
            if (r.type === 'skill') {
                const skillDisplay = r.skill ? `${skillIcon(r.skill.charAt(0).toUpperCase() + r.skill.slice(1))} ${r.skill.charAt(0).toUpperCase() + r.skill.slice(1)}` : 'Select skill...';
                const skillItems = REQ_SKILLS.map(s => {
                    const val = s.toLowerCase();
                    return `<div class="gi-dd-item gi-req-skill-item" data-value="${val}" data-row="${i}">${skillIcon(s)} <span>${s}</span></div>`;
                }).join('');
                fields = `<div class="gi-req-skill-cell" style="position:relative;flex:1">
                    <div class="gi-dd-button gi-req-skill-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${skillDisplay}</div><span class="expand-arrow">▼</span></div>
                    <div class="gi-dd-dropdown gi-req-skill-dd" style="display:none">${skillItems}</div>
                    <input type="hidden" class="gi-req-skill" value="${r.skill || ''}" />
                </div>
                <span>Lv</span><input type="number" class="gi-req-level" value="${r.level || 1}" min="1" max="99" />`;
            } else if (r.type === 'reputation') {
                const factionDisplay = r.faction ? r.faction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Select faction...';
                const factionItems = FACTIONS.map(f => {
                    const label = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    return `<div class="gi-dd-item gi-req-faction-item" data-value="${f}">${label}</div>`;
                }).join('');
                fields = `<div class="gi-req-faction-cell" style="position:relative;flex:1">
                    <div class="gi-dd-button gi-req-faction-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${factionDisplay}</div><span class="expand-arrow">▼</span></div>
                    <div class="gi-dd-dropdown gi-req-faction-dd" style="display:none">${factionItems}</div>
                    <input type="hidden" class="gi-req-faction" value="${r.faction || ''}" />
                </div>
                <span>≥</span><input type="number" class="gi-req-amount" value="${r.amount || 1}" min="1" />`;
            } else if (r.type === 'character_level') {
                fields = `<span>Lv</span><input type="number" class="gi-req-level" value="${r.level || 1}" min="1" max="99" />`;
            } else if (r.type === 'achievement_points') {
                fields = `<span>AP ≥</span><input type="number" class="gi-req-amount" value="${r.amount || 0}" min="0" />`;
            } else if (r.type === 'activity_completion') {
                fields = `<input type="text" class="gi-req-activity" value="${r.activity || ''}" placeholder="e.g. skate_skiing" />
                    <span>×</span><input type="number" class="gi-req-completions" value="${r.completions || 1}" min="1" />`;
            } else if (r.type === 'category_level_percent') {
                const CAT_OPTIONS = [
                    { value: 'gathering', label: 'Gathering' },
                    { value: 'artisan', label: 'Artisan' },
                    { value: 'utility', label: 'Utility' },
                ];
                const catDisplay = CAT_OPTIONS.find(o => o.value === r.category)?.label || 'Select...';
                const catItems = CAT_OPTIONS.map(o =>
                    `<div class="gi-dd-item gi-req-cat-item" data-value="${o.value}" data-row="${i}">${o.label}</div>`
                ).join('');
                fields = `<div class="gi-req-cat-cell" style="position:relative;flex:1">
                    <div class="gi-dd-button gi-req-cat-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${catDisplay}</div><span class="expand-arrow">▼</span></div>
                    <div class="gi-dd-dropdown gi-req-cat-dd" style="display:none">${catItems}</div>
                    <input type="hidden" class="gi-req-category" value="${r.category || ''}" />
                </div>
                <input type="number" class="gi-req-percent" value="${r.percent || 10}" min="1" max="100" style="width:50px" /><span>%</span>`;
            }
            const REQ_TYPE_OPTIONS = [
                { value: '', label: 'Select...' },
                { value: 'skill', label: '📊 Skill Level' },
                { value: 'reputation', label: '🏅 Reputation' },
                { value: 'character_level', label: '⭐ Character Level' },
                { value: 'achievement_points', label: '🏆 Achievement Points' },
                { value: 'activity_completion', label: '✅ Activity Completion' },
                { value: 'category_level_percent', label: '📈 Category Level %' },
            ];
            const typeDisplay = REQ_TYPE_OPTIONS.find(o => o.value === r.type)?.label || 'Select...';
            const typeItems = REQ_TYPE_OPTIONS.map(o =>
                `<div class="gi-dd-item gi-req-type-item${o.value === r.type ? ' gi-dd-selected' : ''}" data-value="${o.value}">${o.label}</div>`
            ).join('');
            return `<div class="gi-req-row" data-index="${i}">
                <div class="gi-req-type-cell" style="position:relative;min-width:140px">
                    <div class="gi-dd-button gi-req-type-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${typeDisplay}</div><span class="expand-arrow">▼</span></div>
                    <div class="gi-dd-dropdown gi-req-type-dd" style="display:none">${typeItems}</div>
                    <input type="hidden" class="gi-req-type" value="${r.type || ''}" />
                </div>
                ${fields}
                <button class="gi-req-remove" title="Remove">✕</button>
            </div>`;
        }).join('');
    }

    _petXpReqRowsHtml() {
        const PET_XP_REQ_TYPES = [
            { value: '', label: 'Select...' },
            { value: 'location', label: '📍 Location' },
            { value: 'skill', label: '📊 Skill' },
        ];

        return this.petXpReqRows.map((r, i) => {
            let fields = '';
            if (r.type === 'location') {
                const locDisplay = r.value ? LOCATION_GROUPS.flatMap(g => g.items).find(l => l.value === r.value)?.label || r.value : 'Select...';
                const locItems = LOCATION_GROUPS.map(g => {
                    const items = g.items.map(l => {
                        const iconHtml = l.svg ? `<img src="${l.svg}" class="gi-loc-icon" style="width:16px;height:16px;margin-right:4px" onerror="this.style.display='none'" />` : (l.icon || '');
                        return `<div class="gi-dd-item gi-pet-xp-loc-item" data-value="${l.value}" data-row="${i}">${iconHtml} ${l.label}</div>`;
                    }).join('');
                    return `<div class="gi-dd-group-label">${g.group}</div>${items}`;
                }).join('');
                fields = `<div class="gi-req-skill-cell" style="position:relative;flex:1">
                        <div class="gi-dd-button gi-pet-xp-loc-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${locDisplay}</div><span class="expand-arrow">▼</span></div>
                        <div class="gi-dd-dropdown gi-pet-xp-loc-dd" style="display:none;max-height:200px;overflow-y:auto">${locItems}</div>
                    </div>`;
            } else if (r.type === 'skill') {
                const notChecked = r.not ? 'checked' : '';
                const skillDropdownHtml = this._skillDropdownHtml(r.value || '').replace(/gi-skill-item/g, 'gi-pet-xp-skill-item');
                const skillDisplay = r.value ? this._skillDisplay(r.value) : 'Select...';
                fields = `<label class="gi-checkbox-label" style="font-size:12px;white-space:nowrap"><input type="checkbox" class="gi-pet-xp-not" data-row="${i}" ${notChecked} /> NOT</label>
                    <div class="gi-req-skill-cell" style="position:relative;flex:1">
                        <div class="gi-dd-button gi-pet-xp-skill-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${skillDisplay}</div><span class="expand-arrow">▼</span></div>
                        <div class="gi-dd-dropdown gi-pet-xp-skill-dd" style="display:none;max-height:250px;overflow-y:auto">${skillDropdownHtml}</div>
                    </div>`;
            }
            const typeDisplay = PET_XP_REQ_TYPES.find(o => o.value === r.type)?.label || 'Select...';
            const typeItems = PET_XP_REQ_TYPES.map(o =>
                `<div class="gi-dd-item gi-pet-xp-type-item${o.value === r.type ? ' gi-dd-selected' : ''}" data-value="${o.value}" data-row="${i}">${o.label}</div>`
            ).join('');
            return `<div class="gi-req-row gi-pet-xp-req-row" data-index="${i}">
                    <div class="gi-req-type-cell" style="position:relative;min-width:110px">
                        <div class="gi-dd-button gi-pet-xp-type-btn" data-row="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${typeDisplay}</div><span class="expand-arrow">▼</span></div>
                        <div class="gi-dd-dropdown gi-pet-xp-type-dd" style="display:none">${typeItems}</div>
                    </div>
                    ${fields}
                    <button class="gi-req-remove gi-pet-xp-req-remove" data-row="${i}" title="Remove">✕</button>
                </div>`;
        }).join('');
    }

    _statRowsHtml(rows) {
        if (rows.length === 0) return '';
        let html = `<div class="gi-stat-headers">
            <span class="gi-sh" style="flex:1.3">Skill</span>
            <span class="gi-sh" style="flex:1.3">Location</span>
            <span class="gi-sh" style="flex:1.5">Stat</span>
            <span class="gi-sh" style="flex:0 0 60px">Value</span>
            <span class="gi-sh" style="flex:0 0 24px"></span>
        </div>`;
        html += rows.map((row, i) => `
            <div class="gi-stat-row" data-index="${i}">
                <div class="gi-stat-cell gi-stat-skill-cell" style="flex:1.3">
                    <div class="gi-dd-button gi-stat-skill-btn" data-index="${i}">
                        <div class="gi-dd-value">${this._skillDisplay(row.skill)}</div>
                        <span class="expand-arrow">▼</span>
                    </div>
                    <div class="gi-dd-dropdown gi-stat-skill-dd" style="display:none">${this._skillDropdownHtml(row.skill)}</div>
                    <input type="hidden" class="gi-stat-skill" value="${row.skill || 'global'}" />
                </div>
                <div class="gi-stat-cell gi-stat-loc-cell" style="flex:1.3">
                    <div class="gi-dd-button gi-stat-loc-btn" data-index="${i}">
                        <div class="gi-dd-value">${this._locationDisplay(row.location)}</div>
                        <span class="expand-arrow">▼</span>
                    </div>
                    <div class="gi-dd-dropdown gi-stat-loc-dd" style="display:none">${this._locationDropdownHtml(row.location)}</div>
                    <input type="hidden" class="gi-stat-location" value="${row.location || 'global'}" />
                </div>
                <div class="gi-stat-cell gi-stat-type-cell" style="flex:1.5">
                    <div class="gi-dd-button gi-stat-type-btn" data-index="${i}" style="padding:4px 6px;font-size:12px"><div class="gi-dd-value">${this._statTypeDisplay(row.type)}</div><span class="expand-arrow">▼</span></div>
                    <div class="gi-dd-dropdown gi-stat-type-dd" style="display:none">${this._statTypeDropdownHtml(row.type)}</div>
                    <input type="hidden" class="gi-stat-type" value="${row.type || 'work_efficiency'}" />
                </div>
                <input type="number" class="gi-stat-value" value="${row.value}" step="0.1" style="flex:0 0 60px" />
                <button class="gi-stat-remove" title="Remove">✕</button>
            </div>
        `).join('');
        return html;
    }

    _savedDefName() {
        if (!this.currentDefId) return '+ New Generic Item';
        const d = this.savedDefs.find(d => d.id === this.currentDefId);
        const name = d ? d.name : this.currentDefName;
        const icon = d ? (d.icon || '⚡') : this.selectedIcon;
        const color = d ? d.icon_color : this.selectedIconColor;
        if (!name) return '+ New Generic Item';
        const iconHtml = color ? `<span style="${window.emojiTintStyle(color)}">${window.emojiForPlatform(icon)}</span>` : icon;
        return `${iconHtml} ${name}`;
    }

    _currentName() {
        const d = this.savedDefs.find(d => d.id === this.currentDefId);
        return d ? d.name : this.currentDefName;
    }

    _updateSavedDropdown() {
        if (!this.$overlay) return;
        const $dd = this.$overlay.find('.gi-saved-dropdown');
        if ($dd.is(':visible')) $dd.html(this._savedDropdownHtml());
    }

    _kwTagsHtml() {
        return this.keywords.map((kw, i) => {
            const customEmoji = this.customKwEmojis[kw];
            const customColor = this.customKwColors[kw];
            const isKnown = KNOWN_KEYWORDS.some(k => k.value.toLowerCase() === kw.toLowerCase());
            let iconHtml;
            if (customEmoji) {
                const colorStyle = customColor ? `${window.emojiTintStyle(customColor)}` : '';
                iconHtml = `<span class="gi-kw-custom-emoji" style="${colorStyle}">${customEmoji}</span>`;
            } else if (isKnown) {
                iconHtml = kwIcon(kw);
            } else {
                iconHtml = `<span class="gi-kw-custom-emoji">🏷️</span>`;
            }
            return `<span class="gi-keyword-tag">${iconHtml} ${kw} <button class="gi-keyword-remove" data-index="${i}">✕</button></span>`;
        }).join('');
    }

    _kwDropdownHtml(search = '') {
        const q = search.toLowerCase();
        const already = new Set(this.keywords.map(k => k.toLowerCase()));
        let html = `<input type="text" class="gi-kw-search" placeholder="Search or type new keyword..." value="${search}" />`;
        html += '<div class="gi-kw-list">';

        // Known keywords section
        let knownCount = 0;
        for (const kw of KNOWN_KEYWORDS) {
            if (already.has(kw.value.toLowerCase())) continue;
            if (q && !kw.value.toLowerCase().includes(q)) continue;
            html += `<div class="gi-dd-item gi-kw-item" data-value="${kw.value}">${kwIcon(kw.value)} ${kw.value}</div>`;
            knownCount++;
        }

        // Custom keywords section (from DB — shared across all users)
        const customKws = this.customKeywordsFromDB.filter(ck =>
            !already.has(ck.name.toLowerCase()) &&
            !KNOWN_KEYWORDS.some(k => k.value.toLowerCase() === ck.name.toLowerCase()) &&
            (!q || ck.name.toLowerCase().includes(q))
        );
        if (customKws.length > 0) {
            html += `<div style="font-size:0.7rem;color:var(--text-muted);padding:6px 8px 2px;border-top:1px solid var(--border-color);margin-top:4px">Custom Keywords</div>`;
            for (const ck of customKws) {
                const colorStyle = ck.icon_color ? `${window.emojiTintStyle(ck.icon_color)}` : '';
                html += `<div class="gi-dd-item gi-kw-item" data-value="${ck.name}"><span class="gi-kw-custom-emoji" style="${colorStyle}">${ck.icon || '🏷️'}</span> ${ck.name}</div>`;
            }
        }

        if (knownCount === 0 && customKws.length === 0 && !q) {
            html += '<div class="gi-dd-item" style="color:var(--text-secondary);font-style:italic">All keywords added</div>';
        }
        // Always show "add new" when there's text that doesn't exactly match a known or custom keyword
        if (q) {
            const exactMatch = KNOWN_KEYWORDS.some(k => k.value.toLowerCase() === q) ||
                this.customKeywordsFromDB.some(ck => ck.name.toLowerCase() === q);
            if (!exactMatch && !already.has(q)) {
                html += `<div class="gi-kw-new-form">
                    <div class="gi-kw-new-row">
                        <button class="gi-kw-new-emoji-btn" title="Pick emoji">🏷️</button>
                        <span class="gi-kw-new-name">${search.trim()}</span>
                        <button class="gi-kw-new-add optimize-btn" data-value="${search.trim()}" style="width:auto;padding:2px 10px;font-size:11px">Add</button>
                    </div>
                    <div class="gi-kw-new-emoji-picker" style="display:none">
                        <div class="gi-icon-defaults">${EMOJI_OPTIONS.map(e => `<span class="gi-kw-emoji-option" data-emoji="${e}">${e}</span>`).join('')}</div>
                        <div style="margin-top:4px"><label style="font-size:0.7rem;color:var(--text-muted)">Color tint:</label> <input type="color" class="gi-kw-color-input" value="#ffffff" style="width:24px;height:20px;border:none;background:none;cursor:pointer"> <button class="gi-kw-color-clear" style="font-size:0.65rem;border:none;background:none;color:var(--text-muted);cursor:pointer">Clear</button></div>
                        <emoji-picker class="gi-kw-full-picker"></emoji-picker>
                    </div>
                </div>`;
            }
        }
        // Also always show a generic "add custom" at the bottom
        html += `<div class="gi-kw-new-form gi-kw-custom-entry" style="border-top:1px solid var(--border-color);margin-top:4px;padding-top:4px">
            <div class="gi-kw-new-row">
                <button class="gi-kw-custom-emoji-btn" title="Pick emoji">🏷️</button>
                <input type="text" class="gi-kw-custom-name" placeholder="New keyword name..." style="flex:1" />
                <button class="gi-kw-custom-add optimize-btn" style="width:auto;padding:2px 10px;font-size:11px">Add</button>
            </div>
            <div class="gi-kw-custom-emoji-picker" style="display:none">
                <div class="gi-icon-defaults">${EMOJI_OPTIONS.map(e => `<span class="gi-kw-custom-emoji-option" data-emoji="${e}">${e}</span>`).join('')}</div>
                <div style="margin-top:4px"><label style="font-size:0.7rem;color:var(--text-muted)">Color tint:</label> <input type="color" class="gi-kw-color-input" value="#ffffff" style="width:24px;height:20px;border:none;background:none;cursor:pointer"> <button class="gi-kw-color-clear" style="font-size:0.65rem;border:none;background:none;color:var(--text-muted);cursor:pointer">Clear</button></div>
                <emoji-picker class="gi-kw-custom-full-picker"></emoji-picker>
            </div>
        </div>`;
        html += '</div>';
        return html;
    }

    _exportName() {
        if (this.currentDefId) {
            const d = this.savedDefs.find(d => d.id === this.currentDefId);
            if (d && d.export_item_name) return d.export_item_name;
        }
        const name = this.$overlay ? (this.$overlay.find('#gi-name').val() || '').trim() : '';
        return name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : '';
    }

    _savedDropdownHtml() {
        const search = (this.savedSearchText || '').toLowerCase();
        let html = '<input type="text" class="gi-saved-search" placeholder="Search by name, keyword, slot..." value="' + (this.savedSearchText || '') + '" />';
        html += '<div class="gi-saved-list">';
        html += '<div class="gi-saved-item" data-id=""><span>+ New Generic Item</span></div>';

        const matchesSearch = (d) => {
            if (!search) return true;
            if (d.name.toLowerCase().includes(search)) return true;
            if (d.slot && d.slot.toLowerCase().includes(search)) return true;
            if (d.keywords && d.keywords.some(kw => kw.toLowerCase().includes(search))) return true;
            return false;
        };

        const renderIcon = (d) => {
            const icon = d.icon || '⚡';
            if (d.icon_color) {
                return `<span style="${window.emojiTintStyle(d.icon_color)}">${window.emojiForPlatform(icon)}</span>`;
            }
            return icon;
        };

        for (const d of this.savedDefs) {
            if (!matchesSearch(d)) continue;
            html += `<div class="gi-saved-item" data-id="${d.id}"><span>${renderIcon(d)} ${d.name} <small>(${d.slot})</small></span></div>`;
        }
        if (this.showCommunity && this.communityDefs.length > 0) {
            html += '<div class="gi-saved-divider">Community <small style="color:var(--text-muted)">(click to edit)</small></div>';
            const ids = new Set(this.savedDefs.map(d => d.id));
            for (const d of this.communityDefs) {
                if (ids.has(d.id)) continue;
                if (!matchesSearch(d)) continue;
                const dsRaw = d.data_status;
                let statusBadge = '';
                if (dsRaw) {
                    try {
                        const dsMap = typeof dsRaw === 'string' ? JSON.parse(dsRaw) : dsRaw;
                        const vals = Object.values(dsMap);
                        const hasIncomplete = vals.some(v => v === 'missing_qualities' || v === 'partial');
                        if (hasIncomplete) statusBadge = ' <span class="gi-status-badge gi-status-incomplete" title="Missing quality data">⚠️</span>';
                        else if (vals.some(v => v === 'complete')) statusBadge = ' <span class="gi-status-badge gi-status-complete" title="Data complete">✅</span>';
                    } catch (e) { /* ignore */ }
                }
                html += `<div class="gi-saved-item gi-community-item" data-id="community::${d.id}"><span>${renderIcon(d)} ${d.name} <small>(${d.slot})</small>${statusBadge}</span></div>`;
            }
        }
        html += '</div>';
        return html;
    }

    // ------------------------------------------------------------------
    // MAIN RENDER
    // ------------------------------------------------------------------

    _render() {
        if (this.$overlay) this.$overlay.remove();
        const kwHtml = this._kwTagsHtml();
        const activeRows = this.isCrafted ? (this._isInputSlot() ? (this.qualityStatRows['Normal'] || []) : (this.qualityStatRows[this.activeQualityTab] || [])) : this.statRows;
        const iconStyle = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
        const rarBg = rarityColor(this.selectedRarity);

        const isCollectible = this._isCollectibleSlot();
        const isConsumable = this._isConsumableSlot();
        const isInput = this._isInputSlot();
        const isPet = this._isPetSlot();
        const qualityNames = this._getQualityNames();

        const qualityTabsHtml = this.isCrafted ? `<div class="gi-quality-tabs">${qualityNames.map(q => {
            const r = QUALITY_TO_RARITY[q] || 'common';
            const c = isPet ? (q === 'Egg' ? '#8B7355' : '#4a7c59') : (q === 'Fine' ? 'var(--rarity-fine)' : rarityColor(r));
            const bc = isPet ? '#fff' : rarityBorderColor(r);
            const active = q === this.activeQualityTab;
            return `<button class="gi-quality-tab ${active ? 'active' : ''}" data-quality="${q}" style="background:${c};color:#fff;border:2px solid ${active ? bc : 'transparent'}">${q}</button>`;
        }).join('')}${isPet && !this.petHasLevel4 ? '<button class="gi-add-level4-btn optimize-btn" style="padding:4px 10px;font-size:12px;margin-left:4px">+ Level 4</button>' : ''}</div>` : '';

        const hideKw = (isCollectible || isPet) ? 'style="display:none"' : '';
        const hideCrafted = (isCollectible || isConsumable || isInput || isPet) ? 'style="display:none"' : '';
        const hideRarity = (this.isCrafted || isCollectible || isPet) ? 'style="display:none"' : '';
        const hideReqs = (isCollectible || isConsumable || isPet) ? 'style="display:none"' : '';
        // For input slot, requirements go above quality tabs; for others, below
        const hideReqsAbove = isInput ? '' : 'style="display:none"';
        const hideReqsBelow = isInput ? 'style="display:none"' : hideReqs;

        // Pet level tabs with +/- Level 4 button inline
        let petLevelTabsHtml = '';
        if (isPet) {
            const levelNames = this._getQualityNames();
            petLevelTabsHtml = `<div class="gi-quality-tabs">${levelNames.map(q => {
                const c = q === 'Egg' ? '#8B7355' : '#4a7c59';
                const active = q === this.activeQualityTab;
                return `<button class="gi-quality-tab ${active ? 'active' : ''}" data-quality="${q}" style="background:${c};color:#fff;border:2px solid ${active ? '#fff' : 'transparent'}">${q}</button>`;
            }).join('')}${!this.petHasLevel4
                ? '<button class="gi-add-level4-btn optimize-btn" style="padding:4px 10px;font-size:12px;margin-left:4px">+ Lv 4</button>'
                : '<button class="gi-remove-level4-btn optimize-btn" style="padding:4px 10px;font-size:12px;margin-left:4px;background:#e53935">- Lv 4</button>'
                }</div>`;
        }

        const html = `
        <div class="generic-item-overlay modal-overlay">
            <div class="generic-item-popup">
                <div class="gi-header"><span>${this._isCommunityEdit ? '✏️ Edit Community Item' : (this.currentDefId ? 'Edit Generic Item' : 'Create Generic Item')}</span><button class="gi-close">✕</button></div>
                ${this._isCommunityEdit ? `<div class="gi-community-banner">
                    <span>🌐 You're editing a shared community item. Your changes will be visible to everyone.</span>
                </div>` : ''}
                <div class="gi-body">
                    <div class="gi-row gi-saved-selector">
                        <label>Saved Items</label>
                        <div class="gi-saved-button"><div class="gi-saved-value">${this._savedDefName()}</div><button class="gi-saved-toggle"><span class="expand-arrow">▼</span></button></div>
                        <div class="gi-saved-dropdown" style="display:none"></div>
                        <label class="gi-checkbox-label gi-community-row"><input type="checkbox" id="gi-show-community" ${this.showCommunity ? 'checked' : ''} /> Show community items</label>
                    </div>
                    <div class="gi-row gi-name-row">
                        <div class="gi-icon-picker">
                            <button class="gi-icon-btn" title="Pick icon" style="${iconStyle}">${this._renderIconContent()}</button>
                            <div class="gi-icon-popup" style="display:none">
                                <div class="gi-icon-defaults">${EMOJI_OPTIONS.map(e => `<span class="gi-emoji-option ${e === this.selectedIcon ? 'selected' : ''}" data-emoji="${e}">${e}</span>`).join('')}</div>
                                <div class="gi-color-row"><label>Tint:</label><input type="color" class="gi-icon-color" value="${this.selectedIconColor || '#ffffff'}" /><button class="gi-color-clear">Clear</button></div>
                                <emoji-picker class="gi-full-picker"></emoji-picker>
                            </div>
                        </div>
                        <div class="gi-name-field"><label>Name</label><input type="text" id="gi-name" value="${this.currentDefId ? (this._currentName() || '') : ''}" /></div>
                    </div>
                    <div class="gi-row gi-slot-selector">
                        <label>Slot</label>
                        <div class="gi-dd-button gi-slot-btn"><div class="gi-dd-value">${this._slotDisplay()}</div><span class="expand-arrow">▼</span></div>
                        <div class="gi-dd-dropdown gi-slot-dropdown" style="display:none">${this._slotDropdownHtml()}</div>
                    </div>
                    <div class="gi-row gi-kw-selector" ${hideKw}>
                        <label>Keywords</label>
                        <div class="gi-keywords-tags">${kwHtml}</div>
                        <div class="gi-dd-button gi-kw-btn"><div class="gi-dd-value">+ Add keyword</div><span class="expand-arrow">▼</span></div>
                        <div class="gi-dd-dropdown gi-kw-dropdown" style="display:none">${this._kwDropdownHtml()}</div>
                    </div>
                    <div class="gi-row gi-crafted-row" ${hideCrafted}><label class="gi-checkbox-label"><input type="checkbox" id="gi-crafted" ${this.isCrafted ? 'checked' : ''} /> Crafted item (quality variants)</label></div>
                    <div class="gi-row gi-rarity-row" ${hideRarity}>
                        <label>Rarity</label>
                        <div class="gi-dd-button gi-rarity-btn" style="background:${rarBg};color:#fff"><div class="gi-dd-value">${this._rarityDisplay()}</div><span class="expand-arrow">▼</span></div>
                        <div class="gi-dd-dropdown gi-rarity-dropdown" style="display:none">${this._rarityDropdownHtml()}</div>
                    </div>
                    <div class="gi-row gi-req-section gi-req-above" ${hideReqsAbove}><label>Requirements</label><div class="gi-req-rows">${isInput ? this._reqRowsHtml() : ''}</div><button class="gi-add-req optimize-btn" style="width:auto;padding:6px 16px;font-size:13px;margin-top:var(--spacing-xs)">+ Add Requirement</button></div>
                    <div class="gi-row gi-req-section gi-req-below" ${hideReqsBelow}><label>Requirements</label><div class="gi-req-rows">${!isInput ? this._reqRowsHtml() : ''}</div><button class="gi-add-req optimize-btn" style="width:auto;padding:6px 16px;font-size:13px;margin-top:var(--spacing-xs)">+ Add Requirement</button></div>
                    <div class="gi-row gi-pet-xp-req-section" ${isPet ? '' : 'style="display:none"'}>
                        <label>Requirement To Gain XP</label>
                        <div class="gi-pet-xp-req-rows">${isPet ? this._petXpReqRowsHtml() : ''}</div>
                        <button class="gi-add-pet-xp-req optimize-btn" style="width:auto;padding:6px 16px;font-size:13px;margin-top:var(--spacing-xs)">+ Add Requirement</button>
                    </div>
                    <div class="gi-row gi-duration-row" ${isConsumable ? '' : 'style="display:none"'}>
                        <label>Step Duration</label>
                        <div class="ga-slider-row">
                            <input type="range" id="gi-duration-slider" min="0" max="5" step="1" value="${[0, 500, 750, 1000, 5000, 10000].indexOf(this.duration)}" class="ga-slider" list="gi-duration-ticks" />
                            <datalist id="gi-duration-ticks"><option value="0"></option><option value="1"></option><option value="2"></option><option value="3"></option><option value="4"></option><option value="5"></option></datalist>
                            <div class="ga-slider-input-wrap">
                                <input type="number" id="gi-duration-input" class="ga-slider-input" style="width:62px;text-align:center" min="0" value="${this.duration}" />
                            </div>
                        </div>
                    </div>
                    ${isPet ? petLevelTabsHtml : qualityTabsHtml}
                    <div class="gi-row gi-quality-value-row" ${(this.isCrafted && !isPet) ? '' : 'style="display:none"'}>
                        <label>Value</label>
                        <div class="ga-slider-input-wrap" style="gap:6px">
                            <input type="number" id="gi-quality-value" min="0" value="${this.qualityValues[this.activeQualityTab] || 0}" class="ga-slider-input" style="width:72px" />
                            <img src="/assets/icons/items/coins.svg" style="width:16px;height:16px;opacity:0.7;transform:scale(1.5)" onerror="this.outerHTML='🪙'" />
                        </div>
                    </div>
                    <div class="gi-row gi-value-row" ${(this.isCrafted && !isPet) || isCollectible ? 'style="display:none"' : ''}>
                        <label>${isPet ? 'Egg Value' : 'Value'}</label>
                        <div class="ga-slider-input-wrap" style="gap:6px">
                            <input type="number" id="gi-item-value" min="0" value="${this.itemValue}" class="ga-slider-input" style="width:72px" />
                            <img src="/assets/icons/items/coins.svg" style="width:16px;height:16px;opacity:0.7;transform:scale(1.5)" onerror="this.outerHTML='🪙'" />
                        </div>
                    </div>
                    <div class="gi-row gi-pet-xp-row" ${isPet && this.activeQualityTab !== (this.petHasLevel4 ? 'Level 4' : 'Level 3') ? '' : 'style="display:none"'}>
                        <label>XP to next level</label>
                        <input type="number" id="gi-pet-xp" min="0" value="${this.petXpRequirements[this.activeQualityTab] || 0}" class="gi-pet-xp-input" />
                    </div>
                    <div class="gi-row gi-stats-section" ${isPet && this.activeQualityTab === 'Egg' ? 'style="display:none"' : ''}><label>Stats</label><div class="gi-stat-rows">${this._statRowsHtml(activeRows)}</div><button class="gi-add-stat optimize-btn" style="width:auto;padding:6px 16px;font-size:13px;margin-top:var(--spacing-xs)">+ Add Stat</button></div>
                    <div class="gi-row gi-gated-section" ${isPet ? 'style="display:none"' : ''}>
                        <label>Gated Stats <span style="font-size:0.7rem;color:var(--text-muted)">(conditional, like Omni-Tool AP or set bonuses)</span></label>
                        <div class="gi-gated-entries">${this._gatedStatsHtml()}</div>
                        <button class="gi-add-gated optimize-btn" style="width:auto;padding:6px 16px;font-size:13px;margin-top:var(--spacing-xs)">+ Add Gated Stat</button>
                    </div>
                    <div class="gi-row"><label class="gi-checkbox-label"><input type="checkbox" id="gi-share" checked /> Share with community</label></div>
                    <div class="gi-advanced-section">
                        <div class="gi-advanced-header clickable">
                            <span class="expand-arrow">▼</span> Advanced
                        </div>
                        <div class="gi-advanced-content" style="display:none">
                            <div class="gi-row" style="margin-top:8px">
                                <label>Export Item Name <small style="color:var(--text-secondary)">(used for gearset exports)</small></label>
                                <input type="text" id="gi-export-name" value="${this._exportName()}" placeholder="auto-generated from name" />
                            </div>
                            <div class="gi-row" style="margin-top:8px">
                                <label>Icon Path <small style="color:var(--text-secondary)">(SVG/PNG path, overrides emoji)</small></label>
                                <input type="text" id="gi-icon-path" value="${this.iconPath || ''}" placeholder="/assets/icons/items/equipment/item_name.svg" />
                            </div>
                        </div>
                    </div>
                </div>
                <div class="gi-actions">
                    <button class="btn-save-item optimize-btn" style="font-size:14px">${this._isCommunityEdit ? '✏️ Update Community Item' : '💾 Save'}</button>
                    ${this.currentDefId && !this._isCommunityEdit ? '<button class="btn-delete-item optimize-btn" style="font-size:14px;background:#e53935">🗑 Delete</button>' : ''}
                </div>
            </div>
        </div>`;
        $('body').append(html);
        this.$overlay = $('.generic-item-overlay').last();
        this._attachEvents();
    }

    // ------------------------------------------------------------------
    // EVENTS
    // ------------------------------------------------------------------

    _attachEvents() {
        if (!this.$overlay) return;
        const self = this;

        // Close
        this.$overlay.on('click.gi', '.gi-close', () => this.hide());
        this.$overlay.on('click.gi', (e) => { if ($(e.target).hasClass('generic-item-overlay')) this.hide(); });

        // Saved dropdown
        this.$overlay.on('click.gi', '.gi-saved-button', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const $dd = this.$overlay.find('.gi-saved-dropdown');
            this._toggleDropdown($btn, $dd, () => {
                this.savedSearchText = '';
                $dd.html(this._savedDropdownHtml());
                // Auto-focus search after slideDown
                setTimeout(() => $dd.find('.gi-saved-search').focus(), 160);
            });
        });
        this.$overlay.on('input.gi', '.gi-saved-search', (e) => {
            e.stopPropagation();
            this.savedSearchText = $(e.target).val();
            const fullHtml = this._savedDropdownHtml();
            const $temp = $('<div>').html(fullHtml);
            this.$overlay.find('.gi-saved-list').html($temp.find('.gi-saved-list').html());
        });
        this.$overlay.on('keydown.gi', '.gi-saved-search', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
            e.preventDefault();
            const $list = this.$overlay.find('.gi-saved-list');
            const $items = $list.find('.gi-saved-item');
            if (!$items.length) return;
            const $active = $items.filter('.keyboard-active');
            let idx = $active.length ? $items.index($active) : -1;

            if (e.key === 'ArrowDown') {
                $items.removeClass('keyboard-active');
                idx = idx < $items.length - 1 ? idx + 1 : 0;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                $items.removeClass('keyboard-active');
                idx = idx > 0 ? idx - 1 : $items.length - 1;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && $active.length) {
                $active.trigger('click');
            }
        });
        this.$overlay.on('click.gi', '.gi-saved-item', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('id') || '';
            this.$overlay.find('.gi-saved-dropdown').slideUp(200);
            if (!id) { this._reset(); this._render(); requestAnimationFrame(() => this.$overlay.addClass('show')); return; }
            if (String(id).startsWith('community::')) {
                const cid = String(id).replace('community::', '');
                const d = this.communityDefs.find(x => x.id === cid);
                if (d) { this._populateFrom(d); this._isCommunityEdit = true; this._render(); requestAnimationFrame(() => this.$overlay.addClass('show')); }
                return;
            }
            const d = this.savedDefs.find(x => x.id === id);
            if (d) { this._populateFrom(d); this._isCommunityEdit = false; this._render(); requestAnimationFrame(() => this.$overlay.addClass('show')); }
        });
        this.$overlay.on('change.gi', '#gi-show-community', async () => {
            this.showCommunity = !this.showCommunity;
            store.state.column3.showGenericItemCommunity = this.showCommunity;
            store._saveColumn3Selection();
            if (this.showCommunity && !this.communityDefs.length) {
                try { const c = await api.getCommunityDefinitions(); this.communityDefs = c.items || []; } catch (e) { this.communityDefs = []; }
            }
            this._updateSavedDropdown();
        });

        // Icon picker — detach popup and append to body (like floating dropdowns)
        this.$overlay.on('click.gi', '.gi-icon-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Check if already open
            if ($('.gi-icon-popup-floating').length) {
                $('.gi-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
                return;
            }
            this._closeAllDropdowns();
            // Clone the popup content and append to body as floating
            const $source = this.$overlay.find('.gi-icon-popup');
            const $floating = $('<div class="gi-icon-popup-floating"></div>');
            $floating.html($source.html());
            const rect = e.currentTarget.getBoundingClientRect();
            $floating.css({
                position: 'fixed',
                top: (rect.bottom + 4) + 'px',
                left: rect.left + 'px',
                width: '340px',
                'max-height': '70vh',
                'overflow-y': 'auto',
                'z-index': 100000,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                'border-radius': '8px',
                'box-shadow': '0 8px 32px rgba(0,0,0,0.5)',
            });
            $('body').append($floating);
            $floating.hide().slideDown(150);

            // Wire up emoji clicks on the floating popup
            $floating.on('click', '.gi-emoji-option', (ev) => {
                ev.stopPropagation();
                this.selectedIcon = $(ev.currentTarget).data('emoji');
                const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
                this.$overlay.find('.gi-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
                $floating.slideUp(150, () => $floating.remove());
            });
            $floating.on('input', '.gi-icon-color', (ev) => {
                this.selectedIconColor = $(ev.target).val();
                this.$overlay.find('.gi-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
            });
            $floating.on('click', '.gi-color-clear', () => {
                this.selectedIconColor = null;
                this.$overlay.find('.gi-icon-btn').html(this.selectedIcon);
                $floating.find('.gi-icon-color').val('#ffffff');
            });
            // Wire up full emoji-picker web component
            const fpicker = $floating.find('emoji-picker')[0];
            if (fpicker) fpicker.addEventListener('emoji-click', (ev) => {
                this.selectedIcon = ev.detail.unicode;
                this.$overlay.find('.gi-icon-btn').html(window.tintedEmoji(this.selectedIcon, null));
                $floating.slideUp(150, () => $floating.remove());
            });
            // Close on outside click
            setTimeout(() => {
                $(document).one('click.gi-icon-floating', (ev) => {
                    if ($(ev.target).closest('.gi-icon-popup-floating, .gi-icon-btn').length) return;
                    $floating.slideUp(150, () => $floating.remove());
                });
            }, 10);
        });
        this.$overlay.on('click.gi', '.gi-emoji-option', (e) => {
            e.stopPropagation();
            this.selectedIcon = $(e.currentTarget).data('emoji');
            const s = this.selectedIconColor ? `${window.emojiTintStyle(this.selectedIconColor)}` : '';
            this.$overlay.find('.gi-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
            this.$overlay.find('.gi-emoji-option').removeClass('selected'); $(e.currentTarget).addClass('selected');
            this.$overlay.find('.gi-icon-popup').slideUp(150);
        });
        this.$overlay.on('input.gi', '.gi-icon-color', (e) => {
            this.selectedIconColor = $(e.target).val();
            this.$overlay.find('.gi-icon-btn').html(window.tintedEmoji(this.selectedIcon, this.selectedIconColor));
        });
        this.$overlay.on('click.gi', '.gi-color-clear', () => {
            this.selectedIconColor = null;
            this.$overlay.find('.gi-icon-btn').html(this.selectedIcon);
            this.$overlay.find('.gi-icon-color').val('#ffffff');
        });
        const picker = this.$overlay.find('emoji-picker')[0];
        if (picker) picker.addEventListener('emoji-click', (e) => {
            this.selectedIcon = e.detail.unicode;
            this.$overlay.find('.gi-icon-btn').html(window.tintedEmoji(this.selectedIcon, null));
            this.$overlay.find('.gi-emoji-option').removeClass('selected');
            this.$overlay.find('.gi-icon-popup').slideUp(150);
        });

        // Slot dropdown
        this.$overlay.on('click.gi', '.gi-slot-btn', (e) => {
            e.stopPropagation();
            this._toggleDropdown($(e.currentTarget), this.$overlay.find('.gi-slot-dropdown'));
        });
        this.$overlay.on('click.gi', '.gi-slot-dropdown .gi-dd-item', (e) => {
            e.stopPropagation();
            this.selectedSlot = $(e.currentTarget).data('value');
            this._autoEquipSlot = null; // Clear auto-equip when slot changes
            this.$overlay.find('.gi-slot-btn .gi-dd-value').html(this._slotDisplay());
            this.$overlay.find('.gi-slot-btn .expand-arrow').removeClass('expanded');
            this.$overlay.find('.gi-slot-dropdown').slideUp(150);

            // Slot-specific form behavior
            const isCollectible = this._isCollectibleSlot();
            const isConsumable = this._isConsumableSlot();
            const isInput = this._isInputSlot();

            if (isCollectible) {
                // Hide keywords, crafted, rarity, requirements, duration, value
                this.isCrafted = false;
                this.selectedRarity = 'common';
                this.keywords = [];
                this.$overlay.find('.gi-kw-selector').slideUp(150);
                this.$overlay.find('.gi-crafted-row').slideUp(150);
                this.$overlay.find('#gi-crafted').prop('checked', false);
                this.$overlay.find('.gi-rarity-row').slideUp(150);
                this.$overlay.find('.gi-req-section').slideUp(150);
                this.$overlay.find('.gi-duration-row').slideUp(150);
                this.$overlay.find('.gi-value-row').slideUp(150);
                this.$overlay.find('.gi-quality-value-row').slideUp(150);
                this._rerenderStatArea();
            } else if (this._isPetSlot()) {
                // Pet: full re-render to get correct layout
                this.isCrafted = true;
                this.activeQualityTab = 'Egg';
                this.selectedRarity = 'common';
                this.keywords = [];
                this._render();
                requestAnimationFrame(() => this.$overlay.addClass('show'));
                this._loadSavedDefinitions();
                return; // _render handles everything
            } else if (isConsumable || isInput) {
                // Auto-enable crafted (Normal/Fine), hide crafted checkbox, hide requirements
                // Show duration for consumables only, hide for inputs
                this.isCrafted = true;
                this._wasAutoConsumableCrafted = true;
                this.activeQualityTab = 'Normal';
                this.$overlay.find('.gi-kw-selector').slideDown(150);
                this.$overlay.find('.gi-crafted-row').slideUp(150);
                this.$overlay.find('#gi-crafted').prop('checked', true);
                this.$overlay.find('.gi-rarity-row').slideUp(150);
                this.$overlay.find('.gi-req-section').slideUp(150);
                this.$overlay.find('.gi-duration-row')[isConsumable ? 'slideDown' : 'slideUp'](150);
                this.$overlay.find('.gi-value-row').slideUp(150);
                this.$overlay.find('.gi-quality-value-row').slideDown(150);
                this._rerenderStatArea();
            } else {
                // Normal slot — restore incremental behavior
                // Only full re-render if coming FROM pet slot (to clean up pet sections)
                const wasPet = this.$overlay.find('.gi-pet-xp-req-section').is(':visible');
                if (wasPet) {
                    this.isCrafted = false;
                    this.$overlay.find('#gi-crafted').prop('checked', false);
                    this._render();
                    requestAnimationFrame(() => this.$overlay.addClass('show'));
                    this._loadSavedDefinitions();
                    return;
                }
                if (this._wasAutoConsumableCrafted) {
                    this.isCrafted = false;
                    this.$overlay.find('#gi-crafted').prop('checked', false);
                    this._wasAutoConsumableCrafted = false;
                    this._rerenderStatArea();
                }
                this.$overlay.find('.gi-kw-selector').slideDown(150);
                this.$overlay.find('.gi-crafted-row').slideDown(150);
                this.$overlay.find('.gi-req-above').slideUp(150);
                this.$overlay.find('.gi-req-below').slideDown(150);
                this.$overlay.find('.gi-duration-row').slideUp(150);
                this.$overlay.find('.gi-pet-xp-req-section').slideUp(150);
                this.$overlay.find('.gi-pet-xp-row').slideUp(150);
                this.$overlay.find('.gi-stats-section').show();
                this.$overlay.find('.gi-value-row label').text('Value');
                if (!this.isCrafted) {
                    this.$overlay.find('.gi-rarity-row').slideDown(150);
                    this.$overlay.find('.gi-value-row').slideDown(150);
                    this.$overlay.find('.gi-quality-value-row').slideUp(150);
                } else {
                    this.$overlay.find('.gi-rarity-row').slideUp(150);
                    this.$overlay.find('.gi-value-row').slideUp(150);
                    this.$overlay.find('.gi-quality-value-row').slideDown(150);
                }
            }
            this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
        });

        // Rarity dropdown
        this.$overlay.on('click.gi', '.gi-rarity-btn', (e) => {
            e.stopPropagation();
            this._toggleDropdown($(e.currentTarget), this.$overlay.find('.gi-rarity-dropdown'));
        });
        this.$overlay.on('click.gi', '.gi-rarity-dropdown .gi-dd-item', (e) => {
            e.stopPropagation();
            this.selectedRarity = $(e.currentTarget).data('value');
            const bg = rarityColor(this.selectedRarity);
            this.$overlay.find('.gi-rarity-btn').css({ background: bg, color: '#fff' });
            this.$overlay.find('.gi-rarity-btn .gi-dd-value').text(this._rarityDisplay());
            this.$overlay.find('.gi-rarity-btn .expand-arrow').removeClass('expanded');
            this.$overlay.find('.gi-rarity-dropdown').slideUp(150);
        });

        // Keywords dropdown
        // Keywords dropdown
        this.$overlay.on('click.gi', '.gi-kw-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const $dd = this.$overlay.find('.gi-kw-dropdown');
            this._toggleDropdown($btn, $dd, () => {
                $dd.html(this._kwDropdownHtml());
            });
            // After opening, scroll to top and focus search
            if ($dd.is(':visible') || !$btn.find('.expand-arrow').hasClass('expanded')) {
                // Will be visible after slideDown
                setTimeout(() => {
                    $dd.scrollTop(0);
                    $dd.find('.gi-kw-search').focus();
                }, 160);
            }
        });
        this.$overlay.on('input.gi', '.gi-kw-search', (e) => {
            e.stopPropagation();
            const search = $(e.target).val().toLowerCase();
            const $dd = this.$overlay.find('.gi-kw-dropdown');
            const $list = $dd.find('.gi-kw-list');
            // Filter visible items without re-rendering (preserves cursor position)
            $list.find('.gi-kw-item').each(function () {
                const val = $(this).data('value').toLowerCase();
                $(this).toggle(!search || val.includes(search));
            });
            // Show/hide "add new" form for custom keyword
            $list.find('.gi-kw-new-form:not(.gi-kw-custom-entry)').remove();
            if (search) {
                const already = new Set(self.keywords.map(k => k.toLowerCase()));
                const exactMatch = KNOWN_KEYWORDS.some(k => k.value.toLowerCase() === search);
                if (!exactMatch && !already.has(search)) {
                    const name = $(e.target).val().trim();
                    const newFormHtml = `<div class="gi-kw-new-form">
                        <div class="gi-kw-new-row">
                            <button class="gi-kw-new-emoji-btn" title="Pick emoji">🏷️</button>
                            <span class="gi-kw-new-name">${name}</span>
                            <button class="gi-kw-new-add optimize-btn" data-value="${name}" style="width:auto;padding:2px 10px;font-size:11px">Add</button>
                        </div>
                        <div class="gi-kw-new-emoji-picker" style="display:none">
                            <div class="gi-icon-defaults">${EMOJI_OPTIONS.map(em => `<span class="gi-kw-emoji-option" data-emoji="${em}">${em}</span>`).join('')}</div>
                            <div style="margin-top:4px"><label style="font-size:0.7rem;color:var(--text-muted)">Color tint:</label> <input type="color" class="gi-kw-color-input" value="#ffffff" style="width:24px;height:20px;border:none;background:none;cursor:pointer"> <button class="gi-kw-color-clear" style="font-size:0.65rem;border:none;background:none;color:var(--text-muted);cursor:pointer">Clear</button></div>
                            <emoji-picker class="gi-kw-full-picker"></emoji-picker>
                        </div>
                    </div>`;
                    $list.find('.gi-kw-custom-entry').before(newFormHtml);
                }
            }
        });
        this.$overlay.on('keydown.gi', '.gi-kw-search', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const $list = this.$overlay.find('.gi-kw-list');
                const $items = $list.find('.gi-kw-item:visible');
                if (!$items.length) return;
                const $active = $items.filter('.keyboard-active');
                let idx = $active.length ? $items.index($active) : -1;
                $items.removeClass('keyboard-active');
                if (e.key === 'ArrowDown') idx = idx < $items.length - 1 ? idx + 1 : 0;
                else idx = idx > 0 ? idx - 1 : $items.length - 1;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const $active = this.$overlay.find('.gi-kw-list .gi-kw-item.keyboard-active');
                if ($active.length) {
                    $active.trigger('click');
                    return;
                }
                const val = $(e.target).val().trim();
                if (val && !this.keywords.includes(val)) {
                    this.keywords.push(val);
                    this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
                }
                this.$overlay.find('.gi-kw-btn .expand-arrow').removeClass('expanded');
                this.$overlay.find('.gi-kw-dropdown').slideUp(150);
            }
        });
        this.$overlay.on('click.gi', '.gi-kw-item', (e) => {
            e.stopPropagation();
            const val = $(e.currentTarget).data('value');
            if (val && !this.keywords.includes(val)) {
                this.keywords.push(val);
                this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
            }
            this.$overlay.find('.gi-kw-btn .expand-arrow').removeClass('expanded');
            this.$overlay.find('.gi-kw-dropdown').slideUp(150);
        });
        // "Add" button from search match
        this.$overlay.on('click.gi', '.gi-kw-new-add', (e) => {
            e.stopPropagation();
            const val = $(e.currentTarget).data('value');
            const $form = $(e.currentTarget).closest('.gi-kw-new-form');
            const emoji = $form.find('.gi-kw-new-emoji-btn').text().trim() || '🏷️';
            const floatingColor = $('.gi-icon-popup-floating .gi-kw-color-input').val();
            const formColor = $form.find('.gi-kw-color-input').val();
            const colorInput = floatingColor || formColor;
            const color = (colorInput && colorInput !== '#ffffff') ? colorInput : null;
            if (val && !this.keywords.includes(val)) {
                this.keywords.push(val);
                this.customKwEmojis[val] = emoji;
                if (color) this.customKwColors[val] = color;
                api.saveCustomKeyword(val, emoji, true, color).then(() => this._loadCustomKeywords()).catch(e => console.error('Failed to save custom keyword:', e));
                this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
            }
            this.$overlay.find('.gi-kw-btn .expand-arrow').removeClass('expanded');
            this.$overlay.find('.gi-kw-dropdown').slideUp(150);
        });
        // Emoji picker for keyword — reuse exact icon-popup-floating pattern
        this._openKwEmojiPicker = ($btn, $source) => {
            if ($('.gi-icon-popup-floating').length) {
                $('.gi-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
                return;
            }
            const $floating = $('<div class="gi-icon-popup-floating"></div>');
            $floating.html($source.html());
            const rect = $btn[0].getBoundingClientRect();
            const popupW = 340;
            $floating.css({
                position: 'fixed', top: '-9999px', left: '-9999px',
                width: popupW + 'px', 'max-height': '70vh', 'overflow-y': 'auto', 'z-index': 200000,
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                'border-radius': '8px', 'box-shadow': '0 8px 32px rgba(0,0,0,0.5)',
                visibility: 'hidden', display: 'block',
            });
            $('body').append($floating);
            const popupH = Math.min($floating[0].scrollHeight, window.innerHeight * 0.7);
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const spaceAbove = rect.top - 8;
            const openAbove = spaceBelow < popupH && spaceAbove > spaceBelow;
            let top = openAbove ? rect.top - Math.min(popupH, spaceAbove) - 4 : rect.bottom + 4;
            let left = rect.left;
            if (left + popupW > window.innerWidth) left = window.innerWidth - popupW - 8;
            if (left < 4) left = 4;
            $floating.css({ top: top + 'px', left: left + 'px', visibility: '', display: 'none' });
            $floating.slideDown(150);
            $floating.on('click', '.gi-kw-emoji-option, .gi-kw-custom-emoji-option', (ev) => {
                ev.stopPropagation();
                $btn.text($(ev.currentTarget).data('emoji'));
                $floating.slideUp(150, () => $floating.remove());
            });
            $floating.on('click', '.gi-kw-color-clear', (ev) => {
                ev.stopPropagation();
                $floating.find('.gi-kw-color-input').val('#ffffff');
                $btn.css(window.emojiTintCSS(null));
            });
            $floating.on('input', '.gi-kw-color-input', (ev) => {
                ev.stopPropagation();
                const c = $(ev.target).val();
                if (c && c !== '#ffffff') {
                    $btn.css(window.emojiTintCSS(c));
                } else {
                    $btn.css(window.emojiTintCSS(null));
                }
            });
            const fp = $floating.find('emoji-picker')[0];
            if (fp) fp.addEventListener('emoji-click', (ev) => {
                $btn.text(ev.detail.unicode);
                $floating.slideUp(150, () => $floating.remove());
            });
            setTimeout(() => {
                $(document).one('click.gi-icon-floating', (ev) => {
                    if ($(ev.target).closest('.gi-icon-popup-floating, .gi-kw-new-emoji-btn, .gi-kw-custom-emoji-btn').length) return;
                    $floating.slideUp(150, () => $floating.remove());
                });
            }, 10);
        };
        this.$overlay.on('click.gi', '.gi-kw-new-emoji-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            this._openKwEmojiPicker($(e.currentTarget), $(e.currentTarget).closest('.gi-kw-new-form').find('.gi-kw-new-emoji-picker'));
        });
        this.$overlay.on('click.gi', '.gi-kw-emoji-option', (e) => {
            e.stopPropagation();
            $(e.currentTarget).closest('.gi-kw-new-form').find('.gi-kw-new-emoji-btn').text($(e.currentTarget).data('emoji'));
            $('.gi-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
        });
        // Custom keyword entry (always at bottom)
        this.$overlay.on('click.gi', '.gi-kw-custom-add', (e) => {
            e.stopPropagation();
            const $form = $(e.currentTarget).closest('.gi-kw-custom-entry');
            const val = $form.find('.gi-kw-custom-name').val().trim();
            const emoji = $form.find('.gi-kw-custom-emoji-btn').text().trim() || '🏷️';
            const floatingColor = $('.gi-icon-popup-floating .gi-kw-color-input').val();
            const formColor = $form.find('.gi-kw-color-input').val();
            const colorInput = floatingColor || formColor;
            const color = (colorInput && colorInput !== '#ffffff') ? colorInput : null;
            if (val && !this.keywords.includes(val)) {
                this.keywords.push(val);
                this.customKwEmojis[val] = emoji;
                if (color) this.customKwColors[val] = color;
                api.saveCustomKeyword(val, emoji, true, color).then(() => this._loadCustomKeywords()).catch(e => console.error('Failed to save custom keyword:', e));
                this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
            }
            this.$overlay.find('.gi-kw-btn .expand-arrow').removeClass('expanded');
            this.$overlay.find('.gi-kw-dropdown').slideUp(150);
        });
        this.$overlay.on('click.gi', '.gi-kw-custom-emoji-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            this._openKwEmojiPicker($(e.currentTarget), $(e.currentTarget).closest('.gi-kw-custom-entry').find('.gi-kw-custom-emoji-picker'));
        });
        this.$overlay.on('click.gi', '.gi-kw-custom-emoji-option', (e) => {
            e.stopPropagation();
            $(e.currentTarget).closest('.gi-kw-custom-entry').find('.gi-kw-custom-emoji-btn').text($(e.currentTarget).data('emoji'));
            $('.gi-icon-popup-floating').slideUp(150, function () { $(this).remove(); });
        });
        this.$overlay.on('click.gi', '.gi-keyword-remove', (e) => {
            this.keywords.splice($(e.currentTarget).data('index'), 1);
            this.$overlay.find('.gi-keywords-tags').html(this._kwTagsHtml());
        });

        // Crafted toggle
        this.$overlay.on('change.gi', '#gi-crafted', (e) => {
            this._syncRows();
            this.isCrafted = $(e.target).is(':checked');
            if (this.isCrafted) {
                this.$overlay.find('.gi-rarity-row').slideUp(150);
                this.$overlay.find('.gi-value-row').slideUp(150);
                this.$overlay.find('.gi-quality-value-row').slideDown(150);
                if (!this.qualityStatRows['Normal'].length && this.statRows.length) this.qualityStatRows['Normal'] = [...this.statRows];
            } else {
                this.$overlay.find('.gi-rarity-row').slideDown(150);
                this.$overlay.find('.gi-value-row').slideDown(150);
                this.$overlay.find('.gi-quality-value-row').slideUp(150);
                if (!this.statRows.length && this.qualityStatRows['Normal'].length) this.statRows = [...this.qualityStatRows['Normal']];
            }
            this._rerenderStatArea();
        });

        // Duration slider (consumables only)
        const DURATION_STEPS = [0, 500, 750, 1000, 5000, 10000];
        this.$overlay.on('input.gi', '#gi-duration-slider', (e) => {
            const idx = parseInt($(e.target).val());
            this.duration = DURATION_STEPS[idx] !== undefined ? DURATION_STEPS[idx] : 1000;
            this.$overlay.find('#gi-duration-input').val(this.duration);
        });

        // Duration manual input
        this.$overlay.on('change.gi', '#gi-duration-input', (e) => {
            const val = parseInt($(e.target).val()) || 0;
            this.duration = Math.max(0, val);
            // Snap slider to nearest step
            let closest = 0;
            let minDist = Infinity;
            for (let i = 0; i < DURATION_STEPS.length; i++) {
                const dist = Math.abs(DURATION_STEPS[i] - this.duration);
                if (dist < minDist) { minDist = dist; closest = i; }
            }
            this.$overlay.find('#gi-duration-slider').val(closest);
        });

        // Quality tabs
        this.$overlay.on('click.gi', '.gi-quality-tab', (e) => {
            this._syncRows();
            // Save current quality's value before switching
            if (this.isCrafted) {
                this.qualityValues[this.activeQualityTab] = parseInt(this.$overlay.find('#gi-quality-value').val()) || 0;
            }
            // Save pet XP before switching
            if (this._isPetSlot()) {
                this.petXpRequirements[this.activeQualityTab] = parseInt(this.$overlay.find('#gi-pet-xp').val()) || 0;
            }
            this.activeQualityTab = $(e.currentTarget).data('quality');
            // Update active styling
            this.$overlay.find('.gi-quality-tab').each(function () {
                const q = $(this).data('quality');
                const isPetTab = self._isPetSlot();
                const r = QUALITY_TO_RARITY[q];
                const bc = isPetTab ? '#fff' : rarityBorderColor(r);
                const active = q === self.activeQualityTab;
                $(this).toggleClass('active', active).css('border', active ? `2px solid ${bc}` : '2px solid transparent');
            });
            // For input items, stats are always Normal — only switch value
            if (!this._isInputSlot()) {
                this.$overlay.find('.gi-stat-rows').html(this._statRowsHtml(this.qualityStatRows[this.activeQualityTab] || []));
            }
            // Load new quality's value
            this.$overlay.find('#gi-quality-value').val(this.qualityValues[this.activeQualityTab] || 0);
            // Load pet XP for new tab
            if (this._isPetSlot()) {
                this.$overlay.find('#gi-pet-xp').val(this.petXpRequirements[this.activeQualityTab] || 0);
                const maxLevelName = this.petHasLevel4 ? 'Level 4' : 'Level 3';
                // Hide stats on Egg tab, hide XP on max level tab
                if (this.activeQualityTab === 'Egg') {
                    this.$overlay.find('.gi-stats-section').slideUp(150);
                    this.$overlay.find('.gi-pet-xp-row').slideDown(150);
                } else if (this.activeQualityTab === maxLevelName) {
                    this.$overlay.find('.gi-stats-section').slideDown(150);
                    this.$overlay.find('.gi-pet-xp-row').slideUp(150);
                } else {
                    this.$overlay.find('.gi-stats-section').slideDown(150);
                    this.$overlay.find('.gi-pet-xp-row').slideDown(150);
                }
            }
            this._updateCopyFromButton();
        });

        // Add Level 4 button for pets
        this.$overlay.on('click.gi', '.gi-add-level4-btn', (e) => {
            e.preventDefault();
            this._syncRows();
            this.petXpRequirements[this.activeQualityTab] = parseInt(this.$overlay.find('#gi-pet-xp').val()) || 0;
            this.petHasLevel4 = true;
            this.qualityStatRows['Level 4'] = [];
            this._rerenderPetTabs();
        });

        // Remove Level 4 button for pets
        this.$overlay.on('click.gi', '.gi-remove-level4-btn', (e) => {
            e.preventDefault();
            this._syncRows();
            this.petXpRequirements[this.activeQualityTab] = parseInt(this.$overlay.find('#gi-pet-xp').val()) || 0;
            this.petHasLevel4 = false;
            delete this.qualityStatRows['Level 4'];
            delete this.petXpRequirements['Level 4'];
            if (this.activeQualityTab === 'Level 4') {
                this.activeQualityTab = 'Level 3';
            }
            this._rerenderPetTabs();
        });

        // Pet XP requirement handlers
        this.$overlay.on('click.gi', '.gi-add-pet-xp-req', (e) => {
            e.preventDefault();
            this.petXpReqRows.push({ type: '', value: '', not: false });
            this.$overlay.find('.gi-pet-xp-req-rows').html(this._petXpReqRowsHtml());
        });
        this.$overlay.on('click.gi', '.gi-pet-xp-req-remove', (e) => {
            const idx = parseInt($(e.currentTarget).data('row'));
            this.petXpReqRows.splice(idx, 1);
            this.$overlay.find('.gi-pet-xp-req-rows').html(this._petXpReqRowsHtml());
        });
        this.$overlay.on('click.gi', '.gi-pet-xp-type-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._petXpActiveRow;
            if (row !== undefined && this.petXpReqRows[row]) {
                this.petXpReqRows[row].type = val;
                this.petXpReqRows[row].value = '';
                this.$overlay.find('.gi-pet-xp-req-rows').html(this._petXpReqRowsHtml());
            }
        });
        this.$overlay.on('click.gi', '.gi-pet-xp-loc-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._petXpActiveRow;
            if (row !== undefined && this.petXpReqRows[row]) {
                this.petXpReqRows[row].value = val;
                this.$overlay.find('.gi-pet-xp-req-rows').html(this._petXpReqRowsHtml());
            }
        });
        this.$overlay.on('click.gi', '.gi-pet-xp-skill-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._petXpActiveRow;
            if (row !== undefined && this.petXpReqRows[row]) {
                this.petXpReqRows[row].value = val;
                this.$overlay.find('.gi-pet-xp-req-rows').html(this._petXpReqRowsHtml());
            }
        });
        this.$overlay.on('change.gi', '.gi-pet-xp-not', (e) => {
            const row = parseInt($(e.currentTarget).data('row'));
            this.petXpReqRows[row].not = $(e.currentTarget).is(':checked');
        });
        // Toggle pet XP req dropdowns — use floating dropdown pattern
        this.$overlay.on('click.gi', '.gi-pet-xp-type-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._petXpActiveRow = parseInt($btn.data('row'));
            const $dd = $btn.siblings('.gi-pet-xp-type-dd');
            this._positionFixedDropdown($btn, $dd);
        });
        this.$overlay.on('click.gi', '.gi-pet-xp-loc-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._petXpActiveRow = parseInt($btn.data('row'));
            const $dd = $btn.siblings('.gi-pet-xp-loc-dd');
            this._positionFixedDropdown($btn, $dd);
        });
        this.$overlay.on('click.gi', '.gi-pet-xp-skill-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._petXpActiveRow = parseInt($btn.data('row'));
            const $dd = $btn.siblings('.gi-pet-xp-skill-dd');
            this._positionFixedDropdown($btn, $dd);
        });

        // Copy from... button and dropdown
        this.$overlay.on('click.gi', '.gi-copy-from-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const $dd = $btn.siblings('.gi-copy-from-dd');
            if ($dd.is(':visible')) { $dd.slideUp(150); } else { $dd.slideDown(150); }
        });
        this.$overlay.on('click.gi', '.gi-copy-from-item', (e) => {
            e.stopPropagation();
            const sourceQuality = $(e.currentTarget).data('value');
            this._syncRows();
            const sourceRows = this.qualityStatRows[sourceQuality] || [];
            if (!sourceRows.length && !this.qualityValues[sourceQuality]) {
                api.showInfo(`${sourceQuality} has no stats or value to copy.`);
                this.$overlay.find('.gi-copy-from-dd').slideUp(150);
                return;
            }
            // Deep copy source rows and append to current quality (keeping existing)
            const copied = sourceRows.map(r => ({ ...r }));
            this.qualityStatRows[this.activeQualityTab] = [
                ...(this.qualityStatRows[this.activeQualityTab] || []),
                ...copied
            ];
            // Copy value too
            if (this.qualityValues[sourceQuality]) {
                this.qualityValues[this.activeQualityTab] = this.qualityValues[sourceQuality];
                this.$overlay.find('#gi-quality-value').val(this.qualityValues[this.activeQualityTab]);
            }
            this.$overlay.find('.gi-stat-rows').html(this._statRowsHtml(this.qualityStatRows[this.activeQualityTab]));
            this.$overlay.find('.gi-copy-from-dd').slideUp(150);
            api.showSuccess(`Copied ${copied.length} stat(s) from ${sourceQuality}.`);
        });

        // Copy to all qualities button
        this.$overlay.on('click.gi', '.gi-copy-to-all-btn', (e) => {
            e.stopPropagation();
            this._syncRows();
            // Save current quality's value
            if (this.isCrafted) {
                this.qualityValues[this.activeQualityTab] = parseInt(this.$overlay.find('#gi-quality-value').val()) || 0;
            }
            const currentRows = this.qualityStatRows[this.activeQualityTab] || [];
            const currentValue = this.qualityValues[this.activeQualityTab] || 0;
            if (!currentRows.length && !currentValue) {
                api.showInfo(`${this.activeQualityTab} has no stats or value to copy.`);
                return;
            }
            const qualityNames = this._getQualityNames();
            let count = 0;
            for (const q of qualityNames) {
                if (q === this.activeQualityTab) continue;
                const copied = currentRows.map(r => ({ ...r }));
                this.qualityStatRows[q] = [...(this.qualityStatRows[q] || []), ...copied];
                if (currentValue) this.qualityValues[q] = currentValue;
                count++;
            }
            api.showSuccess(`Copied ${currentRows.length} stat(s) + value from ${this.activeQualityTab} to ${count} other qualities.`);
        });

        // Stat row skill/location custom dropdowns
        this.$overlay.on('click.gi', '.gi-stat-skill-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-stat-skill-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-stat-skill-dd .gi-dd-item', (e) => {
            e.stopPropagation();
            const $cell = $(e.currentTarget).closest('.gi-stat-skill-cell');
            const val = $(e.currentTarget).data('value');
            $cell.find('.gi-stat-skill').val(val);
            $cell.find('.gi-dd-value').html(this._skillDisplay(val));
            $cell.find('.gi-stat-skill-dd').slideUp(150);
        });
        this.$overlay.on('click.gi', '.gi-stat-loc-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-stat-loc-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-stat-loc-dd .gi-loc-item', (e) => {
            e.stopPropagation();
            const $cell = $(e.currentTarget).closest('.gi-stat-loc-cell');
            const val = $(e.currentTarget).data('value');
            $cell.find('.gi-stat-location').val(val);
            $cell.find('.gi-dd-value').html(this._locationDisplay(val));
            $cell.find('.gi-stat-loc-dd').slideUp(150);
        });
        // Location group collapse/expand (works in both inline and floating dropdowns)
        this.$overlay.on('click.gi', '.gi-loc-group-header', (e) => {
            e.stopPropagation();
            const group = $(e.currentTarget).data('group');
            const $items = $(e.currentTarget).siblings(`.gi-loc-group-items[data-group="${group}"]`);
            $items.slideToggle(150);
            $(e.currentTarget).find('.expand-arrow').toggleClass('expanded');
        });

        // Stat type custom dropdown
        this.$overlay.on('click.gi', '.gi-stat-type-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-stat-type-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-stat-type-dd .gi-dd-item', (e) => {
            e.stopPropagation();
            const $cell = $(e.currentTarget).closest('.gi-stat-type-cell');
            const val = $(e.currentTarget).data('value');
            $cell.find('.gi-stat-type').val(val);
            $cell.find('.gi-dd-value').html(this._statTypeDisplay(val));
            $cell.find('.gi-stat-type-dd').slideUp(150);
        });

        // Add/remove stat rows
        this.$overlay.on('click.gi', '.gi-add-stat', (e) => {
            e.preventDefault();
            this._syncRows();
            const nr = { skill: 'global', location: 'global', type: 'work_efficiency', value: 0 };
            if (this.isCrafted) this.qualityStatRows[this.activeQualityTab].push(nr);
            else this.statRows.push(nr);
            const rows = this.isCrafted ? this.qualityStatRows[this.activeQualityTab] : this.statRows;
            this.$overlay.find('.gi-stat-rows').html(this._statRowsHtml(rows));
            this.$overlay.find('.gi-stat-row').last().hide().slideDown(150, () => {
                // Smooth scroll popup to bottom after new row animates in
                const $popup = this.$overlay.find('.generic-item-popup');
                $popup.animate({ scrollTop: $popup[0].scrollHeight }, 200);
            });
        });
        this.$overlay.on('click.gi', '.gi-stat-remove', (e) => {
            e.preventDefault();
            // Don't handle removes inside gated stat rows — those have their own handler
            if ($(e.currentTarget).closest('.gi-gated-row').length) return;
            const $row = $(e.currentTarget).closest('.gi-stat-row');
            const idx = $row.data('index');
            $row.slideUp(150, () => {
                this._syncRows();
                if (this.isCrafted) this.qualityStatRows[this.activeQualityTab].splice(idx, 1);
                else this.statRows.splice(idx, 1);
                const rows = this.isCrafted ? this.qualityStatRows[this.activeQualityTab] : this.statRows;
                this.$overlay.find('.gi-stat-rows').html(this._statRowsHtml(rows));
            });
        });

        // Gated stats: add/remove
        this.$overlay.on('click.gi', '.gi-add-gated', (e) => {
            e.preventDefault();
            this._syncGatedStats();
            const existingCount = this.$overlay.find('.gi-gated-row').length;
            const newRow = { gateType: 'achievement_points', threshold: 0, skill: 'global', location: 'global', stat: 'work_efficiency', value: 0 };
            const newHtml = this._gatedRowHtml(newRow, existingCount);
            const $new = $(newHtml).hide();
            this.$overlay.find('.gi-gated-entries').append($new);
            $new.slideDown(150);
        });
        this.$overlay.on('click.gi', '.gi-gated-remove', (e) => {
            e.preventDefault();
            const $row = $(e.currentTarget).closest('.gi-gated-row');
            $row.slideUp(150, () => {
                $row.remove();
                this._syncGatedStats();
            });
        });

        // Gated stat dropdown buttons — use _positionFixedDropdown
        this.$overlay.on('click.gi', '.gi-gated-skill-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._gatedActiveRow = parseInt($btn.data('row'));
            this._positionFixedDropdown($btn, $btn.siblings('.gi-gated-skill-dd'));
        });
        this.$overlay.on('click.gi', '.gi-gated-skill-item, .gi-gated-skill-dd .gi-skill-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            $row.find('.gi-gated-skill-btn .gi-dd-value').html(this._skillDisplay(val));
            $row.find('.gi-gated-skill-val').val(val);
        });
        this.$overlay.on('click.gi', '.gi-gated-loc-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._gatedActiveRow = parseInt($btn.data('row'));
            this._positionFixedDropdown($btn, $btn.siblings('.gi-gated-loc-dd'));
        });
        this.$overlay.on('click.gi', '.gi-gated-loc-item, .gi-gated-loc-dd .gi-loc-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            $row.find('.gi-gated-loc-btn .gi-dd-value').html(this._locationDisplay(val));
            $row.find('.gi-gated-loc-val').val(val);
        });
        this.$overlay.on('click.gi', '.gi-gated-stat-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._gatedActiveRow = parseInt($btn.data('row'));
            this._positionFixedDropdown($btn, $btn.siblings('.gi-gated-stat-dd'));
        });
        this.$overlay.on('click.gi', '.gi-gated-stat-item, .gi-gated-stat-dd .gi-dd-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            $row.find('.gi-gated-stat-btn .gi-dd-value').html(this._statTypeDisplay(val));
            $row.find('.gi-gated-stat-val').val(val);
        });
        this.$overlay.on('click.gi', '.gi-gated-type-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._gatedActiveRow = parseInt($btn.data('row'));
            this._positionFixedDropdown($btn, $btn.siblings('.gi-gated-type-dd'));
        });
        this.$overlay.on('click.gi', '.gi-gated-type-item', (e) => {
            const newType = $(e.currentTarget).data('value');
            const row = this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            if (!$row.length) return;
            // Read current stat values directly from this row's hidden inputs
            const currentRow = {
                gateType: newType,
                skill: $row.find('.gi-gated-skill-val').val() || 'global',
                location: $row.find('.gi-gated-loc-val').val() || 'global',
                stat: $row.find('.gi-gated-stat-val').val() || 'work_efficiency',
                value: parseFloat($row.find('.gi-gated-value').val()) || 0,
                // Reset type-specific fields for the new gate type
                threshold: 0, keyword: '', count: 1, gateSkill: '', itemName: '', activityName: '',
            };
            // Replace just this row's HTML
            $row.replaceWith(this._gatedRowHtml(currentRow, row));
            // Re-sync all gated stats from DOM
            this._syncGatedStats();
        });
        this.$overlay.on('click.gi', '.gi-gated-gate-skill-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._gatedActiveRow = parseInt($btn.data('row'));
            this._positionFixedDropdown($btn, $btn.siblings('.gi-gated-gate-skill-dd'));
        });
        this.$overlay.on('click.gi', '.gi-gated-gate-skill-item, .gi-gated-gate-skill-dd .gi-skill-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            $row.find('.gi-gated-gate-skill-btn .gi-dd-value').html(this._skillDisplay(val));
            $row.find('.gi-gated-gate-skill-val').val(val);
        });
        // Gated keyword dropdown (set_pieces)
        this.$overlay.on('click.gi', '.gi-gated-kw-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._gatedActiveRow = parseInt($btn.data('row'));
            this._positionFixedDropdown($btn, $btn.siblings('.gi-gated-kw-dd'));
        });
        this.$overlay.on('click.gi', '.gi-gated-kw-item', (e) => {
            const val = $(e.currentTarget).data('value');
            const row = this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            $row.find('.gi-gated-kw-btn .gi-dd-value').html(`${kwIcon(val)} ${val}`);
            $row.find('.gi-gated-keyword-val').val(val);
        });
        // Gated keyword custom add
        this.$overlay.on('click.gi', '.gi-gated-kw-custom-add', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $entry = $(e.currentTarget).closest('.gi-gated-kw-custom-entry');
            const name = $entry.find('.gi-gated-kw-custom-name').val().trim();
            if (!name) return;
            const row = $(e.currentTarget).data('row') ?? this._gatedActiveRow;
            const $row = this.$overlay.find(`.gi-gated-row[data-index="${row}"]`);
            $row.find('.gi-gated-kw-btn .gi-dd-value').html(`🏷️ ${name}`);
            $row.find('.gi-gated-keyword-val').val(name);
            // Close floating dropdown
            $('.gi-floating-dd').slideUp(150, function () { $(this).remove(); });
            if (this._floatingOpenBtn) {
                this._floatingOpenBtn.removeData('gi-dd-open');
                this._floatingOpenBtn.find('.expand-arrow').removeClass('expanded');
                this._floatingOpenBtn = null;
            }
            $(document).off('click.gi-floating');
        });

        // Save / Delete
        this.$overlay.on('click.gi', '.btn-save-item', (e) => { e.preventDefault(); this.save(); });
        this.$overlay.on('click.gi', '.btn-delete-item', (e) => { e.preventDefault(); this.delete(); });

        // Advanced section toggle
        this.$overlay.on('click.gi', '.gi-advanced-header', (e) => {
            e.stopPropagation();
            const $header = $(e.currentTarget);
            const $content = $header.siblings('.gi-advanced-content');
            const $arrow = $header.find('.expand-arrow');
            if ($content.is(':visible')) {
                $arrow.removeClass('expanded');
                $content.slideUp(150);
            } else {
                $arrow.addClass('expanded');
                $content.slideDown(150);
            }
        });

        // Requirements
        this.$overlay.on('click.gi', '.gi-add-req', (e) => {
            e.preventDefault();
            this._syncRequirements();
            this.requirementRows.push({ type: '' });
            this.$overlay.find('.gi-req-rows').html(this._reqRowsHtml());
            this.$overlay.find('.gi-req-row').last().hide().slideDown(150);
        });
        this.$overlay.on('click.gi', '.gi-req-remove', (e) => {
            e.preventDefault();
            const $row = $(e.currentTarget).closest('.gi-req-row');
            const idx = $row.data('index');
            $row.slideUp(150, () => {
                this._syncRequirements();
                this.requirementRows.splice(idx, 1);
                this.$overlay.find('.gi-req-rows').html(this._reqRowsHtml());
            });
        });
        this.$overlay.on('change.gi', '.gi-req-type', (e) => {
            this._syncRequirements();
            this.$overlay.find('.gi-req-rows').html(this._reqRowsHtml());
        });
        // Requirement type custom dropdown
        this.$overlay.on('click.gi', '.gi-req-type-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-req-type-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-req-type-item', (e) => {
            e.stopPropagation();
            const val = $(e.currentTarget).data('value');
            const $cell = $(e.currentTarget).closest('.gi-req-type-cell');
            $cell.find('.gi-req-type').val(val);
            $cell.find('.gi-req-type-dd').slideUp(150);
            // Re-render requirements to show the right fields for the new type
            this._syncRequirements();
            // Update the type in the synced data
            const idx = $(e.currentTarget).closest('.gi-req-row').data('index');
            if (idx !== undefined && this.requirementRows[idx]) {
                this.requirementRows[idx].type = val;
            }
            this.$overlay.find('.gi-req-rows').html(this._reqRowsHtml());
        });
        // Requirement faction custom dropdown
        this.$overlay.on('click.gi', '.gi-req-faction-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-req-faction-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-req-faction-item', (e) => {
            e.stopPropagation();
            const $cell = $(e.currentTarget).closest('.gi-req-faction-cell');
            const val = $(e.currentTarget).data('value');
            const label = val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            $cell.find('.gi-req-faction').val(val);
            $cell.find('.gi-dd-value').text(label);
            $cell.find('.gi-req-faction-dd').slideUp(150);
        });
        // Requirement category custom dropdown (for category_level_percent)
        this.$overlay.on('click.gi', '.gi-req-cat-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-req-cat-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-req-cat-item', (e) => {
            e.stopPropagation();
            const $cell = $(e.currentTarget).closest('.gi-req-cat-cell');
            const val = $(e.currentTarget).data('value');
            const label = val.charAt(0).toUpperCase() + val.slice(1);
            $cell.find('.gi-req-category').val(val);
            $cell.find('.gi-dd-value').text(label);
            $cell.find('.gi-req-cat-dd').slideUp(150);
        });
        // Requirement skill custom dropdown
        this.$overlay.on('click.gi', '.gi-req-skill-btn', (e) => {
            e.stopPropagation();
            const $dd = $(e.currentTarget).siblings('.gi-req-skill-dd');
            this._positionFixedDropdown($(e.currentTarget), $dd);
        });
        this.$overlay.on('click.gi', '.gi-req-skill-item', (e) => {
            e.stopPropagation();
            const $cell = $(e.currentTarget).closest('.gi-req-skill-cell');
            const val = $(e.currentTarget).data('value');
            const name = val.charAt(0).toUpperCase() + val.slice(1);
            $cell.find('.gi-req-skill').val(val);
            $cell.find('.gi-dd-value').html(`${skillIcon(name)} ${name}`);
            $cell.find('.gi-req-skill-dd').slideUp(150);
        });

        // Close all dropdowns when clicking on the body (but not on a dropdown itself)
        this.$overlay.on('click.gi', '.gi-body', (e) => {
            const $t = $(e.target);
            // Don't close if clicking inside any dropdown-related element
            if ($t.closest('.gi-dd-button, .gi-dd-dropdown, .gi-saved-button, .gi-saved-dropdown, .gi-kw-dropdown, .gi-kw-btn, .gi-slot-btn, .gi-rarity-btn, .gi-kw-selector, .gi-saved-selector, .gi-slot-selector, .gi-rarity-row, .gi-floating-dd, .gi-icon-popup, .gi-icon-btn, .gi-advanced-header, .gi-copy-from-row, .gi-kw-new-emoji-picker, .gi-kw-custom-emoji-picker, .gi-kw-new-emoji-btn, .gi-kw-custom-emoji-btn').length) return;
            this._closeAllDropdowns();
        });

        // Arrow key navigation for inline dropdowns (slot, rarity, keyword items)
        this.$overlay.on('keydown.gi', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') return;
            // Find the first visible inline dropdown
            const $visibleDd = this.$overlay.find('.gi-slot-dropdown:visible, .gi-rarity-dropdown:visible');
            if (!$visibleDd.length) return;
            e.preventDefault();
            if (e.key === 'Escape') { this._closeAllDropdowns(); return; }
            const $items = $visibleDd.find('.gi-dd-item');
            if (!$items.length) return;
            const $active = $items.filter('.keyboard-active');
            let idx = $active.length ? $items.index($active) : -1;
            if (e.key === 'ArrowDown') {
                $items.removeClass('keyboard-active');
                idx = idx < $items.length - 1 ? idx + 1 : 0;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                $items.removeClass('keyboard-active');
                idx = idx > 0 ? idx - 1 : $items.length - 1;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && $active.length) {
                $active.trigger('click');
            }
        });

        // Show copy-from button on initial render if crafted
        this._updateCopyFromButton();
    }

    // Close ALL dropdowns in the form (inline + floating) and reset all arrows
    _closeAllDropdowns() {
        if (!this.$overlay) return;
        // Slide up all inline dropdowns
        this.$overlay.find('.gi-saved-dropdown, .gi-slot-dropdown, .gi-kw-dropdown, .gi-rarity-dropdown').stop(true, true).slideUp(150);
        this.$overlay.find('.gi-stat-skill-dd, .gi-stat-loc-dd, .gi-stat-type-dd, .gi-req-skill-dd, .gi-req-type-dd, .gi-req-faction-dd').stop(true, true).slideUp(150);
        // Close icon popup and emoji pickers
        this.$overlay.find('.gi-icon-popup, .gi-kw-new-emoji-picker, .gi-kw-custom-emoji-picker, .gi-copy-from-dd').stop(true, true).slideUp(150);
        // Remove floating icon popup from body
        $('.gi-icon-popup-floating').stop(true, true).slideUp(150, function () { $(this).remove(); });
        $(document).off('click.gi-icon-floating');
        // Remove floating dropdowns with animation
        $('.gi-floating-dd').stop(true, true).slideUp(150, function () { $(this).remove(); });
        // Remove stale outside-click handler
        $(document).off('click.gi-floating');
        // Reset ALL arrows
        this.$overlay.find('.expand-arrow').removeClass('expanded');
        // Clear floating open state
        if (this._floatingOpenBtn) {
            this._floatingOpenBtn.removeData('gi-dd-open');
            this._floatingOpenBtn = null;
        }
    }

    // Toggle a simple (non-floating) dropdown with arrow animation
    _toggleDropdown($btn, $dd, openCallback) {
        const isOpen = $dd.is(':visible');
        // Close everything else first (instant)
        this._closeAllDropdowns();
        if (isOpen) {
            // Was open — animate closed
            $btn.find('.expand-arrow').removeClass('expanded');
            $dd.stop(true, true).slideUp(150);
            return;
        }
        // Open this one
        const $arrow = $btn.find('.expand-arrow');
        $arrow.addClass('expanded');
        if (openCallback) openCallback();
        $dd.slideDown(150);
    }

    _positionFixedDropdown($btn, $dd) {
        const wasOpen = $btn.data('gi-dd-open');
        // Close everything else first (instant)
        this._closeAllDropdowns();
        if (wasOpen) {
            return null;
        }

        const rect = $btn[0].getBoundingClientRect();
        const $floating = $('<div class="gi-floating-dd gi-dd-dropdown" tabindex="-1"></div>');
        $floating.html($dd.html());
        $floating.css({
            position: 'fixed',
            left: rect.left + 'px',
            top: (rect.bottom + 2) + 'px',
            width: Math.max(rect.width, 200) + 'px',
            'max-height': '250px',
            'overflow-y': 'auto',
            'overflow-x': 'hidden',
            'z-index': 99999,
            'padding': '4px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            'border-radius': '6px',
            'box-shadow': '0 4px 16px rgba(0,0,0,0.4)',
        });
        $('body').append($floating);
        $floating.hide().slideDown(150, () => $floating.focus());
        $btn.data('gi-dd-open', true);
        this._floatingOpenBtn = $btn;
        $btn.find('.expand-arrow').addClass('expanded');

        // Arrow key navigation inside floating dropdown
        $floating.on('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') return;
            // Don't intercept arrow keys in search inputs
            if ($(e.target).is('input[type="text"]') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') {
                $floating.slideUp(150, () => $floating.remove());
                $btn.data('gi-dd-open', false);
                $btn.find('.expand-arrow').removeClass('expanded');
                return;
            }
            const $items = $floating.find('.gi-dd-item:visible, .gi-loc-item:visible, .gi-req-type-item:visible, .gi-req-faction-item:visible, .gi-req-skill-item:visible, .gi-req-cat-item:visible, .gi-pet-xp-type-item:visible, .gi-pet-xp-loc-item:visible, .gi-pet-xp-skill-item:visible, .gi-gated-skill-item:visible, .gi-gated-loc-item:visible, .gi-gated-stat-item:visible, .gi-gated-type-item:visible, .gi-gated-gate-skill-item:visible, .gi-gated-kw-item:visible, .gi-skill-item:visible');
            if (!$items.length) return;
            const $active = $items.filter('.keyboard-active');
            let idx = $active.length ? $items.index($active) : -1;
            if (e.key === 'ArrowDown') {
                $items.removeClass('keyboard-active');
                idx = idx < $items.length - 1 ? idx + 1 : 0;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                $items.removeClass('keyboard-active');
                idx = idx > 0 ? idx - 1 : $items.length - 1;
                $items.eq(idx).addClass('keyboard-active');
                $items.eq(idx)[0]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && $active.length) {
                $active.trigger('click');
            }
        });

        // Location group collapse/expand in floating dropdown
        $floating.on('click', '.gi-loc-group-header', (e) => {
            e.stopPropagation();
            const group = $(e.currentTarget).data('group');
            const $items = $(e.currentTarget).siblings(`.gi-loc-group-items[data-group="${group}"]`);
            $items.slideToggle(150);
            $(e.currentTarget).find('.expand-arrow').toggleClass('expanded');
        });

        // Stat type group collapse/expand in floating dropdown
        $floating.on('click', '.gi-stat-type-group-header', (e) => {
            e.stopPropagation();
            const group = $(e.currentTarget).data('group');
            const $items = $(e.currentTarget).siblings(`.gi-stat-type-group-items[data-group="${group}"]`);
            $items.slideToggle(150);
            $(e.currentTarget).find('.expand-arrow').toggleClass('expanded');
        });

        // Stat type search in floating dropdown
        $floating.on('input', '.gi-stat-type-search', (e) => {
            e.stopPropagation();
            const q = $(e.target).val().toLowerCase();
            const $list = $floating.find('.gi-stat-type-list');
            // Filter base stats
            $list.find('.gi-dd-item').each(function () {
                const label = $(this).text().toLowerCase();
                $(this).toggle(!q || label.includes(q));
            });
            // Show/hide item finding group based on search
            const $groupHeader = $list.find('.gi-stat-type-group-header');
            const $groupItems = $list.find('.gi-stat-type-group-items');
            if (q) {
                // Expand and filter item finding items
                $groupItems.show();
                $groupHeader.find('.expand-arrow').addClass('expanded');
                let anyMatch = false;
                $groupItems.find('.gi-dd-item').each(function () {
                    const label = $(this).text().toLowerCase();
                    const match = label.includes(q);
                    $(this).toggle(match);
                    if (match) anyMatch = true;
                });
                $groupHeader.toggle(anyMatch);
            } else {
                // Collapse item finding, show header
                $groupItems.hide();
                $groupHeader.show();
                $groupHeader.find('.expand-arrow').removeClass('expanded');
                $groupItems.find('.gi-dd-item').show();
            }
        });
        // Focus search input after floating dropdown opens
        setTimeout(() => {
            const $search = $floating.find('.gi-stat-type-search, .gi-gated-kw-search');
            if ($search.length) $search.first().focus();
        }, 160);

        // Gated keyword search in floating dropdown
        $floating.on('input', '.gi-gated-kw-search', (e) => {
            e.stopPropagation();
            const q = $(e.target).val().toLowerCase();
            $floating.find('.gi-gated-kw-item').each(function () {
                $(this).toggle(!q || $(this).text().toLowerCase().includes(q));
            });
        });

        // Click events on floating items trigger original items
        $floating.on('click', '.gi-dd-item, .gi-loc-item, .gi-req-type-item, .gi-req-faction-item, .gi-req-cat-item, .gi-req-skill-item, .gi-pet-xp-type-item, .gi-pet-xp-loc-item, .gi-pet-xp-skill-item, .gi-gated-skill-item, .gi-gated-loc-item, .gi-gated-stat-item, .gi-gated-type-item, .gi-gated-gate-skill-item, .gi-gated-kw-item, .gi-skill-item', (e) => {
            e.stopPropagation();
            const val = $(e.currentTarget).data('value');
            const classes = e.currentTarget.className;
            // Find the matching item class to proxy to
            const selectors = ['.gi-dd-item', '.gi-loc-item', '.gi-req-type-item', '.gi-req-faction-item', '.gi-req-cat-item', '.gi-req-skill-item', '.gi-pet-xp-type-item', '.gi-pet-xp-loc-item', '.gi-pet-xp-skill-item', '.gi-gated-skill-item', '.gi-gated-loc-item', '.gi-gated-stat-item', '.gi-gated-type-item', '.gi-gated-gate-skill-item', '.gi-gated-kw-item', '.gi-skill-item'];
            for (const sel of selectors) {
                if ($(e.currentTarget).is(sel)) {
                    $dd.find(sel).each(function () {
                        if ($(this).data('value') === val) {
                            $(this).trigger('click');
                            return false;
                        }
                    });
                    break;
                }
            }
            $floating.slideUp(150, () => $floating.remove());
            $btn.removeData('gi-dd-open');
            this._floatingOpenBtn = null;
            $btn.find('.expand-arrow').removeClass('expanded');
        });

        // Close on outside click
        setTimeout(() => {
            $(document).one('click.gi-floating', (ev) => {
                // Don't close if clicking inside the emoji picker (it floats above the dropdown)
                if ($(ev.target).closest('.gi-icon-popup-floating, .gi-kw-new-emoji-btn, .gi-kw-custom-emoji-btn').length) {
                    // Re-attach the handler since .one() consumed it
                    setTimeout(() => {
                        $(document).one('click.gi-floating', () => {
                            $floating.slideUp(150, () => $floating.remove());
                            $btn.removeData('gi-dd-open');
                            this._floatingOpenBtn = null;
                            $btn.find('.expand-arrow').removeClass('expanded');
                        });
                    }, 10);
                    return;
                }
                $floating.slideUp(150, () => $floating.remove());
                $btn.removeData('gi-dd-open');
                this._floatingOpenBtn = null;
                $btn.find('.expand-arrow').removeClass('expanded');
            });
        }, 10);

        return $floating;
    }

    /**
     * Show/update the "Copy from..." button+dropdown between quality tabs and stat rows
     */
    _updateCopyFromButton() {
        if (!this.$overlay) return;
        this.$overlay.find('.gi-copy-from-row').remove();
        if (!this.isCrafted) return;
        // Don't show copy buttons on Egg tab (no stats to copy)
        if (this._isPetSlot() && this.activeQualityTab === 'Egg') return;
        const qualityNames = this._getQualityNames();
        const otherQualities = qualityNames.filter(q => q !== this.activeQualityTab);
        const isPet = this._isPetSlot();
        const opts = otherQualities.map(q => {
            if (q === 'Egg') return ''; // Don't offer copying from Egg (no stats)
            const r = QUALITY_TO_RARITY[q] || 'common';
            const c = isPet ? (q === 'Egg' ? '#8B7355' : '#4a7c59') : (q === 'Fine' ? 'var(--rarity-fine)' : rarityColor(r));
            return `<div class="gi-dd-item gi-copy-from-item" data-value="${q}" style="background:${c};color:#fff">${q}</div>`;
        }).filter(Boolean).join('');
        const html = `<div class="gi-copy-from-row">
            <button class="gi-copy-from-btn optimize-btn" style="width:auto;padding:4px 14px;font-size:12px">📋 Copy from…</button>
            <div class="gi-copy-from-dd gi-dd-dropdown" style="display:none">${opts}</div>
            <button class="gi-copy-to-all-btn optimize-btn" style="width:auto;padding:4px 14px;font-size:12px">📋 Copy to all</button>
        </div>`;
        // Insert after quality tabs, before quality value row
        const $tabs = this.$overlay.find('.gi-quality-tabs');
        if ($tabs.length) {
            $tabs.after(html);
        } else {
            this.$overlay.find('.gi-quality-value-row').before(html);
        }
    }

    _rerenderStatArea() {
        if (!this.$overlay) return;
        this.$overlay.find('.gi-quality-tabs').remove();
        this.$overlay.find('.gi-copy-from-row').remove();
        if (this.isCrafted) {
            const qualityNames = this._getQualityNames();
            const isPet = this._isPetSlot();
            let html;
            if (isPet) {
                html = `<div class="gi-quality-tabs">${qualityNames.map(q => {
                    const c = q === 'Egg' ? '#8B7355' : '#4a7c59';
                    const active = q === this.activeQualityTab;
                    return `<button class="gi-quality-tab ${active ? 'active' : ''}" data-quality="${q}" style="background:${c};color:#fff;border:2px solid ${active ? '#fff' : 'transparent'}">${q}</button>`;
                }).join('')}${!this.petHasLevel4
                    ? '<button class="gi-add-level4-btn optimize-btn" style="padding:4px 10px;font-size:12px;margin-left:4px">+ Lv 4</button>'
                    : '<button class="gi-remove-level4-btn optimize-btn" style="padding:4px 10px;font-size:12px;margin-left:4px;background:#e53935">- Lv 4</button>'
                    }</div>`;
            } else {
                html = `<div class="gi-quality-tabs">${qualityNames.map(q => {
                    const r = QUALITY_TO_RARITY[q] || 'common';
                    const c = q === 'Fine' ? 'var(--rarity-fine)' : rarityColor(r);
                    const bc = rarityBorderColor(r);
                    const active = q === this.activeQualityTab;
                    return `<button class="gi-quality-tab ${active ? 'active' : ''}" data-quality="${q}" style="background:${c};color:#fff;border:2px solid ${active ? bc : 'transparent'}">${q}</button>`;
                }).join('')}</div>`;
            }
            // Insert after duration row (which is before tabs for consumables)
            const $duration = this.$overlay.find('.gi-duration-row');
            $duration.after(html);
        }
        const rows = this.isCrafted ? (this.qualityStatRows[this.activeQualityTab] || []) : this.statRows;
        this.$overlay.find('.gi-stat-rows').html(this._statRowsHtml(rows));
        this._updateCopyFromButton();
    }

    /**
     * Re-render pet level tabs and update stats/XP for current tab.
     */
    _rerenderPetTabs() {
        if (!this.$overlay) return;
        this._rerenderStatArea();
        // Update XP field
        this.$overlay.find('#gi-pet-xp').val(this.petXpRequirements[this.activeQualityTab] || 0);
        // Determine max level name
        const maxLevelName = this.petHasLevel4 ? 'Level 4' : 'Level 3';
        // Show/hide stats and XP based on tab
        if (this.activeQualityTab === 'Egg') {
            this.$overlay.find('.gi-stats-section').hide();
            this.$overlay.find('.gi-pet-xp-row').show();
        } else if (this.activeQualityTab === maxLevelName) {
            this.$overlay.find('.gi-stats-section').show();
            this.$overlay.find('.gi-pet-xp-row').hide();
        } else {
            this.$overlay.find('.gi-stats-section').show();
            this.$overlay.find('.gi-pet-xp-row').show();
        }
    }
}

const genericItemForm = new GenericItemForm();
export default genericItemForm;
