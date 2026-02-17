/**
 * SkillSection component
 * 
 * Displays skills organized by category (Gathering, Artisan, Utility)
 * with editable level inputs, plus Achievement Points and Currency.
 * 
 * Features:
 * - Three skill categories with level totals
 * - Individual skill rows with icons and editable levels
 * - Draggable border ring to adjust XP within current level
 * - Input validation (1-99 for skills)
 * - AP and Currency rows with editable fields
 * - State updates on value changes
 * - User overrides persist across reloads
 */

import CollapsibleSection from './collapsible.js';
import store from '../state.js';

class SkillSection extends CollapsibleSection {
    /**
     * Create a Skills & AP section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {Array} props.skills - Array of skill definitions from API
     * @param {Object} props.byCategory - Skills grouped by category
     */
    constructor(element, { skills, byCategory }) {
        // Initialize with collapsible section properties
        super(element, {
            title: 'Skills & AP',
            icon: '/assets/icons/text/general_icons/skills.svg',
            count: '',
            defaultExpanded: true
        });

        // Set properties after super() call
        this.skills = skills || [];
        this.byCategory = byCategory || { Gathering: [], Artisan: [], Utility: [] };

        // Subscribe to character state changes
        // Use a lightweight update that only changes totals, not full re-render
        this.subscribe('character', () => this.updateTotals());

        // Do a full render now that properties are set
        this.render();
        this.attachEvents();
    }

    /**
     * Update input values and category totals (called when character data changes)
     */
    updateTotals() {
        const character = store.state.character || {};
        const overrides = store.state.ui.user_overrides || {};

        // Use overrides if they exist, otherwise fall back to character data
        // Check for undefined specifically (not falsy, since 0 is valid)
        const getSkillLevel = (skillId) => {
            if (overrides.skills && overrides.skills[skillId] !== undefined) {
                return overrides.skills[skillId];
            }
            return character.skills?.[skillId] || 1;
        };

        const achievementPoints = overrides.achievement_points !== undefined
            ? overrides.achievement_points
            : (character.achievement_points || 0);

        const coins = overrides.coins !== undefined
            ? overrides.coins
            : (character.coins || 0);

        // Update skill input values
        this.$element.find('.skill-level-input[data-skill]').each((i, input) => {
            const $input = $(input);
            const skillId = $input.data('skill');
            const level = getSkillLevel(skillId);
            $input.val(level);
        });

        // Update AP input
        this.$element.find('.ap-input').val(achievementPoints);

        // Update currency input
        this.$element.find('.currency-input').val(coins);

        // Update category totals
        ['Gathering', 'Artisan', 'Utility'].forEach(category => {
            const totals = this.calculateCategoryTotals(category);
            const $categoryTotal = this.$element.find(`.skill-category[data-category="${category.toLowerCase()}"] .current-total`);
            if ($categoryTotal.length > 0) {
                $categoryTotal.text(totals.current);
            }
        });
    }

    /**
     * Calculate total levels for a category
     * @param {string} category - Category name (Gathering, Artisan, Utility)
     * @returns {Object} Object with current and max totals
     */
    calculateCategoryTotals(category) {
        const skills = this.byCategory[category] || [];
        const character = store.state.character || {};
        const overrides = store.state.ui.user_overrides || {};

        let currentTotal = 0;
        let maxTotal = skills.length * 99;

        skills.forEach(skill => {
            // Use override if it exists, otherwise fall back to character data
            let level;
            if (overrides.skills && overrides.skills[skill.id] !== undefined) {
                level = overrides.skills[skill.id];
            } else {
                level = character.skills?.[skill.id] || 1;
            }
            currentTotal += level;
        });

        return { current: currentTotal, max: maxTotal };
    }

    /**
     * Render the content inside the collapsible section
     * @returns {string} HTML string for content area
     */
    renderContent() {
        // Defensive check - if byCategory isn't set yet, return empty
        // This can happen during initial construction before properties are set
        if (!this.byCategory) {
            return '<div class="skill-section-content">Loading...</div>';
        }

        const character = store.state.character || {};
        const overrides = store.state.ui.user_overrides || {};

        // Helper to get skill level with proper fallback
        const getSkillLevel = (skillId) => {
            if (overrides.skills && overrides.skills[skillId] !== undefined) {
                return overrides.skills[skillId];
            }
            return character.skills?.[skillId] || 1;
        };

        const achievementPoints = overrides.achievement_points !== undefined
            ? overrides.achievement_points
            : (character.achievement_points || 0);

        const coins = overrides.coins !== undefined
            ? overrides.coins
            : (character.coins || 0);

        let html = '<div class="skill-section-content">';

        // Render each category
        ['Gathering', 'Artisan', 'Utility'].forEach(category => {
            const skills = this.byCategory[category] || [];
            if (skills.length === 0) return;

            const totals = this.calculateCategoryTotals(category);

            html += `
                <div class="skill-category" data-category="${category.toLowerCase()}">
                    <div class="skill-category-header">
                        <img src="/assets/icons/text/skill_types/${category.toLowerCase()}.svg" 
                             class="category-icon" 
                             alt="${category}"
                             onerror="this.style.display='none'">
                        <div class="category-info">
                            <span class="category-name">${category}</span>
                            <span class="category-total"><span class="current-total">${totals.current}</span> / ${totals.max}</span>
                        </div>
                    </div>
                    <div class="skill-category-content">
            `;

            // Render individual skills
            skills.forEach(skill => {
                const level = getSkillLevel(skill.id);
                html += this.renderSkillRow(skill, level);
            });

            html += `
                    </div>
                </div>
            `;
        });

        // Achievement Points row
        html += `
            <div class="skill-category" data-category="special">
                <div class="skill-category-header">
                    <div class="category-info">
                        <span class="category-name">Achievement Points</span>
                    </div>
                </div>
                <div class="skill-category-content skill-category-content-centered">
                    <div class="skill-row special-row" data-field="achievement_points">
                        <img src="/assets/icons/text/general_icons/achievement_points.svg" 
                             class="skill-icon" 
                             alt="Achievement Points"
                             onerror="this.style.display='none'">
                        <input type="number" 
                               class="skill-level-input ap-input" 
                               value="${achievementPoints}" 
                               min="0" 
                               max="999"
                               step="1"
                               data-field="achievement_points">
                    </div>
                </div>
            </div>
        `;

        // Currency row
        html += `
            <div class="skill-category" data-category="special">
                <div class="skill-category-header">
                    <div class="category-info">
                        <span class="category-name">Coins</span>
                    </div>
                </div>
                <div class="skill-category-content skill-category-content-centered">
                    <div class="skill-row special-row" data-field="coins">
                        <img src="/assets/icons/items/coins.svg" 
                             class="skill-icon" 
                             alt="Coins"
                             onerror="this.style.display='none'">
                        <input type="number" 
                               class="skill-level-input currency-input" 
                               value="${coins}" 
                               min="0" 
                               max="999999999"
                               step="1"
                               data-field="coins">
                    </div>
                </div>
            </div>
        `;

        html += '</div>';

        return html;
    }

    /**
     * Render a single skill row
     * @param {Object} skill - Skill definition
     * @param {number} level - Current skill level
     * @returns {string} HTML string for skill row
     */
    renderSkillRow(skill, level) {
        const character = store.state.character || {};
        const overrides = store.state.ui.user_overrides || {};

        // Use XP override if available, otherwise fall back to character data
        const skillXpOverrides = overrides.skills_xp || {};
        const characterXp = character.skills_xp || {};
        const skillXp = skillXpOverrides[skill.id] !== undefined ? skillXpOverrides[skill.id] : characterXp[skill.id];

        // Calculate progress percentage within current level
        let progressPercent = 0;

        if (level < 99 && skillXp) {
            const currentXp = skillXp;

            // XP table from walkscape_constants.py
            const LEVEL_XP = [
                0, 83, 174, 276, 388, 512, 650, 801, 969,
                1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
                4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031,
                13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
                37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721,
                101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
                273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051,
                737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808,
                1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295,
                5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431
            ];

            const currentLevelXp = LEVEL_XP[level - 1];
            const nextLevelXp = LEVEL_XP[level];
            const xpIntoLevel = currentXp - currentLevelXp;
            const xpNeededForLevel = nextLevelXp - currentLevelXp;

            progressPercent = (xpIntoLevel / xpNeededForLevel) * 100;
            progressPercent = Math.max(0, Math.min(100, progressPercent)); // Clamp 0-100
        } else if (level >= 99) {
            progressPercent = 100; // Max level shows full ring
        }

        return `
            <div class="skill-row" data-skill="${skill.id}" style="--progress: ${progressPercent}%;">
                <img src="/assets/icons/text/skill_icons/${skill.id}.svg" 
                     class="skill-icon" 
                     alt="${skill.display_name}"
                     title="${skill.display_name}"
                     onerror="this.style.display='none'">
                <input type="number" 
                       class="skill-level-input" 
                       value="${level}" 
                       min="1" 
                       max="99"
                       step="1"
                       data-skill="${skill.id}">
            </div>
        `;
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        console.log('SkillSection: attachEvents called');

        // Call parent to handle collapsible header
        super.attachEvents();

        // Handle skill level changes - store as user override
        this.$element.on('change', '.skill-level-input[data-skill]', (e) => {
            console.log('Skill input change event fired!');
            const $input = $(e.target);
            const skillId = $input.data('skill');
            let value = parseInt($input.val(), 10);

            // Validate skill level (1-99)
            if (isNaN(value) || value < 1) {
                value = 1;
                $input.val(1);
            } else if (value > 99) {
                value = 99;
                $input.val(99);
            }

            // XP table
            const LEVEL_XP = [
                0, 83, 174, 276, 388, 512, 650, 801, 969,
                1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
                4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031,
                13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
                37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721,
                101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
                273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051,
                737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808,
                1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295,
                5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431
            ];

            // Set XP to minimum for this level
            const minXpForLevel = LEVEL_XP[value - 1];

            console.log(`Skill level changed: ${skillId} = ${value}, setting XP to ${minXpForLevel}`);

            // Store both level and XP as user overrides
            store.update(`ui.user_overrides.skills.${skillId}`, value);
            store.update(`ui.user_overrides.skills_xp.${skillId}`, minXpForLevel);

            console.log('After update, store.state.ui.user_overrides:', store.state.ui.user_overrides);

            // Update visual progress ring to 0% (start of level)
            const $row = $input.closest('.skill-row');
            $row.css('--progress', '0%');
        });

        // Handle AP changes - store as user override
        this.$element.on('change', '.ap-input', (e) => {
            const $input = $(e.target);
            let value = parseInt($input.val(), 10);

            // Validate AP (0-999)
            if (isNaN(value) || value < 0) {
                value = 0;
                $input.val(0);
            } else if (value > 999) {
                value = 999;
                $input.val(999);
            }

            // Store as user override in ui_config
            store.update('ui.user_overrides.achievement_points', value);
        });

        // Handle currency changes - store as user override
        this.$element.on('change', '.currency-input', (e) => {
            const $input = $(e.target);
            let value = parseInt($input.val(), 10);

            // Validate currency (0-999999999)
            if (isNaN(value) || value < 0) {
                value = 0;
                $input.val(0);
            } else if (value > 999999999) {
                value = 999999999;
                $input.val(999999999);
            }

            // Store as user override in ui_config
            store.update('ui.user_overrides.coins', value);
        });

        // Handle input validation on blur (when user leaves field)
        this.$element.on('blur', '.skill-level-input', (e) => {
            const $input = $(e.target);
            const skillId = $input.data('skill');
            const field = $input.data('field');
            let value = parseInt($input.val(), 10);

            if (skillId) {
                // Skill level validation
                if (isNaN(value) || value < 1) {
                    value = 1;
                } else if (value > 99) {
                    value = 99;
                }
                $input.val(value);
            } else if (field === 'achievement_points') {
                // AP validation
                if (isNaN(value) || value < 0) {
                    value = 0;
                } else if (value > 999) {
                    value = 999;
                }
                $input.val(value);
            } else if (field === 'coins') {
                // Currency validation
                if (isNaN(value) || value < 0) {
                    value = 0;
                } else if (value > 999999999) {
                    value = 999999999;
                }
                $input.val(value);
            }
        });

        // Attach drag handlers for circular progress indicators
        this.attachDragHandlers();
    }

    /**
     * Attach drag handlers for circular border ring to adjust XP
     */
    attachDragHandlers() {
        console.log('SkillSection: attachDragHandlers called');

        // Attach to the skill-row itself (the border ring area)
        // But exclude clicks on the input field
        this.$element.on('mousedown', '.skill-row[data-skill]', (e) => {
            // Don't trigger if clicking on the input field
            if ($(e.target).hasClass('skill-level-input') || $(e.target).is('input')) {
                console.log('Clicked on input, skipping drag');
                return;
            }

            console.log('Skill row mousedown event fired!');
            e.preventDefault();

            const $row = $(e.currentTarget);
            const skillId = $row.data('skill');

            console.log('Dragging skill border:', skillId);

            if (!skillId) {
                console.log('No skillId found, skipping');
                return;
            }

            const $input = $row.find('.skill-level-input');
            const level = parseInt($input.val(), 10);

            // Get current XP from overrides or character data (with proper fallback)
            const overrides = store.state.ui.user_overrides || {};
            const skillXpOverrides = overrides.skills_xp || {};
            const characterXp = store.state.character.skills_xp || {};
            let currentXp = skillXpOverrides[skillId] !== undefined
                ? skillXpOverrides[skillId]
                : (characterXp[skillId] || 0);

            // XP table
            const LEVEL_XP = [
                0, 83, 174, 276, 388, 512, 650, 801, 969,
                1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
                4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031,
                13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
                37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721,
                101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
                273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051,
                737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808,
                1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295,
                5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431
            ];

            const currentLevelXp = LEVEL_XP[level - 1];
            const nextLevelXp = LEVEL_XP[level];

            console.log(`Starting drag: level=${level}, currentXp=${currentXp}, range=${currentLevelXp}-${nextLevelXp}`);

            // Get row center position (for circular drag calculation)
            const rowRect = $row[0].getBoundingClientRect();
            const centerX = rowRect.left + rowRect.width / 2;
            const centerY = rowRect.top + rowRect.height / 2;

            // Calculate initial angle
            const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
            let lastAngle = startAngle;

            const onMouseMove = (moveEvent) => {
                // Calculate current angle
                const currentAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);

                // Calculate angle delta (in radians)
                let angleDelta = currentAngle - lastAngle;

                // Handle wrap-around (crossing from -π to π or vice versa)
                if (angleDelta > Math.PI) {
                    angleDelta -= 2 * Math.PI;
                } else if (angleDelta < -Math.PI) {
                    angleDelta += 2 * Math.PI;
                }

                // Convert angle delta to XP delta (full circle = level range)
                const xpRange = nextLevelXp - currentLevelXp;
                const xpDelta = (angleDelta / (2 * Math.PI)) * xpRange;

                // Update XP (but keep within current level bounds)
                currentXp = Math.max(currentLevelXp, Math.min(nextLevelXp - 1, currentXp + xpDelta));

                // Calculate progress percentage
                const xpIntoLevel = currentXp - currentLevelXp;
                const progressPercent = (xpIntoLevel / xpRange) * 100;

                // Update visual progress
                $row.css('--progress', `${progressPercent}%`);

                lastAngle = currentAngle;
            };

            const onMouseUp = () => {
                console.log('Mouse up - saving XP');

                // Remove event listeners
                $(document).off('mousemove', onMouseMove);
                $(document).off('mouseup', onMouseUp);

                // Store XP override in ui_config
                store.update(`ui.user_overrides.skills_xp.${skillId}`, Math.floor(currentXp));

                // Show feedback
                const xpIntoLevel = Math.floor(currentXp - currentLevelXp);
                const xpNeeded = nextLevelXp - currentLevelXp;
                console.log(`${skillId}: ${xpIntoLevel}/${xpNeeded} XP (${Math.floor((xpIntoLevel / xpNeeded) * 100)}%)`);

                // Reset cursor
                $row.css('cursor', 'ew-resize');
            };

            // Change cursor to grabbing
            $row.css('cursor', 'ew-resize');

            // Attach move and up handlers
            $(document).on('mousemove', onMouseMove);
            $(document).on('mouseup', onMouseUp);
        });

        // Add cursor style to indicate draggable rows (but not on input)
        this.$element.find('.skill-row[data-skill]').css('cursor', 'ew-resize');
        this.$element.find('.skill-level-input').css('cursor', 'text');
    }

}

export default SkillSection;
