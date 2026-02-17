/**
 * Main Entry Point - Walkscape UI
 * 
 * Initializes the application:
 * - Loads or creates session from cookie
 * - Fetches initial data from API
 * - Renders all components
 * - Shows import modal if needed
 * 
 * Requirements: 1.1, 1.2, 2.1, 2.5
 */

console.log('🚀 main.js loaded - Import Modal Fix Active');

import store from './state.js';
import api from './api.js';
import ImportModal from './components/import-modal.js';
import SettingsModal from './components/settings-modal.js';
import CustomStatsPopup from './components/custom-stats-popup.js';
import SkillSection from './components/skill-section.js';
import ReputationSection from './components/reputation-section.js';
import OwnedItemsSection from './components/owned-items-section.js';
import GearSetManager from './components/gear-set-manager.js';
import FilterCheckboxes from './components/filter-checkboxes.js';
import GearSlotGrid from './components/gear-slot-grid.js';
import ItemSelectionPopup from './components/item-selection-popup.js';
import ActionButtons from './components/action-buttons.js';
import CombinedStatsSection from './components/combined-stats-section.js';
import ActivitySelectorDropdown from './components/activity-selector-dropdown.js';
import RecipeSelectorDropdown from './components/recipe-selector-dropdown.js';
import ActivityInfoSection from './components/activity-info-section.js';
import RecipeInfoSection from './components/recipe-info-section.js';
import OptimizeButton from './components/optimize-button.js';
import DropsSection from './components/drops-section.js';
import CalculatorSection from './components/calculator-section.js';
import UndoRedoButtons from './components/undo-redo-buttons.js';
import undoRedoManager from './undo-redo.js';
import { initBugReport } from './bug_report.js';
import { initAboutModal } from './about.js';
import { initHelpModal, showHelpModal } from './help.js';

/**
 * Get session UUID from cookie or generate new one
 * @returns {string} Session UUID
 */
function getSessionUuid() {
    // Check for existing cookie
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'session_uuid') {
            return value;
        }
    }

    // Generate new UUID
    const uuid = crypto.randomUUID();

    // Set cookie (expires in 1 year)
    document.cookie = `session_uuid=${uuid}; path=/; max-age=31536000`;

    return uuid;
}

/**
 * Initialize the application
 */
async function initializeApp() {
    console.log('=== initializeApp START ===');
    try {
        // Show loading indicator
        showLoadingIndicator();

        // Get or create session UUID
        const uuid = getSessionUuid();
        console.log('Session UUID:', uuid);

        // Load session data from backend
        await store.loadSession(uuid);
        console.log('Session loaded:', store.state);

        // Fetch static data from API
        const [itemsData, skillsData] = await Promise.all([
            api.getItems(),
            api.getSkills()
        ]);

        console.log('Items loaded:', itemsData);
        console.log('Skills loaded:', skillsData);

        // Hide loading indicator
        hideLoadingIndicator();

        // Render all components
        renderComponents(itemsData, skillsData);

        // Initialize modals
        console.log('About to initialize modals...');
        try {
            initializeModals();
            console.log('Modals initialized successfully');
        } catch (modalError) {
            console.error('Error initializing modals:', modalError);
        }

        // Check if we need to show import modal
        console.log('About to call checkImportModal()...');
        checkImportModal();
        console.log('checkImportModal() completed');

    } catch (error) {
        console.error('Failed to initialize app:', error);
        hideLoadingIndicator();
        api.showError('Failed to initialize application. Please refresh the page.');
    }
}

/**
 * Show loading indicator
 */
function showLoadingIndicator() {
    const $loading = $(`
        <div class="loading-overlay" style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        ">
            <div style="
                text-align: center;
                color: var(--text-primary);
            ">
                <div style="
                    font-size: 1.5em;
                    margin-bottom: var(--spacing-md);
                ">Loading...</div>
                <div style="
                    width: 50px;
                    height: 50px;
                    border: 3px solid var(--border-color);
                    border-top-color: var(--accent-primary);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto;
                "></div>
            </div>
        </div>
    `);

    $('body').append($loading);

    // Add spin animation if not already defined
    if (!$('#spin-animation').length) {
        $('head').append(`
            <style id="spin-animation">
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        `);
    }
}

/**
 * Hide loading indicator
 */
function hideLoadingIndicator() {
    $('.loading-overlay').fadeOut(300, function () {
        $(this).remove();
    });
}

/**
 * Render all components in column 1 and column 2
 * @param {Object} itemsData - Items catalog data from API
 * @param {Object} skillsData - Skills data from API
 */
function renderComponents(itemsData, skillsData) {
    // ========================================
    // Column 1: Character Data
    // ========================================
    const $column1Content = $('#column-1 .column-content');

    // Clear existing content
    $column1Content.empty();

    // Add Import Data and Custom Stats buttons at the top
    const $buttonContainer = $(`
        <div class="button-container" style="
            display: flex;
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-lg);
            justify-content: center;
        ">
            <button class="button button-primary" id="import-data-btn">
                Import Data
            </button>
            <button class="button" id="custom-stats-btn">
                Custom Stats
            </button>
        </div>
    `);
    $column1Content.append($buttonContainer);

    // Create containers for each section
    const $skillsContainer = $('<div id="skills-section"></div>');
    const $reputationContainer = $('<div id="reputation-section"></div>');
    const $itemsContainer = $('<div id="owned-items-section"></div>');

    $column1Content.append($skillsContainer);
    $column1Content.append($reputationContainer);
    $column1Content.append($itemsContainer);

    // Initialize Skills & AP section
    const skillsByCategory = {
        Gathering: skillsData.skills.filter(s => s.category === 'Gathering'),
        Artisan: skillsData.skills.filter(s => s.category === 'Artisan'),
        Utility: skillsData.skills.filter(s => s.category === 'Utility')
    };

    new SkillSection($skillsContainer, {
        skills: skillsData.skills,
        byCategory: skillsByCategory
    });

    // Initialize Faction Reputation section
    new ReputationSection($reputationContainer);

    // Initialize Owned Items section
    new OwnedItemsSection($itemsContainer, {
        catalog: itemsData
    });

    // ========================================
    // Column 2: Gear Stats
    // ========================================
    const $gearSetManagerContainer = $('#gear-set-manager');
    const $filterCheckboxesContainer = $('#filter-checkboxes');
    const $gearSlotGridContainer = $('#gear-slot-grid');
    const $actionButtonsContainer = $('#action-buttons');
    const $combinedStatsContainer = $('#combined-stats-section');

    // Get character level for tool slot calculation
    const characterLevel = calculateCharacterLevel(store.state.character);

    // Create item selection popup (append to body for modal overlay)
    const $popupContainer = $('<div id="item-selection-popup"></div>');
    $('body').append($popupContainer);
    const itemSelectionPopup = new ItemSelectionPopup($popupContainer);

    // Initialize Column 2 components
    window.gearSetManager = new GearSetManager($gearSetManagerContainer);
    new FilterCheckboxes($filterCheckboxesContainer);
    new GearSlotGrid($gearSlotGridContainer, {
        characterLevel: characterLevel,
        catalog: itemsData,
        onSlotClick: (slot) => {
            console.log('Opening item selection popup for slot:', slot);
            itemSelectionPopup.show(slot);
        }
    });
    new ActionButtons($actionButtonsContainer);

    // Load item finding categories eagerly (fire and forget)
    // Categories will be available by the time user interacts with stats
    fetch('/api/item-finding-categories')
        .then(response => response.json())
        .then(data => {
            window.itemFindingCategories = data;
            console.log('Loaded item finding categories:', Object.keys(data).length);
        })
        .catch(error => {
            console.error('Failed to load item finding categories:', error);
            window.itemFindingCategories = {};
        });

    // Store CombinedStatsSection globally for Column 3 integration
    // Requirements: 7.1, 7.2, 7.3, 7.4
    window.combinedStatsSection = new CombinedStatsSection($combinedStatsContainer, {
        catalog: itemsData
    });

    // ========================================
    // Column 3: Activity/Craft Selection
    // ========================================
    const $activitySelectorContainer = $('#activity-selector-dropdown');
    const $recipeSelectorContainer = $('#recipe-selector-dropdown');
    const $activityRecipeInfoContainer = $('#activity-recipe-info');
    const $dropsSectionContainer = $('#drops-section');
    const $calculatorSectionContainer = $('#calculator-section');

    // Create separate containers for activity and recipe info
    const $activityInfoContainer = $('<div id="activity-info-container"></div>');
    const $recipeInfoContainer = $('<div id="recipe-info-container"></div>');
    $activityRecipeInfoContainer.append($activityInfoContainer);
    $activityRecipeInfoContainer.append($recipeInfoContainer);

    // Initialize Column 3 components
    new ActivitySelectorDropdown($activitySelectorContainer);
    new RecipeSelectorDropdown($recipeSelectorContainer);

    // Add optimize button container after selectors
    const $optimizeButtonContainer = $('<div id="optimize-button-container"></div>');
    $recipeSelectorContainer.after($optimizeButtonContainer);
    new OptimizeButton($optimizeButtonContainer);

    // Initialize both info sections in their own containers
    new ActivityInfoSection($activityInfoContainer);
    window.recipeInfoSection = new RecipeInfoSection($recipeInfoContainer);

    // Initialize drops section
    new DropsSection($dropsSectionContainer);

    // Initialize calculator section
    new CalculatorSection($calculatorSectionContainer);

    // ========================================
    // Undo/Redo Buttons (Fixed Position)
    // ========================================
    const $undoRedoContainer = $('<div id="undo-redo-container"></div>');
    $('body').append($undoRedoContainer);
    new UndoRedoButtons($undoRedoContainer);

    // Subscribe undo/redo manager to gearset changes
    undoRedoManager.subscribeToChanges();

    // Initialize with current state after session is loaded
    // Use setTimeout to ensure all components have finished rendering
    setTimeout(() => {
        undoRedoManager.initialize();
    }, 100);

    console.log('All components rendered');
}

/**
 * XP equation algorithm for character level (matches Python xp_equate)
 * @param {number} level - Level
 * @returns {number} XP value
 */
function xpEquate(level) {
    return Math.floor(level + 300 * Math.pow(2, level / 7));
}

/**
 * Calculate XP needed to reach a character level (matches Python xp_to_level_character)
 * @param {number} level - Target level
 * @returns {number} Total XP needed
 */
function xpToLevelCharacter(level) {
    let xp = 0;
    for (let i = 1; i <= level; i++) {
        xp += xpEquate(i);
    }
    return Math.floor(xp / 4) * 4.6;
}

/**
 * Calculate character level from total steps (matches Python character_level_from_steps)
 * @param {number} steps - Total steps across all skills
 * @returns {number} Character level
 */
function characterLevelFromSteps(steps) {
    let charLevel = 1;
    while (charLevel < 999) {
        const requiredXp = xpToLevelCharacter(charLevel + 1);
        if (steps < requiredXp) {
            break;
        }
        charLevel++;
    }
    return charLevel;
}

/**
 * Calculate character level from character state
 * @param {Object} character - Character object from store state
 * @returns {number} Character level
 */
function calculateCharacterLevel(character) {
    if (!character) {
        return 1;
    }

    // Use character.steps directly (total steps across all skills)
    if (character.steps) {
        return characterLevelFromSteps(character.steps);
    }

    // Fallback: calculate from skills_xp if steps not available
    if (character.skills_xp && Object.keys(character.skills_xp).length > 0) {
        const totalSteps = Object.values(character.skills_xp).reduce((sum, xp) => sum + xp, 0);
        return characterLevelFromSteps(totalSteps);
    }

    return 1;
}

/**
 * Initialize modals and attach to buttons
 */
function initializeModals() {
    // Create modal containers
    const $importModalContainer = $('<div id="import-modal-container"></div>');
    const $settingsModalContainer = $('<div id="settings-modal-container"></div>');
    const $customStatsContainer = $('<div id="custom-stats-container"></div>');

    $('body').append($importModalContainer);
    $('body').append($settingsModalContainer);
    $('body').append($customStatsContainer);

    // Initialize modals
    const importModal = new ImportModal($importModalContainer, {
        isFirstVisit: false,
        onImportSuccess: () => {
            // Reload page to refresh all data
            window.location.reload();
        },
        onCancel: () => {
            // Modal closed, nothing to do
        }
    });

    const settingsModal = new SettingsModal($settingsModalContainer);
    window.settingsModal = settingsModal; // Make globally accessible
    const customStatsPopup = new CustomStatsPopup($customStatsContainer);

    // Attach button handlers
    $('#settings-btn').on('click', () => {
        settingsModal.show();
    });

    $(document).on('click', '#import-data-btn', () => {
        importModal.show();
    });

    $(document).on('click', '#custom-stats-btn', () => {
        customStatsPopup.show();
    });

    // Initialize bug report
    initBugReport();

    // Initialize about modal
    initAboutModal();

    // Initialize help modal
    initHelpModal();

    // Randomize gear button
    $('#randomize-gear-btn').on('click', () => {
        randomizeGear();
    });

    // Randomize activity/recipe button
    $('#randomize-activity-btn').on('click', () => {
        randomizeActivityOrRecipe();
    });

    // Store modal instances globally for access from other components
    window.importModal = importModal;
    window.settingsModal = settingsModal;
    window.customStatsPopup = customStatsPopup;

    console.log('Modals initialized');
}

/**
 * Check if we need to show the import modal
 * Shows automatically if:
 * - No character_config exists
 * - User hasn't skipped import (ui.skipped_import is false)
 */
function checkImportModal() {
    console.log('=== checkImportModal START ===');
    console.log('Full state:', store.state);

    const hasCharacterData = store.state.character &&
        Object.keys(store.state.character).length > 0 &&
        store.state.character.skills &&
        Object.keys(store.state.character.skills).length > 0;

    const hasSkippedImport = store.state.ui && store.state.ui.skipped_import;

    console.log('Import modal check:', {
        hasCharacterData,
        hasSkippedImport,
        'character exists': !!store.state.character,
        'character keys': store.state.character ? Object.keys(store.state.character) : 'N/A',
        'character.skills exists': !!store.state.character?.skills,
        'character.skills keys': store.state.character?.skills ? Object.keys(store.state.character.skills) : 'N/A',
        'ui exists': !!store.state.ui,
        'ui.skipped_import': store.state.ui?.skipped_import,
        'ui.skipped_import type': typeof store.state.ui?.skipped_import
    });

    // Show import modal if no character data and user hasn't skipped
    if (!hasCharacterData && !hasSkippedImport) {
        console.log('✓ Conditions met - Showing import modal (first visit)');

        // Create a first-visit import modal
        const $firstVisitModalContainer = $('<div id="first-visit-modal-container"></div>');
        $('body').append($firstVisitModalContainer);

        const firstVisitModal = new ImportModal($firstVisitModalContainer, {
            isFirstVisit: true,
            onImportSuccess: (response, hasSeenCustomStats) => {
                console.log('Import successful, hasSeenCustomStats:', hasSeenCustomStats);

                const hasSeenHelp = store.state.ui && store.state.ui.has_seen_help;

                // If user hasn't seen custom stats popup, show it before help/reload
                if (!hasSeenCustomStats) {
                    console.log('Showing custom stats popup for first time');

                    // Mark as seen immediately
                    store.update('ui.has_seen_custom_stats', true);

                    // Show custom stats popup
                    if (window.customStatsPopup) {
                        window.customStatsPopup.show();

                        // After custom stats, show help if not seen
                        const originalHide = window.customStatsPopup.hide.bind(window.customStatsPopup);
                        window.customStatsPopup.hide = function () {
                            originalHide();
                            console.log('Custom stats popup closed');

                            // Check if user has seen help
                            if (!hasSeenHelp) {
                                console.log('Showing help modal for first time');
                                store.update('ui.has_seen_help', true);

                                // Show help modal
                                showHelpModal();

                                // Reload after help closes
                                const helpModal = document.getElementById('help-modal');
                                const helpOk = document.getElementById('help-ok');
                                const helpClose = document.getElementById('help-close');

                                const reloadAfterHelp = () => {
                                    console.log('Help modal closed, reloading...');
                                    window.location.reload();
                                };

                                if (helpOk) helpOk.addEventListener('click', reloadAfterHelp, { once: true });
                                if (helpClose) helpClose.addEventListener('click', reloadAfterHelp, { once: true });
                                if (helpModal) {
                                    helpModal.addEventListener('click', (e) => {
                                        if (e.target === helpModal) reloadAfterHelp();
                                    }, { once: true });
                                }
                            } else {
                                console.log('User has already seen help, reloading...');
                                window.location.reload();
                            }
                        };
                    } else {
                        // Fallback: just reload if popup not available
                        console.warn('customStatsPopup not available, reloading immediately');
                        window.location.reload();
                    }
                } else {
                    // Already seen custom stats, just reload
                    console.log('User has already seen custom stats, reloading...');
                    window.location.reload();
                }
            },
            onCancel: () => {
                // User cancelled, skipped_import flag already set by modal
                console.log('User skipped import');
            }
        });

        // Show the modal
        firstVisitModal.show();
    } else {
        console.log('✗ Conditions NOT met - Modal will not show');
        console.log('  Reason:', hasCharacterData ? 'Has character data' : 'User skipped import');
    }
    console.log('=== checkImportModal END ===');
}

/**
 * Initialize when DOM is ready
 */
$(document).ready(() => {
    console.log('DOM ready, initializing app...');

    // Apply saved custom colors
    const savedTertiary = localStorage.getItem('customBgTertiary');
    if (savedTertiary) {
        document.documentElement.style.setProperty('--bg-tertiary', savedTertiary);
    }

    const savedHover = localStorage.getItem('customBgHover');
    if (savedHover) {
        document.documentElement.style.setProperty('--bg-hover', savedHover);
    }

    initializeApp();
    initializeMobileTabs();
});

/**
 * Initialize mobile tab navigation
 */
function initializeMobileTabs() {
    const $tabs = $('.mobile-tab');
    const $columns = $('.column');

    $tabs.on('click', function () {
        const targetColumn = $(this).data('column');

        // Update active tab
        $tabs.removeClass('active');
        $(this).addClass('active');

        // Update active column
        $columns.removeClass('active-mobile-column');
        $(`#${targetColumn}`).addClass('active-mobile-column');

        console.log('Switched to column:', targetColumn);
    });
}

/**
 * Randomize gear - equip random items in all slots
 */
async function randomizeGear() {
    console.log('Randomizing gear...');

    try {
        // Fetch catalog data
        const catalogData = await api.getCatalog();
        const allItems = catalogData.items || [];

        console.log(`Total items in catalog: ${allItems.length}`);

        // Debug: Check what slots are available
        const slotCounts = {};
        allItems.forEach(item => {
            slotCounts[item.slot] = (slotCounts[item.slot] || 0) + 1;
        });
        console.log('Items by slot:', slotCounts);

        // Check if we should only use owned items
        const onlyShowOwned = store.state.ui?.column2?.showOwnedOnly || false;
        const ownedItems = store.state.character?.owned_items || [];

        console.log(`Only show owned: ${onlyShowOwned}, Owned items count: ${ownedItems.length}`);
        if (ownedItems.length > 0) {
            console.log('First 5 owned item IDs:', ownedItems.slice(0, 5));
        }
        if (allItems.length > 0) {
            console.log('First 5 catalog item IDs:', allItems.slice(0, 5).map(i => i.id));
        }

        // Get character level for tool slots
        const characterLevel = calculateCharacterLevel(store.state.character);
        const toolSlots = GearSlotGrid.getUnlockedToolSlots(characterLevel);

        console.log(`Character level: ${characterLevel}, unlocked tool slots: ${toolSlots}`);
        console.log('Character state:', store.state.character);

        // Define all slots (matching GearSlotGrid.GEAR_SLOTS layout)
        const gearSlots = ['cape', 'head', 'back', 'hands', 'chest', 'neck', 'primary', 'legs', 'secondary', 'ring1', 'feet', 'ring2'];
        const toolSlotNames = [];
        for (let i = 0; i < toolSlots; i++) {
            toolSlotNames.push(`tool${i}`);
        }
        const specialSlots = ['consumable', 'pet'];

        console.log('Tool slots to randomize:', toolSlotNames);

        const allSlots = [...gearSlots, ...toolSlotNames, ...specialSlots];

        // Filter items by owned if needed
        let availableItems = allItems.filter(item => {
            // Skip items with undefined slot
            if (!item.slot) {
                return false;
            }
            // Filter by owned if checkbox is checked
            if (onlyShowOwned && !ownedItems.includes(item.id)) {
                return false;
            }
            return true;
        });

        console.log(`Available items after filtering: ${availableItems.length} (owned filter: ${onlyShowOwned})`);

        // Randomize each slot
        for (const slot of allSlots) {
            // Get valid items for this slot
            let validItems = availableItems.filter(item => {
                // Match slot type - each slot should only accept items with that exact slot
                if (slot.startsWith('tool')) {
                    return item.slot === 'tools';  // Note: plural 'tools'
                } else if (slot === 'ring1' || slot === 'ring2') {
                    return item.slot === 'ring';
                } else if (slot === 'primary') {
                    return item.slot === 'primary';
                } else if (slot === 'secondary') {
                    return item.slot === 'secondary';
                } else {
                    return item.slot === slot;
                }
            });

            console.log(`Slot ${slot}: found ${validItems.length} valid items`);

            if (validItems.length === 0) {
                // No items for this slot, unequip
                console.log(`  -> Unequipping ${slot} (no valid items)`);
                store.updateGearSlot(slot, null);
                continue;
            }

            // Pick a random item
            const randomItem = validItems[Math.floor(Math.random() * validItems.length)];

            // Build complete item data (matching item-selection-popup format)
            const slotItem = {
                itemId: randomItem.id,
                uuid: randomItem.uuid || randomItem.id,
                name: randomItem.name,
                icon_path: randomItem.icon_path,
                rarity: randomItem.rarity || 'common',
                quality: randomItem.quality || null,
                keywords: randomItem.keywords || [],
                is_fine: randomItem.is_fine || false
            };

            console.log(`  -> Equipping ${randomItem.name} to ${slot}`);

            // Equip it
            store.updateGearSlot(slot, slotItem);
        }

        console.log('Gear randomized!');
    } catch (error) {
        console.error('Failed to randomize gear:', error);
    }
}

/**
 * Randomize activity or recipe selection
 */
async function randomizeActivityOrRecipe() {
    console.log('Randomizing activity/recipe...');

    try {
        // Randomly choose between activity and recipe
        const useActivity = Math.random() < 0.5;

        if (useActivity) {
            // Get all activities
            const response = await $.get('/api/activities');
            const allActivities = [];

            for (const activities of Object.values(response.by_skill)) {
                allActivities.push(...activities);
            }

            if (allActivities.length === 0) {
                console.warn('No activities available');
                return;
            }

            // Pick a random activity
            const randomActivity = allActivities[Math.floor(Math.random() * allActivities.length)];

            // Update state
            if (!store.state.column3) {
                store.state.column3 = {};
            }
            store.state.column3.selectedActivity = randomActivity.id;
            store.state.column3.selectedRecipe = null;

            // Notify subscribers
            store._notifySubscribers('column3.selectedActivity');
            store._notifySubscribers('column3.selectedRecipe');

            console.log('Random activity selected:', randomActivity.name);
        } else {
            // Get all recipes
            const response = await $.get('/api/recipes');
            const allRecipes = [];

            for (const recipes of Object.values(response.by_skill)) {
                allRecipes.push(...recipes);
            }

            if (allRecipes.length === 0) {
                console.warn('No recipes available');
                return;
            }

            // Pick a random recipe
            const randomRecipe = allRecipes[Math.floor(Math.random() * allRecipes.length)];

            // Update state
            if (!store.state.column3) {
                store.state.column3 = {};
            }
            store.state.column3.selectedRecipe = randomRecipe.id;
            store.state.column3.selectedActivity = null;

            // Notify subscribers
            store._notifySubscribers('column3.selectedRecipe');
            store._notifySubscribers('column3.selectedActivity');

            console.log('Random recipe selected:', randomRecipe.name);
        }
    } catch (error) {
        console.error('Failed to randomize activity/recipe:', error);
    }
}

// Export for debugging
window.store = store;
window.api = api;
