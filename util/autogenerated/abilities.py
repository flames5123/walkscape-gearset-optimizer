#!/usr/bin/env python3
"""
Abilities — character/equipment passive and active abilities.
DO NOT EDIT MANUALLY
"""

ABILITIES = {
    'clever_climber': {
        'id': 'clever_climber',
        'name': 'Clever Climber',
        'type': 'passive',
        'desc': 'Counts as a <object id="climbing_gear" />.',
        'requirements': [],
        'cooldown': None,
        'data': [],
        'icon': 'assets/icons/abilities/clever_climber.png'
    },
    'down_go_the_trees': {
        'id': 'down_go_the_trees',
        'name': 'Down Go The Trees',
        'type': 'active',
        'desc': 'Completes {count} <skill skill="woodcutting"/> actions instantly.',
        'requirements': [
            {
                'type': 'activityType',
                'name': None,
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'woodcutting_trees'
                    ],
                    'skill': None,
                    'activity': None
                }
            },
            {
                'type': 'itemEquipped',
                'name': None,
                'opposite': False,
                'requirement': {
                    'item': 'axe_of_destruction'
                }
            }
        ],
        'cooldown': {
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': None,
            'steps': 9999,
            'actions': None,
            'requirements': [
                {
                    'type': 'activityType',
                    'name': None,
                    'opposite': False,
                    'requirement': {
                        'keywords': [
                            'woodcutting_trees'
                        ],
                        'skill': None,
                        'activity': None
                    }
                },
                {
                    'type': 'itemEquipped',
                    'name': None,
                    'opposite': False,
                    'requirement': {
                        'item': 'axe_of_destruction'
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'completeActions',
                        'runtimeType': 'completeActions',
                        'count': 35
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/destory_wood.png'
    },
    'emergency_desert_escape!': {
        'id': 'emergency_desert_escape!',
        'name': 'Emergency Desert Escape!',
        'type': 'emergency',
        'desc': 'You escape to <object id="kildome_cross" />.',
        'requirements': [],
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'kildome_cross'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/emergency_escape_desert.png'
    },
    'emergency_swamp_escape!': {
        'id': 'emergency_swamp_escape!',
        'name': 'Emergency Swamp Escape!',
        'type': 'emergency',
        'desc': 'You escape to <object id="old_arena_ruins" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'old_arena_ruins'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/emergency_escape_global.png'
    },
    'emergency_swim_escape!': {
        'id': 'emergency_swim_escape!',
        'name': 'Emergency Swim Escape!',
        'type': 'emergency',
        'desc': 'You swim to <object id="old_arena_ruins" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'old_arena_ruins'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/emergency_escape_global.png'
    },
    'explore_bog_bottom': {
        'id': 'explore_bog_bottom',
        'name': 'Explore Bog Bottom',
        'type': 'activity',
        'desc': 'You explore the bog bottom to <object id="underwater_cave" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'underwater_cave'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/explore_marsh_green.png'
    },
    'explore_underwater_cave': {
        'id': 'explore_underwater_cave',
        'name': 'Explore Underwater Cave',
        'type': 'activity',
        'desc': 'You explore the underwater cave to <object id="bog_bottom" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'bog_bottom'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/explore_underwater_cave.png'
    },
    'i_miss_the_sun': {
        'id': 'i_miss_the_sun',
        'name': 'I Miss The Sun',
        'type': 'active',
        'desc': 'Teleports you to <object id="myriadian_arc" />.',
        'requirements': [],
        'cooldown': {
            'seconds': None,
            'minutes': None,
            'hours': 12,
            'days': None,
            'steps': None,
            'actions': None,
            'requirements': []
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'myriadian_arc'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/i_miss_the_sun.png'
    },
    'memosphere:_agility': {
        'id': 'memosphere:_agility',
        'name': 'Memosphere: Agility',
        'type': 'consumable',
        'desc': 'Grants <skill skill="agility"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'agility',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_agility.png'
    },
    'memosphere:_carpentry': {
        'id': 'memosphere:_carpentry',
        'name': 'Memosphere: Carpentry',
        'type': 'consumable',
        'desc': 'Grants <skill skill="carpentry"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'carpentry',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_carpentry.png'
    },
    'memosphere:_cooking': {
        'id': 'memosphere:_cooking',
        'name': 'Memosphere: Cooking',
        'type': 'consumable',
        'desc': 'Grants <skill skill="cooking"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'cooking',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_cooking.png'
    },
    'memosphere:_crafting': {
        'id': 'memosphere:_crafting',
        'name': 'Memosphere: Crafting',
        'type': 'consumable',
        'desc': 'Grants <skill skill="crafting"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'crafting',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_crafting.png'
    },
    'memosphere:_fishing': {
        'id': 'memosphere:_fishing',
        'name': 'Memosphere: Fishing',
        'type': 'consumable',
        'desc': 'Grants <skill skill="fishing"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'fishing',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_fishing.png'
    },
    'memosphere:_foraging': {
        'id': 'memosphere:_foraging',
        'name': 'Memosphere: Foraging',
        'type': 'consumable',
        'desc': 'Grants <skill skill="foraging"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'foraging',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_foraging.png'
    },
    'memosphere:_hunting': {
        'id': 'memosphere:_hunting',
        'name': 'Memosphere: Hunting',
        'type': 'consumable',
        'desc': 'Grants <skill skill="hunting"/> experience.',
        'requirements': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'hunting',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/hunting_memosphere.png'
    },
    'memosphere:_mining': {
        'id': 'memosphere:_mining',
        'name': 'Memosphere: Mining',
        'type': 'consumable',
        'desc': 'Grants <skill skill="mining"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'mining',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_mining.png'
    },
    'memosphere:_smithing': {
        'id': 'memosphere:_smithing',
        'name': 'Memosphere: Smithing',
        'type': 'consumable',
        'desc': 'Grants <skill skill="smithing"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'smithing',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_smithing.png'
    },
    'memosphere:_tailoring': {
        'id': 'memosphere:_tailoring',
        'name': 'Memosphere: Tailoring',
        'type': 'consumable',
        'desc': 'Grants <skill skill="tailoring"/> experience.',
        'requirements': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'tailoring',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/tailoring_memosphere.png'
    },
    'memosphere:_trinketry': {
        'id': 'memosphere:_trinketry',
        'name': 'Memosphere: Trinketry',
        'type': 'consumable',
        'desc': 'Grants <skill skill="trinketry"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'trinketry',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/trinketry_memosphere.png'
    },
    'memosphere:_woodcutting': {
        'id': 'memosphere:_woodcutting',
        'name': 'Memosphere: Woodcutting',
        'type': 'consumable',
        'desc': 'Grants <skill skill="woodcutting"/> experience.',
        'requirements': None,
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'experience',
                        'runtimeType': 'experience',
                        'experienceType': 'timesLevel',
                        'skill': 'woodcutting',
                        'flat': None,
                        'percent': None,
                        'timesLevel': 20
                    }
                ]
            }
        ],
        'icon': 'assets/icons/items/consumables/memospheres/memosphere_woodcutting.png'
    },
    'mermaids_need_me': {
        'id': 'mermaids_need_me',
        'name': 'Mermaids Need Me',
        'type': 'active',
        'desc': 'Teleports you to <object id="vastalume" />.',
        'requirements': [
            {
                'type': 'activityType',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'fishing'
                    ],
                    'skill': None,
                    'activity': None
                }
            }
        ],
        'cooldown': {
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': 2,
            'steps': None,
            'actions': None,
            'requirements': []
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'vastalume'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/teleport.png'
    },
    'navigate_desert': {
        'id': 'navigate_desert',
        'name': 'Navigate Desert',
        'type': 'passive',
        'desc': 'Allows you to navigate and interact in <object id="desert" /> environments.',
        'requirements': [],
        'cooldown': None,
        'data': [],
        'icon': 'assets/icons/abilities/navigate_desert.png'
    },
    'need_to_go_fast': {
        'id': 'need_to_go_fast',
        'name': 'Need To Go Fast',
        'type': 'active',
        'desc': 'Completes {count} <hl>Travelling</hl> actions instantly.',
        'requirements': [
            {
                'type': 'traveling',
                'name': '',
                'opposite': False,
                'requirement': {}
            },
            {
                'type': 'itemEquipped',
                'name': '',
                'opposite': False,
                'requirement': {
                    'item': 'shoes_of_escape'
                }
            }
        ],
        'cooldown': {
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': None,
            'steps': 6000,
            'actions': None,
            'requirements': [
                {
                    'type': 'itemEquipped',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'item': 'shoes_of_escape'
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'completeActions',
                        'runtimeType': 'completeActions',
                        'count': 10
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/move_fast.png'
    },
    'pecking_order': {
        'id': 'pecking_order',
        'name': 'Pecking Order',
        'type': 'active',
        'desc': 'Completes {count} <skill skill="foraging"/> actions instantly.',
        'requirements': [
            {
                'type': 'mainSkill',
                'name': '',
                'opposite': False,
                'requirement': {
                    'skill': 'foraging'
                }
            },
            {
                'type': 'abilityAvailable',
                'name': '',
                'opposite': False,
                'requirement': {
                    'ability': 'pecking_order',
                    'scanEquippedItems': False
                }
            }
        ],
        'cooldown': {
            'steps': 4000,
            'requirements': [
                {
                    'type': 'mainSkill',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'skill': 'foraging'
                    }
                },
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'pecking_order',
                        'scanEquippedItems': False
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'completeActions',
                        'runtimeType': 'completeActions',
                        'count': 5
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/pecking_order.png'
    },
    'present_rain': {
        'id': 'present_rain',
        'name': 'Present Rain',
        'type': 'active',
        'desc': 'Gives 5 random <hl>presents</hl> containing items.',
        'requirements': [],
        'cooldown': {
            'hours': 10,
            'requirements': []
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'rollLootTable',
                        'runtimeType': 'rollLootTable',
                        'tables': [
                            {
                                'id': '77a1e0c1-205a-41f4-8b43-bbf69599a6e8',
                                'isPrimary': False,
                                'type': [],
                                'rollAmount': 5,
                                'tables': [
                                    '25038dda-3538-4a64-95fa-fff809b0e2ed'
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/present_rain.png'
    },
    'rock_and_roll': {
        'id': 'rock_and_roll',
        'name': 'Rock And Roll',
        'type': 'active',
        'desc': 'Creates 5 random <hl>rough gems</hl>.',
        'requirements': [],
        'cooldown': {
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': None,
            'steps': None,
            'actions': 300,
            'requirements': [
                {
                    'type': 'mainSkill',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'skill': 'mining'
                    }
                },
                {
                    'type': 'activityType',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'keywords': [
                            'mining_ores'
                        ],
                        'skill': None,
                        'activity': None
                    }
                },
                {
                    'type': 'itemEquipped',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'item': 'rock_star_amulet'
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'rollLootTable',
                        'runtimeType': 'rollLootTable',
                        'tables': [
                            {
                                'id': 'reroll-this-id-b1f102bd-bda0-423c-87af-d538f90f9c0d',
                                'isPrimary': False,
                                'type': [],
                                'rollAmount': 5,
                                'tables': [
                                    'loottable-gem_pouch_table-b13d22bc-ca02-4238-9534-7ba804c9e2c4'
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/spawn_gems.png'
    },
    'run_for_your_life!': {
        'id': 'run_for_your_life!',
        'name': 'Run For Your Life!',
        'type': 'emergency',
        'desc': 'You escape to <object id="old_arena_ruins" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'old_arena_ruins'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/agility/darkness_escape.png'
    },
    'shell_forge': {
        'id': 'shell_forge',
        'name': 'Shell Forge',
        'type': 'active',
        'desc': 'Completes {count} <object id="smelting" /> actions instantly.',
        'requirements': [
            {
                'type': 'activityType',
                'name': 'requirements.singulars.uniques.smeltRecipe',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'smelting'
                    ],
                    'skill': None,
                    'activity': None
                }
            },
            {
                'type': 'abilityAvailable',
                'name': '',
                'opposite': False,
                'requirement': {
                    'ability': 'shell_forge'
                }
            }
        ],
        'cooldown': {
            'steps': 4000,
            'requirements': [
                {
                    'type': 'mainSkill',
                    'name': 'requirements.singulars.uniques.notAgility',
                    'opposite': True,
                    'requirement': {
                        'skill': 'agility'
                    }
                },
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'shell_forge',
                        'scanEquippedItems': False
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'completeActions',
                        'runtimeType': 'completeActions',
                        'count': 5
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/shell_forge.png'
    },
    'spring_bat_tracking': {
        'id': 'spring_bat_tracking',
        'name': 'Spring Bat Tracking',
        'type': 'activity',
        'desc': 'You track the bats to <object id="bog_top" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'bog_top'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/agility/spring_bat_tracking.png'
    },
    'take_me_home': {
        'id': 'take_me_home',
        'name': 'Take Me Home',
        'type': 'active',
        'desc': 'Teleports you to <object id="kallaheim" />.',
        'requirements': [
            {
                'type': 'itemAnywhereWithYou',
                'name': None,
                'opposite': False,
                'requirement': {
                    'item': 'ring_of_homesickness'
                }
            }
        ],
        'cooldown': {
            'seconds': None,
            'minutes': None,
            'hours': 12,
            'days': None,
            'steps': None,
            'actions': None,
            'requirements': []
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'kallaheim'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/teleport.png'
    },
    'thats_a_wrap': {
        'id': 'thats_a_wrap',
        'name': "That's A Wrap",
        'type': 'active',
        'desc': 'Gives some <hl>linens</hl>.',
        'requirements': [],
        'cooldown': {
            'steps': 3000,
            'requirements': [
                {
                    'type': 'mainSkill',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'skill': 'tailoring'
                    }
                },
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'thats_a_wrap',
                        'scanEquippedItems': False
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'rollLootTable',
                        'runtimeType': 'rollLootTable',
                        'tables': [
                            {
                                'id': '201a7a20-a433-4a82-bdfc-1e53120534b2',
                                'isPrimary': False,
                                'type': [],
                                'rollAmount': 2,
                                'tables': [
                                    'd2c1b3e6-a825-4c4f-94d0-40666cd59d6f'
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/mummy_ability.png'
    },
    'the_hunt_is_on': {
        'id': 'the_hunt_is_on',
        'name': 'The Hunt Is On',
        'type': 'active',
        'desc': 'Gives you some buffs toward <skill skill="hunting"/>.',
        'requirements': [],
        'cooldown': {
            'requirements': [
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'the_hunt_is_on',
                        'scanEquippedItems': False
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'effect',
                        'runtimeType': 'effect',
                        'attributes': [
                            {
                                'id': 'eb747da5-0c58-4511-9a62-8b433304b2f4',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Work efficiency',
                                'skillText': 'Hunting',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'hunting'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'work_efficiency',
                                        'name': 'Work efficiency',
                                        'type': 'workEfficiency',
                                        'isPercent': True,
                                        'value': 0.06,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            },
                            {
                                'id': '098e849f-4256-4e64-9385-a12e626606ef',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Double action',
                                'skillText': 'Hunting',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'hunting'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'double_action',
                                        'name': 'Double action',
                                        'type': 'doubleAction',
                                        'isPercent': True,
                                        'value': 0.03,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            },
                            {
                                'id': '3f97befc-68c6-4fe8-87ac-aafbf4c2e3ba',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Steps required',
                                'skillText': 'Hunting',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'hunting'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'steps_required',
                                        'name': 'Steps required',
                                        'type': 'stepsRequired',
                                        'isPercent': False,
                                        'value': -2,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            }
                        ],
                        'duration': {
                            'id': 'a51b3bae-52f9-4147-b82d-bcc484647cf1',
                            'actions': 20
                        }
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/tiger_ability.png'
    },
    'torpedo_away': {
        'id': 'torpedo_away',
        'name': 'Torpedo Away',
        'type': 'active',
        'desc': 'Completes {count} <hl>Underwater Travelling</hl> actions instantly.',
        'requirements': [
            {
                'type': 'traveling',
                'name': '',
                'opposite': False,
                'requirement': {}
            },
            {
                'type': 'locationHasKeywords',
                'name': '',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'underwater'
                    ]
                }
            },
            {
                'type': 'abilityAvailable',
                'name': '',
                'opposite': False,
                'requirement': {
                    'ability': 'torpedo_away',
                    'scanEquippedItems': False
                }
            }
        ],
        'cooldown': {
            'steps': 5000,
            'requirements': [
                {
                    'type': 'locationHasKeywords',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'keywords': [
                            'underwater'
                        ]
                    }
                },
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'torpedo_away',
                        'scanEquippedItems': False
                    }
                }
            ]
        },
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'completeActions',
                        'runtimeType': 'completeActions',
                        'count': 10
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/torpedo_away.png'
    },
    'venture_into_the_bog': {
        'id': 'venture_into_the_bog',
        'name': 'Venture Into The Bog',
        'type': 'activity',
        'desc': 'You venture into the bog to <object id="bog_top" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'bog_top'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/venture_bog.png'
    },
    'venture_into_the_hideout': {
        'id': 'venture_into_the_hideout',
        'name': 'Venture Into The Hideout',
        'type': 'activity',
        'desc': 'You venture into the hideout to <object id="halfmaw_hideout" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'halfmaw_hideout'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/venture_hideout.png'
    },
    'venture_into_the_woods': {
        'id': 'venture_into_the_woods',
        'name': 'Venture Into The Woods',
        'type': 'activity',
        'desc': 'You venture into the woods to <object id="witched_woods" />.',
        'requirements': [],
        'cooldown': None,
        'data': [
            {
                'dataType': 'normal',
                'actions': [
                    {
                        'type': 'teleport',
                        'runtimeType': 'teleport',
                        'location': 'witched_woods'
                    }
                ]
            }
        ],
        'icon': 'assets/icons/activities/venture_woods.png'
    }
}
