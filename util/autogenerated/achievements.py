#!/usr/bin/env python3
"""
Achievements — game achievements with their rewards.
DO NOT EDIT MANUALLY
"""

ACHIEVEMENTS = {
    'a_bone_to_pick': {
        'id': 'a_bone_to_pick',
        'name': 'A Bone To Pick',
        'desc': 'Picking a fight with rocks is always a good choice.',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'ectoplasm',
                'quality': None,
                'tag': None,
                'quantity': 100
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/bone_to_pick.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'a_friend_like_me': {
        'id': 'a_friend_like_me',
        'name': 'A Friend Like Me',
        'desc': 'Phenomenal cosmic powers, itty bitty living space.',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/afriendlikeme_pink.png',
        'cardBackImage': 'assets/achievements/card_backs/pink_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/pink_front.png'
    },
    'all_the_things_i_could_do': {
        'id': 'all_the_things_i_could_do',
        'name': 'All The Things I Could Do',
        'desc': 'Win a fortune in a game, my life will never be the same...',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/space_cars_and_birds.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'an_idiot_sandwich': {
        'id': 'an_idiot_sandwich',
        'name': 'An Idiot Sandwich',
        'desc': '- "What are you?"\\n- "An idiot sandwich."',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'cooking_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/anidiotsandwich_green.png',
        'cardBackImage': 'assets/achievements/card_backs/pink_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/pink_front.png'
    },
    'and_my_axe!': {
        'id': 'and_my_axe!',
        'name': 'And My Axe!',
        'desc': 'Let them come! There is one dwarf yet in Moria who still draws breath!',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/andmyaxe_brown.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'another_mans_treasure': {
        'id': 'another_mans_treasure',
        'name': "Another Man's Treasure",
        'desc': 'Only true appraiser can distinguish regular trash from a fine one.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/another_mans_treasure.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'arctic_explorer': {
        'id': 'arctic_explorer',
        'name': 'Arctic Explorer',
        'desc': 'You can call yourself a proud Jarvonian now, you know this land like your pocket.',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'agility_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/arctic_explorer.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'are_you_sickle_of_it_yet?': {
        'id': 'are_you_sickle_of_it_yet?',
        'name': 'Are You Sickle Of It Yet?',
        'desc': 'Taking all the steps across the empty glacier has made you a friend of the penguins. One is eagerly looking at you, hoping you will pick it up and put it on your shoulder.',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/are_you_sickle_of_it_yet.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'barbarian_village': {
        'id': 'barbarian_village',
        'name': 'Barbarian Village',
        'desc': 'If you used an empty beer glass on the barrels before the Gunnarsgrunn update, a Barbarian would attack you. If you had killed the Barbarian, using the beer glass on the barrels would refill it.',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/barbarianvillage_green.png',
        'cardBackImage': 'assets/achievements/card_backs/green_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'big_game_hunter': {
        'id': 'big_game_hunter',
        'name': 'Big Game Hunter',
        'desc': 'Always a bigger fish. Err beast.',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/big_game_hunter.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'comrade': {
        'id': 'comrade',
        'name': 'Comrade',
        'desc': 'You have a hammer and sickle? We have a hammer and sickle!',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'foraging_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'smithing_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/comrade.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'doomsday_prepper': {
        'id': 'doomsday_prepper',
        'name': 'Doomsday Prepper',
        'desc': 'When the apocalypse comes, you and your 1000 cans of tomato soup are going to be ready!',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/doomsday_prepper.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'enter_sandman': {
        'id': 'enter_sandman',
        'name': 'Enter Sandman',
        'desc': "Exit light, enter night, take my hand — we're off to never-never land!",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/enter_sandman.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'feed_your_inner_child': {
        'id': 'feed_your_inner_child',
        'name': 'Feed Your Inner Child',
        'desc': 'Never too old to have fun!',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'carpentry_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'agility_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'foraging_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/feed_your_inner_child.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'fully_prepared': {
        'id': 'fully_prepared',
        'name': 'Fully Prepared',
        'desc': "With full gear on, you're ready to conquer the world!",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/fully_prepared.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'gold_digger': {
        'id': 'gold_digger',
        'name': 'Gold Digger',
        'desc': "When I said you can't buy my love, I meant it's not possible with your salary.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/thegolddigger_yellow.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'gotta_hatch_em_all': {
        'id': 'gotta_hatch_em_all',
        'name': "Gotta Hatch 'Em All",
        'desc': 'These pets will make a fine addition to my collection.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/gotta_hatch_them_all.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'helan_går!': {
        'id': 'helan_går!',
        'name': 'Helan Går!',
        'desc': 'Cheers, kippis, salud, cin cin, prost, kanpai, ganbei!',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/helan_gar.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'hells_kitchen': {
        'id': 'hells_kitchen',
        'name': "Hell's Kitchen",
        'desc': "There's enough garlic in here to kill every vampire in Europe.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/hellskitchen_red.png',
        'cardBackImage': 'assets/achievements/card_backs/pink_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/pink_front.png'
    },
    'hoarder': {
        'id': 'hoarder',
        'name': 'Hoarder',
        'desc': 'Limitless bank storage is the dream of any hoarder. All banks are connected too. Enjoy!',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/hoarder.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'human_fish': {
        'id': 'human_fish',
        'name': 'Human Fish',
        'desc': 'Being half human, half fish can be very fun. It just depends which half you get.',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/human_fish.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'i_just_felt_like_running': {
        'id': 'i_just_felt_like_running',
        'name': 'I Just Felt Like Running',
        'desc': "Now you wouldn't believe me if I told you, but I could run like the wind blows. From that day on, if I was ever going somewhere, I was running!",
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/i_just_felt_like_running.png',
        'cardBackImage': 'assets/achievements/card_backs/pink_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/pink_front.png'
    },
    'i_smell_dead_miners': {
        'id': 'i_smell_dead_miners',
        'name': 'I Smell Dead Miners',
        'desc': 'This tale is told in “Of mines and monsters” story. Read more on WalkScape wiki!',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/i_smell_dead_miners.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'if_it_is_broken,_fix_it': {
        'id': 'if_it_is_broken,_fix_it',
        'name': 'If It Is Broken, Fix It',
        'desc': "It's hard being a solo developer.",
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/ifitisbrokenfixit_brown.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'infinity_stones': {
        'id': 'infinity_stones',
        'name': 'Infinity Stones',
        'desc': 'Perfectly balanced, as all things should be.',
        'difficulty': 'hard',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'gem_bracelet',
                'quality': 'epic',
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/infinitystones_yellow.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'its_a_marathon,_not_a_sprint': {
        'id': 'its_a_marathon,_not_a_sprint',
        'name': "It's A Marathon, Not A Sprint",
        'desc': 'You are just in the beginning. Now do the same again.',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/itsamarathonnotasprint_blue.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'its_a_trap!': {
        'id': 'its_a_trap!',
        'name': "It's A Trap!",
        'desc': "There's too many of them.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/its_a_trap.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'jack_of_all_trades': {
        'id': 'jack_of_all_trades',
        'name': 'Jack Of All Trades',
        'desc': "Congratulations, you've reached halfway in all the skills! Or have you?",
        'difficulty': 'hard',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'agility_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'carpentry_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'cooking_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'crafting_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'fishing_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'foraging_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'hunting_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'mining_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'smithing_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'tailoring_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'trinketry_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            },
            {
                'type': 'item',
                'id': 'woodcutting_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/jack_of_all_trades_master_of_none.png',
        'cardBackImage': 'assets/achievements/card_backs/green_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'lighthouse': {
        'id': 'lighthouse',
        'name': 'Lighthouse',
        'desc': 'Become a guiding light in the darkness.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/lighthouse.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'maid_of_the_dead': {
        'id': 'maid_of_the_dead',
        'name': 'Maid Of The Dead',
        'desc': "Maybe this wasn't what you wished for with wanting a maid.",
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/maid_of_the_dead.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'make_a_man_out_of_you': {
        'id': 'make_a_man_out_of_you',
        'name': 'Make A Man Out Of You',
        'desc': 'Mysterious as the dark side of the <hl>MOON!</hl>',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/makeamanoutofyou_yellow.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'master_has_given_dobby_a_sock': {
        'id': 'master_has_given_dobby_a_sock',
        'name': 'Master Has Given Dobby A Sock',
        'desc': 'Dobby is... free',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/masterhasgivendobbyasock_brown.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'masterchef': {
        'id': 'masterchef',
        'name': 'Masterchef',
        'desc': 'Yummy! It seems like you make a fine chef.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/masterchef_brown.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'my_back_hurts': {
        'id': 'my_back_hurts',
        'name': 'My Back Hurts',
        'desc': 'Time to drop or sell before you break your back.',
        'difficulty': 'easy',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'tiny_backpack',
                'quality': 'common',
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/my_back_hurts.png',
        'cardBackImage': 'assets/achievements/card_backs/red_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'my_precious': {
        'id': 'my_precious',
        'name': 'My Precious',
        'desc': "Curse the Baggins! It's gone! What has it got in its pocketses? Oh we guess, we guess, my precious. He's found it, yes he must have.",
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'fishing_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/myprecious_red.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'no_trashing': {
        'id': 'no_trashing',
        'name': 'No Trashing',
        'desc': "You better pick up what you dropped! Oh, wait, you can't.",
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/no_trashing.png',
        'cardBackImage': 'assets/achievements/card_backs/green_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'non_academic_electives': {
        'id': 'non_academic_electives',
        'name': 'Non-Academic Electives',
        'desc': "Who would've thought that hobby-like subjects are needed to expand ones intellect.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/non_academic_electives.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'not_in_al_kharid_anymore': {
        'id': 'not_in_al_kharid_anymore',
        'name': 'Not In Al Kharid Anymore',
        'desc': "Didn't even have to pay a gate toll.",
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'dried_fruit',
                'quality': None,
                'tag': 'fine',
                'quantity': 3
            },
            {
                'type': 'item',
                'id': 'nut_mix',
                'quality': None,
                'tag': 'fine',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/not_in_al_kharid_anymore.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'one_does_not_simply_walk_into_mordor': {
        'id': 'one_does_not_simply_walk_into_mordor',
        'name': 'One Does Not Simply Walk Into Mordor',
        'desc': 'Have you ever thought about how simple it would be to walk into Mordor? Well, <hl>now you know</hl>.',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/onedoesnotsimplywalkintomordor_yellow.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'only_two_fingers?': {
        'id': 'only_two_fingers?',
        'name': 'Only Two Fingers?',
        'desc': "It's a well known fact that only one finger out of five can benefit from the magical properties of rings.",
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/only_two_fingers.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'only_you_can_prevent_forest_fires': {
        'id': 'only_you_can_prevent_forest_fires',
        'name': 'Only You Can Prevent Forest Fires',
        'desc': "By cutting all of the trees, there's literally like... zero percent chance?",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/onlyyoucanpreventforestfires_red.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'ooh,_shinier!': {
        'id': 'ooh,_shinier!',
        'name': 'Ooh, Shinier!',
        'desc': 'The rarest thing in the world, next to a spirit of discernment, is a fine shiny star pearl.',
        'difficulty': 'hard',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'fine_pearl_ring',
                'quality': 'rare',
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/ooh_shinier.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'ooh,_shiny!': {
        'id': 'ooh,_shiny!',
        'name': 'Ooh, Shiny!',
        'desc': 'As they say the chance of finding this fine thing is 1 in 100.',
        'difficulty': 'easy',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'shiny_ring',
                'quality': 'uncommon',
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/ooh_shiny.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'overprepared': {
        'id': 'overprepared',
        'name': 'Overprepared',
        'desc': "Maybe you don't need to go all out in every situation.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/overprepared.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'peddle_to_the_mettle': {
        'id': 'peddle_to_the_mettle',
        'name': 'Peddle To The Mettle',
        'desc': "These suckers aren't gonna rip themselves off.",
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/peddal_to_the_mettle.png',
        'cardBackImage': 'assets/achievements/card_backs/green_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'pirates_of_the_algatean': {
        'id': 'pirates_of_the_algatean',
        'name': 'Pirates Of The Algatean',
        'desc': 'Did everyone see that? Because I will not be doing it again.',
        'difficulty': 'extreme',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/pirates_of_the_algatean.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_extreme.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'pride_and_accomplishment': {
        'id': 'pride_and_accomplishment',
        'name': 'Pride And Accomplishment',
        'desc': "Sometimes you're most famous for being the worst.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/pride_and_accomplishment.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'prohibition_inhibition': {
        'id': 'prohibition_inhibition',
        'name': 'Prohibition Inhibition',
        'desc': 'Please drink responsibly.',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'beer',
                'quality': None,
                'tag': 'fine',
                'quantity': 15
            },
            {
                'type': 'item',
                'id': 'wine',
                'quality': None,
                'tag': 'fine',
                'quantity': 15
            },
            {
                'type': 'item',
                'id': 'saltrum',
                'quality': None,
                'tag': 'fine',
                'quantity': 15
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/prohibition_inhibition.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'rare_find': {
        'id': 'rare_find',
        'name': 'Rare Find',
        'desc': "Didn't even have to soft reset for it.",
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/rare_find.png',
        'cardBackImage': 'assets/achievements/card_backs/pink_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/pink_front.png'
    },
    'residual_relic': {
        'id': 'residual_relic',
        'name': 'Residual Relic',
        'desc': 'The right trinket in the wrong place can make all the difference in the world.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/donttelltheelf_green.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'rock_and_stone!': {
        'id': 'rock_and_stone!',
        'name': 'Rock And Stone!',
        'desc': "If you don't Rock and Stone, you ain't comin' home!",
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/rockandstone_brown.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'rockstar': {
        'id': 'rockstar',
        'name': 'Rockstar',
        'desc': 'Hard rock hallelujah!',
        'difficulty': 'hard',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'rock_star_amulet',
                'quality': 'rare',
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/rockstar_pink.png',
        'cardBackImage': 'assets/achievements/card_backs/pink_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/pink_front.png'
    },
    'shield_wall': {
        'id': 'shield_wall',
        'name': 'Shield Wall',
        'desc': 'The best offense is... uh...',
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/shield_wall.png',
        'cardBackImage': 'assets/achievements/card_backs/red_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'spectral_specialist': {
        'id': 'spectral_specialist',
        'name': 'Spectral Specialist',
        'desc': "We've had a doozy of a day.",
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'ghost_trap_pack',
                'quality': None,
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/spectral_specialist.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'stop_and_smell_the_flowers': {
        'id': 'stop_and_smell_the_flowers',
        'name': 'Stop And Smell The Flowers',
        'desc': "Sometimes it's nice to take some time and appreciate things around you.",
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'petal_finder',
                'quality': None,
                'tag': None,
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/smell_the_flower.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'tailor_swiftly': {
        'id': 'tailor_swiftly',
        'name': 'Tailor Swiftly',
        'desc': "Darling, I'm a nightmare dressed like a daydream",
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/tailor_swiftly.png',
        'cardBackImage': 'assets/achievements/card_backs/red_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'taste_the_rainbow': {
        'id': 'taste_the_rainbow',
        'name': 'Taste The Rainbow',
        'desc': "It's been rumoured that rainbows tastes like unicorn horn dust, but remember that it's illegal to grind a unicorn horn to dust.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/taste_the_rainbow.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'thanks,_herbert!': {
        'id': 'thanks,_herbert!',
        'name': 'Thanks, Herbert!',
        'desc': 'Herbert is man with a golden heart, he will gladly sell his old adventuring clothes for little coin.',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/thanks_herbert.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'thats_xcom_baby': {
        'id': 'thats_xcom_baby',
        'name': "That's XCOM Baby",
        'desc': 'RNG can sometimes be very frustrating.',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'crafting_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/thatsxcombaby_blue.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'they_grow_up_so_fast': {
        'id': 'they_grow_up_so_fast',
        'name': 'They Grow Up So Fast',
        'desc': 'Sometimes all you can do is watch.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/they_grow_up_so_fast.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'time_to_party': {
        'id': 'time_to_party',
        'name': 'Time To Party',
        'desc': 'This party hat could feed generations.',
        'difficulty': 'extreme',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/time_to_party.png',
        'cardBackImage': 'assets/achievements/card_backs/green_extreme.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'touch_the_grass': {
        'id': 'touch_the_grass',
        'name': 'Touch The Grass',
        'desc': "I did make you touch the grass didn't I?",
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/touchthegrass_green.png',
        'cardBackImage': 'assets/achievements/card_backs/green_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'travel_ized': {
        'id': 'travel_ized',
        'name': 'Travel-ized',
        'desc': 'And I would walk 100k more.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/travelized.png',
        'cardBackImage': 'assets/achievements/card_backs/red_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'treasure_hunter': {
        'id': 'treasure_hunter',
        'name': 'Treasure Hunter',
        'desc': 'Nothing hits better than a free treasure chest!',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/treasure_hunter.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'trench_explorer': {
        'id': 'trench_explorer',
        'name': 'Trench Explorer',
        'desc': "They say there's infinite space to explore amongst the stars, but why bother when more than 95% of the ocean is unexplored.",
        'difficulty': 'hard',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/trench_explorer.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'tutorial_complete': {
        'id': 'tutorial_complete',
        'name': 'Tutorial Complete',
        'desc': "You're finally ready to leave the starting zone, right?",
        'difficulty': 'extreme',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/tutorial_complete.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_extreme.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'under_the_sea': {
        'id': 'under_the_sea',
        'name': 'Under The Sea',
        'desc': "Down here all the fish is happy\\nAs off through the waves they roll\\nThe fish on the land ain't happy\\nThey sad 'cause they in their bowl",
        'difficulty': 'easy',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'fishing_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/underthesea_blue.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'undersea_chef': {
        'id': 'undersea_chef',
        'name': 'Undersea Chef',
        'desc': "At least you can't overboil the eggs underwater.",
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/undersea_chef.png',
        'cardBackImage': 'assets/achievements/card_backs/blue_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/blue_front.png'
    },
    'visitor_of_the_far_lands': {
        'id': 'visitor_of_the_far_lands',
        'name': 'Visitor Of The Far Lands',
        'desc': 'The number is the amount of blocks you needed to go across until you could get to "Far Lands" in Minecraft.',
        'difficulty': 'extreme',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/visitorofthefarlands_green.png',
        'cardBackImage': 'assets/achievements/card_backs/green_extreme.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'walk_of_shame': {
        'id': 'walk_of_shame',
        'name': 'Walk Of Shame',
        'desc': '*cling* Shame. *cling* Shame. *cling* Shame. *cling* Shame.',
        'difficulty': 'easy',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'agility_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 1
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/walkofshame_brown.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/brown_front.png'
    },
    'we_need_to_go_deeper': {
        'id': 'we_need_to_go_deeper',
        'name': 'We Need To Go Deeper',
        'desc': 'Sometimes you need to explore a bit further than before to find something good.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/need_to_go_deeper.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'wetlands_explorer': {
        'id': 'wetlands_explorer',
        'name': 'Wetlands Explorer',
        'desc': "You sure showed the bog who's boss, who is scared of the dark now?",
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'agility_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/wetlands_explorer.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'what_a_trip': {
        'id': 'what_a_trip',
        'name': 'What A Trip',
        'desc': 'Eating some might also take you to a wild trip. Best consumed in good company.',
        'difficulty': 'normal',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/whatatrip_green.png',
        'cardBackImage': 'assets/achievements/card_backs/green_medium.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/green_front.png'
    },
    'winnie_the_pooh': {
        'id': 'winnie_the_pooh',
        'name': 'Winnie The Pooh',
        'desc': 'Sometimes the smallest things take up the most room in your heart.',
        'difficulty': 'normal',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'cooking_chest',
                'quality': 'common',
                'tag': 'none',
                'quantity': 3
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/winniepooh_yellow.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_normal.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    },
    'wow.': {
        'id': 'wow.',
        'name': 'Wow.',
        'desc': 'You did it.',
        'difficulty': 'hard',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'trinketry_chest',
                'quality': 'common',
                'tag': None,
                'quantity': 4
            },
            {
                'type': 'item',
                'id': 'gold_nugget',
                'quality': None,
                'tag': None,
                'quantity': 67
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/self_reflecting.png',
        'cardBackImage': 'assets/achievements/card_backs/brown_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_backs/brown_front.png'
    },
    'you_shall_not_pass!': {
        'id': 'you_shall_not_pass!',
        'name': 'You Shall Not Pass!',
        'desc': 'I am a servant of the Secret Fire, wielder of the Flame of Anor. The dark fire will not avail you, Flame of Udun! Go back to the shadow. <hl>You Shall Not Pass!</hl>',
        'difficulty': 'easy',
        'itemRewards': [],
        'cardFrontImage': 'assets/achievements/card_fronts/youshallnotpass_red.png',
        'cardBackImage': 'assets/achievements/card_backs/red_easy.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/red_front.png'
    },
    'youre_gonna_need_a_bigger_kitchen': {
        'id': 'youre_gonna_need_a_bigger_kitchen',
        'name': "You're Gonna Need A Bigger Kitchen",
        'desc': 'You cooked a shark. Not THE shark.',
        'difficulty': 'hard',
        'itemRewards': [
            {
                'type': 'item',
                'id': 'cooking_memosphere',
                'quality': 'common',
                'tag': None,
                'quantity': 5
            }
        ],
        'cardFrontImage': 'assets/achievements/card_fronts/youre_gonna_need_bigger_kitchen.png',
        'cardBackImage': 'assets/achievements/card_backs/yellow_hard.png',
        'cardFrontBackgroundImage': 'assets/achievements/card_front_backgrounds/yellow_front.png'
    }
}
