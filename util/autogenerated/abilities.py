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
        'attributes': [
            {
                'id': '0add86b0-aebd-457f-962c-06a15661b021',
                'customIcon': None,
                'customTextLocalizationKey': '',
                'customText': '',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'to <object id="{keyword}" /> count',
                'skillText': '',
                'tables': None,
                'requirements': None,
                'stats': [
                    {
                        'stat': 'to_<object_id={keyword}_/>_count',
                        'name': 'to <object id="{keyword}" /> count',
                        'type': 'countsAsKeyword',
                        'isPercent': False,
                        'value': 1,
                        'isNegative': False,
                        'isMultiplicative': True
                    }
                ]
            }
        ],
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
            'id': 'cooldown-downGoesTheTrees',
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': None,
            'steps': 9999,
            'actions': None,
            'charges': 3,
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
    'flambé': {
        'id': 'flambé',
        'name': 'Flambé',
        'type': 'active',
        'desc': 'Completes {count} <object id="cooking_recipe" /> actions instantly with a small chance to give <itemTag tag="fine"/> results.',
        'requirements': [
            {
                'type': 'activityType',
                'name': 'requirements.singulars.uniques.cookingRecipe',
                'opposite': False,
                'requirement': {
                    'keywords': [
                        'cooking_recipe'
                    ],
                    'skill': None,
                    'activity': None
                }
            },
            {
                'type': 'locationHasKeywords',
                'name': 'requirements.singulars.uniques.notUnderwater',
                'opposite': True,
                'requirement': {
                    'keywords': [
                        'underwater'
                    ]
                }
            }
        ],
        'cooldown': {
            'id': 'cooldown-flambe',
            'steps': 2500,
            'charges': 15,
            'requirements': [
                {
                    'type': 'locationHasKeywords',
                    'name': 'requirements.singulars.uniques.notUnderwater',
                    'opposite': True,
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
                        'ability': 'flambé',
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
                        'count': 3
                    }
                ]
            },
            {
                'dataType': None,
                'actions': [
                    {
                        'type': 'effect',
                        'runtimeType': 'effect',
                        'attributes': [
                            {
                                'id': '15ab15c1-ce3a-4b37-8ca7-a3faafede921',
                                'customIcon': None,
                                'customTextLocalizationKey': None,
                                'customText': '',
                                'textLocalizationKey': None,
                                'text': '',
                                'statText': 'Fine recipe outcome',
                                'skillText': 'Cooking',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': None,
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'cooking'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'fine_recipe_outcome',
                                        'name': 'Fine recipe outcome',
                                        'type': 'fineMaterialOutcome',
                                        'isPercent': True,
                                        'value': 0.03,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            }
                        ],
                        'duration': {
                            'actions': 3
                        }
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/living_flame_ability.png'
    },
    'i_miss_the_sun': {
        'id': 'i_miss_the_sun',
        'name': 'I Miss The Sun',
        'type': 'active',
        'desc': 'Teleports you to <object id="myriadian_arc" />.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-iMissTheSun',
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
    'lucky_day': {
        'id': 'lucky_day',
        'name': 'Lucky Day',
        'type': 'active',
        'desc': 'Gives you a buff towards your <skillType type="artisan"/> Quality outcome.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-luckyDay',
            'inputsNeeded': 10,
            'charges': 20,
            'requirements': [
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'lucky_day',
                        'scanEquippedItems': False
                    }
                }
            ],
            'inputs': [
                {
                    'type': 'coins',
                    'amount': 100,
                    'value': 1
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
                                'id': '6d6bcb25-d0d1-46b8-b6f1-346c55c07377',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Quality outcome',
                                'skillText': '',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkillType',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'type': 'artisan'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'quality_outcome',
                                        'name': 'Quality outcome',
                                        'type': 'qualityOutcome',
                                        'isPercent': False,
                                        'value': 20,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            }
                        ],
                        'duration': {
                            'actions': 20
                        }
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/golden_frog_ability.png'
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
            'id': 'cooldown-mermaidsNeedMe',
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
            'id': 'cooldown-needToGoFast',
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': None,
            'steps': 6000,
            'actions': None,
            'charges': 5,
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
    'party_mode': {
        'id': 'party_mode',
        'name': 'Party Mode',
        'type': 'active',
        'desc': 'Gives a buff to Find collectibles.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-partArtyCool',
            'inputsNeeded': 3,
            'charges': 100,
            'requirements': [
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'party_mode',
                        'scanEquippedItems': False
                    }
                }
            ],
            'inputs': [
                {
                    'type': 'item',
                    'item': 'wine',
                    'value': 3
                },
                {
                    'type': 'item',
                    'item': 'beer',
                    'value': 1
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
                                'id': '40e58576-dd43-4e09-be0a-186bbbfe0812',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Find collectibles',
                                'skillText': '',
                                'tables': [],
                                'requirements': [],
                                'stats': [
                                    {
                                        'stat': 'find_collectibles',
                                        'name': 'Find collectibles',
                                        'type': 'findCollectibles',
                                        'isPercent': True,
                                        'value': 0.2,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            }
                        ],
                        'duration': {
                            'steps': 1000
                        }
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/party_mode.png'
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
            'id': 'cooldown-peckingOrder',
            'steps': 4000,
            'charges': 5,
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
            'id': 'cooldown-presentRain',
            'hours': 10,
            'charges': 15,
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
                                'isPrimary': False,
                                'type': [],
                                'rollAmount': 5,
                                'tables': [
                                    'find_present_items'
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/present_rain.png'
    },
    'reciprocating_saw': {
        'id': 'reciprocating_saw',
        'name': 'Reciprocating Saw',
        'type': 'active',
        'desc': 'Gives a large buff toward your <skill skill="carpentry"/> Double action.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-mantisSaw',
            'steps': 3000,
            'charges': 25,
            'requirements': [
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'reciprocating_saw',
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
                                'id': '42dfca37-2cc5-4c02-9a6f-d26d4ec37629',
                                'customIcon': None,
                                'customTextLocalizationKey': None,
                                'customText': '',
                                'textLocalizationKey': None,
                                'text': '',
                                'statText': 'Double action',
                                'skillText': 'Carpentry',
                                'tables': None,
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': None,
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'carpentry'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'double_action',
                                        'name': 'Double action',
                                        'type': 'doubleAction',
                                        'isPercent': True,
                                        'value': 0.5,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            }
                        ],
                        'duration': {
                            'steps': 1000
                        }
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/mantis_karate_chop.png'
    },
    'rock_and_roll': {
        'id': 'rock_and_roll',
        'name': 'Rock And Roll',
        'type': 'active',
        'desc': 'Creates 5 random <hl>rough gems</hl>.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-rockAndRoll',
            'seconds': None,
            'minutes': None,
            'hours': None,
            'days': None,
            'steps': None,
            'actions': 300,
            'charges': 3,
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
                                'isPrimary': False,
                                'type': [],
                                'rollAmount': 5,
                                'tables': [
                                    'gem_pouch_table'
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/spawn_gems.png'
    },
    'rockslide': {
        'id': 'rockslide',
        'name': 'Rockslide',
        'type': 'active',
        'desc': 'Gives you some buffs toward <skill skill="trinketry"/>.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-rockslide',
            'inputsNeeded': 10,
            'charges': 10,
            'requirements': [
                {
                    'type': 'abilityAvailable',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'ability': 'rockslide',
                        'scanEquippedItems': False
                    }
                }
            ],
            'inputs': [
                {
                    'type': 'item',
                    'item': 'stone',
                    'value': 1
                },
                {
                    'type': 'item',
                    'item': 'large_stone',
                    'value': 10
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
                                'id': '6ada1fbd-5600-465f-adf4-0660d5cafbd3',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Work efficiency',
                                'skillText': 'Trinketry',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'trinketry'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'work_efficiency',
                                        'name': 'Work efficiency',
                                        'type': 'workEfficiency',
                                        'isPercent': True,
                                        'value': 0.1,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            },
                            {
                                'id': 'a3232b49-0f61-4fed-9966-89b8b7a83357',
                                'customIcon': None,
                                'customTextLocalizationKey': '',
                                'customText': '',
                                'textLocalizationKey': '',
                                'text': '',
                                'statText': 'Double action',
                                'skillText': 'Trinketry',
                                'tables': [],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'trinketry'
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
                                'id': '40d99a7e-6523-4475-b5eb-7639f2a28bb5',
                                'customIcon': 'assets/icons/text/stats/skilling/chance_gems.png',
                                'customTextLocalizationKey': 'attributes.singulars.custom.rollGemPouchTable.text',
                                'customText': 'Chance to find <hl>1</hl> <object id="rough_gem" />',
                                'textLocalizationKey': 'attributes.singulars.custom.rollGemPouchTable.text',
                                'text': 'Chance to find <hl>1</hl> <object id="rough_gem" />',
                                'statText': 'Roll special table',
                                'skillText': 'Trinketry',
                                'tables': [
                                    {
                                        'isPrimary': False,
                                        'type': [],
                                        'rollAmount': 1,
                                        'tables': [
                                            'gem_pouch_table'
                                        ]
                                    }
                                ],
                                'requirements': [
                                    {
                                        'type': 'mainSkill',
                                        'name': '',
                                        'opposite': False,
                                        'requirement': {
                                            'skill': 'trinketry'
                                        }
                                    }
                                ],
                                'stats': [
                                    {
                                        'stat': 'roll_special_table',
                                        'name': 'Roll special table',
                                        'type': 'rollSpecialTable',
                                        'isPercent': True,
                                        'value': 0.05,
                                        'isNegative': False,
                                        'isMultiplicative': True
                                    }
                                ]
                            }
                        ],
                        'duration': {
                            'actions': 20
                        }
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/pet_rock_ability.png'
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
            'id': 'cooldown-shellForge',
            'steps': 4000,
            'charges': 10,
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
    'study_time': {
        'id': 'study_time',
        'name': 'Study Time',
        'type': 'active',
        'desc': 'Will give you some random <object id="memosphere" />.',
        'requirements': [],
        'cooldown': {
            'id': 'cooldown-studyTime',
            'steps': 1234,
            'charges': 20,
            'requirements': [
                {
                    'type': 'itemEquipped',
                    'name': '',
                    'opposite': False,
                    'requirement': {
                        'item': 'hat_of_wisdom'
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
                                'isPrimary': False,
                                'type': [],
                                'rollAmount': 2,
                                'tables': [
                                    'find_memospheres'
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/continued_education.png'
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
            'id': 'cooldown-takeMeHome',
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
    'terminate': {
        'id': 'terminate',
        'name': 'Terminate',
        'type': 'passive',
        'desc': 'Chance to turn a <object id="log" /> you find into <skill skill="carpentry"/> experience.',
        'requirements': [],
        'data': [],
        'attributes': [
            {
                'id': 'cb55a772-250d-4998-aa81-ac12c74775c0',
                'customIcon': None,
                'customTextLocalizationKey': '',
                'customText': '',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'Item swap',
                'skillText': 'Woodcutting',
                'tables': None,
                'requirements': [
                    {
                        'type': 'mainSkill',
                        'name': '',
                        'opposite': False,
                        'requirement': {
                            'skill': 'woodcutting'
                        }
                    }
                ],
                'stats': [
                    {
                        'stat': 'item_swap',
                        'name': 'Item swap',
                        'type': 'swapItem',
                        'isPercent': True,
                        'value': 0.15,
                        'isNegative': False,
                        'isMultiplicative': True,
                        'swapFromKeywords': [
                            'logs'
                        ],
                        'swapToSkill': 'carpentry',
                        'swapToXpEffortModifier': 0.5,
                        'scopes': [
                            'activityLoot'
                        ]
                    }
                ]
            }
        ],
        'icon': 'assets/icons/abilities/terminate.png'
    },
    'thats_a_wrap': {
        'id': 'thats_a_wrap',
        'name': "That's A Wrap",
        'type': 'passive',
        'desc': 'Your <hl>Mummy</hl> occasionally takes some of its excess linens that have been sprawling off of its body and hands you them as a gift.',
        'requirements': [],
        'cooldown': None,
        'data': [],
        'attributes': [
            {
                'id': 'f17ba7b5-898f-4e03-bb45-dbd03c97dfb0',
                'customIcon': 'assets/icons/text/stats/skilling/find_linens.png',
                'customTextLocalizationKey': 'abilities.singulars.thatsAWrap.text',
                'customText': 'Chance to get some <hl>linens</hl>.',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'Roll special table',
                'skillText': '',
                'tables': [
                    {
                        'isPrimary': False,
                        'type': [],
                        'rollAmount': 2,
                        'tables': [
                            'find_linens'
                        ]
                    }
                ],
                'requirements': [],
                'stats': [
                    {
                        'stat': 'roll_special_table',
                        'name': 'Roll special table',
                        'type': 'rollSpecialTable',
                        'isPercent': True,
                        'value': 0.07,
                        'isNegative': False,
                        'isMultiplicative': True
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
            'id': 'cooldown-theHuntIsOn',
            'inputsNeeded': 10,
            'charges': 10,
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
            ],
            'inputs': [
                {
                    'type': 'item',
                    'item': 'raw_carp',
                    'value': 1
                },
                {
                    'type': 'item',
                    'item': 'raw_pike',
                    'value': 1
                },
                {
                    'type': 'item',
                    'item': 'animal_meat',
                    'value': 2
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
            'id': 'cooldown-torpedoAway',
            'steps': 5000,
            'charges': 5,
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
