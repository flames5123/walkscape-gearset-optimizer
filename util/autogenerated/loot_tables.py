#!/usr/bin/env python3
"""
Loot tables — drop tables referenced by activities/items/recipes.
DO NOT EDIT MANUALLY
"""

LOOT_TABLES = {
    '99_year_old_wine': {
        'id': '99_year_old_wine',
        'name': '99 year old wine',
        'category': 'collectible',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': '99_year_old_wine',
                'name': '99-year-old wine',
                'icon': 'assets/icons/items/collectibles/99_year_old_wine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'adventurers_guild_chest_table': {
        'id': 'adventurers_guild_chest_table',
        'name': 'adventurers guild chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8.5,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 30,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8.5,
                'rowMinimumAmount': 20,
                'rowMaximumAmount': 60,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'metal_scrap',
                'name': 'Metal scrap',
                'icon': 'assets/icons/items/materials/misc/metal_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8.5,
                'rowMinimumAmount': 20,
                'rowMaximumAmount': 60,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'woodcutting_memosphere',
                'name': 'Woodcutting memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_woodcutting.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mining_memosphere',
                'name': 'Mining memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_mining.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'foraging_memosphere',
                'name': 'Foraging memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_foraging.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fishing_memosphere',
                'name': 'Fishing memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_fishing.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'agility_memosphere',
                'name': 'Agility memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_agility.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'sweet_carrot_pie',
                'name': 'Sweet carrot pie',
                'icon': 'assets/icons/items/materials/food/sweet_carrot_pie.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'jelly_sandwich',
                'name': 'Jelly sandwich',
                'icon': 'assets/icons/items/materials/food/jam_sandwich.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fried_fish_sandwich',
                'name': 'Fried fish sandwich',
                'icon': 'assets/icons/items/materials/food/fish_sandwich.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mushroom_curry',
                'name': 'Mushroom curry',
                'icon': 'assets/icons/items/materials/food/mushroom_curry.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'dynamite',
                'name': 'Dynamite',
                'icon': 'assets/icons/items/gear/skill_gear/mining/dynamite.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'schnitzel',
                'name': 'Schnitzel',
                'icon': 'assets/icons/items/materials/food/schnitzel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            }
        ],
        'subTables': [
            {
                'id': '94475344-84ss-4862-lods-02a8bf0fd1dc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': '81ffb865-bc87-4823-8a76-de0d1e89c15e',
                'weight': 0.2,
                'type': 'common',
                'tableRows': []
            },
            {
                'id': '1ef5d83a-8fe7-4376-a76f-8434695a2fb4',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'adventuring_hatchet',
                        'name': 'Adventuring hatchet',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/adventurers_hatchet.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_pickaxe',
                        'name': 'Adventuring pickaxe',
                        'icon': 'assets/icons/items/gear/skill_gear/mining/adventurers_pickaxe.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_fishing_pole',
                        'name': 'Adventuring fishing pole',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/adventurers_fishing_pole.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_sickle',
                        'name': 'Adventuring sickle',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/adventurers_sickle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_hunting_bow',
                        'name': 'Adventuring hunting bow',
                        'icon': 'assets/icons/items/gear/adventuring_hunting_bow.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b8130a73-a668-43cc-b605-dce49e7098da',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'adventuring_hammer',
                        'name': 'Adventuring hammer',
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/adventurers_hammer.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_frying_pan',
                        'name': 'Adventuring frying pan',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/adventurers_frying_pan.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_saw',
                        'name': 'Adventuring saw',
                        'icon': 'assets/icons/items/gear/skill_gear/carpentry/adventurers_saw.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_wrench',
                        'name': 'Adventuring wrench',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/adventurers_wrench.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_sander',
                        'name': 'Adventuring sander',
                        'icon': 'assets/icons/items/gear/skill_gear/adventurers_sander.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_sewing_needle',
                        'name': 'Adventuring sewing needle',
                        'icon': 'assets/icons/items/gear/adventuring_needle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'f21be717-31fb-439b-8000-203d69e42304',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'adventuring_ring',
                        'name': 'Adventuring ring',
                        'icon': 'assets/icons/items/gear/rings/adventurers_ring.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adventuring_amulet',
                        'name': 'Adventuring amulet',
                        'icon': 'assets/icons/items/gear/neck/adventurers_amulet.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'ceecd17a-db09-4864-bc14-e76051ee02cf',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'shoes_of_escape',
                        'name': 'Shoes of escape',
                        'icon': 'assets/icons/items/gear/feet/shoes_of_escape.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'axe_of_destruction',
                        'name': 'Axe of destruction',
                        'icon': 'assets/icons/items/gear/axes/axe_of_destruction.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '2f4da361-b414-4e90-8a5f-46c44486fc7c',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'agility_activity_chest': {
        'id': 'agility_activity_chest',
        'name': 'agility activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'agility_chest',
                'name': 'Agility chest',
                'icon': 'assets/icons/items/openables/chests/agility_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'agility_chest_table': {
        'id': 'agility_chest_table',
        'name': 'agility chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'wine',
                'name': 'Wine',
                'icon': 'assets/icons/items/materials/food/wine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'nettle',
                'name': 'Nettle',
                'icon': 'assets/icons/items/materials/plants/nettle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'thistle',
                'name': 'Thistle',
                'icon': 'assets/icons/items/materials/plants/thistle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fishbone',
                'name': 'Fishbone',
                'icon': 'assets/icons/items/materials/misc/fishbone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'agility_memosphere',
                'name': 'Agility memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_agility.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': 'bd29cbd4-fe71-4979-91f8-e267abae4518',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'eel_trinket',
                        'name': 'Eel trinket',
                        'icon': 'assets/icons/items/materials/misc/eel_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    },
                    {
                        'rowItemID': 'compass_trinket',
                        'name': 'Compass trinket',
                        'icon': 'assets/icons/items/materials/misc/compass_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '84cebf0b-7e8e-4c48-b1d7-8000e845afc6',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'walking_stick',
                        'name': 'Walking stick',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/walking_stick.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'water_bottle',
                        'name': 'Water bottle',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/water_bottle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'e10de81f-af1a-4468-9833-ee029888d542',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'running_shorts',
                        'name': 'Running shorts',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/runnint_shorts.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'running_shirt',
                        'name': 'Running shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/runnint_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'fc7fee74-57d2-480c-ad8d-91e19c778fea',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'grappling_hook',
                        'name': 'Grappling hook',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/grappling_hook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'toe_shoes',
                        'name': 'Toe shoes',
                        'icon': 'assets/icons/items/gear/toe_shoes.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '1f91f2e1-a508-4366-8e01-f56d06753257',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'medieval_sneakers',
                        'name': 'Medieval sneakers',
                        'icon': 'assets/icons/items/gear/skill_gear/medieval_sneakers.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'stepring',
                        'name': 'Stepring',
                        'icon': 'assets/icons/items/gear/stepring.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '527e2bf7-2839-4792-bc1b-0df10a7d1338',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'exercise_headband',
                        'name': 'Exercise headband',
                        'icon': 'assets/icons/items/gear/skill_gear/exercise_headband.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '9456caa5-9270-4658-a470-b37a8502e999',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'alligator_hunting': {
        'id': 'alligator_hunting',
        'name': 'alligator hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'elderhide_scraps',
                'name': 'Elderhide scraps',
                'icon': 'assets/icons/items/materials/misc/Elder_hide_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 50,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'elderhide_hide',
                'name': 'Elderhide hide',
                'icon': 'assets/icons/items/materials/misc/elder_hide.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'ancient_ankh': {
        'id': 'ancient_ankh',
        'name': 'ancient ankh',
        'category': 'collectible',
        'noDropChance': 0.9993,
        'tableRows': [
            {
                'rowItemID': 'ancient_ankh',
                'name': 'Ancient ankh',
                'icon': 'assets/icons/items/collectibles/anicent_ankh.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'ancient_trident_collectible': {
        'id': 'ancient_trident_collectible',
        'name': 'ancient trident collectible',
        'category': 'collectible',
        'noDropChance': 0.995,
        'tableRows': [
            {
                'rowItemID': 'ancient_trident',
                'name': 'Ancient trident',
                'icon': 'assets/icons/items/syrenthia/ancient_trident.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'anglerfish_mask_collectible': {
        'id': 'anglerfish_mask_collectible',
        'name': 'anglerfish mask collectible',
        'category': 'collectible',
        'noDropChance': 0.998,
        'tableRows': [
            {
                'rowItemID': 'anglerfish_mask',
                'name': 'Anglerfish mask',
                'icon': 'assets/icons/items/syrenthia/anglerfish_mask.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'antique_market_assessment': {
        'id': 'antique_market_assessment',
        'name': 'antique market assessment',
        'category': 'normal',
        'noDropChance': 0.25,
        'tableRows': [
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_star_pearl',
                'name': 'Rough star pearl',
                'icon': 'assets/icons/items/materials/ores/rough_star_pearl.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_wrentmarine',
                'name': 'Rough wrentmarine',
                'icon': 'assets/icons/items/materials/ores/rough_wrentmarine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 100,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'rough_jade',
                'name': 'Rough jade',
                'icon': 'assets/icons/items/materials/ores/rough_jade.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_topaz',
                'name': 'Rough topaz',
                'icon': 'assets/icons/items/materials/ores/rough_topaz.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'bear_hunting': {
        'id': 'bear_hunting',
        'name': 'bear hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'animal_fur',
                'name': 'Animal fur',
                'icon': 'assets/icons/items/materials/animal_fur.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'basic_hide',
                'name': 'Basic hide',
                'icon': 'assets/icons/items/materials/misc/light_hide.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 55,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'weighted_vest',
                'name': 'Weighted vest',
                'icon': 'assets/icons/items/gear/weighted_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.19,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'birch_skis': {
        'id': 'birch_skis',
        'name': 'birch skis',
        'category': 'normal',
        'noDropChance': 0.995,
        'tableRows': [
            {
                'rowItemID': 'birch_skis',
                'name': 'Birch skis',
                'icon': 'assets/icons/items/gear/skill_gear/skiis_birch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'bird_feeding': {
        'id': 'bird_feeding',
        'name': 'bird feeding',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'feather',
                'name': 'Feather',
                'icon': 'assets/icons/items/materials/feather.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 85,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'dark_feather',
                'name': 'Dark feather',
                'icon': 'assets/icons/items/materials/dark_feather.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 13,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'bird_nest_table': {
        'id': 'bird_nest_table',
        'name': 'bird nest table',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'berries',
                'name': 'Berries',
                'icon': 'assets/icons/items/materials/plants/berries.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 8,
                'rowMaximumAmount': 16,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'egg',
                'name': 'Egg',
                'icon': 'assets/icons/items/syrenthia/egg.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'feather',
                'name': 'Feather',
                'icon': 'assets/icons/items/materials/feather.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'bird_watching': {
        'id': 'bird_watching',
        'name': 'bird watching',
        'category': 'normal',
        'noDropChance': 0.07,
        'tableRows': [
            {
                'rowItemID': 'feather',
                'name': 'Feather',
                'icon': 'assets/icons/items/materials/feather.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 60,
                'rowMinimumAmount': 25,
                'rowMaximumAmount': 35,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'dark_feather',
                'name': 'Dark feather',
                'icon': 'assets/icons/items/materials/dark_feather.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'root',
                'name': 'Root',
                'icon': 'assets/icons/items/materials/plants/roots.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'aerodynamic_thread',
                'name': 'Aerodynamic thread',
                'icon': 'assets/icons/items/materials/aerodynamic_thread.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'blue_lotus_butterfly': {
        'id': 'blue_lotus_butterfly',
        'name': 'blue lotus butterfly',
        'category': 'collectible',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': 'blue_lotus_butterfly',
                'name': 'Blue lotus butterfly',
                'icon': 'assets/icons/items/collectibles/blue_lotus_butterfly.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'bog_fishing_net': {
        'id': 'bog_fishing_net',
        'name': 'bog fishing (net)',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_largemouth_bass',
                'name': 'Raw largemouth bass',
                'icon': 'assets/icons/items/materials/fish/raw_largemouth_bass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mud',
                'name': 'Mud',
                'icon': 'assets/icons/items/materials/misc/mud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_perch',
                'name': 'Raw perch',
                'icon': 'assets/icons/items/materials/fish/perch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'bog_fishing_spear': {
        'id': 'bog_fishing_spear',
        'name': 'bog fishing (spear)',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_largemouth_bass',
                'name': 'Raw largemouth bass',
                'icon': 'assets/icons/items/materials/fish/raw_largemouth_bass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'sweet_kelp',
                'name': 'Sweet kelp',
                'icon': 'assets/icons/items/syrenthia/sweet_kelp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mud',
                'name': 'Mud',
                'icon': 'assets/icons/items/materials/misc/mud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_perch',
                'name': 'Raw perch',
                'icon': 'assets/icons/items/materials/fish/perch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'box_trapping': {
        'id': 'box_trapping',
        'name': 'box trapping',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'aerodynamic_thread',
                'name': 'Aerodynamic thread',
                'icon': 'assets/icons/items/materials/aerodynamic_thread.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'birch_plank',
                'name': 'Birch plank',
                'icon': 'assets/icons/items/materials/planks/birch_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_plank',
                'name': 'Pine plank',
                'icon': 'assets/icons/items/materials/planks/pine_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 13,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spruce_plank',
                'name': 'Spruce plank',
                'icon': 'assets/icons/items/materials/planks/spruce_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'oak_plank',
                'name': 'Oak plank',
                'icon': 'assets/icons/items/materials/planks/oak_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hide_scraps',
                'name': 'Hide scraps',
                'icon': 'assets/icons/items/materials/misc/leather_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'box_trapping_tiger_egg': {
        'id': 'box_trapping_tiger_egg',
        'name': 'box trapping tiger egg',
        'category': 'petEgg',
        'noDropChance': 0.9972,
        'tableRows': [
            {
                'rowItemID': 'tiger_egg',
                'name': 'Tiger egg',
                'icon': 'assets/icons/pets/tiger/tiger_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'branch_trimming': {
        'id': 'branch_trimming',
        'name': 'branch trimming',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'wooden_stick',
                'name': 'Wooden stick',
                'icon': 'assets/icons/items/materials/plants/stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 150,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sturdy_branch',
                'name': 'Sturdy branch',
                'icon': 'assets/icons/items/materials/misc/sturdy_stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'brilliant_emerald_dragonfly_collectible': {
        'id': 'brilliant_emerald_dragonfly_collectible',
        'name': 'brilliant emerald dragonfly collectible',
        'category': 'collectible',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': 'brilliant_emerald_dragonfly',
                'name': 'Brilliant emerald dragonfly',
                'icon': 'assets/icons/items/collectibles/brilliant_emerald_dragonfly.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'butterfly_catching': {
        'id': 'butterfly_catching',
        'name': 'butterfly catching',
        'category': 'normal',
        'noDropChance': 0.2,
        'tableRows': [
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fireflies_in_a_jar',
                'name': 'Fireflies in a jar',
                'icon': 'assets/icons/items/gear/skill_gear/foraging/fireflies_in_a_jar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.04,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'honeycomb',
                'name': 'Honeycomb',
                'icon': 'assets/icons/items/materials/misc/honey.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'butterfly_catching_chicken_egg': {
        'id': 'butterfly_catching_chicken_egg',
        'name': 'butterfly catching chicken egg',
        'category': 'petEgg',
        'noDropChance': 0.9992,
        'tableRows': [
            {
                'rowItemID': 'chicken_egg',
                'name': 'Chicken egg',
                'icon': 'assets/icons/pets/chicken/chicken_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'carpentry_activity_chest': {
        'id': 'carpentry_activity_chest',
        'name': 'carpentry activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'carpentry_chest',
                'name': 'Carpentry chest',
                'icon': 'assets/icons/items/openables/chests/carpentry_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'carpentry_chest_table': {
        'id': 'carpentry_chest_table',
        'name': 'carpentry chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'birch_plank',
                'name': 'Birch plank',
                'icon': 'assets/icons/items/materials/planks/birch_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_plank',
                'name': 'Pine plank',
                'icon': 'assets/icons/items/materials/planks/pine_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spruce_plank',
                'name': 'Spruce plank',
                'icon': 'assets/icons/items/materials/planks/spruce_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'maple_plank',
                'name': 'Maple plank',
                'icon': 'assets/icons/items/materials/planks/maple_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'oak_plank',
                'name': 'Oak plank',
                'icon': 'assets/icons/items/materials/planks/oak_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fried_noodles',
                'name': 'Fried noodles',
                'icon': 'assets/icons/items/materials/food/fried_noodles.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'carpentry_memosphere',
                'name': 'Carpentry memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_carpentry.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'teak_plank',
                'name': 'Teak plank',
                'icon': 'assets/icons/items/materials/planks/teak_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'willow_plank',
                'name': 'Willow plank',
                'icon': 'assets/icons/items/materials/planks/willow_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'mangrove_plank',
                'name': 'Mangrove plank',
                'icon': 'assets/icons/items/materials/planks/magrove_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '0161f184-06bc-4120-912b-2e822f3d6d6e',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'beaver_trinket',
                        'name': 'Beaver trinket',
                        'icon': 'assets/icons/items/materials/misc/beaver_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '525ee1fe-2c60-4b39-8943-12cddcc7aea1',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'compressed_charcoal',
                        'name': 'Compressed charcoal',
                        'icon': 'assets/icons/items/gear/compressed_charcoal.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'flimsy_ruler',
                        'name': 'Flimsy ruler',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/simple_ruler.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b09f1e46-ba05-442d-b558-5eb1be4351bb',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'protective_gloves',
                        'name': 'Protective gloves',
                        'icon': 'assets/icons/items/gear/skill_gear/protective_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'protractor',
                        'name': 'Protractor',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/protractor.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'protective_pants',
                        'name': 'Protective pants',
                        'icon': 'assets/icons/items/gear/skill_gear/carpentry/protective_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'woodworking_glasses',
                        'name': 'Woodworking glasses',
                        'icon': 'assets/icons/items/gear/skill_gear/woodworking_glasses.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '801b7127-06f0-4c9f-8dcc-f95d241695d4',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'protective_shirt',
                        'name': 'Protective shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/protective_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'precise_ruler',
                        'name': 'Precise ruler',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/precise_ruler.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'bcdcbe87-f712-4c80-b4df-d5feaff11488',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'handsaw',
                        'name': 'Handsaw',
                        'icon': 'assets/icons/items/gear/skill_gear/handsaw.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'carpenters_clogs',
                        'name': "Carpenter's clogs",
                        'icon': 'assets/icons/items/gear/carpenters_clogs.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'ac1bb943-bc67-4297-acc6-024cbd52635e',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'hookhat',
                        'name': 'Hookhat',
                        'icon': 'assets/icons/items/gear/hookhat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'e688e6f0-acd1-42c8-b1e9-d851efb4ba04',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'cave_diving': {
        'id': 'cave_diving',
        'name': 'cave diving',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'tarsilium_ore',
                'name': 'Tarsilium ore',
                'icon': 'assets/icons/items/materials/ores/tarsilium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'volcanic_rock',
                'name': 'Volcanic rock',
                'icon': 'assets/icons/items/syrenthia/volcanic_rock.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pearls',
                'name': 'Pearls',
                'icon': 'assets/icons/items/materials/misc/pearls.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'salty_hops',
                'name': 'Salty hops',
                'icon': 'assets/icons/items/syrenthia/salty_hops.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'glowstick',
                'name': 'Glowstick',
                'icon': 'assets/icons/items/syrenthia/glowstick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bat_trinket',
                'name': 'Bat trinket',
                'icon': 'assets/icons/items/materials/misc/bat_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cave_foraging': {
        'id': 'cave_foraging',
        'name': 'cave foraging',
        'category': 'normal',
        'noDropChance': 0.3,
        'tableRows': [
            {
                'rowItemID': 'mushroom',
                'name': 'Mushroom',
                'icon': 'assets/icons/items/materials/farming/yield/mushroom.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'carrot',
                'name': 'Carrot',
                'icon': 'assets/icons/items/materials/farming/yield/carrot.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'honeycomb',
                'name': 'Honeycomb',
                'icon': 'assets/icons/items/materials/misc/honey.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bat_trinket',
                'name': 'Bat trinket',
                'icon': 'assets/icons/items/materials/misc/bat_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.02,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cleaning_the_holy_fountain': {
        'id': 'cleaning_the_holy_fountain',
        'name': 'cleaning the holy fountain',
        'category': 'normal',
        'noDropChance': 0.75,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 10,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'cliffs_foraging_jarvonia': {
        'id': 'cliffs_foraging_jarvonia',
        'name': 'cliffs foraging jarvonia',
        'category': 'normal',
        'noDropChance': 0.15,
        'tableRows': [
            {
                'rowItemID': 'berries',
                'name': 'Berries',
                'icon': 'assets/icons/items/materials/plants/berries.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9.6,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'feather_cape',
                'name': 'Feather cape',
                'icon': 'assets/icons/items/gear/capes/feather_cape.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.02,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'honeycomb',
                'name': 'Honeycomb',
                'icon': 'assets/icons/items/materials/misc/honey.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'coin_pouch_activity': {
        'id': 'coin_pouch_activity',
        'name': 'coin pouch activity',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'coin_pouch',
                'name': 'Coin pouch',
                'icon': 'assets/icons/items/openables/chests/coin_pouch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'coin_pouch_table': {
        'id': 'coin_pouch_table',
        'name': 'coin pouch table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 40,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 30,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 30,
                'rowMaximumAmount': 50,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 50,
                'rowMaximumAmount': 70,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 4.8,
                'rowMinimumAmount': 70,
                'rowMaximumAmount': 100,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 100,
                'rowMaximumAmount': 1000,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '2c639e59-a27e-4362-a345-359ebb08f66b',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': '1df473a9-bdb2-4766-9386-f679ad678d04',
                'weight': 0.2,
                'type': 'common',
                'tableRows': []
            },
            {
                'id': '740f2736-f609-4fbd-b449-5f9d61233939',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': []
            },
            {
                'id': '5534c5d0-2d51-4d0e-b429-e4754c6470db',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': []
            },
            {
                'id': '2cd196ec-b8fd-481d-a081-d5c781264424',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': []
            },
            {
                'id': 'a3d4f067-f080-44c6-8c00-727f7f381b25',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': []
            },
            {
                'id': 'b17b5f84-1ccb-4c20-9935-f2d77ef7b4ff',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'cold_embrace_collectible': {
        'id': 'cold_embrace_collectible',
        'name': 'cold embrace collectible',
        'category': 'collectible',
        'noDropChance': 0.9974,
        'tableRows': [
            {
                'rowItemID': 'cold_embrace',
                'name': 'Cold Embrace',
                'icon': 'assets/icons/items/collectibles/cold_embrace.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cooking_activity_chest': {
        'id': 'cooking_activity_chest',
        'name': 'cooking activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'cooking_chest',
                'name': 'Cooking chest',
                'icon': 'assets/icons/items/openables/chests/cooking_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cooking_chest_table': {
        'id': 'cooking_chest_table',
        'name': 'cooking chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_perch',
                'name': 'Raw perch',
                'icon': 'assets/icons/items/materials/fish/perch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_carp',
                'name': 'Raw carp',
                'icon': 'assets/icons/items/materials/fish/carp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'egg',
                'name': 'Egg',
                'icon': 'assets/icons/items/syrenthia/egg.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'cooking_memosphere',
                'name': 'Cooking memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_cooking.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'potato',
                'name': 'Potato',
                'icon': 'assets/icons/items/materials/farming/yield/potato.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'milk',
                'name': 'Milk',
                'icon': 'assets/icons/items/materials/food/milk.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fruit_cake',
                'name': 'Fruit cake',
                'icon': 'assets/icons/items/materials/food/fruit_cake.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '94475344-d558-4862-aecf-02a8bf0fd1dc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'measuring_spoons_trinket',
                        'name': 'Measuring spoons trinket',
                        'icon': 'assets/icons/items/materials/misc/measuring_spoon_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'ba81c95e-e745-4a13-aa95-58035cc2fc53',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'dull_knife',
                        'name': 'Dull knife',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/dull_knife.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'floras_silver_spoon',
                        'name': "Flora's silver spoon",
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/floras_silver_spoon.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'sturdy_whisk',
                        'name': 'Sturdy whisk',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/sturdy_whisk.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '88107d7e-adc4-4c11-ae50-1ebe3a3c3efa',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'cutting_board',
                        'name': 'Cutting board',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/cutting_board.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'oven_mittens',
                        'name': 'Oven mittens',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/oven_mittens.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'non_slip_shoes',
                        'name': 'Non-slip shoes',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/nonslip_shoes.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '42028c70-ba8f-4e3a-98b4-bb80bcb6c62c',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'chefs_apron',
                        'name': "Chef's apron",
                        'icon': 'assets/icons/items/gear/skill_gear/chefs_apron.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'chefs_hat',
                        'name': "Chef's hat",
                        'icon': 'assets/icons/items/gear/skill_gear/chefs_hat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'large_pot',
                        'name': 'Large pot',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/large_pot.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'flippy_spatula',
                        'name': 'Flippy spatula',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/flippy_spatula.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b4f8df00-2bee-4617-83c9-2967be6191de',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'chefs_leg_apron',
                        'name': "Chef's leg apron",
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/chefs_leg_apron.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'meat_cleaver',
                        'name': 'Meat cleaver',
                        'icon': 'assets/icons/items/gear/skill_gear/meat_cleaver.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '4f4c43f0-dc99-4db0-96c5-c077ef8fec43',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'recipe_book',
                        'name': 'Recipe book',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/recipe_book.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '853a6d5d-c41e-46f1-a5a9-892e25e3fecb',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'coral_chest_drop': {
        'id': 'coral_chest_drop',
        'name': 'coral chest drop',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'coral_chest',
                'name': 'Coral chest',
                'icon': 'assets/icons/items/openables/chests/coral_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'coral_chest_table': {
        'id': 'coral_chest_table',
        'name': 'coral chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pearls',
                'name': 'Pearls',
                'icon': 'assets/icons/items/materials/misc/pearls.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'salty_hops',
                'name': 'Salty hops',
                'icon': 'assets/icons/items/syrenthia/salty_hops.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'kelp',
                'name': 'Kelp',
                'icon': 'assets/icons/items/syrenthia/kelp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'coral',
                'name': 'Coral',
                'icon': 'assets/icons/items/syrenthia/coral.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '98455344-d558-6248-aecf-3258bf0fd1dc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': '8be94468-2905-4c30-82b8-ae50843373d3',
                'weight': 0.2,
                'type': 'common',
                'tableRows': []
            },
            {
                'id': 'ea99af55-1baa-433a-8eff-f2115e6247f5',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'coral_cape',
                        'name': 'Coral cape',
                        'icon': 'assets/icons/items/syrenthia/coral_cape.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '884e6569-dacf-41db-a5a4-3a203094c95c',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': []
            },
            {
                'id': '19a69c5c-06c0-4c33-8376-605a58c66820',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': []
            },
            {
                'id': 'd380a214-883f-4cd2-9260-a8489d735c5c',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': []
            },
            {
                'id': '22d6868e-ec7c-4a59-9c0e-9539dbd0f90a',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'coral_cutting': {
        'id': 'coral_cutting',
        'name': 'coral cutting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'coral',
                'name': 'Coral',
                'icon': 'assets/icons/items/syrenthia/coral.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'crab_tracking': {
        'id': 'crab_tracking',
        'name': 'crab tracking',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'raw_crab',
                'name': 'Raw crab',
                'icon': 'assets/icons/items/materials/fish/crab.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'crafting_activity_chest': {
        'id': 'crafting_activity_chest',
        'name': 'crafting activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'crafting_chest',
                'name': 'Crafting chest',
                'icon': 'assets/icons/items/openables/chests/crafting_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'crafting_chest_table': {
        'id': 'crafting_chest_table',
        'name': 'crafting chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'birch_plank',
                'name': 'Birch plank',
                'icon': 'assets/icons/items/materials/planks/birch_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_plank',
                'name': 'Pine plank',
                'icon': 'assets/icons/items/materials/planks/pine_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spruce_plank',
                'name': 'Spruce plank',
                'icon': 'assets/icons/items/materials/planks/spruce_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'maple_plank',
                'name': 'Maple plank',
                'icon': 'assets/icons/items/materials/planks/maple_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'oak_plank',
                'name': 'Oak plank',
                'icon': 'assets/icons/items/materials/planks/oak_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_bar',
                'name': 'Iron bar',
                'icon': 'assets/icons/items/materials/bars/iron_bar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bronze_bar',
                'name': 'Bronze bar',
                'icon': 'assets/icons/items/materials/bars/bronze_bar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 6,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tarsilium_bar',
                'name': 'Tarsilium bar',
                'icon': 'assets/icons/items/materials/bars/tarsilium_bar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'farganite_bar',
                'name': 'Farganite bar',
                'icon': 'assets/icons/items/materials/bars/farganite_bar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'crafting_memosphere',
                'name': 'Crafting memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_crafting.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'teak_plank',
                'name': 'Teak plank',
                'icon': 'assets/icons/items/materials/planks/teak_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'willow_plank',
                'name': 'Willow plank',
                'icon': 'assets/icons/items/materials/planks/willow_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'mangrove_plank',
                'name': 'Mangrove plank',
                'icon': 'assets/icons/items/materials/planks/magrove_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '553138f9-3b77-4b7f-ba27-cfc15e61bc90',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'pink_pearl_trinket',
                        'name': 'Pink pearl trinket',
                        'icon': 'assets/icons/items/materials/misc/pink_pearl_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'ee1753a4-cd60-458d-9042-38a679a01233',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'crafting_pants',
                        'name': 'Crafting pants',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/crafting_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'crafting_boots',
                        'name': 'Crafting boots',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/crafting_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '3c922979-e2e6-4140-a76b-612e235c418d',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'crafting_shirt',
                        'name': 'Crafting shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/crafting_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'slipstick',
                        'name': 'Slipstick',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/sliding_ruler.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'screwdriver',
                        'name': 'Screwdriver',
                        'icon': 'assets/icons/items/gear/skill_gear/screwdriver.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '49c261f9-8ffb-4284-b8d4-8e69327fae78',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'grippy_gloves',
                        'name': 'Grippy gloves',
                        'icon': 'assets/icons/items/gear/skill_gear/grippy_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'adjustable_wrench',
                        'name': 'Adjustable wrench',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting/adjustable_wrench.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'protective_glasses',
                        'name': 'Protective glasses',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/protective_glasses.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'a57dba60-700d-4ea3-bb60-5e243aab62d7',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'crafting_guidebook',
                        'name': 'Crafting guidebook',
                        'icon': 'assets/icons/items/gear/skill_gear/crafting_guidebook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'modified_platform_shoes',
                        'name': 'Modified platform shoes',
                        'icon': 'assets/icons/items/gear/modifiable_crafting_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'f82f4402-0e6e-442d-8331-9427cb560b43',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'candlehat',
                        'name': 'Candlehat',
                        'icon': 'assets/icons/items/gear/skill_gear/candlehat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '610c8342-d902-4851-8cb6-b00a04be12ff',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'cut_bamboo_mummy_egg': {
        'id': 'cut_bamboo_mummy_egg',
        'name': 'cut bamboo mummy egg',
        'category': 'petEgg',
        'noDropChance': 0.99954,
        'tableRows': [
            {
                'rowItemID': 'mummy_egg',
                'name': 'Mummy egg',
                'icon': 'assets/icons/pets/mummy/mummy_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'cut_bamboo_trees': {
        'id': 'cut_bamboo_trees',
        'name': 'cut bamboo trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'bamboo_logs',
                'name': 'Bamboo logs',
                'icon': 'assets/icons/items/materials/logs/bamboo_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'circular_root_trinket',
                'name': 'Circular root trinket',
                'icon': 'assets/icons/items/materials/misc/circular_root_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.17,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_birch_trees': {
        'id': 'cut_birch_trees',
        'name': 'cut birch trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'birch_logs',
                'name': 'Birch logs',
                'icon': 'assets/icons/items/materials/logs/birch_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_ecto_trees': {
        'id': 'cut_ecto_trees',
        'name': 'cut ecto trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'ectoplasm_logs',
                'name': 'Ectoplasm logs',
                'icon': 'assets/icons/items/materials/ecto_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_mangrove_trees': {
        'id': 'cut_mangrove_trees',
        'name': 'cut mangrove trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'mangrove_logs',
                'name': 'Mangrove logs',
                'icon': 'assets/icons/items/materials/logs/mangrove_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'circular_root_trinket',
                'name': 'Circular root trinket',
                'icon': 'assets/icons/items/materials/misc/circular_root_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.28,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_maple_trees': {
        'id': 'cut_maple_trees',
        'name': 'cut maple trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'maple_logs',
                'name': 'Maple logs',
                'icon': 'assets/icons/items/materials/logs/maple_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'circular_root_trinket',
                'name': 'Circular root trinket',
                'icon': 'assets/icons/items/materials/misc/circular_root_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.16,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_oak_trees': {
        'id': 'cut_oak_trees',
        'name': 'cut oak trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'oak_logs',
                'name': 'Oak logs',
                'icon': 'assets/icons/items/materials/logs/oak_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_pine_trees': {
        'id': 'cut_pine_trees',
        'name': 'cut pine trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'pine_logs',
                'name': 'Pine logs',
                'icon': 'assets/icons/items/materials/logs/pine_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_spruce_trees': {
        'id': 'cut_spruce_trees',
        'name': 'cut spruce trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'spruce_logs',
                'name': 'Spruce logs',
                'icon': 'assets/icons/items/materials/logs/spruce_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_teak_trees': {
        'id': 'cut_teak_trees',
        'name': 'cut teak trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'teak_logs',
                'name': 'Teak logs',
                'icon': 'assets/icons/items/materials/logs/teak_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'beaver_trinket',
                'name': 'Beaver trinket',
                'icon': 'assets/icons/items/materials/misc/beaver_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_willow_trees': {
        'id': 'cut_willow_trees',
        'name': 'cut willow trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'willow_logs',
                'name': 'Willow logs',
                'icon': 'assets/icons/items/materials/logs/willow_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'circular_root_trinket',
                'name': 'Circular root trinket',
                'icon': 'assets/icons/items/materials/misc/circular_root_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.13,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'cut_yew_trees': {
        'id': 'cut_yew_trees',
        'name': 'cut yew trees',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'yew_logs',
                'name': 'Yew logs',
                'icon': 'assets/icons/items/materials/logs/yew_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1000,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'deer_hunting': {
        'id': 'deer_hunting',
        'name': 'deer hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'hide_scraps',
                'name': 'Hide scraps',
                'icon': 'assets/icons/items/materials/misc/leather_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 8,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_fur',
                'name': 'Animal fur',
                'icon': 'assets/icons/items/materials/animal_fur.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'basic_hide',
                'name': 'Basic hide',
                'icon': 'assets/icons/items/materials/misc/light_hide.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 50,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'dinglehopper': {
        'id': 'dinglehopper',
        'name': 'dinglehopper',
        'category': 'collectible',
        'noDropChance': 0.995,
        'tableRows': [
            {
                'rowItemID': 'dinglehopper',
                'name': 'Dinglehopper',
                'icon': 'assets/icons/items/syrenthia/dinglehopper.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'dragonfly_catching': {
        'id': 'dragonfly_catching',
        'name': 'dragonfly catching',
        'category': 'normal',
        'noDropChance': 0.2,
        'tableRows': [
            {
                'rowItemID': 'ironweed',
                'name': 'Ironweed',
                'icon': 'assets/icons/items/materials/plants/ironweed.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'loverose',
                'name': 'Loverose',
                'icon': 'assets/icons/items/materials/plants/loverose.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sunblossom',
                'name': 'Sunblossom',
                'icon': 'assets/icons/items/materials/plants/sunblossom.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'dragonfly_catching_net',
                'name': 'Dragonfly catching net',
                'icon': 'assets/icons/items/gear/dragonfly_catching_net.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.035,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'dragonfly_catching_chicken_egg': {
        'id': 'dragonfly_catching_chicken_egg',
        'name': 'dragonfly catching chicken egg',
        'category': 'petEgg',
        'noDropChance': 0.9986,
        'tableRows': [
            {
                'rowItemID': 'chicken_egg',
                'name': 'Chicken egg',
                'icon': 'assets/icons/pets/chicken/chicken_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'drift_net_dolphin_egg': {
        'id': 'drift_net_dolphin_egg',
        'name': 'drift net dolphin egg',
        'category': 'petEgg',
        'noDropChance': 0.9971,
        'tableRows': [
            {
                'rowItemID': 'dolphin_egg',
                'name': 'Dolphin egg',
                'icon': 'assets/icons/pets/dolphin/dolphin_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'drift_net_hunting': {
        'id': 'drift_net_hunting',
        'name': 'drift net hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_crab',
                'name': 'Raw crab',
                'icon': 'assets/icons/items/materials/fish/crab.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_jellyfish',
                'name': 'Raw jellyfish',
                'icon': 'assets/icons/items/materials/fish/jellyfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_salmon',
                'name': 'Raw salmon',
                'icon': 'assets/icons/items/materials/fish/salmon.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_swordfish',
                'name': 'Raw swordfish',
                'icon': 'assets/icons/items/syrenthia/raw_swordfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_squid',
                'name': 'Raw squid',
                'icon': 'assets/icons/items/materials/fish/squid.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'dumpster_diving_blackspell': {
        'id': 'dumpster_diving_blackspell',
        'name': 'dumpster diving blackspell',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 17,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fishing_line',
                'name': 'Fishing line',
                'icon': 'assets/icons/items/materials/misc/fishing_line.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_carp',
                'name': 'Raw carp',
                'icon': 'assets/icons/items/materials/fish/carp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wine',
                'name': 'Wine',
                'icon': 'assets/icons/items/materials/food/wine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'beer',
                'name': 'Beer',
                'icon': 'assets/icons/items/materials/food/beer.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_fishing_rod',
                'name': 'Pine fishing rod',
                'icon': 'assets/icons/items/gear/fishing_gear/pine_fishing_rod.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1.1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'oak_fishing_rod',
                'name': 'Oak fishing rod',
                'icon': 'assets/icons/items/gear/fishing_gear/oak_fishing_rod.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.6,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ruby',
                'name': 'Rough ruby',
                'icon': 'assets/icons/items/materials/ores/rough_ruby.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.07,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'simple_life_vest',
                'name': 'Simple life vest',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/simple_life_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.07,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'shrimp_trinket',
                'name': 'Shrimp trinket',
                'icon': 'assets/icons/items/materials/misc/shrimp_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.04,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'dumpster_diving_granfiddich': {
        'id': 'dumpster_diving_granfiddich',
        'name': 'dumpster diving granfiddich',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 18,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wooden_stick',
                'name': 'Wooden stick',
                'icon': 'assets/icons/items/materials/plants/stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'birch_logs',
                'name': 'Birch logs',
                'icon': 'assets/icons/items/materials/logs/birch_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_logs',
                'name': 'Pine logs',
                'icon': 'assets/icons/items/materials/logs/pine_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'maple_logs',
                'name': 'Maple logs',
                'icon': 'assets/icons/items/materials/logs/maple_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'cooked_shrimp',
                'name': 'Cooked shrimp',
                'icon': 'assets/icons/items/materials/cooked_fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wine',
                'name': 'Wine',
                'icon': 'assets/icons/items/materials/food/wine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'beer',
                'name': 'Beer',
                'icon': 'assets/icons/items/materials/food/beer.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bronze_hatchet',
                'name': 'Bronze hatchet',
                'icon': 'assets/icons/items/gear/axes/bronze_axe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_hatchet',
                'name': 'Iron hatchet',
                'icon': 'assets/icons/items/gear/axes/iron_axe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'simple_saw',
                'name': 'Simple saw',
                'icon': 'assets/icons/items/gear/skill_gear/carpentry/simple_saw.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'simple_chisel',
                'name': 'Simple chisel',
                'icon': 'assets/icons/items/gear/skill_gear/crafting/simple_chisel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'shrimp_trinket',
                'name': 'Shrimp trinket',
                'icon': 'assets/icons/items/materials/misc/shrimp_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.04,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'ecto_slime_hunting': {
        'id': 'ecto_slime_hunting',
        'name': 'ecto slime hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'ectoplasm_scraps',
                'name': 'Ectoplasm scraps',
                'icon': 'assets/icons/activities/ectoplasm_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'ectoplasm_fishing': {
        'id': 'ectoplasm_fishing',
        'name': 'ectoplasm fishing',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'ectoplasm_fish',
                'name': 'Ectoplasm fish',
                'icon': 'assets/icons/items/materials/ecto_fish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 30,
                        'levelMinScaling': 30,
                        'levelMaxScaling': 50,
                        'scalingWeight': 1,
                        'xpBonus': 6
                    }
                ]
            }
        ],
        'subTables': []
    },
    'erdwise_chest_table': {
        'id': 'erdwise_chest_table',
        'name': 'erdwise chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'creme_brulee',
                'name': 'Creme brulee',
                'icon': 'assets/icons/items/materials/food/creme_brulee.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_star_pearl',
                'name': 'Rough star pearl',
                'icon': 'assets/icons/items/materials/ores/rough_star_pearl.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_wrentmarine',
                'name': 'Rough wrentmarine',
                'icon': 'assets/icons/items/materials/ores/rough_wrentmarine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_topaz',
                'name': 'Rough topaz',
                'icon': 'assets/icons/items/materials/ores/rough_topaz.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_jade',
                'name': 'Rough jade',
                'icon': 'assets/icons/items/materials/ores/rough_jade.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ruby',
                'name': 'Rough ruby',
                'icon': 'assets/icons/items/materials/ores/rough_ruby.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_sun_stone',
                'name': 'Rough sun stone',
                'icon': 'assets/icons/items/materials/ores/rough_sunstone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ethernite',
                'name': 'Rough ethernite',
                'icon': 'assets/icons/items/materials/ores/rough_ethernite.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': 'fe251aad-0f0c-4f08-b5a3-deb688adecd5',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': 'b6b0b9d6-132d-4dfc-bc1a-723dc970c677',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'makeup_set',
                        'name': 'Makeup set',
                        'icon': 'assets/icons/items/gear/make_up_set.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'loose_change_pouch',
                        'name': 'Loose change pouch',
                        'icon': 'assets/icons/items/gear/change_pouch.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'ink_pen',
                        'name': 'Ink pen',
                        'icon': 'assets/icons/items/gear/ink_pen.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'af8d051c-f5d1-4f4e-ab49-8fe82923eb42',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'royal_troubadour_boots',
                        'name': 'Royal troubadour boots',
                        'icon': 'assets/icons/items/gear/royal_troubadour_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'map_of_erdwise',
                        'name': 'Map of Erdwise',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/erdwise_map.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '59cdc30a-5c2c-484f-88c6-82c1280b4894',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'royal_troubadour_pantaloons',
                        'name': 'Royal troubadour pantaloons',
                        'icon': 'assets/icons/items/gear/royal_troubadour_pantaloons.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'royal_troubadour_gloves',
                        'name': 'Royal troubadour gloves',
                        'icon': 'assets/icons/items/gear/royal_troubadour_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '9dd70b57-89c2-4207-a7fa-f4f0f1d4e699',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'royal_troubadour_capesuit',
                        'name': 'Royal troubadour capesuit',
                        'icon': 'assets/icons/items/gear/royal_troubadour_capesuit.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'chrome_wool',
                        'name': 'Chrome wool',
                        'icon': 'assets/icons/items/gear/chrome_wool.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '0551ee25-1d82-4fd7-9fd4-fa2ce5f94d5d',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'royal_troubadour_hat',
                        'name': 'Royal troubadour hat',
                        'icon': 'assets/icons/items/gear/royal_troubadour_hat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'fa4faea7-ea81-4fb5-88a5-8f79ce341552',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': [
                    {
                        'rowItemID': 'flowing_pocketwatch',
                        'name': 'Flowing pocketwatch',
                        'icon': 'assets/icons/items/syrenthia/flowing_pocketwatch.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            }
        ]
    },
    'essence_of_the_swamp_collectible': {
        'id': 'essence_of_the_swamp_collectible',
        'name': 'essence of the swamp collectible',
        'category': 'collectible',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'essence_of_the_swamp',
                'name': 'Essence of the swamp',
                'icon': 'assets/icons/items/materials/misc/green_vial.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'expedition_journal': {
        'id': 'expedition_journal',
        'name': 'expedition journal',
        'category': 'collectible',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': 'expedition_journal',
                'name': 'Expedition journal',
                'icon': 'assets/icons/items/collectibles/expedition_journal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'find_basic_chests': {
        'id': 'find_basic_chests',
        'name': 'find basic chests',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'trinketry_chest',
                'name': 'Trinketry chest',
                'icon': 'assets/icons/items/openables/chests/trinketry_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mining_chest',
                'name': 'Mining chest',
                'icon': 'assets/icons/items/openables/chests/mining_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fishing_chest',
                'name': 'Fishing chest',
                'icon': 'assets/icons/items/openables/chests/fishing_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'woodcutting_chest',
                'name': 'Woodcutting chest',
                'icon': 'assets/icons/items/openables/chests/woodcutting_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'agility_chest',
                'name': 'Agility chest',
                'icon': 'assets/icons/items/openables/chests/agility_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'carpentry_chest',
                'name': 'Carpentry chest',
                'icon': 'assets/icons/items/openables/chests/carpentry_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'cooking_chest',
                'name': 'Cooking chest',
                'icon': 'assets/icons/items/openables/chests/cooking_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'smithing_chest',
                'name': 'Smithing chest',
                'icon': 'assets/icons/items/openables/chests/smithing_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'crafting_chest',
                'name': 'Crafting chest',
                'icon': 'assets/icons/items/openables/chests/crafting_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'foraging_chest',
                'name': 'Foraging chest',
                'icon': 'assets/icons/items/openables/chests/foraging_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'tailoring_chest',
                'name': 'Tailoring chest',
                'icon': 'assets/icons/items/openables/chests/tailoring_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'hunting_chest',
                'name': 'Hunting chest',
                'icon': 'assets/icons/items/openables/chests/hunting_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'find_ectoplasm_drop': {
        'id': 'find_ectoplasm_drop',
        'name': 'find ectoplasm drop',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'ectoplasm',
                'name': 'Ectoplasm',
                'icon': 'assets/icons/items/materials/ectoplasm.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'find_linens': {
        'id': 'find_linens',
        'name': 'find linens',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'linen_cloth',
                'name': 'Linen cloth',
                'icon': 'assets/icons/items/materials/simple_linen.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 67,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 4,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'tough_linen_cloth',
                'name': 'Tough linen cloth',
                'icon': 'assets/icons/items/materials/tough_linen.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 33,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'find_present_items': {
        'id': 'find_present_items',
        'name': 'find present items',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'milk',
                'name': 'Milk',
                'icon': 'assets/icons/items/materials/food/milk.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'chocolate',
                'name': 'Chocolate',
                'icon': 'assets/icons/items/materials/food/chocolate.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'silver_nugget',
                'name': 'Silver nugget',
                'icon': 'assets/icons/items/materials/ores/silver_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 7,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'gold_nugget',
                'name': 'Gold nugget',
                'icon': 'assets/icons/items/materials/ores/gold_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 7,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'pearls',
                'name': 'Pearls',
                'icon': 'assets/icons/items/materials/misc/pearls.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fruit_cake',
                'name': 'Fruit cake',
                'icon': 'assets/icons/items/materials/food/fruit_cake.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'sweet_carrot_pie',
                'name': 'Sweet carrot pie',
                'icon': 'assets/icons/items/materials/food/sweet_carrot_pie.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'find_trash_junk_items': {
        'id': 'find_trash_junk_items',
        'name': 'find trash junk items',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 94,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fishbone',
                'name': 'Fishbone',
                'icon': 'assets/icons/items/materials/misc/fishbone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 16,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mud',
                'name': 'Mud',
                'icon': 'assets/icons/items/materials/misc/mud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'moondaisy',
                'name': 'Moondaisy',
                'icon': 'assets/icons/items/materials/plants/moondaisy.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'milkweed',
                'name': 'Milkweed',
                'icon': 'assets/icons/items/materials/misc/milkweed.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'copper_arrows',
                'name': 'Copper arrows',
                'icon': 'assets/icons/items/gear/arrows/copper_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'rusty_chest',
                'name': 'Rusty chest',
                'icon': 'assets/icons/items/openables/chests/rusty_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'sunken_chest',
                'name': 'Sunken chest',
                'icon': 'assets/icons/items/openables/chests/sunken_treasure_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_torch',
                'name': 'Simple torch',
                'icon': 'assets/icons/items/gear/skill_gear/agility/simple_torch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'birch_skis',
                'name': 'Birch skis',
                'icon': 'assets/icons/items/gear/skill_gear/skiis_birch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'clay_skydisc',
                'name': 'Clay skydisc',
                'icon': 'assets/icons/items/gear/skill_gear/frisbee_clay.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'firewood_making': {
        'id': 'firewood_making',
        'name': 'firewood making',
        'category': 'normal',
        'noDropChance': 0.85,
        'tableRows': [
            {
                'rowItemID': 'tree_scaling_claws',
                'name': 'Tree scaling claws',
                'icon': 'assets/icons/items/gear/skill_gear/woodcutting/tree_scaling_claws.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.28,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'fishing_activity_chest': {
        'id': 'fishing_activity_chest',
        'name': 'fishing activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'fishing_chest',
                'name': 'Fishing chest',
                'icon': 'assets/icons/items/openables/chests/fishing_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'fishing_chest_table': {
        'id': 'fishing_chest_table',
        'name': 'fishing chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_perch',
                'name': 'Raw perch',
                'icon': 'assets/icons/items/materials/fish/perch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_carp',
                'name': 'Raw carp',
                'icon': 'assets/icons/items/materials/fish/carp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_salmon',
                'name': 'Raw salmon',
                'icon': 'assets/icons/items/materials/fish/salmon.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_squid',
                'name': 'Raw squid',
                'icon': 'assets/icons/items/materials/fish/squid.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'frozen_bait',
                'name': 'Frozen bait',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/jarvonian_bait.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bug_bait',
                'name': 'Bug bait',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/gdte_bait.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fishing_memosphere',
                'name': 'Fishing memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_fishing.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_lobster',
                'name': 'Raw lobster',
                'icon': 'assets/icons/items/materials/fish/lobster.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '835c51bd-9159-4568-8262-e4c8865815bc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'heron_trinket',
                        'name': 'Heron trinket',
                        'icon': 'assets/icons/items/materials/misc/heron_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '8123ee39-fcaa-4906-b19f-7e483d679631',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'squishy_flip_flops',
                        'name': 'Squishy flip flops',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/squishy_flipflops.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'catch_bucket',
                        'name': 'Catch bucket',
                        'icon': 'assets/icons/items/gear/catch_bucket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'baa8b3c5-5af0-4c3b-8912-11c24e112f9b',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'sturdy_fishing_rod_rest',
                        'name': 'Sturdy fishing rod rest',
                        'icon': 'assets/icons/items/gear/sturdy_rod_rest.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'cool_sunglasses',
                        'name': 'Cool sunglasses',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/cool_sunglasses.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '7d0cbde9-e07b-428f-b650-4711409a17d8',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'fishermans_hat',
                        'name': "Fisherman's hat",
                        'icon': 'assets/icons/items/gear/skill_gear/fishermans_hat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'breezy_shirt',
                        'name': 'Breezy shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/breezy_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'wading_shoes',
                        'name': 'Wading shoes',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/wading_shoes.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '2c60c6f2-e2e6-45b1-b02a-a5adf7031763',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'fishermans_trousers',
                        'name': "Fisherman's trousers",
                        'icon': 'assets/icons/items/gear/skill_gear/fishermans_trousers.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'fishing_guidebook',
                        'name': 'Fishing guidebook',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/fishing_guidebook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'e303affe-9b78-4ffe-91da-8ec46eeebecd',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'angler_gloves',
                        'name': 'Angler gloves',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/angler_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '3bcea375-9737-472a-9a00-050571c03556',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'flame_of_azura_collectible': {
        'id': 'flame_of_azura_collectible',
        'name': 'flame of azura collectible',
        'category': 'collectible',
        'noDropChance': 0.9991,
        'tableRows': [
            {
                'rowItemID': 'flame_of_azura',
                'name': 'Flame of Azura',
                'icon': 'assets/icons/items/collectibles/flame_of_azura.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'flooded_field_scavenging': {
        'id': 'flooded_field_scavenging',
        'name': 'flooded field scavenging',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'cattail',
                'name': 'Cattail',
                'icon': 'assets/icons/items/materials/plants/cattail.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'highwater_lotus',
                'name': 'Highwater lotus',
                'icon': 'assets/icons/items/materials/plants/water_lotus.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sweet_kelp',
                'name': 'Sweet kelp',
                'icon': 'assets/icons/items/syrenthia/sweet_kelp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'flooded_field_scavenging_tiger_egg': {
        'id': 'flooded_field_scavenging_tiger_egg',
        'name': 'flooded field scavenging tiger egg',
        'category': 'petEgg',
        'noDropChance': 0.9974,
        'tableRows': [
            {
                'rowItemID': 'tiger_egg',
                'name': 'Tiger egg',
                'icon': 'assets/icons/pets/tiger/tiger_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'flooded_river_fishing_rod': {
        'id': 'flooded_river_fishing_rod',
        'name': 'flooded river fishing (rod)',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_largemouth_bass',
                'name': 'Raw largemouth bass',
                'icon': 'assets/icons/items/materials/fish/raw_largemouth_bass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_stream_eel',
                'name': 'Raw stream eel',
                'icon': 'assets/icons/items/materials/fish/stream_eel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_pike',
                'name': 'Raw pike',
                'icon': 'assets/icons/items/materials/fish/pike.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fishing_stringer',
                'name': 'Fishing stringer',
                'icon': 'assets/icons/items/gear/fishing_stringer.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.026,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'flooded_river_fishing_tortoise_egg': {
        'id': 'flooded_river_fishing_tortoise_egg',
        'name': 'flooded river fishing tortoise egg',
        'category': 'petEgg',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'tortoise_egg',
                'name': 'Tortoise egg',
                'icon': 'assets/icons/pets/tortoise/tortoise_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'foraging_activity_chest': {
        'id': 'foraging_activity_chest',
        'name': 'foraging activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'foraging_chest',
                'name': 'Foraging chest',
                'icon': 'assets/icons/items/openables/chests/foraging_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'foraging_chest_table': {
        'id': 'foraging_chest_table',
        'name': 'foraging chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'beer',
                'name': 'Beer',
                'icon': 'assets/icons/items/materials/food/beer.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 6,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sunblossom',
                'name': 'Sunblossom',
                'icon': 'assets/icons/items/materials/plants/sunblossom.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'moondaisy',
                'name': 'Moondaisy',
                'icon': 'assets/icons/items/materials/plants/moondaisy.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'berries',
                'name': 'Berries',
                'icon': 'assets/icons/items/materials/plants/berries.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'veggie_soup',
                'name': 'Veggie soup',
                'icon': 'assets/icons/items/materials/food/veggie_soup.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'foraging_memosphere',
                'name': 'Foraging memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_foraging.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '469ddebb-3143-4738-8435-2c33dfcdd55b',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'shrimp_trinket',
                        'name': 'Shrimp trinket',
                        'icon': 'assets/icons/items/materials/misc/shrimp_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'ce0fd4d7-85e9-4bb3-8c91-961364477299',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'foraging_shorts',
                        'name': 'Foraging shorts',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/foraging_shorts.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'foraging_shirt',
                        'name': 'Foraging shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/foraging_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'pointy_shears',
                        'name': 'Pointy shears',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/shears.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'non_waterproof_boots',
                        'name': 'Non-waterproof boots',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/non_waterproof_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'pickers_gloves',
                        'name': "Picker's gloves",
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/leather_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'a51a197f-5b67-4d50-a381-12de68ec1abf',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'gardening_gloves',
                        'name': 'Gardening gloves',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/gardening_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'waterproof_boots',
                        'name': 'Waterproof boots',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/waterproof_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'leaf_cape',
                        'name': 'Leaf cape',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/camouflage_cape.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'f82f6270-fcb7-42dd-857b-c4ecb5d28936',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'big_basket',
                        'name': 'Big basket',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/big_basket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'long_spade',
                        'name': 'Long spade',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/long_spade.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'wilderness_pants',
                        'name': 'Wilderness pants',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/wilderness_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'wilderness_shirt',
                        'name': 'Wilderness shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/wilderness_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '4ed9041c-6084-4db8-8365-2df08c162ed8',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'halflings_feet_slippers',
                        'name': "Halfling's feet slippers",
                        'icon': 'assets/icons/items/gear/skill_gear/halflings_feet_slippers.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'wilderness_guidebook',
                        'name': 'Wilderness guidebook',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/wilderness_guidebook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '184a8872-56ce-442e-9c4a-2c914030089e',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'hat_with_a_feather',
                        'name': 'Hat with a feather',
                        'icon': 'assets/icons/items/gear/skill_gear/hat_with_a_feather.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b513321a-55cb-4dff-951e-a4273c99f4e5',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'forest_foraging_jarvonia': {
        'id': 'forest_foraging_jarvonia',
        'name': 'forest foraging jarvonia',
        'category': 'normal',
        'noDropChance': 0.05,
        'tableRows': [
            {
                'rowItemID': 'nettle',
                'name': 'Nettle',
                'icon': 'assets/icons/items/materials/plants/nettle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'thistle',
                'name': 'Thistle',
                'icon': 'assets/icons/items/materials/plants/thistle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'moondaisy',
                'name': 'Moondaisy',
                'icon': 'assets/icons/items/materials/plants/moondaisy.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'snowdrop',
                'name': 'Snowdrop',
                'icon': 'assets/icons/items/materials/plants/snowdrop.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wooden_stick',
                'name': 'Wooden stick',
                'icon': 'assets/icons/items/materials/plants/stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 6,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'fossil_mining_sea_horse_collectible': {
        'id': 'fossil_mining_sea_horse_collectible',
        'name': 'fossil mining sea horse collectible',
        'category': 'collectible',
        'noDropChance': 0.995,
        'tableRows': [
            {
                'rowItemID': 'seahorse_fossil',
                'name': 'Seahorse fossil',
                'icon': 'assets/icons/items/syrenthia/seahorse_fossil.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'fossil_mining_swordfish_sword_collectible': {
        'id': 'fossil_mining_swordfish_sword_collectible',
        'name': 'fossil mining swordfish sword collectible',
        'category': 'collectible',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': 'swordfish_sword_fossil',
                'name': 'Swordfish sword fossil',
                'icon': 'assets/icons/items/syrenthia/swordfish_fossil.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'fossil_mining_terrifying_fossil_collectible': {
        'id': 'fossil_mining_terrifying_fossil_collectible',
        'name': 'fossil mining terrifying fossil collectible',
        'category': 'collectible',
        'noDropChance': 0.9999,
        'tableRows': [
            {
                'rowItemID': 'terrifying_fossil',
                'name': 'Terrifying fossil',
                'icon': 'assets/icons/items/syrenthia/terrying_fossil.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'fossil_mining_walrus_teeth_collectible': {
        'id': 'fossil_mining_walrus_teeth_collectible',
        'name': 'fossil mining walrus teeth collectible',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'walrus_tusk',
                'name': 'Walrus tusk',
                'icon': 'assets/icons/items/syrenthia/walrus_tusk.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gain_bird_nest_drop': {
        'id': 'gain_bird_nest_drop',
        'name': 'gain bird nest drop',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'bird_nest',
                'name': 'Bird nest',
                'icon': 'assets/icons/items/openables/chests/birds_nest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gain_coin_pouch_drop': {
        'id': 'gain_coin_pouch_drop',
        'name': 'gain coin pouch drop',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'coin_pouch',
                'name': 'Coin pouch',
                'icon': 'assets/icons/items/openables/chests/coin_pouch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gain_crustacean_table': {
        'id': 'gain_crustacean_table',
        'name': 'gain crustacean table',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_lobster',
                'name': 'Raw lobster',
                'icon': 'assets/icons/items/materials/fish/lobster.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_crab',
                'name': 'Raw crab',
                'icon': 'assets/icons/items/materials/fish/crab.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'gain_fishing_bait_table': {
        'id': 'gain_fishing_bait_table',
        'name': 'gain fishing bait table',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'bug_bait',
                'name': 'Bug bait',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/gdte_bait.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'frozen_bait',
                'name': 'Frozen bait',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/jarvonian_bait.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'gain_gold_nugget_drop': {
        'id': 'gain_gold_nugget_drop',
        'name': 'gain gold nugget drop',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'gold_nugget',
                'name': 'Gold nugget',
                'icon': 'assets/icons/items/materials/ores/gold_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'gain_one_adventurers_guild_token': {
        'id': 'gain_one_adventurers_guild_token',
        'name': 'gain one adventurers guild token',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'adventurers_guild_token',
                'name': "Adventurers' guild token",
                'icon': 'assets/icons/items/currencies/adventure_guild_token_32.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gain_one_money': {
        'id': 'gain_one_money',
        'name': 'gain one money',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gain_plant_fiber_table': {
        'id': 'gain_plant_fiber_table',
        'name': 'gain plant fiber table',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 70,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gain_ten_money': {
        'id': 'gain_ten_money',
        'name': 'gain ten money',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 10,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gdte_gem_table': {
        'id': 'gdte_gem_table',
        'name': 'gdte gem table',
        'category': 'normal',
        'noDropChance': 0.99,
        'tableRows': [
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_jade',
                'name': 'Rough jade',
                'icon': 'assets/icons/items/materials/ores/rough_jade.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 6,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gdte_skydisc_course': {
        'id': 'gdte_skydisc_course',
        'name': 'gdte skydisc course',
        'category': 'normal',
        'noDropChance': 0.9848,
        'tableRows': [
            {
                'rowItemID': 'red_skydisc',
                'name': 'Red skydisc',
                'icon': 'assets/icons/items/gear/red_skydisc.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gem_pouch_activity': {
        'id': 'gem_pouch_activity',
        'name': 'gem pouch activity',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'gem_pouch',
                'name': 'Gem pouch',
                'icon': 'assets/icons/items/openables/chests/gem_pouch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gem_pouch_table': {
        'id': 'gem_pouch_table',
        'name': 'gem pouch table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'rough_star_pearl',
                'name': 'Rough star pearl',
                'icon': 'assets/icons/items/materials/ores/rough_star_pearl.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_wrentmarine',
                'name': 'Rough wrentmarine',
                'icon': 'assets/icons/items/materials/ores/rough_wrentmarine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_topaz',
                'name': 'Rough topaz',
                'icon': 'assets/icons/items/materials/ores/rough_topaz.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_jade',
                'name': 'Rough jade',
                'icon': 'assets/icons/items/materials/ores/rough_jade.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_sun_stone',
                'name': 'Rough sun stone',
                'icon': 'assets/icons/items/materials/ores/rough_sunstone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ethernite',
                'name': 'Rough ethernite',
                'icon': 'assets/icons/items/materials/ores/rough_ethernite.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ruby',
                'name': 'Rough ruby',
                'icon': 'assets/icons/items/materials/ores/rough_ruby.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '0dffb230-e3ad-4c66-a828-b1f9cbae1ab6',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': '7ae7d0ac-875c-4641-bcd3-cd9ca974f81d',
                'weight': 0.2,
                'type': 'common',
                'tableRows': []
            },
            {
                'id': '3adaa016-3c84-46d0-a209-f821f9ff13de',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': []
            },
            {
                'id': 'fd0b8d4f-33dc-4d12-a0dd-cd3a1213d9cb',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': []
            },
            {
                'id': 'cd62393f-caf6-4c3b-8de0-60c7e8e45f66',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': []
            },
            {
                'id': 'a80ebc55-8573-44f8-b309-b63095d10668',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': []
            },
            {
                'id': 'c04d2f98-0bb8-480c-8e51-8bc006891753',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'glacier_foraging': {
        'id': 'glacier_foraging',
        'name': 'glacier foraging',
        'category': 'normal',
        'noDropChance': 0.999875,
        'tableRows': [
            {
                'rowItemID': 'blue_ice_sickle',
                'name': 'Blue ice sickle',
                'icon': 'assets/icons/items/gear/skill_gear/foraging/blue_ice_sickle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'gold_panning': {
        'id': 'gold_panning',
        'name': 'gold panning',
        'category': 'normal',
        'noDropChance': 0.55,
        'tableRows': [
            {
                'rowItemID': 'copper_ore',
                'name': 'Copper ore',
                'icon': 'assets/icons/items/materials/ores/copper_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tin_ore',
                'name': 'Tin ore',
                'icon': 'assets/icons/items/materials/ores/tin_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_copper_ring',
                'name': 'Old copper ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_copper_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.05,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_silver_ring',
                'name': 'Old silver ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_silver_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.05,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_gold_ring',
                'name': 'Old gold ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_gold_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.025,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'gold_nugget',
                'name': 'Gold nugget',
                'icon': 'assets/icons/items/materials/ores/gold_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'silver_nugget',
                'name': 'Silver nugget',
                'icon': 'assets/icons/items/materials/ores/silver_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'graveyard_foraging': {
        'id': 'graveyard_foraging',
        'name': 'graveyard foraging',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_copper_ring',
                'name': 'Old copper ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_copper_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.05,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_silver_ring',
                'name': 'Old silver ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_silver_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.05,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_gold_ring',
                'name': 'Old gold ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_gold_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.025,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'widows_kiss',
                'name': "Widow's kiss",
                'icon': 'assets/icons/items/materials/plants/widows_kiss.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'guaranteed_enamel_pin_table': {
        'id': 'guaranteed_enamel_pin_table',
        'name': 'guaranteed enamel pin table',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'adventurers_enamel_pin',
                'name': "Adventurers' enamel pin",
                'icon': 'assets/icons/items/materials/adventurer_enemal_pin.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'guard_duty': {
        'id': 'guard_duty',
        'name': 'guard duty',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 30,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'halfling_rebel_chest_table': {
        'id': 'halfling_rebel_chest_table',
        'name': 'halfling rebel chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'milkweed',
                'name': 'Milkweed',
                'icon': 'assets/icons/items/materials/misc/milkweed.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'potato',
                'name': 'Potato',
                'icon': 'assets/icons/items/materials/farming/yield/potato.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'mud',
                'name': 'Mud',
                'icon': 'assets/icons/items/materials/misc/mud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'root',
                'name': 'Root',
                'icon': 'assets/icons/items/materials/plants/roots.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'rotbud',
                'name': 'Rotbud',
                'icon': 'assets/icons/items/materials/plants/rotbud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'veggie_soup',
                'name': 'Veggie soup',
                'icon': 'assets/icons/items/materials/food/veggie_soup.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': [
            {
                'id': '706c5c4b-0c19-44ca-8016-72540f0a3beb',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': 'fdb4522c-1a44-4c17-aa71-75bf46d69e3e',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'lil_stool',
                        'name': 'Lil stool',
                        'icon': 'assets/icons/items/gear/lil_stool.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'moss_chewie',
                        'name': 'Moss chewie',
                        'icon': 'assets/icons/items/gear/moss_chewie.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'fingersaw',
                        'name': 'Fingersaw',
                        'icon': 'assets/icons/items/gear/fingersaw.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b188170c-2cfe-419d-8358-986bb0002996',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'bogwood_boots',
                        'name': 'Bogwood boots',
                        'icon': 'assets/icons/items/gear/bogwoods_rebel_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'map_of_halfling_rebels',
                        'name': 'Map of Halfling Rebels',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/halfling_rebels_map.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'ac5064e0-5373-45c0-a25d-bad117470c4a',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'bogwood_shorts',
                        'name': 'Bogwood shorts',
                        'icon': 'assets/icons/items/gear/bogwoods_rebel_shorts.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'bogwood_gloves',
                        'name': 'Bogwood gloves',
                        'icon': 'assets/icons/items/gear/bogwoods_rebel_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '3efc6dd5-91e9-4d00-b380-8eae195e7cce',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'bogwood_vest',
                        'name': 'Bogwood vest',
                        'icon': 'assets/icons/items/gear/bogwoods_rebel_vest.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'lily_pad_rope',
                        'name': 'Lily pad rope',
                        'icon': 'assets/icons/items/gear/lily_pad_rope.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'ed72abd2-c292-45fd-b2e2-0d434bd8bd40',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'bogwood_bandana',
                        'name': 'Bogwood bandana',
                        'icon': 'assets/icons/items/gear/bogwoods_rebel_bandana.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '7ad7dd67-7271-45b7-ab08-dcbd10c0862b',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': [
                    {
                        'rowItemID': 'wholly_ring',
                        'name': 'Wholly ring',
                        'icon': 'assets/icons/items/gear/ring_with_good_stats.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            }
        ]
    },
    'halfmaw_tracking': {
        'id': 'halfmaw_tracking',
        'name': 'halfmaw tracking',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'halfmaw_teeth',
                'name': 'Halfmaw teeth',
                'icon': 'assets/icons/items/materials/halfmaw_teeth.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 33,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'halfmaw_scales',
                'name': 'Halfmaw scales',
                'icon': 'assets/icons/items/materials/halfmaw_scales.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 67,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'halfmaw_venom_collectible': {
        'id': 'halfmaw_venom_collectible',
        'name': 'halfmaw venom collectible',
        'category': 'collectible',
        'noDropChance': 0.9983,
        'tableRows': [
            {
                'rowItemID': 'halfmaw_venom',
                'name': 'Halfmaw venom',
                'icon': 'assets/icons/items/materials/halfmaw_venom.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'haunted_teddy_bear_collectible': {
        'id': 'haunted_teddy_bear_collectible',
        'name': 'haunted teddy bear collectible',
        'category': 'collectible',
        'noDropChance': 0.998,
        'tableRows': [
            {
                'rowItemID': 'haunted_teddy_bear',
                'name': 'Haunted teddy bear',
                'icon': 'assets/icons/items/collectibles/haunted_teddy_bear.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'horn_of_respite_treasure_hunt': {
        'id': 'horn_of_respite_treasure_hunt',
        'name': 'horn of respite treasure hunt',
        'category': 'collectible',
        'noDropChance': 1,
        'tableRows': [],
        'subTables': []
    },
    'horseshoe_making': {
        'id': 'horseshoe_making',
        'name': 'horseshoe making',
        'category': 'normal',
        'noDropChance': 0.85,
        'tableRows': [
            {
                'rowItemID': 'cooling_icicle_trinket',
                'name': 'Cooling icicle trinket',
                'icon': 'assets/icons/items/materials/misc/cooling_ice_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'metal_scrap',
                'name': 'Metal scrap',
                'icon': 'assets/icons/items/materials/misc/metal_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 25.3,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'hunting_activity_chest': {
        'id': 'hunting_activity_chest',
        'name': 'hunting activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'hunting_chest',
                'name': 'Hunting chest',
                'icon': 'assets/icons/items/openables/chests/hunting_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'hunting_chest_table': {
        'id': 'hunting_chest_table',
        'name': 'hunting chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'copper_arrows',
                'name': 'Copper arrows',
                'icon': 'assets/icons/items/gear/arrows/copper_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bronze_arrows',
                'name': 'Bronze arrows',
                'icon': 'assets/icons/items/gear/arrows/bronze_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_arrows',
                'name': 'Iron arrows',
                'icon': 'assets/icons/items/gear/arrows/iron_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'steel_arrows',
                'name': 'Steel arrows',
                'icon': 'assets/icons/items/gear/arrows/steel_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tarsilium_arrows',
                'name': 'Tarsilium arrows',
                'icon': 'assets/icons/items/gear/arrows/tarsilium_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'jerky',
                'name': 'Jerky',
                'icon': 'assets/icons/activities/beef_jerky.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hunting_memosphere',
                'name': 'Hunting memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/hunting_memosphere.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hide_scraps',
                'name': 'Hide scraps',
                'icon': 'assets/icons/items/materials/misc/leather_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 20,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'feather',
                'name': 'Feather',
                'icon': 'assets/icons/items/materials/feather.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 20,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '3644ee44-64b5-4b5e-89a9-c205fd4f0baa',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'shark_tooth_trinket',
                        'name': 'Shark tooth trinket',
                        'icon': 'assets/icons/items/materials/misc/shark_tooth_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '1d196559-f1fe-4454-860d-d333b19e9ad3',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'skinny_field_knife',
                        'name': 'Skinny field knife',
                        'icon': 'assets/icons/items/gear/simple_field_knife.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'trappers_cape',
                        'name': "Trapper's cape",
                        'icon': 'assets/icons/items/gear/capes/trappers_cape.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'camo_face_paint',
                        'name': 'Camo face paint',
                        'icon': 'assets/icons/items/gear/facepaint_camo.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': None,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '1c9b117d-768e-4736-8be6-fa3f46b9d058',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'scent_masking_spray',
                        'name': 'Scent masking spray',
                        'icon': 'assets/icons/items/gear/scent_masking_spray.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'camo_boots',
                        'name': 'Camo boots',
                        'icon': 'assets/icons/items/gear/camoflauge_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '48b7a7ba-801a-470a-940c-21864ba6cd0c',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'flashy_field_knife',
                        'name': 'Flashy field knife',
                        'icon': 'assets/icons/items/gear/field_knife.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'hunting_bestiary',
                        'name': 'Hunting bestiary',
                        'icon': 'assets/icons/items/gear/hunting_beastiary.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'camo_pants',
                        'name': 'Camo pants',
                        'icon': 'assets/icons/items/gear/camoflauge_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': None,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'da4eb19a-4e0f-4c29-9ffb-f14a5c6dcf7b',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'camo_shirt',
                        'name': 'Camo shirt',
                        'icon': 'assets/icons/items/gear/camoflauge_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'duck_decoy',
                        'name': 'Duck decoy',
                        'icon': 'assets/icons/items/gear/duck_decoy.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '2c60e31e-8685-4afc-9786-096b12039076',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'hunting_trip_pack',
                        'name': 'Hunting trip pack',
                        'icon': 'assets/icons/items/gear/hunting_trip_pack.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '093d2309-9619-44c4-a963-becbc7ac43aa',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'ice_sculpting': {
        'id': 'ice_sculpting',
        'name': 'ice sculpting',
        'category': 'normal',
        'noDropChance': 0.5,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 50,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'ice_cutter',
                'name': 'Ice cutter',
                'icon': 'assets/icons/items/gear/skill_gear/carpentry/ice_saw.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.21,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'isthmus_sea_fishing_net': {
        'id': 'isthmus_sea_fishing_net',
        'name': 'isthmus sea fishing (net)',
        'category': 'normal',
        'noDropChance': 0.25,
        'tableRows': [
            {
                'rowItemID': 'raw_moray',
                'name': 'Raw moray',
                'icon': 'assets/icons/items/materials/fish/moray.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'fishnet_shirt',
                'name': 'Fishnet shirt',
                'icon': 'assets/icons/items/gear/fishnet_shirt.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.022,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'shark_tooth_trinket',
                'name': 'Shark tooth trinket',
                'icon': 'assets/icons/items/materials/misc/shark_tooth_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.046,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'jar_of_dirt_collectible': {
        'id': 'jar_of_dirt_collectible',
        'name': 'jar of dirt collectible',
        'category': 'collectible',
        'noDropChance': 0.9987,
        'tableRows': [
            {
                'rowItemID': 'jar_of_dirt',
                'name': 'Jar of dirt',
                'icon': 'assets/icons/items/collectibles/jar_of_dirt.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'jarvonia_chest_table': {
        'id': 'jarvonia_chest_table',
        'name': 'jarvonia chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'tarsilium_ore',
                'name': 'Tarsilium ore',
                'icon': 'assets/icons/items/materials/ores/tarsilium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'farganite_ore',
                'name': 'Farganite ore',
                'icon': 'assets/icons/items/materials/ores/farganite_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 15,
                'rowMaximumAmount': 30,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 13,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'jarvonian_pastry',
                'name': 'Jarvonian pastry',
                'icon': 'assets/icons/items/materials/food/jarvonian_pastry.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'dynamite',
                'name': 'Dynamite',
                'icon': 'assets/icons/items/gear/skill_gear/mining/dynamite.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pancake',
                'name': 'Pancake',
                'icon': 'assets/icons/items/materials/food/pancakes.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '94475344-9876-4862-1234-02a8bf0fd1dc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': 'reroll-this-id-24807b3e-25d4-4088-ba5a-5e4de01c50d7',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'hand_warming_pack',
                        'name': 'Hand warming pack',
                        'icon': 'assets/icons/items/gear/hand_heating_pack.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'knitted_mittens',
                        'name': 'Knitted mittens',
                        'icon': 'assets/icons/items/gear/knitted_mittens.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    },
                    {
                        'rowItemID': 'perfect_snowballs',
                        'name': 'Perfect snowballs',
                        'icon': 'assets/icons/items/gear/snowballs.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'reroll-this-id-7b0070fe-d6e9-4d9f-adb1-9fae6c46e315',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'frost_touched_boots',
                        'name': 'Frost-touched boots',
                        'icon': 'assets/icons/items/gear/frost_touched_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'map_of_jarvonia',
                        'name': 'Map of Jarvonia',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/jarvonia_map.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-703e493d-a54b-4f6f-b360-2a4b5ae509a0',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'frost_touched_leggings',
                        'name': 'Frost-touched leggings',
                        'icon': 'assets/icons/items/gear/frost_touched_leggings.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'frost_touched_gauntlets',
                        'name': 'Frost-touched gauntlets',
                        'icon': 'assets/icons/items/gear/frost_touched_gauntlets.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'reroll-this-id-01e1de76-36e9-4695-bf28-ef8dec819fdc',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'frost_touched_torso',
                        'name': 'Frost-touched torso',
                        'icon': 'assets/icons/items/gear/frost_touched_torso.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'wintry_pan',
                        'name': 'Wintry pan',
                        'icon': 'assets/icons/items/gear/wintery_pan.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-8f461679-afe3-466f-9380-765b7c887a80',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'frost_touched_helm',
                        'name': 'Frost-touched helm',
                        'icon': 'assets/icons/items/gear/frost_touched_helm.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-9ec1a1d9-785e-47f4-9a9d-663876e59617',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': [
                    {
                        'rowItemID': 'ring_of_ash',
                        'name': 'Ring of ash',
                        'icon': 'assets/icons/items/gear/rings/ring_of_ash.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            }
        ]
    },
    'jarvonia_crossword_puzzle': {
        'id': 'jarvonia_crossword_puzzle',
        'name': 'jarvonia crossword puzzle',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'jarvonian_crossword_puzzle',
                'name': 'Jarvonian crossword puzzle',
                'icon': 'assets/icons/items/collectibles/jarvonian_crossword_puzzle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'jarvonia_gem_table': {
        'id': 'jarvonia_gem_table',
        'name': 'jarvonia gem table',
        'category': 'normal',
        'noDropChance': 0.99,
        'tableRows': [
            {
                'rowItemID': 'rough_star_pearl',
                'name': 'Rough star pearl',
                'icon': 'assets/icons/items/materials/ores/rough_star_pearl.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 6,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'kayaking': {
        'id': 'kayaking',
        'name': 'kayaking',
        'category': 'normal',
        'noDropChance': 0.7,
        'tableRows': [
            {
                'rowItemID': 'raw_pike',
                'name': 'Raw pike',
                'icon': 'assets/icons/items/materials/fish/pike.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4.5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'lucky_rabbit_foot_trinket',
                'name': 'Lucky rabbit foot trinket',
                'icon': 'assets/icons/items/materials/misc/lucky_rabbits_foot_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.04,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'kayaking_tortoise_egg': {
        'id': 'kayaking_tortoise_egg',
        'name': 'kayaking tortoise egg',
        'category': 'petEgg',
        'noDropChance': 0.9996,
        'tableRows': [
            {
                'rowItemID': 'tortoise_egg',
                'name': 'Tortoise egg',
                'icon': 'assets/icons/pets/tortoise/tortoise_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'kelp_foraging': {
        'id': 'kelp_foraging',
        'name': 'kelp foraging',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'kelp',
                'name': 'Kelp',
                'icon': 'assets/icons/items/syrenthia/kelp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sweet_kelp',
                'name': 'Sweet kelp',
                'icon': 'assets/icons/items/syrenthia/sweet_kelp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'lake_fishing_jarvonia': {
        'id': 'lake_fishing_jarvonia',
        'name': 'lake fishing jarvonia',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_carp',
                'name': 'Raw carp',
                'icon': 'assets/icons/items/materials/fish/carp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 5,
                        'levelMinScaling': 5,
                        'levelMaxScaling': 15,
                        'scalingWeight': 1,
                        'xpBonus': 0
                    }
                ]
            },
            {
                'rowItemID': 'raw_pike',
                'name': 'Raw pike',
                'icon': 'assets/icons/items/materials/fish/pike.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 10,
                        'levelMinScaling': 10,
                        'levelMaxScaling': 20,
                        'scalingWeight': 1,
                        'xpBonus': 13
                    }
                ]
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 20,
                        'levelMinScaling': 20,
                        'levelMaxScaling': 30,
                        'scalingWeight': 1,
                        'xpBonus': 22
                    }
                ]
            }
        ],
        'subTables': []
    },
    'large_sail_repair': {
        'id': 'large_sail_repair',
        'name': 'large sail repair',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 52,
                'rowMinimumAmount': 15,
                'rowMaximumAmount': 26,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sailors_hat',
                'name': "Sailor's hat",
                'icon': 'assets/icons/items/gear/skill_gear/fishing/sailors_hat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fishing_line',
                'name': 'Fishing line',
                'icon': 'assets/icons/items/materials/misc/fishing_line.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spider_trinket',
                'name': 'Spider trinket',
                'icon': 'assets/icons/items/materials/misc/spider_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.14,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'letter_from_a._a.': {
        'id': 'letter_from_a._a.',
        'name': 'letter from A. A.',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'letter_from_a._a.',
                'name': 'Letter from A. A.',
                'icon': 'assets/icons/items/syrenthia/letter_from_aa.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'litter_looting': {
        'id': 'litter_looting',
        'name': 'litter looting',
        'category': 'normal',
        'noDropChance': 0.4,
        'tableRows': [
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'birch_plank',
                'name': 'Birch plank',
                'icon': 'assets/icons/items/materials/planks/birch_plank.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'smelly_socks',
                'name': 'Smelly socks',
                'icon': 'assets/icons/items/gear/feet/smelly_socks.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'simple_torch',
                'name': 'Simple torch',
                'icon': 'assets/icons/items/gear/skill_gear/agility/simple_torch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'lizard_hunting': {
        'id': 'lizard_hunting',
        'name': 'lizard hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'lizard_tail',
                'name': 'Lizard tail',
                'icon': 'assets/icons/items/materials/misc/lizard_tail.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 75,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'lizard_hunting_gecko_egg': {
        'id': 'lizard_hunting_gecko_egg',
        'name': 'lizard hunting gecko egg',
        'category': 'petEgg',
        'noDropChance': 0.9976,
        'tableRows': [
            {
                'rowItemID': 'gecko_egg',
                'name': 'Gecko egg',
                'icon': 'assets/icons/pets/gecko/gecko_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'magnet_fishing': {
        'id': 'magnet_fishing',
        'name': 'magnet fishing',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 28,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fishing_line',
                'name': 'Fishing line',
                'icon': 'assets/icons/items/materials/misc/fishing_line.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'copper_hatchet',
                'name': 'Copper hatchet',
                'icon': 'assets/icons/items/gear/axes/copper_axe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'copper_arrows',
                'name': 'Copper arrows',
                'icon': 'assets/icons/items/gear/arrows/copper_arrows.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_hatchet',
                'name': 'Iron hatchet',
                'icon': 'assets/icons/items/gear/axes/iron_axe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'steel_hatchet',
                'name': 'Steel hatchet',
                'icon': 'assets/icons/items/gear/axes/steel_axe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'steel_pickaxe',
                'name': 'Steel pickaxe',
                'icon': 'assets/icons/items/gear/pickaxes/steel_pickaxe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'copper_pickaxe',
                'name': 'Copper pickaxe',
                'icon': 'assets/icons/items/gear/pickaxes/copper_pickaxe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_pickaxe',
                'name': 'Iron pickaxe',
                'icon': 'assets/icons/items/gear/pickaxes/iron_pickaxe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'simple_magnet',
                'name': 'Simple magnet',
                'icon': 'assets/icons/items/gear/skill_gear/mining/simple_magnet.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.18,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'heron_trinket',
                'name': 'Heron trinket',
                'icon': 'assets/icons/items/materials/misc/heron_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_gold_ring',
                'name': 'Old gold ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_gold_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_silver_ring',
                'name': 'Old silver ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_silver_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'old_copper_ring',
                'name': 'Old copper ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/old_copper_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'merfolk_dancing': {
        'id': 'merfolk_dancing',
        'name': 'merfolk dancing',
        'category': 'normal',
        'noDropChance': 0.9,
        'tableRows': [
            {
                'rowItemID': 'salty_hops',
                'name': 'Salty hops',
                'icon': 'assets/icons/items/syrenthia/salty_hops.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'merfolk_dress',
                'name': 'Merfolk dress',
                'icon': 'assets/icons/items/syrenthia/merfolk_dress.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'merfolk_dancing_dolphin_egg': {
        'id': 'merfolk_dancing_dolphin_egg',
        'name': 'merfolk dancing dolphin egg',
        'category': 'petEgg',
        'noDropChance': 0.9981,
        'tableRows': [
            {
                'rowItemID': 'dolphin_egg',
                'name': 'Dolphin egg',
                'icon': 'assets/icons/pets/dolphin/dolphin_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'merfolk_farm_foraging': {
        'id': 'merfolk_farm_foraging',
        'name': 'merfolk farm foraging',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'sea_cabbage',
                'name': 'Sea cabbage',
                'icon': 'assets/icons/items/syrenthia/sea_cabbage.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sea_spinach',
                'name': 'Sea spinach',
                'icon': 'assets/icons/items/syrenthia/sea_spinach.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'underwater_lotus',
                'name': 'Underwater lotus',
                'icon': 'assets/icons/items/syrenthia/underwater_lotus.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'salty_hops',
                'name': 'Salty hops',
                'icon': 'assets/icons/items/syrenthia/salty_hops.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'cucumber',
                'name': 'Cucumber',
                'icon': 'assets/icons/items/syrenthia/sea_cucumber.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'meteorite_fragment_collectible': {
        'id': 'meteorite_fragment_collectible',
        'name': 'meteorite fragment collectible',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'meteorite_fragment',
                'name': 'Meteorite fragment',
                'icon': 'assets/icons/items/collectibles/meteorite_fragment.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_adamant_ore': {
        'id': 'mine_adamant_ore',
        'name': 'mine adamant ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'adamant_ore',
                'name': 'Adamant ore',
                'icon': 'assets/icons/items/materials/ores/adamant_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_adamant_ore_camel_egg': {
        'id': 'mine_adamant_ore_camel_egg',
        'name': 'mine adamant ore camel egg',
        'category': 'petEgg',
        'noDropChance': 0.9993,
        'tableRows': [
            {
                'rowItemID': 'camel_egg',
                'name': 'Camel egg',
                'icon': 'assets/icons/pets/camel/egg_item.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'mine_coal_gecko_egg': {
        'id': 'mine_coal_gecko_egg',
        'name': 'mine coal gecko egg',
        'category': 'petEgg',
        'noDropChance': 0.99945,
        'tableRows': [
            {
                'rowItemID': 'gecko_egg',
                'name': 'Gecko egg',
                'icon': 'assets/icons/pets/gecko/gecko_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'mine_coal_ore': {
        'id': 'mine_coal_ore',
        'name': 'mine coal ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_copper_ore': {
        'id': 'mine_copper_ore',
        'name': 'mine copper ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'copper_ore',
                'name': 'Copper ore',
                'icon': 'assets/icons/items/materials/ores/copper_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_crystal_coal': {
        'id': 'mine_crystal_coal',
        'name': 'mine crystal coal',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'crystal_coal',
                'name': 'Crystal coal',
                'icon': 'assets/icons/items/materials/ores/crystal_shard.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'crystallized_flame',
                'name': 'Crystallized flame',
                'icon': 'assets/icons/items/materials/crystalized_flame.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'mine_crystal_coal_camel_egg': {
        'id': 'mine_crystal_coal_camel_egg',
        'name': 'mine crystal coal camel egg',
        'category': 'petEgg',
        'noDropChance': 0.9994,
        'tableRows': [
            {
                'rowItemID': 'camel_egg',
                'name': 'Camel egg',
                'icon': 'assets/icons/pets/camel/egg_item.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'mine_ecto_rock': {
        'id': 'mine_ecto_rock',
        'name': 'mine ecto rock',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'ectoplasm_rock',
                'name': 'Ectoplasm rock',
                'icon': 'assets/icons/items/materials/ecto_rock.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_farganite_ore': {
        'id': 'mine_farganite_ore',
        'name': 'mine farganite ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'farganite_ore',
                'name': 'Farganite ore',
                'icon': 'assets/icons/items/materials/ores/farganite_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_gold_ore': {
        'id': 'mine_gold_ore',
        'name': 'mine gold ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'gold_ore',
                'name': 'Gold ore',
                'icon': 'assets/icons/items/materials/ores/gold_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_gold_ore_camel_egg': {
        'id': 'mine_gold_ore_camel_egg',
        'name': 'mine gold ore camel egg',
        'category': 'petEgg',
        'noDropChance': 0.9996,
        'tableRows': [
            {
                'rowItemID': 'camel_egg',
                'name': 'Camel egg',
                'icon': 'assets/icons/pets/camel/egg_item.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'mine_iron_ore': {
        'id': 'mine_iron_ore',
        'name': 'mine iron ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_silver_ore': {
        'id': 'mine_silver_ore',
        'name': 'mine silver ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'silver_ore',
                'name': 'Silver ore',
                'icon': 'assets/icons/items/materials/ores/silver_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_silver_ore_camel_egg': {
        'id': 'mine_silver_ore_camel_egg',
        'name': 'mine silver ore camel egg',
        'category': 'petEgg',
        'noDropChance': 0.9997,
        'tableRows': [
            {
                'rowItemID': 'camel_egg',
                'name': 'Camel egg',
                'icon': 'assets/icons/pets/camel/egg_item.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'mine_tarsilium_ore': {
        'id': 'mine_tarsilium_ore',
        'name': 'mine tarsilium ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'tarsilium_ore',
                'name': 'Tarsilium ore',
                'icon': 'assets/icons/items/materials/ores/tarsilium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_tin_ore': {
        'id': 'mine_tin_ore',
        'name': 'mine tin ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'tin_ore',
                'name': 'Tin ore',
                'icon': 'assets/icons/items/materials/ores/tin_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_violite_ore': {
        'id': 'mine_violite_ore',
        'name': 'mine violite ore',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'violite_ore',
                'name': 'Violite ore',
                'icon': 'assets/icons/items/materials/ores/petrifium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mine_violite_ore_camel_egg': {
        'id': 'mine_violite_ore_camel_egg',
        'name': 'mine violite ore camel egg',
        'category': 'petEgg',
        'noDropChance': 0.9993,
        'tableRows': [
            {
                'rowItemID': 'camel_egg',
                'name': 'Camel egg',
                'icon': 'assets/icons/pets/camel/egg_item.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'mining_activity_chest': {
        'id': 'mining_activity_chest',
        'name': 'mining activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'mining_chest',
                'name': 'Mining chest',
                'icon': 'assets/icons/items/openables/chests/mining_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mining_chest_table': {
        'id': 'mining_chest_table',
        'name': 'mining chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'tarsilium_ore',
                'name': 'Tarsilium ore',
                'icon': 'assets/icons/items/materials/ores/tarsilium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'copper_ore',
                'name': 'Copper ore',
                'icon': 'assets/icons/items/materials/ores/copper_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tin_ore',
                'name': 'Tin ore',
                'icon': 'assets/icons/items/materials/ores/tin_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'farganite_ore',
                'name': 'Farganite ore',
                'icon': 'assets/icons/items/materials/ores/farganite_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 15,
                'rowMaximumAmount': 30,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 13,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'jarvonian_pastry',
                'name': 'Jarvonian pastry',
                'icon': 'assets/icons/items/materials/food/jarvonian_pastry.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'mining_memosphere',
                'name': 'Mining memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_mining.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'large_stone',
                'name': 'Large stone',
                'icon': 'assets/icons/items/materials/ores/large_stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '01437f92-e80b-4b12-9717-a181c283af7c',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'bat_trinket',
                        'name': 'Bat trinket',
                        'icon': 'assets/icons/items/materials/misc/bat_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '5e18de99-5ff9-44d6-9981-c499ae40e1a3',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'light_mining_shovel',
                        'name': 'Light mining shovel',
                        'icon': 'assets/icons/items/gear/skill_gear/mining/shovel.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'fingerpick',
                        'name': 'Fingerpick',
                        'icon': 'assets/icons/items/gear/fingerpick.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '22b733af-b722-4c35-85c2-ec5352a9cf02',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'hand_lantern',
                        'name': 'Hand lantern',
                        'icon': 'assets/icons/items/gear/skill_gear/mining/hand_lantern.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'mining_cartpack',
                        'name': 'Mining cartpack',
                        'icon': 'assets/icons/items/gear/mining_cartpack.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '5921a175-cd5d-4785-9ef6-5329500abb45',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'mining_helmet',
                        'name': 'Mining helmet',
                        'icon': 'assets/icons/items/gear/skill_gear/mining_helm.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'miners_beard',
                        'name': "Miner's beard",
                        'icon': 'assets/icons/items/gear/skill_gear/mining/miners_beard.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'miners_magnet',
                        'name': "Miner's magnet",
                        'icon': 'assets/icons/items/gear/skill_gear/mining/magnet.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b561d611-10d7-4125-a573-1025e9887c6d',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'miners_pants',
                        'name': "Miner's pants",
                        'icon': 'assets/icons/items/gear/skill_gear/mining/miners_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'miners_shirt',
                        'name': "Miner's shirt",
                        'icon': 'assets/icons/items/gear/skill_gear/mining/miners_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'heavy_pick_handle',
                        'name': 'Heavy pick handle',
                        'icon': 'assets/icons/items/gear/heavy_pick_handle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '8cd9741e-639a-4cb3-ab8b-ef69bfd1b82d',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'shovel_axe',
                        'name': 'Shovel axe',
                        'icon': 'assets/icons/items/gear/skill_gear/shovelaxe.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'a5f0f53c-d655-4ce6-be0f-158ea2e83161',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'mountain_climbing_beginner': {
        'id': 'mountain_climbing_beginner',
        'name': 'mountain climbing beginner',
        'category': 'normal',
        'noDropChance': 0.54,
        'tableRows': [
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'copper_ore',
                'name': 'Copper ore',
                'icon': 'assets/icons/items/materials/ores/copper_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tin_ore',
                'name': 'Tin ore',
                'icon': 'assets/icons/items/materials/ores/tin_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_thermos',
                'name': 'Iron thermos',
                'icon': 'assets/icons/items/gear/skill_gear/agility/iron_thermos.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'mountain_climbing_intermediate': {
        'id': 'mountain_climbing_intermediate',
        'name': 'mountain climbing intermediate',
        'category': 'normal',
        'noDropChance': 0.37,
        'tableRows': [
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 17,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_pickaxe',
                'name': 'Iron pickaxe',
                'icon': 'assets/icons/items/gear/pickaxes/iron_pickaxe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'steel_pickaxe',
                'name': 'Steel pickaxe',
                'icon': 'assets/icons/items/gear/pickaxes/steel_pickaxe.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'mountaineering_guidebook',
                'name': 'Mountaineering guidebook',
                'icon': 'assets/icons/items/gear/skill_gear/agility/mountaineering_guidebook.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.018,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'name_tags_table': {
        'id': 'name_tags_table',
        'name': 'name tags table',
        'category': 'normal',
        'noDropChance': 0.6,
        'tableRows': [
            {
                'rowItemID': 'name_tag',
                'name': 'Name tag',
                'icon': 'assets/icons/items/materials/adventurer_name_tag.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'old_war_sword': {
        'id': 'old_war_sword',
        'name': 'old war sword',
        'category': 'collectible',
        'noDropChance': 0.9991,
        'tableRows': [
            {
                'rowItemID': 'old_war_sword',
                'name': 'Old war sword',
                'icon': 'assets/icons/items/collectibles/old_war_sword.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'plains_foraging': {
        'id': 'plains_foraging',
        'name': 'plains foraging',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'snowdrop',
                'name': 'Snowdrop',
                'icon': 'assets/icons/items/materials/plants/snowdrop.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sticky_finger_shorts',
                'name': 'Sticky finger shorts',
                'icon': 'assets/icons/items/gear/rikus_pockets.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'predator_fishing': {
        'id': 'predator_fishing',
        'name': 'predator fishing',
        'category': 'normal',
        'noDropChance': 0.2,
        'tableRows': [
            {
                'rowItemID': 'raw_shark',
                'name': 'Raw shark',
                'icon': 'assets/icons/items/syrenthia/raw_shark.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 55,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 10
                    }
                ]
            },
            {
                'rowItemID': 'raw_anglerfish',
                'name': 'Raw anglerfish',
                'icon': 'assets/icons/items/syrenthia/raw_angler_fish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 60,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 20
                    }
                ]
            },
            {
                'rowItemID': 'raw_squid',
                'name': 'Raw squid',
                'icon': 'assets/icons/items/materials/fish/squid.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 40,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 0
                    }
                ]
            }
        ],
        'subTables': []
    },
    'rabbit_tracking': {
        'id': 'rabbit_tracking',
        'name': 'rabbit tracking',
        'category': 'normal',
        'noDropChance': 0.15,
        'tableRows': [
            {
                'rowItemID': 'berries',
                'name': 'Berries',
                'icon': 'assets/icons/items/materials/plants/berries.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 841.6,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rabbit_ears',
                'name': 'Rabbit ears',
                'icon': 'assets/icons/items/gear/rabbit_ears.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8.4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'rescue_team_compass_trinket': {
        'id': 'rescue_team_compass_trinket',
        'name': 'rescue team compass trinket',
        'category': 'normal',
        'noDropChance': 0.9167,
        'tableRows': [
            {
                'rowItemID': 'compass_trinket',
                'name': 'Compass trinket',
                'icon': 'assets/icons/items/materials/misc/compass_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'rooftop_jumping_beginner': {
        'id': 'rooftop_jumping_beginner',
        'name': 'rooftop jumping beginner',
        'category': 'normal',
        'noDropChance': 0.78,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wooden_stick',
                'name': 'Wooden stick',
                'icon': 'assets/icons/items/materials/plants/stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'parkour_gloves',
                'name': 'Parkour gloves',
                'icon': 'assets/icons/items/gear/skill_gear/agility/parkour_gloves.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'rooftop_jumping_intermediate': {
        'id': 'rooftop_jumping_intermediate',
        'name': 'rooftop jumping intermediate',
        'category': 'normal',
        'noDropChance': 0.3,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wooden_stick',
                'name': 'Wooden stick',
                'icon': 'assets/icons/items/materials/plants/stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flowy_trousers',
                'name': 'Flowy trousers',
                'icon': 'assets/icons/items/gear/skill_gear/agility/flowy_trousers.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'rose_quartz_collectible': {
        'id': 'rose_quartz_collectible',
        'name': 'rose quartz collectible',
        'category': 'collectible',
        'noDropChance': 0.9999,
        'tableRows': [
            {
                'rowItemID': 'rose_quartz',
                'name': 'Rose quartz',
                'icon': 'assets/icons/items/collectibles/rose_quartz.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'rusty_chest_drop': {
        'id': 'rusty_chest_drop',
        'name': 'rusty chest drop',
        'category': 'normal',
        'noDropChance': 0.995,
        'tableRows': [
            {
                'rowItemID': 'rusty_chest',
                'name': 'Rusty chest',
                'icon': 'assets/icons/items/openables/chests/rusty_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'rusty_chest_table': {
        'id': 'rusty_chest_table',
        'name': 'rusty chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'birch_logs',
                'name': 'Birch logs',
                'icon': 'assets/icons/items/materials/logs/birch_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wooden_stick',
                'name': 'Wooden stick',
                'icon': 'assets/icons/items/materials/plants/stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'copper_ore',
                'name': 'Copper ore',
                'icon': 'assets/icons/items/materials/ores/copper_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'snowdrop',
                'name': 'Snowdrop',
                'icon': 'assets/icons/items/materials/plants/snowdrop.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'moondaisy',
                'name': 'Moondaisy',
                'icon': 'assets/icons/items/materials/plants/moondaisy.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': [
            {
                'id': '12575344-3656-7771-aecf-02a8548fd1dc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': '60288d8f-dea3-41d6-b5b2-2580b2a6ceaa',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'rusty_pickaxe',
                        'name': 'Rusty pickaxe',
                        'icon': 'assets/icons/items/gear/skill_gear/mining/rusty_pickaxe.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'rusty_hatchet',
                        'name': 'Rusty hatchet',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/rusty_hatchet.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'rusty_sickle',
                        'name': 'Rusty sickle',
                        'icon': 'assets/icons/items/gear/skill_gear/foraging/rusty_sickle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'rusty_fishing_net',
                        'name': 'Rusty fishing net',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/rusty_fishing_net.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'rusty_fishing_rod',
                        'name': 'Rusty fishing rod',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/rusty_fishing_rod.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'rusty_hunting_bow',
                        'name': 'Rusty hunting bow',
                        'icon': 'assets/icons/items/gear/rusty_hunting_bow.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '35f2e756-ee81-4146-b97d-53254ec6c70a',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': []
            },
            {
                'id': '16b185b3-ec86-47f7-bfb5-f48e68c51fea',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': []
            },
            {
                'id': 'd75d406e-c10e-476b-8284-42193e1660c2',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': []
            },
            {
                'id': 'c8c965b1-42c9-4ea5-8e69-c707e01490e6',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': []
            },
            {
                'id': '25f3b8ce-15f7-4113-b09a-ca79d290a130',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'sandcastle_building_sand_shovel': {
        'id': 'sandcastle_building_sand_shovel',
        'name': 'sandcastle building sand shovel',
        'category': 'collectible',
        'noDropChance': 0.98,
        'tableRows': [
            {
                'rowItemID': 'lost_timmys_sand_shovel',
                'name': "Lost Timmy's sand shovel",
                'icon': 'assets/icons/items/collectibles/timmys_sand_shovel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'sea_fishing_cage': {
        'id': 'sea_fishing_cage',
        'name': 'sea fishing (cage)',
        'category': 'normal',
        'noDropChance': 0.3,
        'tableRows': [
            {
                'rowItemID': 'raw_lobster',
                'name': 'Raw lobster',
                'icon': 'assets/icons/items/materials/fish/lobster.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 1,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 5
                    }
                ]
            },
            {
                'rowItemID': 'trash',
                'name': 'Trash',
                'icon': 'assets/icons/items/materials/misc/trash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'crustacean_call',
                'name': 'Crustacean call',
                'icon': 'assets/icons/items/gear/rings/crustacean_call.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.066,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pink_pearl_trinket',
                'name': 'Pink pearl trinket',
                'icon': 'assets/icons/items/materials/misc/pink_pearl_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.07,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'sea_fishing_jarvonia_net': {
        'id': 'sea_fishing_jarvonia_net',
        'name': 'sea fishing jarvonia net',
        'category': 'normal',
        'noDropChance': 0.25,
        'tableRows': [
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_jellyfish',
                'name': 'Raw jellyfish',
                'icon': 'assets/icons/items/materials/fish/jellyfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 30,
                        'levelMinScaling': 30,
                        'levelMaxScaling': 60,
                        'scalingWeight': 1,
                        'xpBonus': 46
                    }
                ]
            },
            {
                'rowItemID': 'pink_pearl_trinket',
                'name': 'Pink pearl trinket',
                'icon': 'assets/icons/items/materials/misc/pink_pearl_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.03,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 30,
                        'levelMinScaling': 30,
                        'levelMaxScaling': 30,
                        'scalingWeight': 0,
                        'xpBonus': 150
                    }
                ]
            }
        ],
        'subTables': []
    },
    'sea_fishing_rod': {
        'id': 'sea_fishing_rod',
        'name': 'sea fishing rod',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_salmon',
                'name': 'Raw salmon',
                'icon': 'assets/icons/items/materials/fish/salmon.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 30,
                        'levelMinScaling': 30,
                        'levelMaxScaling': 50,
                        'scalingWeight': 1,
                        'xpBonus': 6
                    }
                ]
            },
            {
                'rowItemID': 'raw_squid',
                'name': 'Raw squid',
                'icon': 'assets/icons/items/materials/fish/squid.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 40,
                        'levelMinScaling': 40,
                        'levelMaxScaling': 60,
                        'scalingWeight': 1,
                        'xpBonus': 8
                    }
                ]
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 20,
                        'levelMinScaling': 20,
                        'levelMaxScaling': 40,
                        'scalingWeight': 1,
                        'xpBonus': 0
                    }
                ]
            }
        ],
        'subTables': []
    },
    'sea_fishing_spear': {
        'id': 'sea_fishing_spear',
        'name': 'sea fishing (spear)',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'raw_salmon',
                'name': 'Raw salmon',
                'icon': 'assets/icons/items/materials/fish/salmon.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 30,
                        'levelMinScaling': 1,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 6
                    }
                ]
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 20,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 0
                    }
                ]
            },
            {
                'rowItemID': 'raw_stingray',
                'name': 'Raw stingray',
                'icon': 'assets/icons/items/syrenthia/raw_stingray.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 45,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 15
                    }
                ]
            },
            {
                'rowItemID': 'raw_swordfish',
                'name': 'Raw swordfish',
                'icon': 'assets/icons/items/syrenthia/raw_swordfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': [
                    {
                        'relatedSkill': 'fishing',
                        'levelRequirement': 40,
                        'levelMinScaling': 0,
                        'levelMaxScaling': 0,
                        'scalingWeight': 1,
                        'xpBonus': 10
                    }
                ]
            },
            {
                'rowItemID': 'eye_patch',
                'name': 'Eye patch',
                'icon': 'assets/icons/items/syrenthia/eyepatch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.04,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'heron_trinket',
                'name': 'Heron trinket',
                'icon': 'assets/icons/items/materials/misc/heron_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.04,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'sea_shells_1_10_drop': {
        'id': 'sea_shells_1_10_drop',
        'name': 'sea shells 1-10 drop',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'search_team_alien_squeaky_toy': {
        'id': 'search_team_alien_squeaky_toy',
        'name': 'search team alien squeaky toy',
        'category': 'normal',
        'noDropChance': 0.875,
        'tableRows': [
            {
                'rowItemID': 'alien_squeaky_toy',
                'name': 'Alien squeaky toy',
                'icon': 'assets/icons/items/gear/alien_squeaky_toy.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'seashell_searching': {
        'id': 'seashell_searching',
        'name': 'seashell searching',
        'category': 'normal',
        'noDropChance': 0.15,
        'tableRows': [
            {
                'rowItemID': 'fishbone',
                'name': 'Fishbone',
                'icon': 'assets/icons/items/materials/misc/fishbone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 17,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'clam_shell',
                'name': 'Clam shell',
                'icon': 'assets/icons/items/materials/misc/seashell_1.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pearls',
                'name': 'Pearls',
                'icon': 'assets/icons/items/materials/misc/pearls.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'beaver_trinket',
                'name': 'Beaver trinket',
                'icon': 'assets/icons/items/materials/misc/beaver_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.005,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'seashell_searching_chest': {
        'id': 'seashell_searching_chest',
        'name': 'seashell searching chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'sunken_chest',
                'name': 'Sunken chest',
                'icon': 'assets/icons/items/openables/chests/sunken_treasure_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'shells_10_percent': {
        'id': 'shells_10_percent',
        'name': 'shells 10 percent',
        'category': 'normal',
        'noDropChance': 0.9,
        'tableRows': [
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'shiny_broken_skydisk_collectible': {
        'id': 'shiny_broken_skydisk_collectible',
        'name': 'shiny broken skydisk collectible',
        'category': 'collectible',
        'noDropChance': 0.9998,
        'tableRows': [
            {
                'rowItemID': 'shiny_broken_skydisc',
                'name': 'Shiny broken skydisc',
                'icon': 'assets/icons/items/collectibles/shiny_broken_skydisc.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'ship_repair_beginner': {
        'id': 'ship_repair_beginner',
        'name': 'ship repair beginner',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'life_vest',
                'name': 'Life vest',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/life_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.135,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 75,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'metal_scrap',
                'name': 'Metal scrap',
                'icon': 'assets/icons/items/materials/misc/metal_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'beaver_trinket',
                'name': 'Beaver trinket',
                'icon': 'assets/icons/items/materials/misc/beaver_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.03,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'ship_repair_intermediate': {
        'id': 'ship_repair_intermediate',
        'name': 'ship repair intermediate',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 58,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sailors_hat',
                'name': "Sailor's hat",
                'icon': 'assets/icons/items/gear/skill_gear/fishing/sailors_hat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 20,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'metal_scrap',
                'name': 'Metal scrap',
                'icon': 'assets/icons/items/materials/misc/metal_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 20,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'beaver_trinket',
                'name': 'Beaver trinket',
                'icon': 'assets/icons/items/materials/misc/beaver_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.05,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'shoreline_scramble': {
        'id': 'shoreline_scramble',
        'name': 'shoreline scramble',
        'category': 'normal',
        'noDropChance': 0.9988,
        'tableRows': [
            {
                'rowItemID': 'feather_boots',
                'name': 'Feather boots',
                'icon': 'assets/icons/items/gear/feather_boots.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'silver_ore_smithing_recipe': {
        'id': 'silver_ore_smithing_recipe',
        'name': 'silver ore smithing recipe',
        'category': 'normal',
        'noDropChance': 0.93,
        'tableRows': [
            {
                'rowItemID': 'silver_nugget',
                'name': 'Silver nugget',
                'icon': 'assets/icons/items/materials/ores/silver_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'silver_pocket_watch': {
        'id': 'silver_pocket_watch',
        'name': 'silver pocket watch',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'silver_pocket_watch',
                'name': 'Silver pocket watch',
                'icon': 'assets/icons/items/collectibles/silver_pocket_watch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'skate_skiing_reindeer_egg': {
        'id': 'skate_skiing_reindeer_egg',
        'name': 'skate skiing reindeer egg',
        'category': 'petEgg',
        'noDropChance': 0.998,
        'tableRows': [
            {
                'rowItemID': 'reindeer_egg',
                'name': 'Reindeer egg',
                'icon': 'assets/icons/pets/reindeer/reindeer_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'sledding': {
        'id': 'sledding',
        'name': 'sledding',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [],
        'subTables': []
    },
    'small_sail_repair': {
        'id': 'small_sail_repair',
        'name': 'small sail repair',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'life_vest',
                'name': 'Life vest',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/life_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.135,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 60,
                'rowMinimumAmount': 7,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'fishing_line',
                'name': 'Fishing line',
                'icon': 'assets/icons/items/materials/misc/fishing_line.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spider_trinket',
                'name': 'Spider trinket',
                'icon': 'assets/icons/items/materials/misc/spider_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'smithing_activity_chest': {
        'id': 'smithing_activity_chest',
        'name': 'smithing activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'smithing_chest',
                'name': 'Smithing chest',
                'icon': 'assets/icons/items/openables/chests/smithing_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'smithing_chest_table': {
        'id': 'smithing_chest_table',
        'name': 'smithing chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'tarsilium_ore',
                'name': 'Tarsilium ore',
                'icon': 'assets/icons/items/materials/ores/tarsilium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'copper_ore',
                'name': 'Copper ore',
                'icon': 'assets/icons/items/materials/ores/copper_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tin_ore',
                'name': 'Tin ore',
                'icon': 'assets/icons/items/materials/ores/tin_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'farganite_ore',
                'name': 'Farganite ore',
                'icon': 'assets/icons/items/materials/ores/farganite_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 8,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 15,
                'rowMaximumAmount': 30,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'iron_ore',
                'name': 'Iron ore',
                'icon': 'assets/icons/items/materials/ores/iron_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spicy_pumpkin_juice',
                'name': 'Spicy pumpkin juice',
                'icon': 'assets/icons/items/materials/food/spicy_pumpkin_juice.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'smithing_memosphere',
                'name': 'Smithing memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_smithing.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'dynamite',
                'name': 'Dynamite',
                'icon': 'assets/icons/items/gear/skill_gear/mining/dynamite.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': 'c269806f-d5ee-4968-9669-28ef3272141a',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'cooling_icicle_trinket',
                        'name': 'Cooling icicle trinket',
                        'icon': 'assets/icons/items/materials/misc/cooling_ice_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'caed4752-d1a9-43f0-840e-a70a6ad917aa',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'steel_toe_boots',
                        'name': 'Steel-toe boots',
                        'icon': 'assets/icons/items/gear/skill_gear/mining/steel_toe_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'jarvonian_poker',
                        'name': 'Jarvonian poker',
                        'icon': 'assets/icons/items/gear/jarvonian_poker.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '5227fe46-52b3-4019-ba56-b59c2815ea9f',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'wolf_jaw_tongs',
                        'name': 'Wolf jaw tongs',
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/wolf_jaw_tongs.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'forge_bellows',
                        'name': 'Forge bellows',
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/forge_bellows.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'smiths_pants',
                        'name': "Smith's pants",
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/smith_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '589cd0ea-8d96-4766-84a3-ba04eae7c524',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'smiths_apron',
                        'name': "Smith's apron",
                        'icon': 'assets/icons/items/gear/skill_gear/smiths_apron.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'smelting_goggles',
                        'name': 'Smelting goggles',
                        'icon': 'assets/icons/items/gear/skill_gear/smelting_goggles.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'metalworking_gloves',
                        'name': 'Metalworking gloves',
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/metalworking_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'blacksmithing_guidebook',
                        'name': 'Blacksmithing guidebook',
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/blacksmiths_handbook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '011d8183-56c4-4b6b-9b3a-0f10922ee317',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'jarvonian_smiths_hammer',
                        'name': "Jarvonian smith's hammer",
                        'icon': 'assets/icons/items/gear/skill_gear/smithing/jarvonian_smith_hammer.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'fire_resistant_cloak',
                        'name': 'Fire resistant cloak',
                        'icon': 'assets/icons/items/gear/heat_resistant_cloak.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '98a0cac2-b890-4b00-8127-27da55debadd',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'meltdown_mask',
                        'name': 'Meltdown mask',
                        'icon': 'assets/icons/items/gear/meltdown_mask.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '21d74f2b-584f-410f-b9f6-c6dbbe4b63e6',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'soup_kitchen_badge': {
        'id': 'soup_kitchen_badge',
        'name': 'soup kitchen badge',
        'category': 'collectible',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': 'soup_kitchen_badge',
                'name': 'Soup kitchen badge',
                'icon': 'assets/icons/items/collectibles/soup_kitchen_badge.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'soup_kitchen_volunteering': {
        'id': 'soup_kitchen_volunteering',
        'name': 'soup kitchen volunteering',
        'category': 'normal',
        'noDropChance': 0.75,
        'tableRows': [
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_perch',
                'name': 'Raw perch',
                'icon': 'assets/icons/items/materials/fish/perch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_carp',
                'name': 'Raw carp',
                'icon': 'assets/icons/items/materials/fish/carp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'measuring_spoons_trinket',
                'name': 'Measuring spoons trinket',
                'icon': 'assets/icons/items/materials/misc/measuring_spoon_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.02,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'nettle',
                'name': 'Nettle',
                'icon': 'assets/icons/items/materials/plants/nettle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wheat',
                'name': 'Wheat',
                'icon': 'assets/icons/items/materials/plants/wheat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'cooked_shrimp',
                'name': 'Cooked shrimp',
                'icon': 'assets/icons/items/materials/cooked_fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'spelunking': {
        'id': 'spelunking',
        'name': 'spelunking',
        'category': 'normal',
        'noDropChance': 0.2,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 15,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'coal',
                'name': 'Coal',
                'icon': 'assets/icons/items/materials/ores/coal_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tarsilium_ore',
                'name': 'Tarsilium ore',
                'icon': 'assets/icons/items/materials/ores/tarsilium_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'farganite_ore',
                'name': 'Farganite ore',
                'icon': 'assets/icons/items/materials/ores/farganite_ore.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bat_trinket',
                'name': 'Bat trinket',
                'icon': 'assets/icons/items/materials/misc/bat_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.35,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'spelunking_mummy_egg': {
        'id': 'spelunking_mummy_egg',
        'name': 'spelunking mummy egg',
        'category': 'petEgg',
        'noDropChance': 0.9981,
        'tableRows': [
            {
                'rowItemID': 'mummy_egg',
                'name': 'Mummy egg',
                'icon': 'assets/icons/pets/mummy/mummy_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'squirrel_hunting': {
        'id': 'squirrel_hunting',
        'name': 'squirrel hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'hide_scraps',
                'name': 'Hide scraps',
                'icon': 'assets/icons/items/materials/misc/leather_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 80,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'stone_quarrying_': {
        'id': 'stone_quarrying_',
        'name': 'stone quarrying ',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 150,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'large_stone',
                'name': 'Large stone',
                'icon': 'assets/icons/items/materials/ores/large_stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'summer_cave_foraging': {
        'id': 'summer_cave_foraging',
        'name': 'summer cave foraging',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'bell_pepper',
                'name': 'Bell pepper',
                'icon': 'assets/icons/items/materials/plants/bell_pepper.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'mushroom',
                'name': 'Mushroom',
                'icon': 'assets/icons/items/materials/farming/yield/mushroom.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'honeycomb',
                'name': 'Honeycomb',
                'icon': 'assets/icons/items/materials/misc/honey.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'bat_trinket',
                'name': 'Bat trinket',
                'icon': 'assets/icons/items/materials/misc/bat_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.01,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'egg',
                'name': 'Egg',
                'icon': 'assets/icons/items/syrenthia/egg.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'sunken_chest_table': {
        'id': 'sunken_chest_table',
        'name': 'sunken chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'raw_jellyfish',
                'name': 'Raw jellyfish',
                'icon': 'assets/icons/items/materials/fish/jellyfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_lobster',
                'name': 'Raw lobster',
                'icon': 'assets/icons/items/materials/fish/lobster.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_salmon',
                'name': 'Raw salmon',
                'icon': 'assets/icons/items/materials/fish/salmon.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': 'bf9643c0-e798-488a-a409-b9c09f1bce4d',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 25,
                        'rowMaximumAmount': 35,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'bcedf307-93fc-445c-8cd8-6e7156ac4b49',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'rusty_diving_leggings',
                        'name': 'Rusty diving leggings',
                        'icon': 'assets/icons/items/gear/legs/rusty_divers_bottom.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'd1a64137-fabe-43d7-8175-d66f7331a45d',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'gold_pan',
                        'name': 'Gold pan',
                        'icon': 'assets/icons/items/gear/skill_gear/mining/gold_pan.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'b50e9ca5-7f4d-41df-9fdc-ca616ca9eb3a',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'shiny_spinner',
                        'name': 'Shiny spinner',
                        'icon': 'assets/icons/items/gear/skill_gear/fishing/shiny_spinner.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'northern_spices',
                        'name': 'Northern spices',
                        'icon': 'assets/icons/items/gear/skill_gear/cooking/northern_spices.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '33124b31-dd99-4a81-8ef1-c37566bbd8a4',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': []
            },
            {
                'id': '43b3b87f-d002-4922-a62f-018c58f0a129',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': []
            },
            {
                'id': 'fc77d396-1604-495a-a472-105ab7d0d105',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'surface_salt_mining': {
        'id': 'surface_salt_mining',
        'name': 'surface salt mining',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'salt_crystal',
                'name': 'Salt crystal',
                'icon': 'assets/icons/items/materials/ores/salt_crystal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 18,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'swamp_foraging': {
        'id': 'swamp_foraging',
        'name': 'swamp foraging',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'mud',
                'name': 'Mud',
                'icon': 'assets/icons/items/materials/misc/mud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'root',
                'name': 'Root',
                'icon': 'assets/icons/items/materials/plants/roots.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'bell_pepper',
                'name': 'Bell pepper',
                'icon': 'assets/icons/items/materials/plants/bell_pepper.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'pepper',
                'name': 'Pepper',
                'icon': 'assets/icons/items/materials/misc/pepper_spice.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 10,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'milkweed',
                'name': 'Milkweed',
                'icon': 'assets/icons/items/materials/misc/milkweed.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'rotbud',
                'name': 'Rotbud',
                'icon': 'assets/icons/items/materials/plants/rotbud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'beaver_trinket',
                'name': 'Beaver trinket',
                'icon': 'assets/icons/items/materials/misc/beaver_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'swampman_article_collectible': {
        'id': 'swampman_article_collectible',
        'name': 'swampman article collectible',
        'category': 'collectible',
        'noDropChance': 0.9986,
        'tableRows': [
            {
                'rowItemID': 'swampman_article',
                'name': 'Swampman article',
                'icon': 'assets/icons/items/collectibles/swamp_map_article.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'swimming_beginner': {
        'id': 'swimming_beginner',
        'name': 'swimming beginner',
        'category': 'normal',
        'noDropChance': 0.82,
        'tableRows': [
            {
                'rowItemID': 'raw_shrimp',
                'name': 'Raw shrimp',
                'icon': 'assets/icons/items/materials/fish/shrimp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_carp',
                'name': 'Raw carp',
                'icon': 'assets/icons/items/materials/fish/carp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_trout',
                'name': 'Raw trout',
                'icon': 'assets/icons/items/materials/fish/trout.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'simple_life_vest',
                'name': 'Simple life vest',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/simple_life_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'eel_trinket',
                'name': 'Eel trinket',
                'icon': 'assets/icons/items/materials/misc/eel_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'swimming_expert': {
        'id': 'swimming_expert',
        'name': 'swimming expert',
        'category': 'normal',
        'noDropChance': 0.5,
        'tableRows': [
            {
                'rowItemID': 'flippers',
                'name': 'Flippers',
                'icon': 'assets/icons/items/syrenthia/flippers.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_stingray',
                'name': 'Raw stingray',
                'icon': 'assets/icons/items/syrenthia/raw_stingray.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_swordfish',
                'name': 'Raw swordfish',
                'icon': 'assets/icons/items/syrenthia/raw_swordfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'eel_trinket',
                'name': 'Eel trinket',
                'icon': 'assets/icons/items/materials/misc/eel_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'swimming_intermediate': {
        'id': 'swimming_intermediate',
        'name': 'swimming intermediate',
        'category': 'normal',
        'noDropChance': 0.82,
        'tableRows': [
            {
                'rowItemID': 'raw_salmon',
                'name': 'Raw salmon',
                'icon': 'assets/icons/items/materials/fish/salmon.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_jellyfish',
                'name': 'Raw jellyfish',
                'icon': 'assets/icons/items/materials/fish/jellyfish.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'raw_squid',
                'name': 'Raw squid',
                'icon': 'assets/icons/items/materials/fish/squid.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'life_vest',
                'name': 'Life vest',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/life_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'shark_tooth_trinket',
                'name': 'Shark tooth trinket',
                'icon': 'assets/icons/items/materials/misc/shark_tooth_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'eel_trinket',
                'name': 'Eel trinket',
                'icon': 'assets/icons/items/materials/misc/eel_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'syrenthia_chest_table': {
        'id': 'syrenthia_chest_table',
        'name': 'syrenthia chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pearls',
                'name': 'Pearls',
                'icon': 'assets/icons/items/materials/misc/pearls.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'salty_hops',
                'name': 'Salty hops',
                'icon': 'assets/icons/items/syrenthia/salty_hops.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'saltrum',
                'name': 'Saltrum',
                'icon': 'assets/icons/items/syrenthia/saltrum.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'kelp_rolls',
                'name': 'Kelp rolls',
                'icon': 'assets/icons/items/syrenthia/kelp_rolls.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'underwater_salad',
                'name': 'Underwater salad',
                'icon': 'assets/icons/items/syrenthia/underwater_salad.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '94473544-d558-2215-aecf-6987bf0fd1dc',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': 'reroll-this-id-d5455e80-0ac1-43f6-81db-2229043b9a5f',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'bubble_bauble',
                        'name': 'Bubble bauble',
                        'icon': 'assets/icons/items/gear/bubble_bauble.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    },
                    {
                        'rowItemID': 'merfolk_shell_coverings',
                        'name': 'Merfolk shell coverings',
                        'icon': 'assets/icons/items/gear/seashell_bra.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'reroll-this-id-3a9ad07d-f100-4014-8e1d-6dda32ecc7a5',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'merfolk_dance_leglets',
                        'name': 'Merfolk dance leglets',
                        'icon': 'assets/icons/items/gear/merfolk_dance_leglets.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'map_of_syrenthia',
                        'name': 'Map of Syrenthia',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/syrenthia_map.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    },
                    {
                        'rowItemID': 'pearl_bracelet',
                        'name': 'Pearl bracelet',
                        'icon': 'assets/icons/items/syrenthia/pearl_amulet.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'reroll-this-id-e60f1efe-fbb5-4f78-a99c-ceef43ead7aa',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'merfolk_dance_skirt',
                        'name': 'Merfolk dance skirt',
                        'icon': 'assets/icons/items/gear/merfolk_dance_skirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'merfolk_dance_bracers',
                        'name': 'Merfolk dance bracers',
                        'icon': 'assets/icons/items/gear/merfolk_dance_bracers.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'reroll-this-id-ce4ad89e-3695-41bf-acb8-fbe476829f25',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'tidal_lure',
                        'name': 'Tidal lure',
                        'icon': 'assets/icons/items/syrenthia/tidal_lure.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'merfolk_dance_corslet',
                        'name': 'Merfolk dance corslet',
                        'icon': 'assets/icons/items/gear/merfolk_dance_fit.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'reroll-this-id-fc810e79-6b55-43dc-bceb-73c6339fc1d9',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'merfolk_dance_circlet',
                        'name': 'Merfolk dance circlet',
                        'icon': 'assets/icons/items/gear/merfolk_dance_circlet.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-e58e2f8b-f8a5-4087-a98d-5b70d5904383',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': [
                    {
                        'rowItemID': 'algae_ring',
                        'name': 'Algae ring',
                        'icon': 'assets/icons/items/gear/rings/algatean_ring.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            }
        ]
    },
    'tailoring_activity_chest': {
        'id': 'tailoring_activity_chest',
        'name': 'tailoring activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'tailoring_chest',
                'name': 'Tailoring chest',
                'icon': 'assets/icons/items/openables/chests/tailoring_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'tailoring_chest_table': {
        'id': 'tailoring_chest_table',
        'name': 'tailoring chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'bamboo_logs',
                'name': 'Bamboo logs',
                'icon': 'assets/icons/items/materials/logs/bamboo_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 6,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 4,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'grass',
                'name': 'Grass',
                'icon': 'assets/icons/items/materials/plants/grass.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flax',
                'name': 'Flax',
                'icon': 'assets/icons/items/materials/plants/flax.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'basic_hide',
                'name': 'Basic hide',
                'icon': 'assets/icons/items/materials/misc/light_hide.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'hemp',
                'name': 'Hemp',
                'icon': 'assets/icons/items/materials/plants/hemp.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bacon_weave',
                'name': 'Bacon weave',
                'icon': 'assets/icons/activities/bacon_weave.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tailoring_memosphere',
                'name': 'Tailoring memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/tailoring_memosphere.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '92132bd7-606a-40f2-87e7-f4c3bd708683',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'spider_trinket',
                        'name': 'Spider trinket',
                        'icon': 'assets/icons/items/materials/misc/spider_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '22a81c6a-31ef-4b68-b5ff-a61cad19427f',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'safety_scissors',
                        'name': 'Safety scissors',
                        'icon': 'assets/icons/items/gear/simple_scissors.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'marking_chalk',
                        'name': 'Marking chalk',
                        'icon': 'assets/icons/items/gear/marking_chalk.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'practice_pins',
                        'name': 'Practice pins',
                        'icon': 'assets/icons/items/gear/simple_pins.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'c30989ae-2a6c-4537-9b05-0bb02910d4df',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'clingy_measuring_tape',
                        'name': 'Clingy Measuring Tape',
                        'icon': 'assets/icons/items/gear/measuring_tape.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'never_ending_needlecase',
                        'name': 'Never-ending needlecase',
                        'icon': 'assets/icons/items/gear/needlecase.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'durable_fabric_cutting_mat',
                        'name': 'Durable fabric cutting mat',
                        'icon': 'assets/icons/items/gear/fabric_cutting_mat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '15fce75f-8dbc-4e7e-b0a5-427843afbdb6',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'silver_scissors',
                        'name': 'Silver scissors',
                        'icon': 'assets/icons/items/gear/fabric_scissors.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'precision_pins',
                        'name': 'Precision pins',
                        'icon': 'assets/icons/items/gear/sharp_pins.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '8a760f00-0d4a-4ae6-878d-7660c88e276f',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'sewing_guidebook',
                        'name': 'Sewing guidebook',
                        'icon': 'assets/icons/items/gear/sewing_guidebook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'tailors_moccasins',
                        'name': "Tailor's moccasins",
                        'icon': 'assets/icons/items/gear/tailors_moccassins.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '81c4df09-b76b-4e6e-ba9a-92d6b9bf6303',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'pincushion_beret',
                        'name': 'Pincushion beret',
                        'icon': 'assets/icons/items/gear/pincushion_beret.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '03f17a48-8514-4310-82b6-86c2f85582e0',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'tinkering': {
        'id': 'tinkering',
        'name': 'tinkering',
        'category': 'normal',
        'noDropChance': 0.75,
        'tableRows': [
            {
                'rowItemID': None,
                'name': None,
                'icon': 'assets/icons/items/money.png',
                'isMoney': True,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wire_saw',
                'name': 'Wire saw',
                'icon': 'assets/icons/items/gear/skill_gear/crafting/wire_saw.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.08,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'metal_scrap',
                'name': 'Metal scrap',
                'icon': 'assets/icons/items/materials/misc/metal_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 20,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 20,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'tiny_swan_ice_sculpture': {
        'id': 'tiny_swan_ice_sculpture',
        'name': 'tiny swan ice sculpture',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'tiny_swan_ice_sculpture',
                'name': 'Tiny swan ice sculpture',
                'icon': 'assets/icons/items/collectibles/tiny_swan_ice_sculpture.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'trash_transform': {
        'id': 'trash_transform',
        'name': 'trash transform',
        'category': 'normal',
        'noDropChance': 0.5,
        'tableRows': [
            {
                'rowItemID': 'fishing_line',
                'name': 'Fishing line',
                'icon': 'assets/icons/items/materials/misc/fishing_line.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'twine',
                'name': 'Twine',
                'icon': 'assets/icons/items/materials/misc/rope.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_rope',
                'name': 'Simple rope',
                'icon': 'assets/icons/items/gear/skill_gear/agility/simple_rope.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 24.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'metal_scrap',
                'name': 'Metal scrap',
                'icon': 'assets/icons/items/materials/misc/metal_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 24.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_torch',
                'name': 'Simple torch',
                'icon': 'assets/icons/items/gear/skill_gear/agility/simple_torch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_ring',
                'name': 'Simple ring',
                'icon': 'assets/icons/items/gear/skill_gear/global/simple_ring.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_hammer',
                'name': 'Simple hammer',
                'icon': 'assets/icons/items/gear/skill_gear/smithing/simple_hammer.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_amulet',
                'name': 'Simple amulet',
                'icon': 'assets/icons/items/gear/skill_gear/global/simple_amulet.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_pan',
                'name': 'Simple pan',
                'icon': 'assets/icons/items/gear/skill_gear/cooking/simple_pan.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_magnet',
                'name': 'Simple magnet',
                'icon': 'assets/icons/items/gear/skill_gear/mining/simple_magnet.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_gold_pan',
                'name': 'Simple gold pan',
                'icon': 'assets/icons/items/gear/skill_gear/mining/simple_gold_pan.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_bug_catching_net',
                'name': 'Simple bug catching net',
                'icon': 'assets/icons/items/gear/skill_gear/foraging/simple_bug_catching_net.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_life_vest',
                'name': 'Simple life vest',
                'icon': 'assets/icons/items/gear/skill_gear/fishing/simple_life_vest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_saw',
                'name': 'Simple saw',
                'icon': 'assets/icons/items/gear/skill_gear/carpentry/simple_saw.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_chisel',
                'name': 'Simple chisel',
                'icon': 'assets/icons/items/gear/skill_gear/crafting/simple_chisel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_wrench',
                'name': 'Simple wrench',
                'icon': 'assets/icons/items/gear/skill_gear/crafting/simple_wrench.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'simple_sewing_needle',
                'name': 'Simple sewing needle',
                'icon': 'assets/icons/services/simple_sewing_needle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'shrimp_trinket',
                'name': 'Shrimp trinket',
                'icon': 'assets/icons/items/materials/misc/shrimp_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.008,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'treasure_hunt_artificial_snowflake': {
        'id': 'treasure_hunt_artificial_snowflake',
        'name': 'treasure hunt artificial snowflake',
        'category': 'collectible',
        'noDropChance': 0.99997,
        'tableRows': [
            {
                'rowItemID': 'artificial_snowflake',
                'name': 'Artificial snowflake',
                'icon': 'assets/icons/items/collectibles/artificial_snowflake.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 70,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'treasure_hunt_easter_egg': {
        'id': 'treasure_hunt_easter_egg',
        'name': 'treasure hunt easter egg',
        'category': 'collectible',
        'noDropChance': 0.99976,
        'tableRows': [
            {
                'rowItemID': 'easter_egg',
                'name': 'Easter egg',
                'icon': 'assets/icons/items/collectibles/easter_egg.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 70,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'treasure_hunt_enamel_pin_table': {
        'id': 'treasure_hunt_enamel_pin_table',
        'name': 'treasure hunt enamel pin table',
        'category': 'normal',
        'noDropChance': 0.97,
        'tableRows': [
            {
                'rowItemID': 'adventurers_enamel_pin',
                'name': "Adventurers' enamel pin",
                'icon': 'assets/icons/items/materials/adventurer_enemal_pin.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'treasure_hunt_floating_coral': {
        'id': 'treasure_hunt_floating_coral',
        'name': 'treasure hunt floating coral',
        'category': 'collectible',
        'noDropChance': 0.99879,
        'tableRows': [
            {
                'rowItemID': 'floating_coral',
                'name': 'Floating coral',
                'icon': 'assets/icons/items/collectibles/floating_coral.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 70,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'treasure_hunt_petrified_branch': {
        'id': 'treasure_hunt_petrified_branch',
        'name': 'treasure hunt petrified branch',
        'category': 'collectible',
        'noDropChance': 0.9916,
        'tableRows': [
            {
                'rowItemID': 'petrified_branch',
                'name': 'Petrified branch',
                'icon': 'assets/icons/items/collectibles/petrified_branch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 70,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'treasure_hunt_reindeer_egg': {
        'id': 'treasure_hunt_reindeer_egg',
        'name': 'treasure hunt reindeer egg',
        'category': 'petEgg',
        'noDropChance': 0.9995,
        'tableRows': [
            {
                'rowItemID': 'reindeer_egg',
                'name': 'Reindeer egg',
                'icon': 'assets/icons/pets/reindeer/reindeer_egg_static.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': None
    },
    'treasure_hunt_treasure_hunter_token': {
        'id': 'treasure_hunt_treasure_hunter_token',
        'name': 'treasure hunt treasure hunter token',
        'category': 'collectible',
        'noDropChance': 0.99994,
        'tableRows': [
            {
                'rowItemID': 'treasure_hunter_token',
                'name': 'Treasure hunter token',
                'icon': 'assets/icons/items/collectibles/treasure_hunter_token.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 70,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'trellin_chest_table': {
        'id': 'trellin_chest_table',
        'name': 'trellin chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'birch_logs',
                'name': 'Birch logs',
                'icon': 'assets/icons/items/materials/logs/birch_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_logs',
                'name': 'Pine logs',
                'icon': 'assets/icons/items/materials/logs/pine_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spruce_logs',
                'name': 'Spruce logs',
                'icon': 'assets/icons/items/materials/logs/spruce_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'maple_logs',
                'name': 'Maple logs',
                'icon': 'assets/icons/items/materials/logs/maple_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'schnitzel',
                'name': 'Schnitzel',
                'icon': 'assets/icons/items/materials/food/schnitzel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'oak_logs',
                'name': 'Oak logs',
                'icon': 'assets/icons/items/materials/logs/oak_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sturdy_branch',
                'name': 'Sturdy branch',
                'icon': 'assets/icons/items/materials/misc/sturdy_stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '94475344-2815-4862-5484-02a8bf0floki',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': []
            },
            {
                'id': 'reroll-this-id-99e1cd08-6d58-421b-9b33-410e16e0bdd4',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'bug_repelling_incense',
                        'name': 'Bug repelling incense',
                        'icon': 'assets/icons/items/gear/bug_repelling_incense.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'bug_attracting_incense',
                        'name': 'Bug attracting incense',
                        'icon': 'assets/icons/items/gear/bug_attracting_incense.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'firestarter',
                        'name': 'Firestarter',
                        'icon': 'assets/icons/items/gear/firestarter.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-d8d5ef7a-aab7-4fcf-b11f-7109af241b99',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'linden_leaf_boots',
                        'name': 'Linden leaf boots',
                        'icon': 'assets/icons/items/gear/linden_leaf_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'map_of_trellin',
                        'name': 'Map of Trellin',
                        'icon': 'assets/icons/items/gear/skill_gear/agility/trellin_map.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-1d0a4805-2c95-46e7-8207-82a9d9ce20d5',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'linden_leaf_shorts',
                        'name': 'Linden leaf shorts',
                        'icon': 'assets/icons/items/gear/linden_leaf_shorts.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'linden_leaf_gloves',
                        'name': 'Linden leaf gloves',
                        'icon': 'assets/icons/items/gear/linden_leaf_gloves.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-52183c8c-99ba-490c-b001-79427b3ce345',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'linden_leaf_vest',
                        'name': 'Linden leaf vest',
                        'icon': 'assets/icons/items/gear/linden_leaf_vest.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'fungal_backpack',
                        'name': 'Fungal backpack',
                        'icon': 'assets/icons/items/gear/fungal_backpack.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-86a09802-fc20-4499-a0b7-2375fedd2aaf',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'linden_leaf_hat',
                        'name': 'Linden leaf hat',
                        'icon': 'assets/icons/items/gear/linden_leaf_hat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'reroll-this-id-a70f6e77-87e8-4b99-810f-ede097f31aa3',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': [
                    {
                        'rowItemID': 'trellin_beaver',
                        'name': 'Trellin beaver',
                        'icon': 'assets/icons/items/gear/trellin_beaver.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            }
        ]
    },
    'trinketry_activity_chest': {
        'id': 'trinketry_activity_chest',
        'name': 'trinketry activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'trinketry_chest',
                'name': 'Trinketry chest',
                'icon': 'assets/icons/items/openables/chests/trinketry_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'trinketry_chest_table': {
        'id': 'trinketry_chest_table',
        'name': 'trinketry chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'rough_opal',
                'name': 'Rough opal',
                'icon': 'assets/icons/items/materials/ores/rough_opal.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 30,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'trinketry_memosphere',
                'name': 'Trinketry memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/trinketry_memosphere.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 12,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_star_pearl',
                'name': 'Rough star pearl',
                'icon': 'assets/icons/items/materials/ores/rough_star_pearl.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 25,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_topaz',
                'name': 'Rough topaz',
                'icon': 'assets/icons/items/materials/ores/rough_topaz.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_jade',
                'name': 'Rough jade',
                'icon': 'assets/icons/items/materials/ores/rough_jade.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 17,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ruby',
                'name': 'Rough ruby',
                'icon': 'assets/icons/items/materials/ores/rough_ruby.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_sun_stone',
                'name': 'Rough sun stone',
                'icon': 'assets/icons/items/materials/ores/rough_sunstone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_ethernite',
                'name': 'Rough ethernite',
                'icon': 'assets/icons/items/materials/ores/rough_ethernite.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 1,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'creme_brulee',
                'name': 'Creme brulee',
                'icon': 'assets/icons/items/materials/food/creme_brulee.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'silver_nugget',
                'name': 'Silver nugget',
                'icon': 'assets/icons/items/materials/ores/silver_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 7,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'gold_nugget',
                'name': 'Gold nugget',
                'icon': 'assets/icons/items/materials/ores/gold_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 15,
                'rowMinimumAmount': 3,
                'rowMaximumAmount': 5,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'silver_bar',
                'name': 'Silver bar',
                'icon': 'assets/icons/items/materials/bars/silver_bar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'gold_bar',
                'name': 'Gold bar',
                'icon': 'assets/icons/items/materials/bars/gold_bar.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_wrentmarine',
                'name': 'Rough wrentmarine',
                'icon': 'assets/icons/items/materials/ores/rough_wrentmarine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'gem_pouch',
                'name': 'Gem pouch',
                'icon': 'assets/icons/items/openables/chests/gem_pouch.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': '2f383b4c-7fc9-4881-977a-4d237c5e7200',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 50,
                        'rowMaximumAmount': 500,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'lucky_rabbit_foot_trinket',
                        'name': 'Lucky rabbit foot trinket',
                        'icon': 'assets/icons/items/materials/misc/lucky_rabbits_foot_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': 'df15fca6-c328-4a55-aacc-55126a7d5134',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'dull_chisel',
                        'name': 'Dull chisel',
                        'icon': 'assets/icons/items/gear/skill_gear/carpentry/dull_chisel.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    },
                    {
                        'rowItemID': 'rough_sandpaper',
                        'name': 'Rough sandpaper',
                        'icon': 'assets/icons/items/gear/rough_sandpaper.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '15278178-a634-4b08-bcc2-2af3a06ccbfa',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'gem_tipped_tweezers',
                        'name': 'Gem-tipped tweezers',
                        'icon': 'assets/icons/items/gear/gem_tipped_tweezers.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'pretty_pliers',
                        'name': 'Pretty pliers',
                        'icon': 'assets/icons/items/gear/pretty_pliers.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'zip_pouch',
                        'name': 'Zip pouch',
                        'icon': 'assets/icons/items/gear/zip_pouch.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'a023588c-735d-49e6-b6c2-eed7839359e0',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'sharp_chisel',
                        'name': 'Sharp chisel',
                        'icon': 'assets/icons/items/gear/skill_gear/carpentry/sharp_chisel.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'handy_hand_file',
                        'name': 'Handy hand-file',
                        'icon': 'assets/icons/items/gear/hand_file.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'auto_adjusting_mandrel',
                        'name': 'Auto-adjusting mandrel',
                        'icon': 'assets/icons/items/gear/skill_gear/auto_adjusting_mandrel.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '88b2923f-db48-4b0b-9aa0-246b717369af',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'magnifying_lens',
                        'name': 'Magnifying lens',
                        'icon': 'assets/icons/items/gear/skill_gear/magnifying_glass.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'gemistry_guidebook',
                        'name': 'Gemistry guidebook',
                        'icon': 'assets/icons/items/gear/skill_gear/gemistry_guidebook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'golden_chisel',
                        'name': 'Golden chisel',
                        'icon': 'assets/icons/items/gear/golden_chisel.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '1698a291-7912-4d04-ade3-1932ec40609f',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'dar_witts_monocle',
                        'name': "Dar Witt's monocle",
                        'icon': 'assets/icons/items/gear/skill_gear/der_witts_monocle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'f719171c-5cac-4750-8bc3-00fa9f520e71',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'underwater_aqueduct_construction': {
        'id': 'underwater_aqueduct_construction',
        'name': 'underwater aqueduct construction',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'mud',
                'name': 'Mud',
                'icon': 'assets/icons/items/materials/misc/mud.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'underwater_aqueduct_digging': {
        'id': 'underwater_aqueduct_digging',
        'name': 'underwater aqueduct digging',
        'category': 'normal',
        'noDropChance': 0.5,
        'tableRows': [
            {
                'rowItemID': 'stone',
                'name': 'Stone',
                'icon': 'assets/icons/items/materials/plants/stone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'volcanic_rock',
                'name': 'Volcanic rock',
                'icon': 'assets/icons/items/syrenthia/volcanic_rock.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 5,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'silver_nugget',
                'name': 'Silver nugget',
                'icon': 'assets/icons/items/materials/ores/silver_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'gold_nugget',
                'name': 'Gold nugget',
                'icon': 'assets/icons/items/materials/ores/gold_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': None,
                'requirementsBonuses': None
            },
            {
                'rowItemID': 'ring_of_pandemonium',
                'name': 'Ring of pandemonium',
                'icon': 'assets/icons/items/gear/rings/ring_of_pandemonium.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.0053,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': None,
                'requirementsBonuses': None
            }
        ],
        'subTables': None
    },
    'underwater_basket_weaving': {
        'id': 'underwater_basket_weaving',
        'name': 'underwater basket weaving',
        'category': 'normal',
        'noDropChance': 0.6,
        'tableRows': [
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'flatpack_shark',
                'name': 'Flatpack shark',
                'icon': 'assets/icons/items/gear/flatpack_shark.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.07,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': None
            }
        ],
        'subTables': []
    },
    'unicorn_hunting': {
        'id': 'unicorn_hunting',
        'name': 'unicorn hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'elderhide_scraps',
                'name': 'Elderhide scraps',
                'icon': 'assets/icons/items/materials/misc/Elder_hide_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 13,
                'rowMinimumAmount': 13,
                'rowMaximumAmount': 24,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'elderhide_hide',
                'name': 'Elderhide hide',
                'icon': 'assets/icons/items/materials/misc/elder_hide.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 13,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 3,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 45,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 6,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'unicorn_horn',
                'name': 'Unicorn horn',
                'icon': 'assets/icons/items/gear/unicorn_horn.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 28.83,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'swift_sight_goggles',
                'name': 'Swift sight goggles',
                'icon': 'assets/icons/items/gear/skill_gear/agility/swift_sight_goggles.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.17,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'unidentified_remains_table': {
        'id': 'unidentified_remains_table',
        'name': 'unidentified remains table',
        'category': 'normal',
        'noDropChance': 0.7,
        'tableRows': [
            {
                'rowItemID': 'unidentified_remains',
                'name': 'Unidentified remains',
                'icon': 'assets/icons/items/materials/unidentified_remains.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'vegetable_chopping': {
        'id': 'vegetable_chopping',
        'name': 'vegetable chopping',
        'category': 'normal',
        'noDropChance': 0.5,
        'tableRows': [
            {
                'rowItemID': 'potato',
                'name': 'Potato',
                'icon': 'assets/icons/items/materials/farming/yield/potato.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'tomato',
                'name': 'Tomato',
                'icon': 'assets/icons/items/materials/farming/yield/tomato.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'nettle',
                'name': 'Nettle',
                'icon': 'assets/icons/items/materials/plants/nettle.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'very_shiny_stone_collectible': {
        'id': 'very_shiny_stone_collectible',
        'name': 'very shiny stone collectible',
        'category': 'collectible',
        'noDropChance': 0.9998,
        'tableRows': [
            {
                'rowItemID': 'very_shiny_stone',
                'name': 'Very shiny stone',
                'icon': 'assets/icons/items/syrenthia/very_shiny_rock.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'volcanic_rock_mining': {
        'id': 'volcanic_rock_mining',
        'name': 'volcanic rock mining',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'volcanic_rock',
                'name': 'Volcanic rock',
                'icon': 'assets/icons/items/syrenthia/volcanic_rock.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'volcanic_ash',
                'name': 'Volcanic ash',
                'icon': 'assets/icons/items/syrenthia/volcanic_ash.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'wallisia_gem_table': {
        'id': 'wallisia_gem_table',
        'name': 'wallisia gem table',
        'category': 'normal',
        'noDropChance': 0.99,
        'tableRows': [
            {
                'rowItemID': 'rough_star_pearl',
                'name': 'Rough star pearl',
                'icon': 'assets/icons/items/materials/ores/rough_star_pearl.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_topaz',
                'name': 'Rough topaz',
                'icon': 'assets/icons/items/materials/ores/rough_topaz.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'weeping_willow_tear_collectible': {
        'id': 'weeping_willow_tear_collectible',
        'name': 'weeping willow tear collectible',
        'category': 'collectible',
        'noDropChance': 0.9997,
        'tableRows': [
            {
                'rowItemID': 'weeping_willow_tear',
                'name': 'Weeping willow tear',
                'icon': 'assets/icons/items/collectibles/weeping_willow_tear.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'wine_stomping': {
        'id': 'wine_stomping',
        'name': 'wine stomping',
        'category': 'normal',
        'noDropChance': 0.2,
        'tableRows': [
            {
                'rowItemID': 'wine',
                'name': 'Wine',
                'icon': 'assets/icons/items/materials/food/wine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'eberhart_corkscrew',
                'name': 'Eberhart corkscrew',
                'icon': 'assets/icons/items/gear/skill_gear/cooking/eberhart_corkscrew.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.01,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'berries',
                'name': 'Berries',
                'icon': 'assets/icons/items/materials/plants/berries.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'measuring_spoons_trinket',
                'name': 'Measuring spoons trinket',
                'icon': 'assets/icons/items/materials/misc/measuring_spoon_trinket.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.005,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'wolf_hunting': {
        'id': 'wolf_hunting',
        'name': 'wolf hunting',
        'category': 'normal',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'hide_scraps',
                'name': 'Hide scraps',
                'icon': 'assets/icons/items/materials/misc/leather_scraps.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 50,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 8,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_fur',
                'name': 'Animal fur',
                'icon': 'assets/icons/items/materials/animal_fur.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'basic_hide',
                'name': 'Basic hide',
                'icon': 'assets/icons/items/materials/misc/light_hide.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'bones',
                'name': 'Bones',
                'icon': 'assets/icons/items/materials/bones.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'animal_meat',
                'name': 'Animal meat',
                'icon': 'assets/icons/items/materials/animal_meat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'wood_carving': {
        'id': 'wood_carving',
        'name': 'wood carving',
        'category': 'normal',
        'noDropChance': 0.9,
        'tableRows': [
            {
                'rowItemID': 'carving_knife',
                'name': 'Carving knife',
                'icon': 'assets/icons/items/gear/skill_gear/crafting/carving_knife.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.24,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'wood_scrap',
                'name': 'Wood scrap',
                'icon': 'assets/icons/items/materials/misc/wood_scrap.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 2,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'woodcutting_activity_chest': {
        'id': 'woodcutting_activity_chest',
        'name': 'woodcutting activity chest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'woodcutting_chest',
                'name': 'Woodcutting chest',
                'icon': 'assets/icons/items/openables/chests/woodcutting_chest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'woodcutting_bird_nest': {
        'id': 'woodcutting_bird_nest',
        'name': 'woodcutting bird nest',
        'category': 'normal',
        'noDropChance': 0.996,
        'tableRows': [
            {
                'rowItemID': 'bird_nest',
                'name': 'Bird nest',
                'icon': 'assets/icons/items/openables/chests/birds_nest.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'woodcutting_chest_table': {
        'id': 'woodcutting_chest_table',
        'name': 'woodcutting chest table',
        'category': 'chest',
        'noDropChance': 0,
        'tableRows': [
            {
                'rowItemID': 'birch_logs',
                'name': 'Birch logs',
                'icon': 'assets/icons/items/materials/logs/birch_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 11,
                'rowMinimumAmount': 4,
                'rowMaximumAmount': 9,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pine_logs',
                'name': 'Pine logs',
                'icon': 'assets/icons/items/materials/logs/pine_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 9,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 14,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'spruce_logs',
                'name': 'Spruce logs',
                'icon': 'assets/icons/items/materials/logs/spruce_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 12,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'maple_logs',
                'name': 'Maple logs',
                'icon': 'assets/icons/items/materials/logs/maple_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 8,
                'rowMinimumAmount': 6,
                'rowMaximumAmount': 11,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'schnitzel',
                'name': 'Schnitzel',
                'icon': 'assets/icons/items/materials/food/schnitzel.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 2,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'oak_logs',
                'name': 'Oak logs',
                'icon': 'assets/icons/items/materials/logs/oak_log.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'woodcutting_memosphere',
                'name': 'Woodcutting memosphere',
                'icon': 'assets/icons/items/consumables/memospheres/memosphere_woodcutting.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 4,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 2,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'sturdy_branch',
                'name': 'Sturdy branch',
                'icon': 'assets/icons/items/materials/misc/sturdy_stick.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 5,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': [
            {
                'id': 'b002192d-321c-4d3a-9205-22e2c2e9b8b2',
                'weight': 0.2164,
                'type': 'money',
                'tableRows': [
                    {
                        'rowItemID': None,
                        'name': None,
                        'icon': 'assets/icons/items/money.png',
                        'isMoney': True,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 10,
                        'rowMaximumAmount': 100,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'circular_root_trinket',
                        'name': 'Circular root trinket',
                        'icon': 'assets/icons/items/materials/misc/circular_root_trinket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 0.512,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': None
                    }
                ]
            },
            {
                'id': '839c74f8-9bfc-43a7-bc41-c44866b01803',
                'weight': 0.2,
                'type': 'common',
                'tableRows': [
                    {
                        'rowItemID': 'lumberjack_sandals',
                        'name': 'Lumberjack sandals',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/lumberjack_sandals.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'lumberjack_pants',
                        'name': 'Lumberjack pants',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/lumberjacks_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'fc49471e-9494-41c1-8551-f992379ed7db',
                'weight': 0.05,
                'type': 'uncommon',
                'tableRows': [
                    {
                        'rowItemID': 'log_basket',
                        'name': 'Log basket',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/log_basket.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'lumberjack_hat',
                        'name': 'Lumberjack hat',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/lumberjack_hat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'lumberjack_shirt',
                        'name': 'Lumberjack shirt',
                        'icon': 'assets/icons/items/gear/skill_gear/lumberjacks_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'c3625473-017f-4b06-9fd5-a570aed2f58a',
                'weight': 0.025,
                'type': 'rare',
                'tableRows': [
                    {
                        'rowItemID': 'log_splitter',
                        'name': 'Log splitter',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/log_splitter.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'foresters_pants',
                        'name': "Forester's pants",
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/foresters_pants.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '82d360e7-73a8-46ff-b14c-b9d505b7088c',
                'weight': 0.0075,
                'type': 'epic',
                'tableRows': [
                    {
                        'rowItemID': 'heavy_axe_handle',
                        'name': 'Heavy axe handle',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/heavy_axe_handle.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'foresters_hat',
                        'name': "Forester's hat",
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/foresters_hat.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'woodcutting_guidebook',
                        'name': 'Woodcutting guidebook',
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/woodcutting_guidebook.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    },
                    {
                        'rowItemID': 'foresters_flannel_shirt',
                        'name': "Forester's flannel shirt",
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/foresters_flannel_shirt.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': 'c9c85a3c-288c-4603-8055-e9b46191644f',
                'weight': 0.001,
                'type': 'legendary',
                'tableRows': [
                    {
                        'rowItemID': 'foresters_boots',
                        'name': "Forester's boots",
                        'icon': 'assets/icons/items/gear/skill_gear/woodcutting/foresters_boots.png',
                        'isMoney': False,
                        'linearWeightScaling': True,
                        'rowWeight': 10,
                        'rowMinimumAmount': 1,
                        'rowMaximumAmount': 1,
                        'minWeightScale': 0,
                        'requirementsBonuses': []
                    }
                ]
            },
            {
                'id': '4b7e7967-9294-489d-811f-830aed9c6645',
                'weight': 0.0001,
                'type': 'ethereal',
                'tableRows': []
            }
        ]
    },
    'wooden_carved_bear_figurine': {
        'id': 'wooden_carved_bear_figurine',
        'name': 'wooden carved bear figurine',
        'category': 'collectible',
        'noDropChance': 0.999,
        'tableRows': [
            {
                'rowItemID': 'wooden_carved_bear_figurine',
                'name': 'Wooden carved bear figurine',
                'icon': 'assets/icons/items/collectibles/wooden_carved_bear_figurine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'wreck_diving': {
        'id': 'wreck_diving',
        'name': 'wreck diving',
        'category': 'normal',
        'noDropChance': 0.1,
        'tableRows': [
            {
                'rowItemID': 'sea_shell',
                'name': 'Sea shell',
                'icon': 'assets/icons/items/materials/misc/seashell_2.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 10,
                'rowMinimumAmount': 10,
                'rowMaximumAmount': 15,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'pirate_hat',
                'name': 'Pirate hat',
                'icon': 'assets/icons/items/syrenthia/pirate_hat.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 0.025,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'gold_nugget',
                'name': 'Gold nugget',
                'icon': 'assets/icons/items/materials/ores/gold_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'silver_nugget',
                'name': 'Silver nugget',
                'icon': 'assets/icons/items/materials/ores/silver_nugget.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 7,
                'rowMinimumAmount': 5,
                'rowMaximumAmount': 10,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    },
    'wrentmark_gem_table': {
        'id': 'wrentmark_gem_table',
        'name': 'wrentmark gem table',
        'category': 'normal',
        'noDropChance': 0.99,
        'tableRows': [
            {
                'rowItemID': 'rough_wrentmarine',
                'name': 'Rough wrentmarine',
                'icon': 'assets/icons/items/materials/ores/rough_wrentmarine.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 20,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            },
            {
                'rowItemID': 'rough_sun_stone',
                'name': 'Rough sun stone',
                'icon': 'assets/icons/items/materials/ores/rough_sunstone.png',
                'isMoney': False,
                'linearWeightScaling': True,
                'rowWeight': 3,
                'rowMinimumAmount': 1,
                'rowMaximumAmount': 1,
                'minWeightScale': 0.05,
                'requirementsBonuses': []
            }
        ],
        'subTables': []
    }
}
