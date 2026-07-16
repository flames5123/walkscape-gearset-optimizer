#!/usr/bin/env python3
"""
Scrape recipes from the Walkscape wiki Recipes page.
Generates recipes.py with all recipe data.
"""

from bs4 import BeautifulSoup
from scraper_utils import *
import re
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from util.recipe_materials import resolve_material

# Configuration
RESCRAPE = False
RECIPES_URL = 'https://wiki.walkscape.app/wiki/Recipes'
CACHE_DIR = get_cache_dir('recipes')
CACHE_FILE = get_cache_file('recipes_cache.html')

# Recipe name overrides - maps cleaned recipe name to desired enum name
# Use this when the automatic cleaning produces incorrect names
# Key: cleaned recipe name (after removing prefixes like "Harden ")
# Value: desired enum name (will be uppercased and have spaces replaced with _)
# 
# Examples:
#   'kelp': 'HARDENED_KELP'  - "Harden kelp" → "HARDENED_KELP" instead of "KELP"
#   'wood': 'TREATED_WOOD'   - "Treat wood" → "TREATED_WOOD" instead of "WOOD"
#
RECIPE_NAME_OVERRIDES = {
    'kelp': 'HARDENED_KELP',  # "Harden kelp" → "HARDENED_KELP" instead of "KELP"
}

# Create validator instance
validator = ScraperValidator()

def extract_item_name(td):
    """Extract item name from a table cell with link, including suffixes like (Scrap)."""
    # The format is like "Create a <a>Birch Plank</a> (Scrap)"
    # Extract the link text (the actual item name)
    link = td.find('a')
    if link:
        item_name = clean_text(link.get_text())
        
        # Get full text and find any suffix after the link
        full_text = clean_text(td.get_text())
        
        # Find where the item name appears in full text
        idx = full_text.find(item_name)
        if idx >= 0:
            # Get everything after the item name
            after_name = full_text[idx + len(item_name):].strip()
            
            # If there's a suffix in parentheses, add it
            if after_name.startswith('(') and ')' in after_name:
                # Extract just the parenthetical part
                end_paren = after_name.find(')')
                suffix = after_name[:end_paren + 1]
                return f"{item_name} {suffix}"
        
        return item_name
    
    # Fallback: no link found, return full text
    return clean_text(td.get_text())

def extract_materials(td):
    """
    Extract materials list from the materials cell and link to objects.
    
    Materials with " or " are alternatives (separate arrays).
    All other materials are required (same array).
    
    Returns:
        List of material groups, where each group is a list of (quantity, material) tuples
        Example: [[(2, Material.VIOLITE_BAR), (1, Material.MAHOGANY_PLANK)]]  # Both required
        Example: [[(5, Material.GOLD_BAR)], [(5, Material.SILVER_BAR)]]  # Alternatives
    """
    # Replace <br> tags with space to ensure separation
    for br in td.find_all('br'):
        br.replace_with(' ')
    
    # Get plain text
    text = clean_text(td.get_text())
    
    # Check if there are " or " alternatives
    if ' or ' in text.lower():
        # Split by " or " to get alternative groups
        alternatives = [alt.strip() for alt in re.split(r'\s+or\s+', text, flags=re.IGNORECASE)]

        def parse_group(alt_text):
            matches = re.findall(r'(\d+)x\s+([A-Za-z\s\(\)\'\-]+?)(?=\s*\d+x|$)', alt_text)
            group = []
            for qty_str, material_name in matches:
                quantity = int(qty_str)
                material_name = material_name.strip()
                material_obj = resolve_material(material_name)
                group.append((quantity, material_obj if material_obj else material_name))
            return group

        # The first segment may contain shared materials + the first alternative.
        # e.g. "1x Pants 1x Wrench 2x Twine" → shared=[pants, wrench], first_alt=[twine]
        # All subsequent segments are just the alternative material.
        first_group = parse_group(alternatives[0])

        # Shared = everything in the first group except the last item
        # (the last item is the first alternative)
        shared_materials = first_group[:-1]
        first_alternative = first_group[-1:]  # last item only

        material_groups = []
        # Build group for first alternative
        if first_alternative:
            material_groups.append(shared_materials + first_alternative)

        # Build groups for remaining alternatives, prepending shared materials
        for alt in alternatives[1:]:
            group = parse_group(alt)
            if group:
                material_groups.append(shared_materials + group)
    else:
        # No alternatives - all materials are required (one group)
        matches = re.findall(r'(\d+)x\s+([A-Za-z\s\(\)\'\-]+?)(?=\s*\d+x|$)', text)
        
        group = []
        for qty_str, material_name in matches:
            quantity = int(qty_str)
            material_name = material_name.strip()
            
            material_obj = resolve_material(material_name)
            if material_obj:
                group.append((quantity, material_obj))
            else:
                group.append((quantity, material_name))
        
        if group:
            material_groups = [group]  # Single group with all required materials
        else:
            material_groups = []
    
    return material_groups

def extract_skill_and_level(td):
    """Extract skill name and level requirement."""
    text = clean_text(td.get_text())
    # Pattern: "Carpentry lvl. 1" or "Cooking lvl 20" (with or without period)
    match = re.search(r'(\w+)\s+lvl\.?\s+(\d+)', text, re.IGNORECASE)
    if match:
        return match.group(1), int(match.group(2))
    return None, None

def extract_output_quantity(td):
    """
    Extract output quantity from RecipeOutputs cell.
    Format: "5x Item Name" or just "Item Name" (quantity 1)
    
    Returns:
        Tuple of (quantity, item_name)
    """
    text = clean_text(td.get_text())
    
    # Check for quantity pattern like "5x Beer"
    match = re.match(r'(\d+)x\s+(.+)', text)
    if match:
        return int(match.group(1)), match.group(2).strip()
    
    # No quantity specified, default to 1
    # Remove "Create a " or "Craft a " prefix if present
    text = re.sub(r'^(Create|Craft)\s+an?\s+', '', text, flags=re.IGNORECASE)
    return 1, text


def resolve_output_item(item_name):
    """
    Resolve output item name to actual Item, Material, or Consumable object.
    
    Args:
        item_name: Name of the output item
        
    Returns:
        Tuple of (object, type_str) where type_str is 'Item', 'Material', or 'Consumable'
        Returns (None, None) if not found
    """
    # Try to resolve as Material first (most common for recipes)
    material_obj = resolve_material(item_name)
    if material_obj:
        # Check what type it actually is
        from util.walkscape_constants import Material, Item, Consumable
        
        # Check if it's a Material
        for attr_name in dir(Material):
            if not attr_name.startswith('_'):
                if getattr(Material, attr_name, None) is material_obj:
                    return material_obj, 'Material'
        
        # Check if it's an Item
        for attr_name in dir(Item):
            if not attr_name.startswith('_'):
                if getattr(Item, attr_name, None) is material_obj:
                    return material_obj, 'Item'
        
        # Check if it's a Consumable
        for attr_name in dir(Consumable):
            if not attr_name.startswith('_'):
                if getattr(Consumable, attr_name, None) is material_obj:
                    return material_obj, 'Consumable'
    
    return None, None


def extract_service_and_level(service_td, level_td):
    """
    Extract service name and level from cells.
    Level is in the service cell like "Needs Basic Sawmill service or better. Carpentry lvl. 1"
    
    Returns:
        Tuple of (service_name, skill, level)
    """
    service_text = clean_text(service_td.get_text())
    level_text = clean_text(level_td.get_text())
    
    # Extract level from either cell
    skill = None
    level = None
    
    # Try level cell first
    level_match = re.search(r'(\w+)\s+lvl\.?\s+(\d+)', level_text, re.IGNORECASE)
    if level_match:
        skill = level_match.group(1)
        level = int(level_match.group(2))
    
    # If not found, try service cell
    if not level_match:
        level_match = re.search(r'(\w+)\s+lvl\.?\s+(\d+)', service_text, re.IGNORECASE)
        if level_match:
            skill = level_match.group(1)
            level = int(level_match.group(2))
    
    # Extract service name from service cell
    # Format: "Needs Basic Sawmill service or better"
    service_match = re.search(r'Needs\s+(.+?)\s+service', service_text, re.IGNORECASE)
    if service_match:
        service_name = service_match.group(1).strip()
    else:
        # Fallback to full text
        service_name = service_text
    
    return service_name, skill, level


def parse_recipe_experience_from_item_page(item_name, recipe_name, item_url, cache_dir):
    """
    Find and parse an individual item page to extract recipe experience data.
    Searches in equipment_cache, materials_cache, and consumables_cache.
    
    Args:
        item_name: Name of the output item (for finding cached file)
        recipe_name: Full recipe name to match in the table (e.g., "Create a birch plank (Scrap)")
        item_url: URL to the item page (not used, kept for compatibility)
        cache_dir: Directory to cache the HTML (not used, searches existing caches)
    
    Returns:
        Dict with base_xp, base_steps, max_efficiency or None if not found
    """
    from pathlib import Path
    
    # Search in existing cache folders
    cache_folders = [
        get_cache_dir('equipment'),
        get_cache_dir('materials'),
        get_cache_dir('consumables'),
    ]
    
    # Try to find the cached file
    cache_path = None
    for folder in cache_folders:
        # Try with spaces first
        potential_path = folder / (sanitize_filename(item_name) + '.html')
        if potential_path.exists():
            cache_path = potential_path
            break
        
        # Try with underscores (how materials/equipment save them)
        potential_path = folder / (sanitize_filename(item_name).replace(' ', '_') + '.html')
        if potential_path.exists():
            cache_path = potential_path
            break
    
    if not cache_path:
        print(f"    ⚠ No cached page found for {item_name}")
        return None
    
    # Read the cached HTML
    html = read_cached_html(cache_path)
    if not html:
        return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Find ALL tables with "Recipe Experience" caption on the page
    # (some items have multiple recipe variants in separate tables)
    for table in soup.find_all('table'):
        caption = table.find('caption')
        if not caption or 'Recipe Experience' not in caption.get_text():
            continue
        
        rows = table.find_all('tr')[1:]  # Skip header
        
        for data_row in rows:
            cells = data_row.find_all('td')
            
            # Cell 1 has the recipe name
            if len(cells) >= 7:
                row_recipe_name = clean_text(cells[1].get_text())
                
                # Check if this row matches our recipe name
                if row_recipe_name == recipe_name:
                    try:
                        base_xp = float(clean_text(cells[2].get_text()))
                        base_steps = int(clean_text(cells[3].get_text()))
                        
                        # Max efficiency is in cells[6]
                        # New format: "150%" means 100% base + 50% bonus
                        # Old format: "50%" means 50% bonus directly
                        max_eff_text = clean_text(cells[6].get_text()).replace('%', '')
                        max_eff_pct = float(max_eff_text)
                        # Wiki now shows 100% as base, so subtract it
                        if max_eff_pct >= 100:
                            max_efficiency = round((max_eff_pct - 100.0) / 100.0, 4)
                        else:
                            max_efficiency = round(max_eff_pct / 100.0, 4)
                        
                        return {
                            'base_xp': base_xp,
                            'base_steps': base_steps,
                            'max_efficiency': max_efficiency
                        }
                    except (ValueError, IndexError) as e:
                        print(f"    ⚠ Error parsing recipe experience: {e}")
                        return None
    
    print(f"    ⚠ Recipe '{recipe_name}' not found in any Recipe Experience table")
    return None


def parse_additional_recipe_outputs(item_name, recipe_name):
    """
    Parse the 'Additional Recipe Outputs' table(s) for a given recipe from its
    cached item wiki page. Handles single-roll drops (e.g. Smithing chest) and
    multi-roll drops (e.g. Silver nugget 'Does 2 rolls' on Smelt a copper bar).

    Recipe pages may have multiple variants (Ore vs Scrap); each variant has its
    own <h3> heading and its own Additional Recipe Outputs table. We walk the
    DOM in order, tracking the current h3 heading, and only accept rows from
    the heading that matches the recipe name.

    Columns in the table (9 cols if Note is present, 8 otherwise):
        0: icon  1: item name  2: item type  3: quantity  4: chance%
        5: odds  6: base rate  7: W.E.A.R.  8: note (optional — "Does N rolls")

    Returns:
        List of drop dicts, each with:
          - item_name (str)
          - item_type (str, e.g. 'Material', 'Container')
          - quantity_min (int), quantity_max (int)
          - chance_percent (float, the wiki's displayed chance — compound for multi-roll)
          - multi_roll_count (int, only when present and > 1)
        Returns None if page not found; [] if page found but no additional outputs
        for this recipe variant.
    """
    from pathlib import Path

    # Reuse the same cache search strategy as parse_recipe_experience_from_item_page
    cache_folders = [
        get_cache_dir('equipment'),
        get_cache_dir('materials'),
        get_cache_dir('consumables'),
    ]

    cache_path = None
    for folder in cache_folders:
        potential_path = folder / (sanitize_filename(item_name) + '.html')
        if potential_path.exists():
            cache_path = potential_path
            break
        potential_path = folder / (sanitize_filename(item_name).replace(' ', '_') + '.html')
        if potential_path.exists():
            cache_path = potential_path
            break

    if not cache_path:
        return None

    html = read_cached_html(cache_path)
    if not html:
        return None

    soup = BeautifulSoup(html, 'html.parser')

    def _parse_chance_percent(text):
        """Parse '13.510%' or '0.400%' -> float. Return None on failure."""
        if not text:
            return None
        cleaned = text.strip().rstrip('%').replace(',', '').strip()
        try:
            return float(cleaned)
        except ValueError:
            return None

    def _parse_quantity_range(text):
        """Parse '1', '1-3', or '1 or more' -> (min, max)."""
        if not text:
            return (1, 1)
        t = text.strip().lower()
        # Range like '1-3' or '1 - 3'
        m = re.search(r'(\d+)\s*[-\u2013]\s*(\d+)', t)
        if m:
            return (int(m.group(1)), int(m.group(2)))
        # '1 or more' — single-roll; the 'more' is produced via multi_roll_count
        m = re.search(r'(\d+)\s+or\s+more', t)
        if m:
            q = int(m.group(1))
            return (q, q)
        # Plain number
        m = re.search(r'(\d+)', t)
        if m:
            q = int(m.group(1))
            return (q, q)
        return (1, 1)

    drops = []
    current_h3 = None  # Current recipe variant heading

    # Walk ALL descendants in document order so we can associate each
    # Additional Recipe Outputs table with its preceding h3 heading.
    for el in soup.find_all(['h3', 'table']):
        if el.name == 'h3':
            current_h3 = clean_text(el.get_text()).strip()
            continue

        # element is a <table>
        caption = el.find('caption')
        if not caption:
            continue
        caption_text = clean_text(caption.get_text()).strip()
        if 'Additional Recipe Outputs' not in caption_text:
            continue

        # Only accept when this table belongs to the requested recipe variant.
        # Recipe page h3 headings use the full recipe name (e.g. "Smelt a copper bar",
        # "Create a copper bar (Scrap)").
        if current_h3 != recipe_name:
            continue

        # Parse rows
        rows = el.find_all('tr')[1:]  # Skip header
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 5:
                continue
            # Columns: 0=icon, 1=item_name, 2=item_type, 3=quantity, 4=chance, 5=odds,
            # 6=base_rate, 7=WEAR, 8=note (optional)
            name_link = cols[1].find('a')
            if name_link:
                name_text = clean_text(name_link.get_text())
            else:
                name_text = clean_text(cols[1].get_text())

            type_link = cols[2].find('a')
            if type_link:
                type_text = clean_text(type_link.get_text())
            else:
                type_text = clean_text(cols[2].get_text())

            qty_min, qty_max = _parse_quantity_range(clean_text(cols[3].get_text()))
            chance_pct = _parse_chance_percent(clean_text(cols[4].get_text()))
            if chance_pct is None or chance_pct <= 0:
                continue

            multi_roll = None
            if len(cols) > 8:
                note_text = clean_text(cols[8].get_text())
                m = re.search(r'[Dd]oes\s+(\d+)\s+rolls?', note_text)
                if m:
                    multi_roll = int(m.group(1))

            # Activity convention: chance_percent is the PER-ROLL probability.
            # The wiki displays the compound "at least one" probability after N rolls,
            # so invert it back to per-roll: per_roll = 1 - (1 - compound)^(1/N).
            # Single-roll drops keep the wiki value as-is.
            stored_chance = chance_pct
            if multi_roll and multi_roll > 1:
                import math as _math
                compound = max(0.0, min(chance_pct / 100.0, 0.99999999))
                per_roll = 1.0 - _math.pow(1.0 - compound, 1.0 / multi_roll)
                # Round to 6 decimals to avoid floating point noise
                stored_chance = round(per_roll * 100.0, 6)

            # Average quantity per roll (min and max are always equal in observed
            # recipes; we keep them in metadata but also expose `quantity` as the
            # per-roll average so existing drop-table consumers keep working).
            avg_qty = (qty_min + qty_max) / 2.0
            if avg_qty.is_integer():
                avg_qty = int(avg_qty)

            drop = {
                'item_name': name_text,
                'item_type': type_text,
                'quantity': avg_qty,
                'quantity_min': qty_min,
                'quantity_max': qty_max,
                'chance_percent': stored_chance,
            }
            if multi_roll is not None and multi_roll > 1:
                drop['multi_roll_count'] = multi_roll
            drops.append(drop)

        # Don't break — a recipe variant could have multiple tables, but in
        # practice there is exactly one. Keep accumulating to be safe, but we
        # only accept tables under the matching h3.

    return drops


def extract_max_efficiency(td):
    """Extract max efficiency as decimal from the min steps cell."""
    text = clean_text(td.get_text())
    # Old format: "66(+50%)" -> extract 50, convert to 0.5
    match = re.search(r'\(\+(\d+\.?\d*)%\)', text)
    if match:
        return float(match.group(1)) / 100.0
    # New format: "150%" means 100% base + 50% bonus -> extract 150, subtract 100, convert to 0.5
    match = re.search(r'(\d+\.?\d*)%', text)
    if match:
        raw = float(match.group(1))
        return round((raw - 100.0) / 100.0, 4) if raw > 100 else 0.0
    return 0.0


def _resolve_drop_item_ref(item_name, item_type=None):
    """
    Resolve an Additional Recipe Output item name to a string reference like
    'Material.SILVER_NUGGET' or 'Container.SMITHING_CHEST'. Returns None if the
    item can't be resolved against any known class.

    Prefers a class hinted by `item_type` (wiki column 'Item Type'), then falls
    back to searching Material, Container, Consumable, Collectible, Item,
    Currency in that order.
    """
    try:
        from util.walkscape_constants import Material, Item, Consumable
    except Exception:
        return None

    try:
        from util.autogenerated.containers import Container
    except Exception:
        Container = None
    try:
        from util.autogenerated.collectibles import Collectible
    except Exception:
        Collectible = None
    try:
        from util.autogenerated.currency import Currency
    except Exception:
        Currency = None

    # Candidates in priority order
    if item_type:
        type_lower = item_type.strip().lower()
    else:
        type_lower = ''

    priority = []
    if 'container' in type_lower and Container is not None:
        priority.append(('Container', Container))
    elif 'collectible' in type_lower and Collectible is not None:
        priority.append(('Collectible', Collectible))
    elif 'consumable' in type_lower:
        priority.append(('Consumable', Consumable))
    elif 'material' in type_lower:
        priority.append(('Material', Material))

    # Fallback search order
    fallback = [
        ('Material', Material),
        ('Container', Container),
        ('Consumable', Consumable),
        ('Collectible', Collectible),
        ('Item', Item),
        ('Currency', Currency),
    ]
    for cls_name, cls_obj in fallback:
        if cls_obj is not None and (cls_name, cls_obj) not in priority:
            priority.append((cls_name, cls_obj))

    target = item_name.strip()
    target_lower = target.lower()
    for cls_name, cls_obj in priority:
        if cls_obj is None:
            continue
        for attr_name in dir(cls_obj):
            if attr_name.startswith('_'):
                continue
            value = getattr(cls_obj, attr_name, None)
            if value is None:
                continue
            # Match by .name attribute (string or enum-ish)
            vname = getattr(value, 'name', None)
            if isinstance(vname, str) and vname.strip().lower() == target_lower:
                return f'{cls_name}.{attr_name}'
    return None


def parse_recipes():
    """Parse all recipes from the cached HTML file."""
    html = download_page(RECIPES_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return []
    soup = BeautifulSoup(html, 'html.parser')
    
    recipes = []
    current_skill = None
    
    # Find all recipe tables
    for table in soup.find_all('table', class_='wikitable'):
        # Check if this is a recipe table (has the right headers)
        headers = table.find_all('th')
        header_text = ' '.join([clean_text(h.get_text()) for h in headers])
        
        if 'Recipe' not in header_text or 'Level' not in header_text:
            continue
        
        # Find the skill heading before this table
        heading = table.find_previous('h2')
        if heading:
            skill_text = clean_text(heading.get_text())
            # Remove "Contents" and numbers
            skill_text = re.sub(r'^\d+\s*', '', skill_text)
            if skill_text and skill_text != 'Contents':
                current_skill = skill_text
        
        # Parse each recipe row
        for row in table.find_all('tr')[1:]:  # Skip header row
            cells = row.find_all('td')
            if len(cells) < 6:
                continue
            
            # Extract data from cells
            # 0: Icon, 1: Recipe Name, 2: Level, 3: Service, 4: Materials, 5: Outputs
            
            # Get recipe name from cell 1
            recipe_name = clean_text(cells[1].get_text())
            
            # Get output item name from the link in cell 5 (RecipeOutputs)
            # Cell 5 has format: "1x Item Name" with links (first is icon, second is item)
            output_links = cells[5].find_all('a')
            output_link = None
            for link in output_links:
                href = link.get('href', '')
                # Skip icon links (File:)
                if '/wiki/File:' not in href:
                    output_link = link
                    break
            
            if not output_link:
                continue
            
            # Get item name from URL (for cache lookup)
            output_item_url = output_link.get('href', '')
            if not output_item_url:
                continue
            
            # Extract item name from URL
            from urllib.parse import unquote
            output_item_url = unquote(output_item_url)
            output_item_url = output_item_url.replace('/Special:MyLanguage/', '/')
            
            # Get the last part of the URL as the item name (for cache lookup)
            output_item_name = output_item_url.split('/')[-1].replace('_', ' ')
            
            # Full URL for reference
            # Full URL for reference
            full_url = 'https://wiki.walkscape.app' + output_item_url
            
            # Get output quantity from cell 5 text
            output_quantity, _ = extract_output_quantity(cells[5])
            
            # Extract service and level
            service, skill, level = extract_service_and_level(cells[3], cells[2])
            
            # Parse materials
            materials = extract_materials(cells[4])
            
            # Use skill from heading if not found in cell
            if not skill:
                skill = current_skill
            
            # Search for cached item page to get XP/steps/efficiency
            print(f"  {skill} {level}: {recipe_name} -> {output_item_name} (x{output_quantity})")
            recipe_exp_data = parse_recipe_experience_from_item_page(output_item_name, recipe_name, full_url, CACHE_DIR)
            
            if recipe_exp_data:
                base_xp = recipe_exp_data['base_xp']
                base_steps = recipe_exp_data['base_steps']
                max_efficiency = recipe_exp_data['max_efficiency']
            else:
                # Fallback: try to get from main page if available (old format)
                try:
                    if len(cells) >= 10:
                        base_xp = float(clean_text(cells[5].get_text()))
                        base_steps = int(clean_text(cells[6].get_text()))
                        max_efficiency = extract_max_efficiency(cells[8])
                    else:
                        # No data available
                        print(f"    ⚠ No recipe experience data found")
                        base_xp = 0
                        base_steps = 0
                        max_efficiency = 0.0
                except (ValueError, IndexError) as e:
                    validator.add_item_issue(output_item_name, [f"Failed to parse numeric values: {e}"])
                    continue
            
            # Try to resolve output item to get a string reference
            output_obj, output_type = resolve_output_item(output_item_name)
            
            # Build string reference for output_item
            output_item_ref = None
            if output_obj and output_type:
                # Find the enum name for the object
                try:
                    from util.walkscape_constants import Material, Item, Consumable
                    
                    if output_type == 'Material':
                        for attr_name in dir(Material):
                            if not attr_name.startswith('_'):
                                if getattr(Material, attr_name, None) is output_obj:
                                    output_item_ref = f'Material.{attr_name}'
                                    break
                    elif output_type == 'Item':
                        for attr_name in dir(Item):
                            if not attr_name.startswith('_'):
                                if getattr(Item, attr_name, None) is output_obj:
                                    output_item_ref = f'Item.{attr_name}'
                                    break
                    elif output_type == 'Consumable':
                        for attr_name in dir(Consumable):
                            if not attr_name.startswith('_'):
                                if getattr(Consumable, attr_name, None) is output_obj:
                                    output_item_ref = f'Consumable.{attr_name}'
                                    break
                except:
                    pass
            
            recipe = {
                'name': recipe_name,  # Use full recipe name like "Cut a birch plank"
                'output_item_name': output_item_name,  # Item name for cache lookup
                'output_item_ref': output_item_ref,  # String reference like 'Material.PINE_PLANK' or 'Item.WOODEN_SHIELD'
                'skill': skill,
                'level': level,
                'service': service,
                'quantity': output_quantity,
                'materials': materials,  # Now array of arrays
                'base_xp': base_xp,
                'base_steps': base_steps,
                'max_efficiency': max_efficiency,
                'drop_table': None,  # Populated below from wiki 'Additional Recipe Outputs' table
            }
            
            # Debug output
            if level is None:
                print(f"    DEBUG: Recipe dict has level=None for {recipe_name}")

            # Parse the 'Additional Recipe Outputs' table from the cached item page
            # (e.g. Silver nugget 13.510% 'Does 2 rolls' on Smelt a copper bar).
            additional_outputs = parse_additional_recipe_outputs(output_item_name, recipe_name)
            if additional_outputs:
                # Resolve item_name -> item_ref for each drop so downstream code can
                # look up material/container/etc. values. Fall back to item_ref=None
                # when resolution fails (rendering still works off item_name).
                resolved_drops = []
                for drop in additional_outputs:
                    resolved = dict(drop)
                    resolved['item_ref'] = _resolve_drop_item_ref(
                        drop['item_name'], drop.get('item_type')
                    )
                    resolved_drops.append(resolved)
                    multi_note = (
                        f" (multi_roll_count={resolved.get('multi_roll_count')})"
                        if resolved.get('multi_roll_count')
                        else ''
                    )
                    print(
                        f"    + drop: {resolved['item_name']} "
                        f"{resolved['chance_percent']:.3f}%{multi_note}"
                    )
                recipe['drop_table'] = resolved_drops

            # Validate materials
            for group in materials:
                missing_materials = [item for qty, item in group if isinstance(item, str)]
                if missing_materials:
                    validator.add_item_issue(recipe_name, [f"Missing materials: {', '.join(missing_materials)}"])
            
            recipes.append(recipe)
    
    return recipes

def generate_python_module(recipes):
    """Generate the recipes.py module."""
    output_file = get_output_file('recipes.py')
    
    def clean_recipe_name_for_enum(name):
        """
        Clean recipe name to create a better enum name.
        Removes common prefixes like "Craft a", "Make a", "Smelt a", etc.
        Checks RECIPE_NAME_OVERRIDES for custom mappings.
        """
        # Remove common prefixes
        prefixes = [
            'Craft a ', 'Craft an ', 'Craft ',
            'Make a ', 'Make an ', 'Make ',
            'Smelt a ', 'Smelt an ', 'Smelt into ', 'Smelt ',
            'Create a ', 'Create an ', 'Create ',
            'Cut a ', 'Cut an ', 'Cut into ', 'Cut ',
            'Fry a ', 'Fry an ', 'Fry ',
            'Bake a ', 'Bake an ', 'Bake ',
            'Brew ', 'Cook into ', 'Cook ',
            'Weave a ', 'Weave an ', 'Weave ',
            'Spin ', 'Assemble ', 'Prepare a ', 'Prepare an ', 'Prepare ',
            'Mix ', 'Harden ', 'Upcycle ',
            'Forge into ', 'Ferment ', 'Distill ', 'Fletch ', 
            'Woodwork a '
        ]
        
        cleaned = name
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):]
                break
        
        # Check for override mapping (case-insensitive)
        cleaned_lower = cleaned.lower()
        for override_key, override_value in RECIPE_NAME_OVERRIDES.items():
            if cleaned_lower == override_key.lower():
                return override_value
        
        return cleaned
    
    # First pass: identify which cleaned names would be duplicates
    cleaned_name_counts = {}
    for recipe in recipes:
        cleaned_name = clean_recipe_name_for_enum(recipe['name'])
        if '(' in cleaned_name and ')' in cleaned_name:
            base_name = cleaned_name[:cleaned_name.index('(')].strip()
            suffix = cleaned_name[cleaned_name.index('(')+1:cleaned_name.index(')')].strip()
            enum_name = f"{base_name}_{suffix}".upper()
        else:
            enum_name = cleaned_name.upper()
        enum_name = enum_name.replace(' ', '_').replace('-', '_').replace("'", '').replace('.', '')
        
        cleaned_name_counts[enum_name] = cleaned_name_counts.get(enum_name, 0) + 1
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Auto-generated recipe data from Walkscape wiki.', 'scrape_recipes.py')
        write_imports(f, [
            'from dataclasses import dataclass',
            'from typing import List, Tuple, Optional, Union',
            'from util.walkscape_constants import Material, Item, Consumable',
        ])
        
        lines = [
        '@dataclass',
        'class RecipeInstance:',
        '    """Represents a crafting recipe."""',
        '    name: str',
        '    output_item: Optional[str]  # String reference like "Material.PINE_PLANK" or None',
        '    skill: str',
        '    level: int',
        '    service: str',
        '    quantity: int  # Output quantity (e.g., Beer outputs 5)',
        '    materials: List[List[Tuple[int, object]]]  # Array of alternative groups: [[(qty, mat1), (qty, mat2)], [(qty, mat3)]]',
        '    base_xp: float  # Can be decimal like 21.5',
        '    base_steps: int',
        '    max_efficiency: float  # Decimal bonus (0.5 = 50%, can be decimal like 0.215 = 21.5%)',
        '    drop_table: Optional[List] = None  # Secondary drops (e.g., pet eggs) — list of dicts with item_name, chance_percent, quantity',
        '    ',
        '    def get_output_item_object(self):',
        '        """Resolve output_item string reference to actual Item, Material, or Consumable object."""',
        '        if not self.output_item:',
        '            return None',
        '        ',
        '        # Parse the string reference like "Material.PINE_PLANK"',
        '        if "." in self.output_item:',
        '            class_name, attr_name = self.output_item.split(".", 1)',
        '            if class_name == "Material":',
        '                return getattr(Material, attr_name, None)',
        '            elif class_name == "Item":',
        '                return getattr(Item, attr_name, None)',
        '            elif class_name == "Consumable":',
        '                return getattr(Consumable, attr_name, None)',
        '        ',
        '        return None',
        ''
        ]
        # Generate direct instantiation like equipment.py
        seen_names = {}
        
        for recipe in recipes:
            name = recipe['name']
            skill = recipe['skill']
            
            # Clean the name first
            cleaned_name = clean_recipe_name_for_enum(name)
            
            # Convert to enum name
            if '(' in cleaned_name and ')' in cleaned_name:
                base_name = cleaned_name[:cleaned_name.index('(')].strip()
                suffix = cleaned_name[cleaned_name.index('(')+1:cleaned_name.index(')')].strip()
                enum_name = f"{base_name}_{suffix}".upper()
            else:
                enum_name = cleaned_name.upper()
            
            enum_name = enum_name.replace(' ', '_').replace('-', '_').replace("'", '').replace('.', '')
            
            # Only add skill suffix if this name appears multiple times
            if cleaned_name_counts.get(enum_name, 0) > 1:
                enum_name = f"{enum_name}_{skill.upper()}"
            
            # Handle any remaining duplicates with counter
            if enum_name in seen_names:
                count = seen_names[enum_name]
                seen_names[enum_name] += 1
                enum_name = f"{enum_name}_{count}"
            else:
                seen_names[enum_name] = 1
            
            # Format materials as array of arrays (for alternatives)
            # Structure: [[(qty, Material.X), (qty, Material.Y)], [(qty, Material.Z)]]
            materials_str = '[\n'
            for group in recipe['materials']:
                materials_str += '        ['  # Start alternative group
                for i, (qty, item) in enumerate(group):
                    if isinstance(item, str):
                        # Missing material - store as None with comment
                        materials_str += f'({qty}, None)'  # Missing: {item}
                    else:
                        # Found material - store direct reference
                        obj_ref = None
                        try:
                            from util.autogenerated.materials import Material
                            from util.autogenerated.equipment import Item
                            from util.autogenerated.consumables import Consumable
                            # Find which class it belongs to
                            for attr_name in dir(Material):
                                if not attr_name.startswith('_'):
                                    if getattr(Material, attr_name, None) is item:
                                        obj_ref = f'Material.{attr_name}'
                                        break
                            if not obj_ref:
                                for attr_name in dir(Item):
                                    if not attr_name.startswith('_'):
                                        if getattr(Item, attr_name, None) is item:
                                            obj_ref = f'Item.{attr_name}'
                                            break
                            if not obj_ref:
                                for attr_name in dir(Consumable):
                                    if not attr_name.startswith('_'):
                                        if getattr(Consumable, attr_name, None) is item:
                                            obj_ref = f'Consumable.{attr_name}'
                                            break
                        except:
                            pass
                        
                        if obj_ref:
                            materials_str += f'({qty}, {obj_ref})'
                        else:
                            materials_str += f'({qty}, None)'  # Could not resolve
                    
                    # Add comma if not last item in group
                    if i < len(group) - 1:
                        materials_str += ', '
                
                materials_str += '],\n'  # End alternative group
            materials_str += '    ]'
            
            # Format output_item as string reference or None
            output_item_str = repr(recipe['output_item_ref']) if recipe['output_item_ref'] else 'None'
            
            # Direct instantiation
            drop_table = recipe.get('drop_table')
            drop_line = ''
            if drop_table:
                # Emit as a readable multi-line list of dict literals.
                _drop_parts = []
                for _drop in drop_table:
                    _items = []
                    # Stable field order for readability
                    _items.append(f"'item_name': {repr(_drop['item_name'])}")
                    if 'item_ref' in _drop:
                        _items.append(f"'item_ref': {repr(_drop['item_ref'])}")
                    if 'item_type' in _drop:
                        _items.append(f"'item_type': {repr(_drop['item_type'])}")
                    if 'quantity' in _drop:
                        _items.append(f"'quantity': {_drop['quantity']}")
                    if 'quantity_min' in _drop:
                        _items.append(f"'quantity_min': {_drop['quantity_min']}")
                    if 'quantity_max' in _drop:
                        _items.append(f"'quantity_max': {_drop['quantity_max']}")
                    if 'chance_percent' in _drop:
                        _items.append(f"'chance_percent': {_drop['chance_percent']}")
                    if 'multi_roll_count' in _drop:
                        _items.append(f"'multi_roll_count': {_drop['multi_roll_count']}")
                    _drop_parts.append('        {' + ', '.join(_items) + '}')
                drop_line = ',\n    drop_table=[\n' + ',\n'.join(_drop_parts) + '\n    ]'
            lines.extend([
                '',
                f'{enum_name} = RecipeInstance(',
                f'    name={repr(recipe["name"])},',
                f'    output_item={output_item_str},',
                f'    skill={repr(recipe["skill"])},',
                f'    level={recipe["level"]},',
                f'    service={repr(recipe["service"])},',
                f'    quantity={recipe["quantity"]},',
                f'    materials={materials_str},',
                f'    base_xp={recipe["base_xp"]},',
                f'    base_steps={recipe["base_steps"]},',
                f'    max_efficiency={recipe["max_efficiency"]}{drop_line}',
                ')'
            ])
        
        lines.extend([
        '',
        '# Build lookup dictionaries from module globals',
        'RECIPES_BY_NAME = {',
        '    r.name: r for r in globals().values()',
        '    if isinstance(r, RecipeInstance)',
        '}',
        '',
        'RECIPES_BY_SKILL = {}',
        'for _r in RECIPES_BY_NAME.values():',
        '    if _r.skill not in RECIPES_BY_SKILL:',
        '        RECIPES_BY_SKILL[_r.skill] = []',
        '    RECIPES_BY_SKILL[_r.skill].append(_r)',
        'del _r',
        '',
        '# Enum-style access',
        'class Recipe:',
        '    """Enum-style access to recipes."""',
        ])
        
        # Reset seen_names for Recipe class generation
        seen_names_for_class = {}
        
        for recipe in recipes:
            cleaned_name = clean_recipe_name_for_enum(recipe['name'])
            skill = recipe['skill']
            
            if '(' in cleaned_name and ')' in cleaned_name:
                base = cleaned_name[:cleaned_name.index('(')].strip()
                suffix = cleaned_name[cleaned_name.index('(')+1:cleaned_name.index(')')].strip()
                enum_name = f"{base}_{suffix}".upper().replace(' ', '_').replace('-', '_').replace("'", '').replace('.', '')
            else:
                enum_name = cleaned_name.upper().replace(' ', '_').replace('-', '_').replace("'", '').replace('.', '')
            
            # Only add skill suffix if this name appears multiple times
            if cleaned_name_counts.get(enum_name, 0) > 1:
                enum_name = f"{enum_name}_{skill.upper()}"
            
            # Handle any remaining duplicates
            if enum_name in seen_names_for_class:
                count = seen_names_for_class[enum_name]
                seen_names_for_class[enum_name] += 1
                enum_name = f"{enum_name}_{count}"
            else:
                seen_names_for_class[enum_name] = 1
            
            lines.append(f'    {enum_name} = RECIPES_BY_NAME[{repr(recipe["name"])}]')

        write_lines(f, lines)
    
    print(f"\n✓ Generated {output_file} with {len(recipes)} recipes")

if __name__ == '__main__':
    # Ensure cache directory exists
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    recipes = parse_recipes()
    print(f"\nFound {len(recipes)} recipes")
    generate_python_module(recipes)
    
    # Report validation issues
    validator.report()

    # Refresh stats_report precomputed tables after scrape completes.
    # See util/stats_report/ for details. No-op if sessions.db not present.
    try:
        from util.stats_report.precompute.scraper_hook import refresh_after_scrape
        refresh_after_scrape()
    except Exception as _e:
        print(f"[stats_report precompute] hook failed: {_e}")
