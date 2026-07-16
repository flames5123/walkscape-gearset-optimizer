#!/usr/bin/env python3
"""
Terrain modifiers — referenced by routes.options[].terrainModifiers; each carries its own requirements[] (e.g. "2 light sources" → distinctKeywordItemsEquipped requirement).
DO NOT EDIT MANUALLY
"""

TERRAIN_MODIFIERS = {
    '2_light_sources': {
        'id': '2_light_sources',
        'name': '2 Light sources',
        'requirements': [
            {
                'type': 'distinctKeywordItemsEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'light_source'
                    ],
                    'quantity': 2
                }
            }
        ],
        'keyword': []
    },
    '3_light_sources': {
        'id': '3_light_sources',
        'name': '3 Light sources',
        'requirements': [
            {
                'type': 'distinctKeywordItemsEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'light_source'
                    ],
                    'quantity': 3
                }
            }
        ],
        'keyword': []
    },
    'advanced_diving_gear': {
        'id': 'advanced_diving_gear',
        'name': 'Advanced diving gear',
        'requirements': [
            {
                'type': 'distinctKeywordItemsEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'advanced_diving_gear'
                    ],
                    'quantity': 3
                }
            }
        ],
        'keyword': []
    },
    'black_eye_peak_wilderness_permit': {
        'id': 'black_eye_peak_wilderness_permit',
        'name': 'Black eye peak wilderness permit',
        'requirements': [
            {
                'type': 'itemAnywhereWithYou',
                'name': '',
                'opposite': False,
                'requirement': {
                    'item': 'black_eye_peak_wilderness_permit'
                }
            }
        ],
        'keyword': []
    },
    'challenging_wilderness_terrain': {
        'id': 'challenging_wilderness_terrain',
        'name': 'Challenging wilderness terrain',
        'requirements': [
            {
                'type': 'distinctKeywordItemsEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'skis'
                    ],
                    'quantity': 1
                }
            },
            {
                'type': 'skillLevel',
                'name': '',
                'opposite': False,
                'requirement': {
                    'level': 25,
                    'skill': 'agility'
                }
            }
        ],
        'keyword': []
    },
    'charter_of_the_drowned': {
        'id': 'charter_of_the_drowned',
        'name': 'Charter of the drowned',
        'requirements': [
            {
                'type': 'itemAnywhereWithYou',
                'name': '',
                'opposite': False,
                'requirement': {
                    'item': 'charter_of_the_drowned'
                }
            }
        ],
        'keyword': []
    },
    'difficult_mountain_terrain': {
        'id': 'difficult_mountain_terrain',
        'name': 'Difficult mountain terrain',
        'requirements': [
            {
                'type': 'skillLevel',
                'name': '',
                'opposite': False,
                'requirement': {
                    'level': 35,
                    'skill': 'agility'
                }
            }
        ],
        'keyword': [
            'mountains'
        ]
    },
    'diving_gear': {
        'id': 'diving_gear',
        'name': 'Diving gear',
        'requirements': [
            {
                'type': 'distinctKeywordItemsEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'diving_gear'
                    ],
                    'quantity': 3
                }
            }
        ],
        'keyword': []
    },
    'expert_diving_gear': {
        'id': 'expert_diving_gear',
        'name': 'Expert diving gear',
        'requirements': [
            {
                'type': 'distinctKeywordItemsEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'expert_diving_gear'
                    ],
                    'quantity': 3
                }
            }
        ],
        'keyword': []
    },
    'jarvonian_border_check': {
        'id': 'jarvonian_border_check',
        'name': 'Jarvonian border check',
        'requirements': [
            {
                'type': 'itemAnywhereWithYou',
                'name': '',
                'opposite': False,
                'requirement': {
                    'item': 'jarvonian_letter_of_passage'
                }
            }
        ],
        'keyword': [
            'jarvonia_visa_needed'
        ]
    },
    'level_50_agility': {
        'id': 'level_50_agility',
        'name': 'Level 50 Agility',
        'requirements': [
            {
                'type': 'skillLevel',
                'name': '',
                'opposite': False,
                'requirement': {
                    'level': 50,
                    'skill': 'agility'
                }
            }
        ],
        'keyword': []
    },
    'level_50_fishing': {
        'id': 'level_50_fishing',
        'name': 'Level 50 Fishing',
        'requirements': [
            {
                'type': 'skillLevel',
                'name': '',
                'opposite': False,
                'requirement': {
                    'level': 50,
                    'skill': 'fishing'
                }
            }
        ],
        'keyword': []
    },
    'mysterious_northern_map': {
        'id': 'mysterious_northern_map',
        'name': 'Mysterious northern map',
        'requirements': [
            {
                'type': 'itemAnywhereWithYou',
                'name': '',
                'opposite': False,
                'requirement': {
                    'item': 'mysterious_northern_map'
                }
            }
        ],
        'keyword': [
            'glacier_map_needed'
        ]
    },
    'spring_bat_tracking_completion': {
        'id': 'spring_bat_tracking_completion',
        'name': 'Spring bat tracking completion',
        'requirements': [
            {
                'type': 'historyData',
                'name': 'terrainmodifiers.singulars.requiresActivity.springBats.desc',
                'opposite': False,
                'requirement': {
                    'category': 'actionCompleted',
                    'data': 'spring_bat_tracking',
                    'value': 1,
                    'distinct': False
                }
            }
        ],
        'keyword': []
    },
    'terrainmodifiers.singulars.requiresability.navigatedesert.name': {
        'id': 'terrainmodifiers.singulars.requiresability.navigatedesert.name',
        'name': 'terrainmodifiers.singulars.requiresAbility.navigateDesert.name',
        'requirements': [
            {
                'type': 'abilityAvailable',
                'name': '',
                'opposite': False,
                'requirement': {
                    'ability': 'navigate_desert',
                    'scanEquippedItems': False
                }
            }
        ],
        'keyword': []
    },
    'underwater_map': {
        'id': 'underwater_map',
        'name': 'Underwater map',
        'requirements': [
            {
                'type': 'itemAnywhereWithYou',
                'name': 'terrainmodifiers.singulars.requiresItems.UnderwaterMap.desc',
                'opposite': False,
                'requirement': {
                    'item': 'underwater_map'
                }
            }
        ],
        'keyword': []
    }
}
