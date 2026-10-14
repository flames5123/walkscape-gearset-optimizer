#!/usr/bin/env python3
"""
Pet eggs — items with type=egg.
DO NOT EDIT MANUALLY
"""

EGGS = {
    'living_flame_egg': {
        'id': 'living_flame_egg',
        'name': 'Living flame egg',
        'desc': "This egg is said to contain a living flame. Some questions are better off unanswered. You probably don't have to worry about this egg getting cold.",
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/living_flame/living_flame_egg_static.png'
    },
    'camel_egg': {
        'id': 'camel_egg',
        'name': 'Camel egg',
        'desc': "The egg left behind by a camel, you can tell because it has a hump on it. That's how you tell, right?",
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/camel/egg_item.png'
    },
    'chicken_egg': {
        'id': 'chicken_egg',
        'name': 'Chicken egg',
        'desc': "A fertile chicken egg. Don't get it confused with your breakfast, hurry and hatch it!",
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/chicken/chicken_egg_static.png'
    },
    'dolphin_egg': {
        'id': 'dolphin_egg',
        'name': 'Dolphin egg',
        'desc': 'The egg of a dolphin. The aquatic colour hides it well underwater. It is a wonder the parents can ever find them again.',
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/dolphin/dolphin_egg_static.png'
    },
    'gecko_egg': {
        'id': 'gecko_egg',
        'name': 'Gecko egg',
        'desc': 'This egg came from a gecko. It is looking a little green, so might want to hatch it soon!',
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/gecko/gecko_egg_static.png'
    },
    'golden_frog_egg': {
        'id': 'golden_frog_egg',
        'name': 'Golden frog egg',
        'desc': "The golden egg of a golden frog. It sure looks deceiving with its colour, you'd think it'd be hard and heavy, but it is quite light and squishy!",
        'keywords': [
            'pet_egg',
            'egg',
            'achievement_reward'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'none',
            'value': None
        },
        'canBeFine': False,
        'canBeSold': False,
        'icon': 'assets/icons/pets/golden_frog/goldenfrog_egg_static.png'
    },
    'mummy_egg': {
        'id': 'mummy_egg',
        'name': 'Mummy egg',
        'desc': "A mummy's egg. It may be covered in bandages, but you should still try to keep it warm. Wonder where the mother is?",
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/mummy/mummy_egg_static.png'
    },
    'pet_rock_egg': {
        'id': 'pet_rock_egg',
        'name': 'Pet rock egg',
        'desc': 'A pet rock egg? Is this a joke? You think something is going to come out of this? It is just a bunch of rocks clumped together.',
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/rock/rock_egg_static.png'
    },
    'pixie_egg': {
        'id': 'pixie_egg',
        'name': 'Pixie egg',
        'desc': "A pixie egg. Don't shake it at all or jolt it around! That goes without saying normally, but these cause problems for everyone around when that happens.",
        'keywords': [
            'pet_egg',
            'egg',
            'achievement_reward'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'none',
            'value': None
        },
        'canBeFine': False,
        'canBeSold': False,
        'icon': 'assets/icons/pets/pixie/pixie_egg_static.png'
    },
    'reindeer_egg': {
        'id': 'reindeer_egg',
        'name': 'Reindeer egg',
        'desc': "A reindeer's egg. Should get this warmed up more even though the fur coating helps keep it a little warmer.",
        'keywords': [
            'pet_egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/reindeer/reindeer_egg_static.png'
    },
    'sawmantis_egg': {
        'id': 'sawmantis_egg',
        'name': 'Sawmantis egg',
        'desc': 'A sawmantis egg. Better to be careful with this, you can hear what sounds like blades rustling inside of it occasionally.',
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/sawmoth/sawmoth_egg_static.png'
    },
    'termite_egg': {
        'id': 'termite_egg',
        'name': 'Termite egg',
        'desc': "A termite's egg. You've heard the stories of people that sneak these creatures into the houses of their least favourite woodworkers. What if you trained one instead?",
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/woodmunch/woodmunch_egg_static.png'
    },
    'tiger_egg': {
        'id': 'tiger_egg',
        'name': 'Tiger egg',
        'desc': "The egg from a tiger. You would think it would have stripes on it too, but you'll have to hatch it for those.",
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/tiger/tiger_egg_static.png'
    },
    'tortoise_egg': {
        'id': 'tortoise_egg',
        'name': 'Tortoise egg',
        'desc': 'A tortoise egg. It has an extra hard shell to it. Guess it will never be without one.',
        'keywords': [
            'pet_egg',
            'egg'
        ],
        'type': 'egg',
        'quality': 'common',
        'consumableType': None,
        'gearType': None,
        'requirements': [],
        'itemAttrs': [],
        'itemQualityAttrs': [],
        'itemValue': {
            'currency': 'money',
            'value': {
                'common': 100
            }
        },
        'buffs': [],
        'tables': [],
        'canBeFine': True,
        'canBeSold': True,
        'icon': 'assets/icons/pets/tortoise/tortoise_egg_static.png'
    }
}
