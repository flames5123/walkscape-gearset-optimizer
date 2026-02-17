#!/usr/bin/env python3
"""
Scrape Item Finding Items from Walkscape wiki and generate item_finding.py
Maps categories like "random gem" to actual items with their drop chances
"""

from bs4 import BeautifulSoup
from scraper_utils import *
import re

# Configuration
RESCRAPE = False
ITEM_FINDING_URL = 'https://wiki.walkscape.app/wiki/Item_Finding_Items'
CACHE_FILE = get_cache_file('item_finding_cache.html')

# Categories to skip (these map to single items and should use direct references)
SKIP_CATEGORIES = {
    'bird nest',
    'coin pouch',
}

# Create validator instance
validator = ScraperValidator()


def parse_item_finding_categories():
    """Parse item finding categories and their items from cached HTML."""
    html = download_page(ITEM_FINDING_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return {}
    
    soup = BeautifulSoup(html, 'html.parser')
    categories = {}
    
    # Find all h2 headings (category names)
    for heading in soup.find_all(['h2', 'h3']):
        heading_text = heading.get_text().strip()
        
        # Skip edit links and empty headings
        if not heading_text or '[edit]' in heading_text:
            continue
        
        # Clean heading text
        category_name = heading_text.replace('[edit]', '').strip()
        
        # Skip non-category headings
        if category_name in ['Contents', 'Navigation', 'See also']:
            continue
        
        # Skip categories that map to single items
        if category_name.lower() in SKIP_CATEGORIES:
            print(f"  Skipping: {category_name} (direct item)")
            continue
        
        print(f"  Found category: {category_name}")
        
        # Find the table after this heading
        current = heading.parent
        table = None
        while current:
            current = current.find_next_sibling()
            if not current:
                break
            if current.name == 'table' and 'wikitable' in current.get('class', []):
                table = current
                break
            # Stop if we hit another heading
            if current.name in ['h2', 'h3']:
                break
        
        if not table:
            print(f"    ⚠ No table found for {category_name}")
            continue
        
        # Parse the table
        items = []
        rows = table.find_all('tr')[1:]  # Skip header
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) < 4:
                continue
            
            # Extract item name from SECOND cell (first is icon)
            item_link = cells[1].find('a')
            if not item_link:
                continue
            
            item_name = item_link.get_text().strip()
            
            # Extract quantity from THIRD cell
            quantity_text = cells[2].get_text().strip()
            quantity_match = re.match(r'(\d+)(?:-(\d+))?', quantity_text)
            if quantity_match:
                min_qty = int(quantity_match.group(1))
                max_qty = int(quantity_match.group(2)) if quantity_match.group(2) else min_qty
            else:
                min_qty = max_qty = 1
            
            # Extract chance from FOURTH cell
            chance_text = cells[3].get_text().strip()
            chance_match = re.search(r'([\d.]+)%', chance_text)
            if chance_match:
                chance = float(chance_match.group(1))
            else:
                chance = 0.0
            
            items.append({
                'name': item_name,
                'min_qty': min_qty,
                'max_qty': max_qty,
                'chance': chance
            })
        
        if items:
            # Convert category name to identifier
            category_id = category_name.lower().replace(' ', '_').replace("'", "")
            categories[category_id] = {
                'display_name': category_name,
                'items': items
            }
            print(f"    ✓ Parsed {len(items)} items")
    
    return categories


def generate_module(categories):
    """Generate the item_finding.py module."""
    output_file = get_output_file('item_finding.py')
    
    # Build item lookups once for resolving references
    from util.misc_utils import build_all_item_lookups, resolve_item_reference
    lookups = build_all_item_lookups()
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Item Finding Items - category to item mappings', 'scrape_item_finding.py')
        write_imports(f, [
            'from typing import List',
            'from util.item_utils import Quantity, DropEntry'
        ])
        
        lines = [
            '',
            'class CategoryInstance:',
            '    """Represents an item finding category with its drop table."""',
            '    def __init__(self, name: str, drops: List[DropEntry]):',
            '        self.name = name',
            '        self.drops = drops  # List of DropEntry with relative chances',
            '    ',
            '    def expand_with_chance(self, base_chance: float) -> List[DropEntry]:',
            '        """',
            '        Expand this category to actual drops with adjusted chances.',
            '        ',
            '        Args:',
            '            base_chance: Base chance from equipment (e.g., 0.5 for 0.5%)',
            '        ',
            '        Returns:',
            '            List of DropEntry with actual chances (base_chance * relative_chance)',
            '        """',
            '        expanded = []',
            '        for drop in self.drops:',
            '            # Calculate actual chance: base_chance * (drop_chance / 100)',
            '            actual_chance = base_chance * (drop.chance_percent / 100.0)',
            '            expanded.append(DropEntry(',
            '                item_name=drop.item_name,',
            '                item_ref=drop.item_ref,',
            '                quantity=drop.quantity,',
            '                chance_percent=actual_chance',
            '            ))',
            '        return expanded',
            '    ',
            '    def __repr__(self):',
            '        return f"CategoryInstance({self.name}, {len(self.drops)} items)"',
            '',
            '',
            'class ItemFindingCategory:',
            '    """All item finding categories."""',
            '    ',
        ]
        
        # Generate category constants
        for category_id, category_data in sorted(categories.items()):
            category_const = name_to_enum(category_id)
            
            # Build drops list
            drops_list = []
            for item in category_data['items']:
                # Resolve item reference
                item_ref = resolve_item_reference(item['name'], lookups)
                if not item_ref:
                    print(f"    ⚠ Could not resolve: {item['name']}")
                    item_ref = None
                
                drops_list.append(
                    f"DropEntry(item_name={repr(item['name'])}, "
                    f"item_ref={repr(item_ref)}, "
                    f"quantity=Quantity(min_qty={item['min_qty']}, max_qty={item['max_qty']}), "
                    f"chance_percent={item['chance']})"
                )
            
            lines.append(f"    {category_const} = CategoryInstance(")
            lines.append(f"        name={repr(category_data['display_name'])},")
            lines.append(f"        drops=[")
            for drop_str in drops_list:
                lines.append(f"            {drop_str},")
            lines.append('        ]')
            lines.append('    )')
            lines.append('')
        
        lines.append('')
        
        f.write('\n'.join(lines))
    
    print(f"✓ Generated {output_file} with {len(categories)} categories")


if __name__ == '__main__':
    print("Scraping Item Finding Items...")
    categories = parse_item_finding_categories()
    print(f"\nFound {len(categories)} categories")
    
    if categories:
        generate_module(categories)
    
    validator.report()
