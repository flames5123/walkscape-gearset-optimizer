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
        
        material_groups = []
        for alt in alternatives:
            # Find all materials in this alternative
            matches = re.findall(r'(\d+)x\s+([A-Za-z\s\(\)\']+?)(?=\s*\d+x|$)', alt)
            
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
                material_groups.append(group)
    else:
        # No alternatives - all materials are required (one group)
        matches = re.findall(r'(\d+)x\s+([A-Za-z\s\(\)\']+?)(?=\s*\d+x|$)', text)
        
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
    
    # Find "Primary Recipe Output" h2 heading
    recipe_heading = soup.find('h2', id='Primary_Recipe_Output')
    if not recipe_heading:
        return None
    
    # Find the table with caption "Recipe Experience" after this heading
    current = recipe_heading.parent
    while current:
        current = current.find_next_sibling()
        if not current:
            break
        
        # Check if this is a table with "Recipe Experience" caption
        if current.name == 'table':
            caption = current.find('caption')
            if caption and 'Recipe Experience' in caption.get_text():
                # Found the table! Now find the row that matches our recipe name
                rows = current.find_all('tr')[1:]  # Skip header
                
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
                                
                                # Max efficiency is in cells[6] as a percentage like "50%"
                                max_eff_text = clean_text(cells[6].get_text()).replace('%', '')
                                max_eff_pct = float(max_eff_text)
                                # Convert percentage to decimal (50% -> 0.5, 60% -> 0.6)
                                max_efficiency = round(max_eff_pct / 100.0, 2)
                                
                                return {
                                    'base_xp': base_xp,
                                    'base_steps': base_steps,
                                    'max_efficiency': max_efficiency
                                }
                            except (ValueError, IndexError) as e:
                                print(f"    ⚠ Error parsing recipe experience: {e}")
                                return None
                
                # If we didn't find a matching row, return None
                print(f"    ⚠ Recipe '{recipe_name}' not found in Recipe Experience table")
                return None
        
        # Stop if we hit another h2
        if current.name == 'h2':
            break
    
    return None


def extract_max_efficiency(td):
    """Extract max efficiency as decimal from the min steps cell."""
    text = clean_text(td.get_text())
    # Pattern: "66(+50%)" or "66(+21.5%)" -> extract 50 or 21.5, convert to 0.5 or 0.215
    match = re.search(r'\(\+(\d+\.?\d*)%\)', text)
    if match:
        return float(match.group(1)) / 100.0  # Convert to decimal
    return 0.0

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
            
            recipe = {
                'name': recipe_name,  # Use full recipe name like "Cut a birch plank"
                'output_item': output_item_name,  # Item name for cache lookup
                'skill': skill,
                'level': level,
                'service': service,
                'quantity': output_quantity,  # NEW: output quantity
                'materials': materials,  # Now array of arrays
                'base_xp': base_xp,
                'base_steps': base_steps,
                'max_efficiency': max_efficiency
            }
            
            # Debug output
            if level is None:
                print(f"    DEBUG: Recipe dict has level=None for {recipe_name}")
            
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
        """
        # Remove common prefixes
        prefixes = [
            'Craft a ', 'Craft an ', 'Craft ',
            'Make a ', 'Make an ', 'Make ',
            'Smelt a ', 'Smelt an ', 'Smelt ',
            'Create a ', 'Create an ', 'Create ',
            'Cut a ', 'Cut an ', 'Cut into ', 'Cut ',
            'Fry a ', 'Fry an ', 'Fry ',
            'Bake a ', 'Bake an ', 'Bake ',
            'Brew ', 'Cook into ', 'Cook ',
            'Weave a ', 'Weave an ', 'Weave ',
            'Spin ', 'Assemble ', 'Prepare a ', 'Prepare an ', 'Prepare ',
            'Mix ', 'Harden ', 'Upcycle ',
            'Smelt into ', 'Forge into ',
        ]
        
        cleaned = name
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):]
                break
        
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
            'from util.autogenerated.materials import Material', 
            'from util.autogenerated.equipment import Item',
            'from util.autogenerated.consumables import Consumable',
        ])
        
        lines = [
        '@dataclass',
        'class RecipeInstance:',
        '    """Represents a crafting recipe."""',
        '    name: str',
        '    skill: str',
        '    level: int',
        '    service: str',
        '    quantity: int  # Output quantity (e.g., Beer outputs 5)',
        '    materials: List[List[Tuple[int, object]]]  # Array of alternative groups: [[(qty, mat1), (qty, mat2)], [(qty, mat3)]]',
        '    base_xp: float  # Can be decimal like 21.5',
        '    base_steps: int',
        '    max_efficiency: float  # Decimal bonus (0.5 = 50%, can be decimal like 0.215 = 21.5%)',
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
                            from util.walkscape_constants import Material, Item, Consumable
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
            
            # Direct instantiation
            lines.extend([
                '',
                f'{enum_name} = RecipeInstance(',
                f'    name={repr(recipe["name"])},',
                f'    skill={repr(recipe["skill"])},',
                f'    level={recipe["level"]},',
                f'    service={repr(recipe["service"])},',
                f'    quantity={recipe["quantity"]},',
                f'    materials={materials_str},',
                f'    base_xp={recipe["base_xp"]},',
                f'    base_steps={recipe["base_steps"]},',
                f'    max_efficiency={recipe["max_efficiency"]}',
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
        'for r in RECIPES_BY_NAME.values():',
        '    if r.skill not in RECIPES_BY_SKILL:',
        '        RECIPES_BY_SKILL[r.skill] = []',
        '    RECIPES_BY_SKILL[r.skill].append(r)',
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
