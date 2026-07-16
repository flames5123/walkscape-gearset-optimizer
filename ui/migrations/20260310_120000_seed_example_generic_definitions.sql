-- ============================================================================
-- SEED: Example Generic Definitions for Developers
-- ============================================================================
-- These examples demonstrate every feature of the generic definitions system.
-- All entries use source=NULL and is_public=1 so all users can see them and they publish to the sheet.
-- They will be wiped before public launch (DELETE FROM ... WHERE id LIKE 'ex-%').
--
-- Session UUID: 00000000-0000-0000-0000-example-seed (fixed, won't collide)
-- ============================================================================

-- ============================================================================
-- ACTIVITIES — one per location (shows every location in the game)
-- ============================================================================

INSERT OR IGNORE INTO generic_activities
    (id, session_uuid, name, skill, location, base_steps, base_xp, max_efficiency,
     required_level, is_public, source, icon, contributed_by, requirements_json, created_at, updated_at)
VALUES
-- Jarvonia
('ex-act-001', '00000000-0000-0000-0000-example-seed', 'Example: Kallaheim Mining', 'mining', 'Kallaheim', 250, 45.0, 0.6, 1, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-002', '00000000-0000-0000-0000-example-seed', 'Example: Port Skildar Fishing', 'fishing', 'Port Skildar', 200, 38.0, 0.6, 1, 1, NULL, '🎣', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-003', '00000000-0000-0000-0000-example-seed', 'Example: Nomad Woods Foraging', 'foraging', 'Nomad Woods', 180, 32.0, 0.6, 1, 1, NULL, '🌿', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-004', '00000000-0000-0000-0000-example-seed', 'Example: Norsack Plains Hunting', 'hunting', 'Norsack Plains', 220, 40.0, 0.6, 1, 1, NULL, '🏹', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-005', '00000000-0000-0000-0000-example-seed', 'Example: Frusenholm Woodcutting', 'woodcutting', 'Frusenholm', 210, 36.0, 0.6, 1, 1, NULL, '🪓', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-006', '00000000-0000-0000-0000-example-seed', 'Example: Azurazera Agility', 'agility', 'Azurazera', 318, 172.0, 0.6, 1, 1, NULL, '🏃', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-007', '00000000-0000-0000-0000-example-seed', 'Example: Centaham Smithing', 'smithing', 'Centaham', 300, 55.0, 0.6, 20, 1, NULL, '🔨', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-008', '00000000-0000-0000-0000-example-seed', 'Example: Coldington Carpentry', 'carpentry', 'Coldington', 280, 50.0, 0.6, 15, 1, NULL, '🪚', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-009', '00000000-0000-0000-0000-example-seed', 'Example: Barbantok Cooking', 'cooking', 'Barbantok', 260, 48.0, 0.6, 10, 1, NULL, '🍳', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-010', '00000000-0000-0000-0000-example-seed', 'Example: Sanguine Hills Crafting', 'crafting', 'Sanguine Hills', 270, 52.0, 0.6, 12, 1, NULL, '🔧', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-011', '00000000-0000-0000-0000-example-seed', 'Example: Casbrant Fields Tailoring', 'tailoring', 'Casbrant Fields', 240, 44.0, 0.6, 8, 1, NULL, '🧵', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-012', '00000000-0000-0000-0000-example-seed', 'Example: Disenchanted Forest Trinketry', 'trinketry', 'Disenchanted Forest', 290, 53.0, 0.6, 18, 1, NULL, '💎', 'Dev Seed', '{}', datetime('now'), datetime('now')),
-- GDTE
('ex-act-013', '00000000-0000-0000-0000-example-seed', 'Example: Salsfirth Fishing', 'fishing', 'Salsfirth', 195, 37.0, 0.6, 1, 1, NULL, '🎣', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-014', '00000000-0000-0000-0000-example-seed', 'Example: Granfiddich Mining', 'mining', 'Granfiddich', 245, 44.0, 0.6, 1, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-015', '00000000-0000-0000-0000-example-seed', 'Example: Mangrove Forest Foraging', 'foraging', 'Mangrove Forest', 175, 31.0, 0.6, 1, 1, NULL, '🌿', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-016', '00000000-0000-0000-0000-example-seed', 'Example: Witched Woods Hunting', 'hunting', 'Witched Woods', 215, 39.0, 0.6, 1, 1, NULL, '🏹', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-017', '00000000-0000-0000-0000-example-seed', 'Example: Warrenfield Woodcutting', 'woodcutting', 'Warrenfield', 205, 35.0, 0.6, 1, 1, NULL, '🪓', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-018', '00000000-0000-0000-0000-example-seed', 'Example: Old Arena Ruins Agility', 'agility', 'Old Arena Ruins', 320, 174.0, 0.6, 1, 1, NULL, '🏃', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-019', '00000000-0000-0000-0000-example-seed', 'Example: Bilgemont Port Smithing', 'smithing', 'Bilgemont Port', 305, 56.0, 0.6, 20, 1, NULL, '🔨', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-020', '00000000-0000-0000-0000-example-seed', 'Example: Everhaven Carpentry', 'carpentry', 'Everhaven', 285, 51.0, 0.6, 15, 1, NULL, '🪚', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-021', '00000000-0000-0000-0000-example-seed', 'Example: Farsand Coast Cooking', 'cooking', 'Farsand Coast', 265, 49.0, 0.6, 10, 1, NULL, '🍳', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-022', '00000000-0000-0000-0000-example-seed', 'Example: Halfling Campgrounds Crafting', 'crafting', 'Halfling Campgrounds', 275, 53.0, 0.6, 12, 1, NULL, '🔧', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-023', '00000000-0000-0000-0000-example-seed', 'Example: Red Coast Tailoring', 'tailoring', 'Red Coast', 242, 45.0, 0.6, 8, 1, NULL, '🧵', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-024', '00000000-0000-0000-0000-example-seed', 'Example: Halfmaw Hideout Trinketry', 'trinketry', 'Halfmaw Hideout', 292, 54.0, 0.6, 18, 1, NULL, '💎', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-025', '00000000-0000-0000-0000-example-seed', 'Example: Bog Top Hunting', 'hunting', 'Bog Top', 218, 40.0, 0.6, 1, 1, NULL, '🏹', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-026', '00000000-0000-0000-0000-example-seed', 'Example: Bog Bottom Fishing', 'fishing', 'Bog Bottom', 198, 38.0, 0.6, 1, 1, NULL, '🎣', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-027', '00000000-0000-0000-0000-example-seed', 'Example: Blackspell Port Mining', 'mining', 'Blackspell Port', 248, 45.0, 0.6, 1, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-028', '00000000-0000-0000-0000-example-seed', 'Example: Granfiddich Shores Foraging', 'foraging', 'Granfiddich Shores', 178, 32.0, 0.6, 1, 1, NULL, '🌿', 'Dev Seed', '{}', datetime('now'), datetime('now')),
-- Syrenthia (underwater)
('ex-act-029', '00000000-0000-0000-0000-example-seed', 'Example: Vastalume Fishing', 'fishing', 'Vastalume', 200, 38.0, 0.6, 1, 1, NULL, '🎣', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-030', '00000000-0000-0000-0000-example-seed', 'Example: Kelp Forest Foraging', 'foraging', 'Kelp Forest', 180, 33.0, 0.6, 1, 1, NULL, '🌿', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-031', '00000000-0000-0000-0000-example-seed', 'Example: Darktide Trench Mining', 'mining', 'Darktide Trench', 255, 46.0, 0.6, 30, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-032', '00000000-0000-0000-0000-example-seed', 'Example: Casbrant''s Grave Trinketry', 'trinketry', 'Casbrant''s Grave', 295, 55.0, 0.6, 25, 1, NULL, '💎', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-033', '00000000-0000-0000-0000-example-seed', 'Example: Elara''s Lagoon Fishing', 'fishing', 'Elara''s Lagoon', 202, 39.0, 0.6, 1, 1, NULL, '🎣', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-034', '00000000-0000-0000-0000-example-seed', 'Example: Underwater Cave Mining', 'mining', 'Underwater Cave', 258, 47.0, 0.6, 35, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
-- Wallisia
('ex-act-035', '00000000-0000-0000-0000-example-seed', 'Example: Blackrane Smithing', 'smithing', 'Blackrane', 308, 57.0, 0.6, 20, 1, NULL, '🔨', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-036', '00000000-0000-0000-0000-example-seed', 'Example: Blackwater Fields Hunting', 'hunting', 'Blackwater Fields', 222, 41.0, 0.6, 1, 1, NULL, '🏹', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-037', '00000000-0000-0000-0000-example-seed', 'Example: Kildome Cross Carpentry', 'carpentry', 'Kildome Cross', 288, 52.0, 0.6, 15, 1, NULL, '🪚', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-038', '00000000-0000-0000-0000-example-seed', 'Example: Stalking Yew Woods Woodcutting', 'woodcutting', 'Stalking Yew Woods', 212, 37.0, 0.6, 1, 1, NULL, '🪓', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-039', '00000000-0000-0000-0000-example-seed', 'Example: Tendon Wet Fields Foraging', 'foraging', 'Tendon Wet Fields', 182, 33.0, 0.6, 1, 1, NULL, '🌿', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-040', '00000000-0000-0000-0000-example-seed', 'Example: Wraithwater Trinketry', 'trinketry', 'Wraithwater', 298, 56.0, 0.6, 22, 1, NULL, '💎', 'Dev Seed', '{}', datetime('now'), datetime('now')),
-- Jarvonia continued
('ex-act-041', '00000000-0000-0000-0000-example-seed', 'Example: Black Eye Peak Mining', 'mining', 'Black Eye Peak', 260, 47.0, 0.6, 25, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-042', '00000000-0000-0000-0000-example-seed', 'Example: Frostbite Mountain Woodcutting', 'woodcutting', 'Frostbite Mountain', 215, 38.0, 0.6, 20, 1, NULL, '🪓', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-043', '00000000-0000-0000-0000-example-seed', 'Example: Fort of Permafrost Smithing', 'smithing', 'Fort of Permafrost', 310, 58.0, 0.6, 30, 1, NULL, '🔨', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-044', '00000000-0000-0000-0000-example-seed', 'Example: Horn of Respite Cooking', 'cooking', 'Horn of Respite', 268, 50.0, 0.6, 10, 1, NULL, '🍳', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-045', '00000000-0000-0000-0000-example-seed', 'Example: Noiseless Pass Agility', 'agility', 'Noiseless Pass', 322, 175.0, 0.6, 1, 1, NULL, '🏃', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-046', '00000000-0000-0000-0000-example-seed', 'Example: Nurturing Nook Springs Crafting', 'crafting', 'Nurturing Nook Springs', 278, 54.0, 0.6, 12, 1, NULL, '🔧', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-047', '00000000-0000-0000-0000-example-seed', 'Example: Pit of Pittance Mining', 'mining', 'Pit of Pittance', 252, 46.0, 0.6, 15, 1, NULL, '⛏️', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-048', '00000000-0000-0000-0000-example-seed', 'Example: Winter''s End Tailoring', 'tailoring', 'Winter''s End', 244, 45.0, 0.6, 8, 1, NULL, '🧵', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-049', '00000000-0000-0000-0000-example-seed', 'Example: Winter Waves Glacier Woodcutting', 'woodcutting', 'Winter Waves Glacier', 208, 36.0, 0.6, 10, 1, NULL, '🪓', 'Dev Seed', '{}', datetime('now'), datetime('now')),
('ex-act-050', '00000000-0000-0000-0000-example-seed', 'Example: Beach of Woes Fishing', 'fishing', 'Beach of Woes', 196, 37.0, 0.6, 1, 1, NULL, '🎣', 'Dev Seed', '{}', datetime('now'), datetime('now'));

-- Activity with EVERY requirement type
INSERT OR IGNORE INTO generic_activities
    (id, session_uuid, name, skill, location, base_steps, base_xp, max_efficiency,
     required_level, is_public, source, icon, contributed_by, requirements_json, created_at, updated_at)
VALUES (
    'ex-act-req', '00000000-0000-0000-0000-example-seed',
    'Example: Activity With All Requirements', 'mining', 'Kallaheim',
    300, 55.0, 0.6, 30, 1, NULL, '⛏️', 'Dev Seed',
    '{"skill_requirements":{"Mining":30,"Agility":20},"keyword_counts":{"Pickaxe":1,"Diving gear":1,"Light source":2,"Skis":1},"reputation":{"Jarvonia":50},"achievement_points":60,"activity_completions":{}}',
    datetime('now'), datetime('now')
);

-- ============================================================================
-- RECIPES — one per skill
-- ============================================================================

INSERT OR IGNORE INTO generic_recipes
    (id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
     required_level, is_public, source, icon, contributed_by, is_quality_item, requirements_json, created_at, updated_at)
VALUES
('ex-rec-001', '00000000-0000-0000-0000-example-seed', 'Example: Smithing Recipe', 'smithing', 300, 55.0, 0.6, 20, 1, NULL, '🔨', 'Dev Seed', 0, '{}', datetime('now'), datetime('now')),
('ex-rec-002', '00000000-0000-0000-0000-example-seed', 'Example: Carpentry Recipe', 'carpentry', 280, 50.0, 0.6, 15, 1, NULL, '🪚', 'Dev Seed', 0, '{}', datetime('now'), datetime('now')),
('ex-rec-003', '00000000-0000-0000-0000-example-seed', 'Example: Cooking Recipe', 'cooking', 260, 48.0, 0.6, 10, 1, NULL, '🍳', 'Dev Seed', 0, '{}', datetime('now'), datetime('now')),
('ex-rec-004', '00000000-0000-0000-0000-example-seed', 'Example: Crafting Recipe', 'crafting', 270, 52.0, 0.6, 12, 1, NULL, '🔧', 'Dev Seed', 0, '{}', datetime('now'), datetime('now')),
('ex-rec-005', '00000000-0000-0000-0000-example-seed', 'Example: Tailoring Recipe', 'tailoring', 240, 44.0, 0.6, 8, 1, NULL, '🧵', 'Dev Seed', 0, '{}', datetime('now'), datetime('now')),
('ex-rec-006', '00000000-0000-0000-0000-example-seed', 'Example: Trinketry Recipe', 'trinketry', 290, 53.0, 0.6, 18, 1, NULL, '💎', 'Dev Seed', 0, '{}', datetime('now'), datetime('now')),
-- Quality item recipe (shows crafting odds table)
('ex-rec-007', '00000000-0000-0000-0000-example-seed', 'Example: Quality Item Recipe (Smithing)', 'smithing', 350, 65.0, 0.6, 25, 1, NULL, '⭐', 'Dev Seed', 1, '{}', datetime('now'), datetime('now'));

-- ============================================================================
-- SERVICES — one per skill, basic and advanced
-- ============================================================================

INSERT OR IGNORE INTO generic_services
    (id, session_uuid, name, skill, location, stats_json, is_public, source, icon, contributed_by, tier, created_at, updated_at)
VALUES
-- Basic services
('ex-svc-001', '00000000-0000-0000-0000-example-seed', 'Example: Basic Smithing Service', 'smithing', 'Kallaheim', '{"work_efficiency":5.0}', 1, NULL, '🔨', 'Dev Seed', 'basic', datetime('now'), datetime('now')),
('ex-svc-002', '00000000-0000-0000-0000-example-seed', 'Example: Basic Carpentry Service', 'carpentry', 'Coldington', '{"work_efficiency":5.0}', 1, NULL, '🪚', 'Dev Seed', 'basic', datetime('now'), datetime('now')),
('ex-svc-003', '00000000-0000-0000-0000-example-seed', 'Example: Basic Cooking Service', 'cooking', 'Barbantok', '{"work_efficiency":5.0}', 1, NULL, '🍳', 'Dev Seed', 'basic', datetime('now'), datetime('now')),
('ex-svc-004', '00000000-0000-0000-0000-example-seed', 'Example: Basic Crafting Service', 'crafting', 'Sanguine Hills', '{"work_efficiency":5.0}', 1, NULL, '🔧', 'Dev Seed', 'basic', datetime('now'), datetime('now')),
('ex-svc-005', '00000000-0000-0000-0000-example-seed', 'Example: Basic Tailoring Service', 'tailoring', 'Casbrant Fields', '{"work_efficiency":5.0}', 1, NULL, '🧵', 'Dev Seed', 'basic', datetime('now'), datetime('now')),
('ex-svc-006', '00000000-0000-0000-0000-example-seed', 'Example: Basic Trinketry Service', 'trinketry', 'Disenchanted Forest', '{"work_efficiency":5.0}', 1, NULL, '💎', 'Dev Seed', 'basic', datetime('now'), datetime('now')),
-- Advanced services
('ex-svc-007', '00000000-0000-0000-0000-example-seed', 'Example: Advanced Smithing Service', 'smithing', 'Centaham', '{"work_efficiency":10.0,"quality_outcome":5.0}', 1, NULL, '🔨', 'Dev Seed', 'advanced', datetime('now'), datetime('now')),
('ex-svc-008', '00000000-0000-0000-0000-example-seed', 'Example: Advanced Carpentry Service', 'carpentry', 'Everhaven', '{"work_efficiency":10.0,"quality_outcome":5.0}', 1, NULL, '🪚', 'Dev Seed', 'advanced', datetime('now'), datetime('now')),
('ex-svc-009', '00000000-0000-0000-0000-example-seed', 'Example: Advanced Cooking Service', 'cooking', 'Horn of Respite', '{"work_efficiency":10.0,"quality_outcome":5.0}', 1, NULL, '🍳', 'Dev Seed', 'advanced', datetime('now'), datetime('now')),
('ex-svc-010', '00000000-0000-0000-0000-example-seed', 'Example: Advanced Crafting Service', 'crafting', 'Nurturing Nook Springs', '{"work_efficiency":10.0,"quality_outcome":5.0}', 1, NULL, '🔧', 'Dev Seed', 'advanced', datetime('now'), datetime('now')),
('ex-svc-011', '00000000-0000-0000-0000-example-seed', 'Example: Advanced Tailoring Service', 'tailoring', 'Azurazera', '{"work_efficiency":10.0,"quality_outcome":5.0}', 1, NULL, '🧵', 'Dev Seed', 'advanced', datetime('now'), datetime('now')),
('ex-svc-012', '00000000-0000-0000-0000-example-seed', 'Example: Advanced Trinketry Service', 'trinketry', 'Frusenholm', '{"work_efficiency":10.0,"quality_outcome":5.0}', 1, NULL, '💎', 'Dev Seed', 'advanced', datetime('now'), datetime('now')),
-- Service with 2 stats (shows multi-stat format)
('ex-svc-013', '00000000-0000-0000-0000-example-seed', 'Example: Service With 2 Stats', 'smithing', 'Port Skildar', '{"work_efficiency":8.0,"no_materials_consumed":5.0}', 1, NULL, '⚙️', 'Dev Seed', 'basic', datetime('now'), datetime('now'));

-- ============================================================================
-- GENERIC ITEMS
-- ============================================================================

-- Non-crafted: one per slot with a single stat
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES
('ex-item-head',  '00000000-0000-0000-0000-example-seed', 'Example: Head Item',       '🪖', NULL, 'head',      '[]', '{"global":{"global":{"work_efficiency":5.0}}}',                NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_head_item',       datetime('now'), datetime('now')),
('ex-item-cape',  '00000000-0000-0000-0000-example-seed', 'Example: Cape Item',       '🧣', NULL, 'cape',      '[]', '{"global":{"global":{"double_action":3.0}}}',                  NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_cape_item',       datetime('now'), datetime('now')),
('ex-item-back',  '00000000-0000-0000-0000-example-seed', 'Example: Back Item',       '🎒', NULL, 'back',      '[]', '{"global":{"global":{"double_rewards":4.0}}}',                 NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_back_item',       datetime('now'), datetime('now')),
('ex-item-chest', '00000000-0000-0000-0000-example-seed', 'Example: Chest Item',      '👕', NULL, 'chest',     '[]', '{"global":{"global":{"bonus_xp_percent":5.0}}}',               NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_chest_item',      datetime('now'), datetime('now')),
('ex-item-hands', '00000000-0000-0000-0000-example-seed', 'Example: Hands Item',      '🧤', NULL, 'hands',     '[]', '{"global":{"global":{"fine_material_finding":3.0}}}',          NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_hands_item',      datetime('now'), datetime('now')),
('ex-item-legs',  '00000000-0000-0000-0000-example-seed', 'Example: Legs Item',       '👖', NULL, 'legs',      '[]', '{"global":{"global":{"steps_percent":-2.0}}}',                 NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_legs_item',       datetime('now'), datetime('now')),
('ex-item-neck',  '00000000-0000-0000-0000-example-seed', 'Example: Neck Item',       '📿', NULL, 'neck',      '[]', '{"global":{"global":{"chest_finding":5.0}}}',                  NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_neck_item',       datetime('now'), datetime('now')),
('ex-item-feet',  '00000000-0000-0000-0000-example-seed', 'Example: Feet Item',       '👢', NULL, 'feet',      '[]', '{"global":{"global":{"steps_add":-2.0}}}',                     NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_feet_item',       datetime('now'), datetime('now')),
('ex-item-ring',  '00000000-0000-0000-0000-example-seed', 'Example: Ring Item',       '💍', NULL, 'ring',      '[]', '{"global":{"global":{"steps_percent":-1.0}}}',                 NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_ring_item',       datetime('now'), datetime('now')),
('ex-item-tool',  '00000000-0000-0000-0000-example-seed', 'Example: Tool Item',       '🔧', NULL, 'tool',      '["Hatchet"]', '{"woodcutting":{"global":{"work_efficiency":8.0}}}',   NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_tool_item',       datetime('now'), datetime('now')),
('ex-item-coll',  '00000000-0000-0000-0000-example-seed', 'Example: Collectible',     '🏆', NULL, 'collectible','[]', '{"global":{"global":{"double_rewards":2.0}}}',                NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_collectible',     datetime('now'), datetime('now')),
('ex-item-cons',  '00000000-0000-0000-0000-example-seed', 'Example: Consumable',      '🧪', NULL, 'consumable', '[]', '{}', '{"Normal":{"global":{"global":{"work_efficiency":5.0}}},"Fine":{"global":{"global":{"work_efficiency":10.0}}}}', 'common', 1, 1, NULL, 'Dev Seed', 'example_consumable', datetime('now'), datetime('now'));

-- Non-crafted chest with 4 keywords
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-chest4kw', '00000000-0000-0000-0000-example-seed',
    'Example: Chest With 4 Keywords', '👕', NULL, 'chest',
    '["Treasure hunter set","Proper gear","Regional","Underwater"]',
    '{"global":{"global":{"work_efficiency":5.0},"underwater":{"double_rewards":8.0}}}',
    NULL, 'rare', 0, 1, NULL, 'Dev Seed', 'example_chest_4_keywords',
    datetime('now'), datetime('now')
);

-- Non-crafted tool with 3 skills (global + skill-specific + location-specific)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-tool3sk', '00000000-0000-0000-0000-example-seed',
    'Example: Tool With 3 Skills', '⛏️', NULL, 'tool',
    '["Pickaxe","Mining tool"]',
    '{"global":{"global":{"work_efficiency":5.0}},"mining":{"global":{"double_action":8.0},"jarvonia":{"double_rewards":5.0}}}',
    NULL, 'uncommon', 0, 1, NULL, 'Dev Seed', 'example_tool_3_skills',
    datetime('now'), datetime('now')
);

-- Crafted tool with 2 skills per quality (Normal through Eternal)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-craftool', '00000000-0000-0000-0000-example-seed',
    'Example: Crafted Tool (All Qualities)', '🔨', '#ff8800', 'tool',
    '["Smithing hammer","Smithing tool"]',
    '{}',
    '{"Normal":{"global":{"global":{"work_efficiency":5.0}},"smithing":{"global":{"quality_outcome":2.0}}},"Good":{"global":{"global":{"work_efficiency":8.0}},"smithing":{"global":{"quality_outcome":4.0}}},"Great":{"global":{"global":{"work_efficiency":11.0}},"smithing":{"global":{"quality_outcome":6.0}}},"Excellent":{"global":{"global":{"work_efficiency":14.0}},"smithing":{"global":{"quality_outcome":8.0}}},"Perfect":{"global":{"global":{"work_efficiency":17.0}},"smithing":{"global":{"quality_outcome":10.0}}},"Eternal":{"global":{"global":{"work_efficiency":20.0}},"smithing":{"global":{"quality_outcome":12.0}}}}',
    'common', 1, 1, NULL, 'Dev Seed', 'example_crafted_tool_all_qualities',
    datetime('now'), datetime('now')
);

-- Crafted chest with 2 skills per quality (shows quality tiers on non-tool gear)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-crchest', '00000000-0000-0000-0000-example-seed',
    'Example: Crafted Chest (All Qualities)', '👕', '#4488ff', 'chest',
    '["Proper gear"]',
    '{}',
    '{"Normal":{"global":{"global":{"work_efficiency":3.0}},"agility":{"global":{"double_action":2.0}}},"Good":{"global":{"global":{"work_efficiency":5.0}},"agility":{"global":{"double_action":4.0}}},"Great":{"global":{"global":{"work_efficiency":7.0}},"agility":{"global":{"double_action":6.0}}},"Excellent":{"global":{"global":{"work_efficiency":9.0}},"agility":{"global":{"double_action":8.0}}},"Perfect":{"global":{"global":{"work_efficiency":11.0}},"agility":{"global":{"double_action":10.0}}},"Eternal":{"global":{"global":{"work_efficiency":13.0}},"agility":{"global":{"double_action":12.0}}}}',
    'common', 1, 1, NULL, 'Dev Seed', 'example_crafted_chest_all_qualities',
    datetime('now'), datetime('now')
);

-- Consumable with 2 skills per quality (Normal + Fine)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-cons2sk', '00000000-0000-0000-0000-example-seed',
    'Example: Consumable With 2 Skills Per Quality', '🧪', NULL, 'consumable',
    '[]', '{}',
    '{"Normal":{"global":{"global":{"work_efficiency":5.0}},"mining":{"global":{"double_action":3.0}}},"Fine":{"global":{"global":{"work_efficiency":10.0}},"mining":{"global":{"double_action":6.0}}}}',
    'common', 1, 1, NULL, 'Dev Seed', 'example_consumable_2_skills',
    datetime('now'), datetime('now')
);

-- Collectible with location-specific stat (underwater bonus)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-colloc', '00000000-0000-0000-0000-example-seed',
    'Example: Collectible With Location Stat', '🏆', NULL, 'collectible',
    '[]',
    '{"global":{"global":{"double_rewards":2.0},"underwater":{"double_rewards":8.0}}}',
    NULL, 'common', 0, 1, NULL, 'Dev Seed', 'example_collectible_location_stat',
    datetime('now'), datetime('now')
);

-- Primary slot: one of EVERY requirement type (shown via keywords)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-primary', '00000000-0000-0000-0000-example-seed',
    'Example: Primary With All Keywords', '⚔️', NULL, 'primary',
    '["Weapon","Achievement reward","Faction reward","Regional","Underwater","Spectral","Light source","Treasure hunter set","Adventuring tool set","Skill book"]',
    '{"global":{"global":{"work_efficiency":5.0}}}',
    NULL, 'legendary', 0, 1, NULL, 'Dev Seed', 'example_primary_all_keywords',
    datetime('now'), datetime('now')
);

-- Secondary slot: one of EVERY stat type
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-secondary', '00000000-0000-0000-0000-example-seed',
    'Example: Secondary With All Stats', '🛡️', NULL, 'secondary',
    '["Shield"]',
    '{"global":{"global":{"work_efficiency":1.0,"double_action":1.0,"double_rewards":1.0,"bonus_xp_add":1.0,"bonus_xp_percent":1.0,"chest_finding":1.0,"find_bird_nests":1.0,"find_coin_pouch":1.0,"find_collectibles":1.0,"find_gems":1.0,"fine_material_finding":1.0,"inventory_space":1,"no_materials_consumed":1.0,"quality_outcome":1.0,"steps_add":-1.0,"steps_percent":-1.0}}}',
    NULL, 'ethereal', 0, 1, NULL, 'Dev Seed', 'example_secondary_all_stats',
    datetime('now'), datetime('now')
);

-- Item with icon_color tint (shows the color tint feature)
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-tint', '00000000-0000-0000-0000-example-seed',
    'Example: Item With Icon Color Tint', '⚡', '#ff4400', 'tool',
    '["Crafting tool"]',
    '{"crafting":{"global":{"work_efficiency":6.0}}}',
    NULL, 'rare', 0, 1, NULL, 'Dev Seed', 'example_item_icon_tint',
    datetime('now'), datetime('now')
);

-- Pet item example
INSERT OR IGNORE INTO generic_items
    (id, session_uuid, name, icon, icon_color, slot, keywords, stats_json, quality_stats_json,
     rarity, is_crafted, is_public, source, contributed_by, export_item_name, created_at, updated_at)
VALUES (
    'ex-item-pet', '00000000-0000-0000-0000-example-seed',
    'Example: Pet Item', '🐾', NULL, 'pet',
    '[]',
    '{"global":{"global":{"double_rewards":3.0}}}',
    NULL, 'uncommon', 0, 1, NULL, 'Dev Seed', 'example_pet_item',
    datetime('now'), datetime('now')
);
