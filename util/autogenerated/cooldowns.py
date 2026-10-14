#!/usr/bin/env python3
"""
Cooldowns — exactly one of seconds/minutes/hours/days/steps/actions is non-null per cooldown; the others are null on purpose.
DO NOT EDIT MANUALLY
"""

COOLDOWNS = {
    'cooldown-downGoesTheTrees': {
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
    'cooldown-flambe': {
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
    'cooldown-iMissTheSun': {
        'id': 'cooldown-iMissTheSun',
        'seconds': None,
        'minutes': None,
        'hours': 12,
        'days': None,
        'steps': None,
        'actions': None,
        'requirements': []
    },
    'cooldown-luckyDay': {
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
    'cooldown-mantisSaw': {
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
    'cooldown-mermaidsNeedMe': {
        'id': 'cooldown-mermaidsNeedMe',
        'seconds': None,
        'minutes': None,
        'hours': None,
        'days': 2,
        'steps': None,
        'actions': None,
        'requirements': []
    },
    'cooldown-needToGoFast': {
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
    'cooldown-partArtyCool': {
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
    'cooldown-peckingOrder': {
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
    'cooldown-presentRain': {
        'id': 'cooldown-presentRain',
        'hours': 10,
        'charges': 15,
        'requirements': []
    },
    'cooldown-rockAndRoll': {
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
    'cooldown-rockslide': {
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
    'cooldown-shellForge': {
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
    'cooldown-studyTime': {
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
    'cooldown-takeMeHome': {
        'id': 'cooldown-takeMeHome',
        'seconds': None,
        'minutes': None,
        'hours': 12,
        'days': None,
        'steps': None,
        'actions': None,
        'requirements': []
    },
    'cooldown-thatsAWrap': {
        'id': 'cooldown-thatsAWrap',
        'steps': 3000,
        'charges': 10,
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
    'cooldown-theHuntIsOn': {
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
    'cooldown-torpedoAway': {
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
    }
}
