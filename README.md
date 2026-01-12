# Walkscape Optimizer Toolkit
## v0.5
A Python toolkit for optimizing your Walkscape gameplay - find the best gear for traveling, activities, and crafting.

## What This Does

This toolkit helps you answer questions like:
- "What's the fastest way to travel from Port Skildar to Casbrant's Grave?"
- "What gear should I wear for butterfly catching?"
- "How many materials do I need to craft a Perfect Iron Sickle?"
- "What's the best route to visit 5 locations?"

## Getting Started

### 1. Set Up Your Character

Edit `my_config.py` and paste your character export:

```python
CHARACTER_EXPORT = """{"name":"YourName",...}"""
```

**Where to find it:** In-game, go to Settings > Account > Export Character Data

### 2. Add Your Gearsets (Optional)

If you want to optimize travel routes, add your gearset exports:

```python
GEARSETS = {
    'default': "H4sI...",  # Your main traveling gear
}
```

**Where to find it:** Equipment > Gear sets > Select a gearset > Export Gearset

### 3. Run an Optimizer

```bash
python3 optimize_activity_gearsets.py
```

That's it! The optimizer will find the best gear from your inventory.

---

## Main Tools

### 🎒 Travel Optimizer (`optimize_travel_gearsets.py`)

**What it does:** Finds the best gear for traveling between locations.

**How to use:**
1. Edit the `TEST_LOCATIONS` list in the file - uncomment the locations you want to optimize for
2. Run: `python3 optimize_travel_gearsets.py`
3. Copy the export string and import it in-game

**What you get:**
- Optimal gearset for each route
- Routes grouped by identical gearsets (so you can see which routes share gear)
- Step counts for each route
- Handles diving gear, light sources, and skis automatically

**Example output:**
```
Gearset 1 - Used by 2 route(s):
  • Witched Woods → Halfling Campgrounds    419 steps
  • Halfling Campgrounds → Witched Woods    419 steps
  
  Items:
    head: Mining helmet
    tool0: Simple torch
    tool1: Hand lantern
    tool3: Map of Halfling Rebels
    ...
```

---

### 🎣 Activity Optimizer (`optimize_activity_gearsets.py`)

**What it does:** Finds the best gear for activities like fishing, foraging, mining, etc.

**How to use:**
1. Edit the configuration:
   ```python
   ACTIVITY = Activity.SKATE_SKIING
   TARGET_ITEM = None  # Or specify an item to optimize for
   
   SORTING_PRIORITY = [
       Sorting.STEPS_PER_REWARD_ROLL,  # Minimize steps per reward
       Sorting.XP_PER_STEP,             # Maximize XP per step
   ]
   ```

2. Run: `python3 optimize_activity_gearsets.py`

**What you get:**
- Best gearset for your optimization goals
- Steps per action, steps per reward, XP per step
- Export string to import in-game

**Optimization goals:**
- `STEPS_PER_REWARD_ROLL` - Best for farming items
- `XP_PER_STEP` - Best for leveling up
- `EXPECTED_STEPS_PER_ACTION` - Best for completing actions quickly

---

### 🔨 Crafting Optimizer (`optimize_craft_gearsets.py`)

**What it does:** Finds the best gear for crafting items.

**How to use:**
1. Edit the configuration:
   ```python
   RECIPE = Recipe.IRON_SICKLE
   SERVICE = Service.TIDAL_WORKSHOP_VASTALUME
   TARGET_QUALITY = 'Perfect'  # For quality items
   ```

2. Run: `python3 optimize_craft_gearsets.py`

**What you get:**
- Best gearset for minimizing materials or steps
- Materials needed for your target
- Expected crafts to get Perfect quality
- Export string

**Optimization modes:**
- Minimize materials (default for quality items)
- Minimize steps
- Maximize XP

---

### 🗺️ Route Planner (`travel_locations_optimizer.py`)

**What it does:** Plans the shortest route to visit multiple locations.

**How to use:**
1. Edit the route:
   ```python
   test_route = [
       Location.KALLAHEIM,
       Location.PORT_SKILDAR,
       Location.CASBRANTS_GRAVE,
   ]
   ```

2. Add service visits if needed:
   ```python
   test_route = [
       b(Location.KALLAHEIM),  # Visit bank
       Location.PORT_SKILDAR,
   ]
   ```

3. Run: `python3 travel_locations_optimizer.py`

**What you get:**
- Shortest path visiting all locations
- Automatic gear switches
- Bank/service visits inserted where needed
- Total steps and route breakdown

---

## Analysis Tools

### 📊 Drop Rate Calculator (`activity_drop_rates.py`)

See expected steps per item drop for an activity with your current gear.

```bash
python3 activity_drop_rates.py
```

### 🔍 Gear Comparison (`gear_item_comparison.py`)

Test if a new item improves your gearset.

```bash
python3 gear_item_comparison.py
```

### 📋 Gearset Stats (`gearset_stats.py`)

View detailed stats for a gearset - see what each item contributes.

```bash
python3 gearset_stats.py
```

### ⚖️ Item Comparison (`compare_two_items.py`)

Compare two items side-by-side.

```bash
python3 compare_two_items.py
```

### 🔬 Crafting Analysis (`craft_compare.py`)

Analyze crafting efficiency for a specific setup - see exactly how all bonuses combine.

```bash
python3 craft_compare.py
```

---

## Understanding Stats

### Travel Stats
- **WE (Work Efficiency)**: Reduces distance (more is better)
- **DA (Double Action)**: Chance to skip paying steps (more is better)
- **Flat Steps**: Fixed modifier per node (negative is better)
- **Pct Steps**: Percentage reduction (negative is better)

### Activity Stats
- **WE**: Reduces steps per action
- **DA**: Chance for bonus actions
- **DR (Double Rewards)**: Chance for bonus items
- **Find bonuses**: Increases specific drop rates

### Crafting Stats
- **WE**: Reduces steps per craft (capped by recipe)
- **DR**: Reduces materials needed
- **DA**: Reduces steps
- **NMC (No Materials Consumed)**: Reduces materials needed
- **QO (Quality Outcome)**: Improves craft quality

---

## Configuration Guide

### Character Export (Required)

1. In Walkscape: Settings > Account > Export Character Data
2. Copy the entire JSON text
3. Paste into `my_config.py`:
   ```python
   CHARACTER_EXPORT = """paste here"""
   ```

### Gearsets (Optional but Recommended)

1. In Walkscape: Equipment > Gear sets > Select a gearset > Export Gearset
2. Copy the export string
3. Add to `my_config.py`:
   ```python
   GEARSETS = {
       'default': "H4sI...",
       'Diving': "H4sI...",
       'Jarvonia': "H4sI...",
   }
   ```

**Gearset types:**
- `default` - Your main traveling gear
- `Diving` - For underwater routes (3 diving gear items)
- `Jarvonia` - For Jarvonia routes (with skis if needed)
- `GDTE` - For Trellin/Erdwise/Halfling Rebels routes
- `Swamp_2light` / `Swamp_3light` - For swamp routes
- Custom routes: Use `from_to_location_gear_set_name(from, to)` for specific routes

The optimizer automatically picks the right gearset based on:
1. Custom route gearsets (highest priority)
2. Route requirements (diving gear, light sources, skis)
3. Starting location region
4. Distance (picks `_short` variants for shorter routes)

### Service Unlocks (Optional)

Mark which crafting stations you've unlocked:

```python
LOCATION_SERVICES = {
    Location.KALLAHEIM: {
        ServiceCategory.BANK: (ServiceTier.BASIC, True),  # Unlocked
        ServiceCategory.COOKING: (ServiceTier.ADVANCED, False),  # Locked
    },
}
```

This helps the route planner avoid locked services.

---

## Updating Data

When Walkscape updates with new items or locations:

```bash
python3 util/scrapers/rescrape_all.py
```

This regenerates all data from the wiki. Takes about 2-3 minutes.

---

## Tips & Tricks

### For Travel
- Create specialized gearsets for different regions (Jarvonia with skis, underwater with diving gear)
- Use `_short` suffix gearsets for routes under ~500 steps
- Add custom route gearsets for frequently-traveled routes

### For Activities
- Optimize for `STEPS_PER_REWARD_ROLL` when farming items
- Optimize for `XP_PER_STEP` when leveling skills
- Use `TARGET_ITEM` to optimize for specific drops

### For Crafting
- The optimizer auto-detects if you're crafting quality items (optimizes for Perfect)
- For simple items (twine, planks), set `TARGET_QUANTITY` or `MATERIAL_BUDGET`
- Enable `INCLUDE_CONSUMABLES` to test food/potions

### General
- Update your character export after leveling up or getting new gear
- The optimizers test thousands of combinations - be patient!
- Export strings can be imported directly in-game

---

## Troubleshooting

**"No items found"**
- Make sure your character export is up to date
- Check that items aren't in the `IGNORED_ITEMS` list

**"Route blocked"**
- You're missing required equipment (diving gear, light sources, skis)
- Add the required items to your inventory or gearset

**"Optimizer is slow"**
- Normal! Testing thousands of combinations takes time
- Travel optimizer: ~3-5 seconds for 66 routes
- Activity optimizer: ~0.2-0.5 seconds
- Crafting optimizer: ~1-3 seconds

**"Results don't match the game"**
- Regenerate data: `python3 util/scrapers/rescrape_all.py`
- Check if your character export is current
- Verify gearset exports are correct

---

## Technical Details

### How Tool Slots Work
Based on total character level (sum of all skills):
- Level 1-19: 3 tool slots
- Level 20-49: 4 tool slots
- Level 50-79: 5 tool slots
- Level 80+: 6 tool slots

### How Regional Stats Work
Items can have different stats in different regions:
- **Trusty Tent**: +50% WE in GDTE regions (Trellin, Erdwise, Halfling Rebels)
- **Maps**: +15% DA in their respective regions
- **Diving gear**: Different stats underwater vs on land

The optimizer automatically applies the correct stats based on your starting location.

### How Requirements Work
Routes and activities can require:
- **Diving gear**: 3 items with "diving gear" keyword (basic, advanced, or expert)
- **Light sources**: 2-3 unique light source items
- **Skis**: 1 item with "skis" keyword
- **Tools**: Specific tool types (fishing rod, net, etc.)

The optimizer ensures all requirements are met.

---

## Project Structure

```
Main Tools (⭐ = edit these)
├── my_config.py ⭐                 Your configuration
├── optimize_travel_gearsets.py ⭐  Travel optimizer
├── optimize_activity_gearsets.py ⭐ Activity optimizer
├── optimize_craft_gearsets.py ⭐   Crafting optimizer
├── travel_locations_optimizer.py ⭐ Route planner

Analysis Tools
├── activity_drop_rates.py          Drop rate calculator
├── craft_compare.py                Crafting analyzer
├── gear_item_comparison.py         Item tester
├── gearset_stats.py                Gearset viewer
└── compare_two_items.py            Item comparer

Data & Utilities (don't edit)
└── util/
    ├── autogenerated/              Generated from wiki
    ├── scrapers/                   Wiki scrapers
    └── *.py                        Core utilities
```

---

## Requirements

- Python 3.7 or newer
- BeautifulSoup4 (only needed for regenerating data from wiki)

**To install dependencies:**
```bash
pip install -r requirements.txt
```

**Note:** The optimizers work with Python standard library only. BeautifulSoup4 is only needed if you want to regenerate data from the wiki using the scrapers.

---

## Quick Install

```bash
# Clone or download this repository
git clone <repository-url>
cd walkscape-optimizer

# Install dependencies (optional - only needed for wiki scrapers)
pip install -r requirements.txt

# Configure your character
# Edit my_config.py and paste your character export

# Run an optimizer
python3 optimize_activity_gearsets.py
```

---

## Credits

Data extracted from the [Walkscape Wiki](https://wiki.walkscape.app/).

Formulas verified against the official Walkscape tools.

---

## Version History

**v0.4** - Current
- Per-route travel optimization with grouped display
- keyword_counts format for route requirements
- Regional stat matching fixes
- 2-swap support for escaping local optima
- Activity optimizer refactoring (Tasks 1-5 complete)

**v0.3**
- Crafting system with quality outcome calculations
- Service and collectible support
- Consumables integration

**v0.2**
- Activity optimization with drop rate targeting
- Location-aware stats

**v0.1**
- Initial travel route optimization
