#!/usr/bin/env python3
"""
Global variables — game-wide tunables (e.g. fine-input bonus tables).
DO NOT EDIT MANUALLY
"""

GLOBAL_VARIABLES = {
    'global-fine-input-benefit': {
        'id': 'global-fine-input-benefit',
        'name': '',
        'type': 'fineInputBenefit',
        'attrs': [
            {
                'id': 'e091c33a-a020-40f1-b965-c0a8c28974c3',
                'customIcon': None,
                'customTextLocalizationKey': None,
                'customText': '',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'Bonus experience',
                'skillText': '',
                'tables': None,
                'requirements': [],
                'stats': [
                    {
                        'stat': 'bonus_experience',
                        'name': 'Bonus experience',
                        'type': 'bonusExperience',
                        'isPercent': True,
                        'value': 1,
                        'isNegative': False,
                        'isMultiplicative': True
                    }
                ]
            },
            {
                'id': 'd63aec25-5d5c-435d-9780-054a0dfc4afd',
                'customIcon': None,
                'customTextLocalizationKey': None,
                'customText': '',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'Work efficiency',
                'skillText': '',
                'tables': None,
                'requirements': [],
                'stats': [
                    {
                        'stat': 'work_efficiency',
                        'name': 'Work efficiency',
                        'type': 'workEfficiency',
                        'isPercent': True,
                        'value': 0.4,
                        'isNegative': False,
                        'isMultiplicative': True
                    }
                ]
            },
            {
                'id': '2aa66aa8-0471-4f09-ac0b-a46a4ccb1676',
                'customIcon': None,
                'customTextLocalizationKey': None,
                'customText': '',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'Double rewards',
                'skillText': '',
                'tables': None,
                'requirements': [],
                'stats': [
                    {
                        'stat': 'double_rewards',
                        'name': 'Double rewards',
                        'type': 'doubleRewards',
                        'isPercent': True,
                        'value': 0.1,
                        'isNegative': False,
                        'isMultiplicative': True
                    }
                ]
            },
            {
                'id': '4ce1f74c-91aa-4995-beb3-f2c37c457e0c',
                'customIcon': None,
                'customTextLocalizationKey': None,
                'customText': '',
                'textLocalizationKey': '',
                'text': '',
                'statText': 'Fine material finding',
                'skillText': '',
                'tables': None,
                'requirements': [],
                'stats': [
                    {
                        'stat': 'fine_material_finding',
                        'name': 'Fine material finding',
                        'type': 'fineMaterialFind',
                        'isPercent': True,
                        'value': 2,
                        'isNegative': False,
                        'isMultiplicative': True
                    }
                ]
            }
        ]
    }
}
