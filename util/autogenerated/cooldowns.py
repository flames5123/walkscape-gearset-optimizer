#!/usr/bin/env python3
"""
Cooldowns — exactly one of seconds/minutes/hours/days/steps/actions is non-null per cooldown; the others are null on purpose.
DO NOT EDIT MANUALLY
"""

COOLDOWNS = {
    'cooldown-downGoesTheTrees': {
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
    'cooldown-iMissTheSun': {
        'seconds': None,
        'minutes': None,
        'hours': 12,
        'days': None,
        'steps': None,
        'actions': None,
        'requirements': []
    },
    'cooldown-mermaidsNeedMe': {
        'seconds': None,
        'minutes': None,
        'hours': None,
        'days': 2,
        'steps': None,
        'actions': None,
        'requirements': []
    },
    'cooldown-needToGoFast': {
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
    'cooldown-peckingOrder': {
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
    'cooldown-presentRain': {
        'hours': 10,
        'requirements': []
    },
    'cooldown-rockAndRoll': {
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
    'cooldown-shellForge': {
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
    'cooldown-takeMeHome': {
        'seconds': None,
        'minutes': None,
        'hours': 12,
        'days': None,
        'steps': None,
        'actions': None,
        'requirements': []
    },
    'cooldown-thatsAWrap': {
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
    'cooldown-theHuntIsOn': {
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
    'cooldown-torpedoAway': {
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
    }
}
