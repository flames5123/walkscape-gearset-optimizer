#!/usr/bin/env python3
"""
Keywords — keyword catalogue including bannedKeywords list.
DO NOT EDIT MANUALLY
"""

KEYWORDS = {
    'achievement_percentage': {
        'id': 'achievement_percentage',
        'name': 'Achievement percentage',
        'requirementText': 'none',
        'types': [
            'achievement'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/achievement_percentages.png'
    },
    'achievement_reward': {
        'id': 'achievement_reward',
        'name': 'Achievement reward',
        'requirementText': 'Requires an <object id="achievement_reward" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/achievement_reward.png'
    },
    'advanced_diving_gear': {
        'id': 'advanced_diving_gear',
        'name': 'Advanced diving gear',
        'requirementText': 'Requires <object id="advanced_diving_gear" />.',
        'types': [
            'itemSet'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/itemset_diving_gear_advanced.png'
    },
    'adventuring_tool_set': {
        'id': 'adventuring_tool_set',
        'name': 'Adventuring tool set',
        'requirementText': 'Requires equipped pieces of the <object id="adventuring_tool_set" /> set.',
        'types': [
            'itemSet'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/itemset_adventuring_tools.png'
    },
    'agility': {
        'id': 'agility',
        'name': 'Agility',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'agility_tool': {
        'id': 'agility_tool',
        'name': 'Agility tool',
        'requirementText': 'Requires an equipped <object id="agility_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/agilityTool.png'
    },
    'alcohol': {
        'id': 'alcohol',
        'name': 'Alcohol',
        'requirementText': 'Requires <object id="alcohol" />.',
        'types': [
            'consumable'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/alcohol.png'
    },
    'amulet': {
        'id': 'amulet',
        'name': 'Amulet',
        'requirementText': 'Requires an equipped <object id="amulet" />.',
        'types': [
            'gear'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/amulet.png'
    },
    'aquatic': {
        'id': 'aquatic',
        'name': 'Aquatic',
        'requirementText': 'Requires <object id="aquatic" /> equipment.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/location_underwater.png'
    },
    'arrows': {
        'id': 'arrows',
        'name': 'Arrows',
        'requirementText': 'Requires equipped <object id="arrows" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/arrows.png'
    },
    'artisan': {
        'id': 'artisan',
        'name': 'Artisan',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'bar': {
        'id': 'bar',
        'name': 'Bar',
        'requirementText': 'Requires a <object id="bar" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/bar.png'
    },
    'basket': {
        'id': 'basket',
        'name': 'Basket',
        'requirementText': 'Requires an equipped <object id="basket" />.',
        'types': [],
        'bannedKeywords': [
            'basket'
        ],
        'icon': 'assets/icons/keywords/basket.png'
    },
    'bellows': {
        'id': 'bellows',
        'name': 'Bellows',
        'requirementText': 'Requires equipped <object id="bellows" />.',
        'types': [],
        'bannedKeywords': [
            'bellows'
        ],
        'icon': 'assets/icons/keywords/bellows.png'
    },
    'beverage': {
        'id': 'beverage',
        'name': 'Beverage',
        'requirementText': 'Requires a <object id="beverage" />.',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'birdhouse': {
        'id': 'birdhouse',
        'name': 'Birdhouse',
        'requirementText': 'Requires a <object id="birdhouse" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/birdhouse.png'
    },
    'bug_catching_net': {
        'id': 'bug_catching_net',
        'name': 'Bug catching net',
        'requirementText': 'Requires an equipped <object id="bug_catching_net" />.',
        'types': [],
        'bannedKeywords': [
            'bug_catching_net'
        ],
        'icon': 'assets/icons/keywords/bug_catching_net.png'
    },
    'carpentry': {
        'id': 'carpentry',
        'name': 'Carpentry',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'carpentry_tool': {
        'id': 'carpentry_tool',
        'name': 'Carpentry tool',
        'requirementText': 'Requires an equipped <object id="carpentry_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/carpentry_tool.png'
    },
    'chest': {
        'id': 'chest',
        'name': 'Chest',
        'requirementText': 'Requires a <object id="chest" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/chest.png'
    },
    'chisel': {
        'id': 'chisel',
        'name': 'Chisel',
        'requirementText': 'Requires an equipped <object id="chisel" />.',
        'types': [],
        'bannedKeywords': [
            'chisel'
        ],
        'icon': 'assets/icons/keywords/chisel.png'
    },
    'climbing_gear': {
        'id': 'climbing_gear',
        'name': 'Climbing gear',
        'requirementText': 'Requires equipped <object id="climbing_gear" />.',
        'types': [],
        'bannedKeywords': [
            'climbing_gear'
        ],
        'icon': 'assets/icons/keywords/climbing.png'
    },
    'cooked_fish': {
        'id': 'cooked_fish',
        'name': 'Cooked fish',
        'requirementText': 'Requires a <object id="cooked_fish" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/cookedFish.png'
    },
    'cooking': {
        'id': 'cooking',
        'name': 'Cooking',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'cooking_knife': {
        'id': 'cooking_knife',
        'name': 'Cooking knife',
        'requirementText': 'Requires an equipped <object id="cooking_knife" />.',
        'types': [],
        'bannedKeywords': [
            'cooking_knife'
        ],
        'icon': 'assets/icons/keywords/cooking_knife.png'
    },
    'cooking_pan': {
        'id': 'cooking_pan',
        'name': 'Cooking pan',
        'requirementText': 'Requires an equipped <object id="cooking_pan" />.',
        'types': [],
        'bannedKeywords': [
            'cooking_pan'
        ],
        'icon': 'assets/icons/keywords/cooking_pan.png'
    },
    'cooking_pot': {
        'id': 'cooking_pot',
        'name': 'Cooking pot',
        'requirementText': 'Requires an equipped <object id="cooking_pot" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/cooking_pot.png'
    },
    'cooking_recipe': {
        'id': 'cooking_recipe',
        'name': 'Cooking recipe',
        'requirementText': 'Requires a <object id="cooking_recipe" />.',
        'types': [
            'recipe'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/cooking_recipe.png'
    },
    'cooking_tool': {
        'id': 'cooking_tool',
        'name': 'Cooking tool',
        'requirementText': 'Requires an equipped <object id="cooking_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/cooking_tool.png'
    },
    'crafting': {
        'id': 'crafting',
        'name': 'Crafting',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'crafting_tool': {
        'id': 'crafting_tool',
        'name': 'Crafting tool',
        'requirementText': 'Requires an equipped <object id="crafting_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/crafting_tool.png'
    },
    'crustacean': {
        'id': 'crustacean',
        'name': 'Crustacean',
        'requirementText': 'Requires a <object id="crustacean" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/crustacean.png'
    },
    'currency': {
        'id': 'currency',
        'name': 'Currency',
        'requirementText': 'Requires <object id="currency" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/currency.png'
    },
    'cursed': {
        'id': 'cursed',
        'name': 'Cursed',
        'requirementText': 'Requires something <object id="cursed" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/cursed.png'
    },
    'cut_gem': {
        'id': 'cut_gem',
        'name': 'Cut gem',
        'requirementText': 'Requires a <object id="cut_gem" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/cut_gem.png'
    },
    'cutting_board': {
        'id': 'cutting_board',
        'name': 'Cutting board',
        'requirementText': 'Requires an equipped <object id="cutting_board" />.',
        'types': [],
        'bannedKeywords': [
            'cutting_board'
        ],
        'icon': 'assets/icons/keywords/cooking_board.png'
    },
    'cutting_mat': {
        'id': 'cutting_mat',
        'name': 'Cutting mat',
        'requirementText': 'Requires equipped <object id="cutting_mat" />.',
        'types': [],
        'bannedKeywords': [
            'cutting_mat'
        ],
        'icon': 'assets/icons/keywords/cutting_mat.png'
    },
    'desert': {
        'id': 'desert',
        'name': 'Desert',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'diving_gear': {
        'id': 'diving_gear',
        'name': 'Diving gear',
        'requirementText': 'Requires <object id="diving_gear" />.',
        'types': [
            'itemSet'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/itemset_diving_gear.png'
    },
    'egg': {
        'id': 'egg',
        'name': 'Egg',
        'requirementText': 'Requires an <object id="egg" />.',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'erdwise': {
        'id': 'erdwise',
        'name': 'Erdwise',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'expert_diving_gear': {
        'id': 'expert_diving_gear',
        'name': 'Expert diving gear',
        'requirementText': 'Requires <object id="expert_diving_gear" />.',
        'types': [
            'itemSet'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/itemset_diving_gear_expert.png'
    },
    'fabric': {
        'id': 'fabric',
        'name': 'Fabric',
        'requirementText': 'Requires <object id="fabric" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/linen.png'
    },
    'faction_reward': {
        'id': 'faction_reward',
        'name': 'Faction reward',
        'requirementText': 'Requires a <object id="faction_reward" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/faction_reward.png'
    },
    'fibrous_plant': {
        'id': 'fibrous_plant',
        'name': 'Fibrous plant',
        'requirementText': 'Requires a <object id="fibrous_plant" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/fibrous_plants.png'
    },
    'fish': {
        'id': 'fish',
        'name': 'Fish',
        'requirementText': 'Requires a <object id="fish" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/fish.png'
    },
    'fishing': {
        'id': 'fishing',
        'name': 'Fishing',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'fishing_cage': {
        'id': 'fishing_cage',
        'name': 'Fishing cage',
        'requirementText': 'Requires an equipped <object id="fishing_cage" />.',
        'types': [],
        'bannedKeywords': [
            'fishing_net',
            'fishing_rod',
            'fishing_spear',
            'fishing_cage'
        ],
        'icon': 'assets/icons/keywords/fishing_cage.png'
    },
    'fishing_lure': {
        'id': 'fishing_lure',
        'name': 'Fishing lure',
        'requirementText': 'Requires an equipped <object id="fishing_lure" />.',
        'types': [],
        'bannedKeywords': [
            'fishing_lure'
        ],
        'icon': 'assets/icons/keywords/fishing_lure.png'
    },
    'fishing_net': {
        'id': 'fishing_net',
        'name': 'Fishing net',
        'requirementText': 'Requires an equipped <object id="fishing_net" />.',
        'types': [],
        'bannedKeywords': [
            'fishing_net',
            'fishing_rod',
            'fishing_spear',
            'fishing_cage'
        ],
        'icon': 'assets/icons/keywords/fishing_net.png'
    },
    'fishing_rod': {
        'id': 'fishing_rod',
        'name': 'Fishing rod',
        'requirementText': 'Requires an equipped <object id="fishing_rod" />.',
        'types': [],
        'bannedKeywords': [
            'fishing_net',
            'fishing_rod',
            'fishing_spear',
            'fishing_cage'
        ],
        'icon': 'assets/icons/keywords/fishing_rod.png'
    },
    'fishing_rod_rest': {
        'id': 'fishing_rod_rest',
        'name': 'Fishing rod rest',
        'requirementText': 'Requires an equipped <object id="fishing_rod" />.',
        'types': [],
        'bannedKeywords': [
            'fishing_rod_rest'
        ],
        'icon': 'assets/icons/keywords/rod_rest.png'
    },
    'fishing_spear': {
        'id': 'fishing_spear',
        'name': 'Fishing spear',
        'requirementText': 'Requires an equipped <object id="fishing_spear" />.',
        'types': [],
        'bannedKeywords': [
            'fishing_net',
            'fishing_rod',
            'fishing_spear',
            'fishing_cage'
        ],
        'icon': 'assets/icons/keywords/fishing_spear.png'
    },
    'fishing_tool': {
        'id': 'fishing_tool',
        'name': 'Fishing tool',
        'requirementText': 'Requires an equipped <object id="fishing_tool" /> related tool.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/fishingTool.png'
    },
    'food': {
        'id': 'food',
        'name': 'Food',
        'requirementText': 'Requires a <object id="food" />.',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'foraging': {
        'id': 'foraging',
        'name': 'Foraging',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'foraging_tool': {
        'id': 'foraging_tool',
        'name': 'Foraging tool',
        'requirementText': 'Requires an equipped <object id="foraging_tool" />.',
        'types': [],
        'bannedKeywords': [
            'foraging_tool'
        ],
        'icon': 'assets/icons/keywords/foraging_tool.png'
    },
    'forge': {
        'id': 'forge',
        'name': 'Forge',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'service'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/service_forge.png'
    },
    'fruit': {
        'id': 'fruit',
        'name': 'Fruit',
        'requirementText': 'Requires a <object id="fruit" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/fruit.png'
    },
    'gathering': {
        'id': 'gathering',
        'name': 'Gathering',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'gdte': {
        'id': 'gdte',
        'name': 'GDTE',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'gem': {
        'id': 'gem',
        'name': 'Gem',
        'requirementText': 'Requires a <object id="gem" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/gem.png'
    },
    'ghostly': {
        'id': 'ghostly',
        'name': 'Ghostly',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'location'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/spectral.png'
    },
    'global': {
        'id': 'global',
        'name': 'Global',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'gold_pan': {
        'id': 'gold_pan',
        'name': 'Gold pan',
        'requirementText': 'Requires an equipped <object id="gold_pan" />.',
        'types': [],
        'bannedKeywords': [
            'gold_pan'
        ],
        'icon': 'assets/icons/keywords/goldPan.png'
    },
    'halfling_rebels': {
        'id': 'halfling_rebels',
        'name': 'Halfling Rebels',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'hatchet': {
        'id': 'hatchet',
        'name': 'Hatchet',
        'requirementText': 'Requires an equipped <object id="hatchet" />.',
        'types': [],
        'bannedKeywords': [
            'hatchet'
        ],
        'icon': 'assets/icons/keywords/hatchet.png'
    },
    'heat_resistant': {
        'id': 'heat_resistant',
        'name': 'Heat resistant',
        'requirementText': 'Requires something <object id="heat_resistant" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/heat_resistant.png'
    },
    'heavy': {
        'id': 'heavy',
        'name': 'Heavy',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'weight'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/weight_heavy.png'
    },
    'hide': {
        'id': 'hide',
        'name': 'Hide',
        'requirementText': 'Requires <object id="hide" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/animal_hide.png'
    },
    'hunting': {
        'id': 'hunting',
        'name': 'Hunting',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'hunting_bow': {
        'id': 'hunting_bow',
        'name': 'Hunting bow',
        'requirementText': 'Requires an equipped <object id="hunting_bow" />.',
        'types': [],
        'bannedKeywords': [
            'hunting_bow'
        ],
        'icon': 'assets/icons/keywords/hunting_bow.png'
    },
    'hunting_net': {
        'id': 'hunting_net',
        'name': 'Hunting net',
        'requirementText': 'Requires an equipped <object id="hunting_net" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/huntingNet.png'
    },
    'hunting_trap': {
        'id': 'hunting_trap',
        'name': 'Hunting trap',
        'requirementText': 'Requires an equipped <object id="hunting_trap" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/huntingTrap.png'
    },
    'ingredient': {
        'id': 'ingredient',
        'name': 'Ingredient',
        'requirementText': 'keywords.singulars.materials.ingredient.requirement',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/ingredient.png'
    },
    'jarvonia': {
        'id': 'jarvonia',
        'name': 'Jarvonia',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'kitchen': {
        'id': 'kitchen',
        'name': 'Kitchen',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'service'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/service_kitchen.png'
    },
    'knife': {
        'id': 'knife',
        'name': 'Knife',
        'requirementText': 'Requires an equipped <object id="knife" />.',
        'types': [],
        'bannedKeywords': [
            'knife'
        ],
        'icon': 'assets/icons/keywords/knife.png'
    },
    'leather': {
        'id': 'leather',
        'name': 'Leather',
        'requirementText': 'Requires <object id="leather" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/leather.png'
    },
    'life_vest': {
        'id': 'life_vest',
        'name': 'Life vest',
        'requirementText': 'Requires an equipped <object id="life_vest" />.',
        'types': [],
        'bannedKeywords': [
            'life_vest'
        ],
        'icon': 'assets/icons/keywords/life_vest.png'
    },
    'light': {
        'id': 'light',
        'name': 'Light',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'weight'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/weight_light.png'
    },
    'light_source': {
        'id': 'light_source',
        'name': 'Light source',
        'requirementText': 'Requires an equipped <object id="light_source" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/light_source.png'
    },
    'local_map': {
        'id': 'local_map',
        'name': 'Local map',
        'requirementText': 'Requires an equipped <object id="local_map" />.',
        'types': [],
        'bannedKeywords': [
            'local_map'
        ],
        'icon': 'assets/icons/keywords/local_map.png'
    },
    'log': {
        'id': 'log',
        'name': 'Log',
        'requirementText': 'Requires a wooden <object id="log" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/logs.png'
    },
    'log_splitter': {
        'id': 'log_splitter',
        'name': 'Log splitter',
        'requirementText': 'Requires an equipped <object id="log_splitter" />.',
        'types': [],
        'bannedKeywords': [
            'log_splitter'
        ],
        'icon': 'assets/icons/keywords/item_log_splitter.png'
    },
    'loom': {
        'id': 'loom',
        'name': 'Loom',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'service'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/service_loom.png'
    },
    'magnetic': {
        'id': 'magnetic',
        'name': 'Magnetic',
        'requirementText': 'Requires an equipped <object id="magnetic" /> item.',
        'types': [],
        'bannedKeywords': [
            'magnetic'
        ],
        'icon': 'assets/icons/keywords/magnetic.png'
    },
    'magnifying_lens': {
        'id': 'magnifying_lens',
        'name': 'Magnifying lens',
        'requirementText': 'Requires an equipped <object id="magnifying_lens" />.',
        'types': [],
        'bannedKeywords': [
            'magnifying_lens'
        ],
        'icon': 'assets/icons/keywords/magnifying_lense.png'
    },
    'medium': {
        'id': 'medium',
        'name': 'Medium',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'weight'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/weight_medium.png'
    },
    'memosphere': {
        'id': 'memosphere',
        'name': 'Memosphere',
        'requirementText': 'Requires a <object id="memosphere" />.',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'mining': {
        'id': 'mining',
        'name': 'Mining',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'mining_ores': {
        'id': 'mining_ores',
        'name': 'Mining ores',
        'requirementText': 'Requires a <object id="mining_ores" /> activity.',
        'types': [
            'activity'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/mining_ore.png'
    },
    'mining_tool': {
        'id': 'mining_tool',
        'name': 'Mining tool',
        'requirementText': 'Requires an equipped <object id="mining_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/miningTool.png'
    },
    'misc.': {
        'id': 'misc.',
        'name': 'Misc.',
        'requirementText': 'Requires a <object id="misc." /> item.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/misc.png'
    },
    'mushroom': {
        'id': 'mushroom',
        'name': 'Mushroom',
        'requirementText': 'Requires a <object id="mushroom" />.',
        'types': [
            'material'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/mushroom.png'
    },
    'needle': {
        'id': 'needle',
        'name': 'Needle',
        'requirementText': 'Requires an equipped <object id="needle" />.',
        'types': [],
        'bannedKeywords': [
            'needle'
        ],
        'icon': 'assets/icons/keywords/needle.png'
    },
    'nugget': {
        'id': 'nugget',
        'name': 'Nugget',
        'requirementText': 'Requires a <object id="nugget" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/nugget.png'
    },
    'offcut': {
        'id': 'offcut',
        'name': 'Offcut',
        'requirementText': 'Requires an <object id="offcut" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/offcut.png'
    },
    'ore': {
        'id': 'ore',
        'name': 'Ore',
        'requirementText': 'Requires an <object id="ore" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/ore.png'
    },
    'pet_egg': {
        'id': 'pet_egg',
        'name': 'Pet egg',
        'requirementText': 'Requires an <object id="pet_egg" />.',
        'types': [],
        'bannedKeywords': []
    },
    'pickaxe': {
        'id': 'pickaxe',
        'name': 'Pickaxe',
        'requirementText': 'Requires an equipped <object id="pickaxe" />.',
        'types': [],
        'bannedKeywords': [
            'pickaxe'
        ],
        'icon': 'assets/icons/keywords/pickaxe.png'
    },
    'pins': {
        'id': 'pins',
        'name': 'Pins',
        'requirementText': 'Requires equipped <object id="pins" />.',
        'types': [],
        'bannedKeywords': [
            'pins'
        ],
        'icon': 'assets/icons/keywords/pins.png'
    },
    'plank': {
        'id': 'plank',
        'name': 'Plank',
        'requirementText': 'Requires a <object id="plank" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/plank.png'
    },
    'plant': {
        'id': 'plant',
        'name': 'Plant',
        'requirementText': 'Requires a <object id="plant" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/plant.png'
    },
    'plant_foraging': {
        'id': 'plant_foraging',
        'name': 'Plant foraging',
        'requirementText': 'Requires a <object id="plant_foraging" /> activity.',
        'types': [
            'activity'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/foraging_plants.png'
    },
    'pliers': {
        'id': 'pliers',
        'name': 'Pliers',
        'requirementText': 'Requires equipped <object id="pliers" />.',
        'types': [],
        'bannedKeywords': [
            'pliers'
        ],
        'icon': 'assets/icons/keywords/pliers.png'
    },
    'potion': {
        'id': 'potion',
        'name': 'Potion',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'processed': {
        'id': 'processed',
        'name': 'Processed',
        'requirementText': 'Requires a <object id="processed" /> material.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/processed.png'
    },
    'proper_gear': {
        'id': 'proper_gear',
        'name': 'Proper gear',
        'requirementText': 'Requires worn pieces of the <object id="proper_gear" /> set.',
        'types': [
            'itemSet'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/itemset_proper_gear.png'
    },
    'regional': {
        'id': 'regional',
        'name': 'Regional',
        'requirementText': '<PLACEHOLDER>',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/text/icon_picker/regional.png'
    },
    'regional_chest': {
        'id': 'regional_chest',
        'name': 'Regional chest',
        'requirementText': 'Requires a <object id="regional_chest" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/chest.png'
    },
    'ring': {
        'id': 'ring',
        'name': 'Ring',
        'requirementText': 'Requires an equipped <object id="ring" />.',
        'types': [
            'gear'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/ring.png'
    },
    'rough_gem': {
        'id': 'rough_gem',
        'name': 'Rough gem',
        'requirementText': 'Requires a <object id="rough_gem" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/rough_gem.png'
    },
    'ruler': {
        'id': 'ruler',
        'name': 'Ruler',
        'requirementText': 'Requires an equipped <object id="ruler" />.',
        'types': [],
        'bannedKeywords': [
            'ruler'
        ],
        'icon': 'assets/icons/keywords/ruler.png'
    },
    'sander': {
        'id': 'sander',
        'name': 'Sander',
        'requirementText': 'Requires an equipped <object id="sander" />.',
        'types': [],
        'bannedKeywords': [
            'sander'
        ],
        'icon': 'assets/icons/keywords/sander.png'
    },
    'sandwich': {
        'id': 'sandwich',
        'name': 'Sandwich',
        'requirementText': 'Requires a <object id="sandwich" />.',
        'types': [
            'consumable'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/sandwich.png'
    },
    'sandwich_recipe': {
        'id': 'sandwich_recipe',
        'name': 'Sandwich recipe',
        'requirementText': 'Requires a <object id="sandwich" /> be made by a <object id="cooking_recipe" />.',
        'types': [
            'recipe'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/recipe_sandwich.png'
    },
    'saw': {
        'id': 'saw',
        'name': 'Saw',
        'requirementText': 'Requires an equipped <object id="saw" />.',
        'types': [],
        'bannedKeywords': [
            'saw'
        ],
        'icon': 'assets/icons/keywords/saw.png'
    },
    'sawmill': {
        'id': 'sawmill',
        'name': 'Sawmill',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'service'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/service_sawmill.png'
    },
    'scissors': {
        'id': 'scissors',
        'name': 'Scissors',
        'requirementText': 'Requires equipped <object id="scissors" />.',
        'types': [],
        'bannedKeywords': [
            'scissors'
        ],
        'icon': 'assets/icons/keywords/scissors.png'
    },
    'screwdriver': {
        'id': 'screwdriver',
        'name': 'Screwdriver',
        'requirementText': 'Requires an equipped <object id="screwdriver" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/screwdriver.png'
    },
    'shield': {
        'id': 'shield',
        'name': 'Shield',
        'requirementText': 'Requires an equipped <object id="shield" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/shield.png'
    },
    'sickle': {
        'id': 'sickle',
        'name': 'Sickle',
        'requirementText': 'Requires an equipped <object id="sickle" />.',
        'types': [],
        'bannedKeywords': [
            'sickle'
        ],
        'icon': 'assets/icons/keywords/sickle.png'
    },
    'skill_book': {
        'id': 'skill_book',
        'name': 'Skill book',
        'requirementText': 'Requires an equipped <object id="skill_book" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/skillBook.png'
    },
    'skilling_chest': {
        'id': 'skilling_chest',
        'name': 'Skilling chest',
        'requirementText': 'Requires a <object id="skilling_chest" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/chest.png'
    },
    'skis': {
        'id': 'skis',
        'name': 'Skis',
        'requirementText': 'Requires equipped <object id="skis" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/skis.png'
    },
    'skydisc': {
        'id': 'skydisc',
        'name': 'Skydisc',
        'requirementText': 'Requires an equipped <object id="skydisc" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/frisbee.png'
    },
    'smelting': {
        'id': 'smelting',
        'name': 'Smelting',
        'requirementText': 'Requires materials that can be used be used in smelting for <object id="smithing" />.',
        'types': [
            'recipe'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/smelting.png'
    },
    'smithing': {
        'id': 'smithing',
        'name': 'Smithing',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'smithing_hammer': {
        'id': 'smithing_hammer',
        'name': 'Smithing hammer',
        'requirementText': 'Requires an equipped <object id="smithing_hammer" />.',
        'types': [],
        'bannedKeywords': [
            'smithing_hammer'
        ],
        'icon': 'assets/icons/keywords/smithing_hammer.png'
    },
    'smithing_tool': {
        'id': 'smithing_tool',
        'name': 'Smithing tool',
        'requirementText': 'Requires an equipped <object id="smithing_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/smithingTool.png'
    },
    'snowy': {
        'id': 'snowy',
        'name': 'Snowy',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'socks': {
        'id': 'socks',
        'name': 'Socks',
        'requirementText': 'Requires a equipped <object id="socks" />.',
        'types': [
            'gear'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/sock.png'
    },
    'spectral': {
        'id': 'spectral',
        'name': 'Spectral',
        'requirementText': 'Requires something <object id="spectral" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/spectral.png'
    },
    'spices': {
        'id': 'spices',
        'name': 'Spices',
        'requirementText': 'Requires an equipped <object id="spices" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/spices.png'
    },
    'swamp': {
        'id': 'swamp',
        'name': 'Swamp',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'syrenthia': {
        'id': 'syrenthia',
        'name': 'Syrenthia',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'tailoring': {
        'id': 'tailoring',
        'name': 'Tailoring',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'tool': {
        'id': 'tool',
        'name': 'Tool',
        'requirementText': 'Requires an equipped <object id="tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/tools.png'
    },
    'toolbox': {
        'id': 'toolbox',
        'name': 'Toolbox',
        'requirementText': 'Requires equipped <object id="toolbox" />',
        'types': [],
        'bannedKeywords': [
            'toolbox'
        ],
        'icon': 'assets/icons/keywords/toolbox.png'
    },
    'trash': {
        'id': 'trash',
        'name': 'Trash',
        'requirementText': 'Requires <object id="trash" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/trash.png'
    },
    'travelling': {
        'id': 'travelling',
        'name': 'Travelling',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'treasure_hunter_set': {
        'id': 'treasure_hunter_set',
        'name': 'Treasure hunter set',
        'requirementText': 'Requires equipped pieces of the <object id="treasure_hunter_set" /> set.',
        'types': [
            'itemSet'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/itemset_treasure_hunter.png'
    },
    'trellin': {
        'id': 'trellin',
        'name': 'Trellin',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'trinket': {
        'id': 'trinket',
        'name': 'Trinket',
        'requirementText': 'Requires a <object id="trinket" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/item_trinket.png'
    },
    'trinketry': {
        'id': 'trinketry',
        'name': 'Trinketry',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'trinketry_bench': {
        'id': 'trinketry_bench',
        'name': 'Trinketry Bench',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'service'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/service_trinketry_bench.png'
    },
    'trinketry_tool': {
        'id': 'trinketry_tool',
        'name': 'Trinketry tool',
        'requirementText': 'Requires an equipped <object id="trinketry_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/trinketryTool.png'
    },
    'ultra_light': {
        'id': 'ultra_light',
        'name': 'Ultra light',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'weight'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/weight_ultra_light.png'
    },
    'underwater': {
        'id': 'underwater',
        'name': 'Underwater',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'location'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/location_underwater.png'
    },
    'upgradeable': {
        'id': 'upgradeable',
        'name': 'Upgradeable',
        'requirementText': 'Requires something <object id="upgradeable" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/upgradeable.png'
    },
    'utility': {
        'id': 'utility',
        'name': 'Utility',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'wallisia': {
        'id': 'wallisia',
        'name': 'Wallisia',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'water': {
        'id': 'water',
        'name': 'Water',
        'requirementText': 'Requires <object id="water" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/water.png'
    },
    'weapon': {
        'id': 'weapon',
        'name': 'Weapon',
        'requirementText': 'Requires an equipped <object id="weapon" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/weapon.png'
    },
    'woodcutting': {
        'id': 'woodcutting',
        'name': 'Woodcutting',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    },
    'woodcutting_tool': {
        'id': 'woodcutting_tool',
        'name': 'Woodcutting tool',
        'requirementText': 'Requires an equipped <object id="woodcutting_tool" />.',
        'types': [],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/woodcuttingTool.png'
    },
    'woodcutting_trees': {
        'id': 'woodcutting_trees',
        'name': 'Woodcutting trees',
        'requirementText': 'Requires a <object id="woodcutting_trees" /> activity.',
        'types': [
            'activity'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/woodcutting_trees.png'
    },
    'workshop': {
        'id': 'workshop',
        'name': 'Workshop',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'service'
        ],
        'bannedKeywords': [],
        'icon': 'assets/icons/keywords/service_workshop.png'
    },
    'wrench': {
        'id': 'wrench',
        'name': 'Wrench',
        'requirementText': 'Requires an equipped <object id="wrench" />.',
        'types': [],
        'bannedKeywords': [
            'wrench'
        ],
        'icon': 'assets/icons/keywords/wrench.png'
    },
    'wrentmark': {
        'id': 'wrentmark',
        'name': 'Wrentmark',
        'requirementText': '<PLACEHOLDER>',
        'types': [
            'search'
        ],
        'bannedKeywords': []
    }
}
