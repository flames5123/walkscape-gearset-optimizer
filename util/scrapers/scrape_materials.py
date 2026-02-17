#!/usr/bin/env python3
"""
Scrape materials data from Walkscape wiki and generate materials.py.

Extracts material names, keywords, values, and special sale information.
Creates separate entries for regular and fine versions of each material.
"""

# Third-party imports
from bs4 import BeautifulSoup

# Local imports
from scraper_utils import *
import re

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
SCAN_FOLDER_FOR_NEW_ITEMS = True  # Scan cache folder for additional items
MATERIALS_URL = 'https://wiki.walkscape.app/wiki/Materials'
CACHE_FILE = get_cache_file('materials_cache.html')
CACHE_DIR = get_cache_dir('materials')

# Create validator instance
validator = ScraperValidator()

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_material_page(material_url):
    """Download individual material page with retry logic for Lua errors."""
    filename = sanitize_filename(material_url.split('/')[-1]) + '.html'
    cache_path = CACHE_DIR / filename
    
    # Use shared download_with_retry function
    return download_with_retry(material_url, cache_path, max_retries=3, delay=5)


def extract_value_from_page(html_content):
    """Extract value and special sale info from material page"""
    soup = BeautifulSoup(html_content, 'html.parser')
    value = 0
    fine_value = 0
    special_sell = None
    special_sell_fine = None
    
    # Extract regular value from infobox
    infobox = soup.find('table', class_='ItemInfobox')
    if infobox:
        for row in infobox.find_all('tr'):
            header = row.find('th')
            if header:
                header_text = header.get_text()
                if 'Value' in header_text and 'Fine Value' not in header_text:
                    value_cell = row.find('td')
                    if value_cell:
                        val_match = re.search(r'(\d+)', value_cell.get_text())
                        if val_match:
                            value = int(val_match.group(1))
                elif 'Fine Value' in header_text:
                    value_cell = row.find('td')
                    if value_cell:
                        val_match = re.search(r'(\d+)', value_cell.get_text())
                        if val_match:
                            fine_value = int(val_match.group(1))
    
    # Extract special sale info
    special_sale_heading = soup.find('h2', id='Special_Sale')
    if special_sale_heading:
        # Find the table after the Special Sale heading
        table = special_sale_heading.find_next('table', class_='wikitable')
        if table:
            rows = table.find_all('tr')[1:]  # Skip header
            for row in rows:
                cells = row.find_all('td')
                if len(cells) >= 2:
                    # Rows can have different cell counts due to rowspan
                    # First row (Normal): 6 cells - Shop Icon, Shop Name, Location, Region, Item Type, Value
                    # Second row (Fine): 2 cells - Item Type, Value (others use rowspan from first row)
                    
                    # Item Type is always second-to-last cell, Value is always last cell
                    item_type_cell = cells[-2]
                    value_cell = cells[-1]
                    
                    # Check if this is Normal or Fine quality by looking at the image title
                    is_fine = False
                    quality_img = item_type_cell.find('img')
                    if quality_img and quality_img.has_attr('alt'):
                        # alt text is like "Material 0 Normal" or "Material 1 Fine"
                        is_fine = 'Fine' in quality_img['alt']
                    
                    # Extract quantity from text (after the image)
                    cell_text = value_cell.get_text(strip=True)
                    quantity_match = re.search(r'(\d+)', cell_text)
                    if quantity_match:
                        quantity = int(quantity_match.group(1))
                        
                        # Extract item name from link or image
                        item_name = None
                        item_link = value_cell.find('a')
                        if item_link:
                            # Try title attribute first
                            if item_link.has_attr('title'):
                                item_name = clean_text(item_link['title'])
                            # Try link text as fallback
                            elif item_link.get_text(strip=True):
                                item_name = clean_text(item_link.get_text(strip=True))
                            # Try image alt text
                            else:
                                img = item_link.find('img')
                                if img and img.has_attr('alt'):
                                    item_name = clean_text(img['alt'])
                        
                        if item_name:
                            if is_fine:
                                special_sell_fine = (quantity, item_name)
                            else:
                                special_sell = (quantity, item_name)
    
    return value, fine_value, special_sell, special_sell_fine

# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def extract_materials(html_content):
    """Extract material names and keywords from Materials page."""
    soup = BeautifulSoup(html_content, 'html.parser')
    materials = []
    
    # Ensure cache directory exists
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    # Find all wikitable tables
    tables = soup.find_all('table', class_='wikitable')
    
    for table in tables:
        rows = table.find_all('tr')[1:]  # Skip header
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) >= 2:
                # Material name and URL
                name_link = cells[1].find('a')
                if name_link:
                    material_name = name_link.get_text().strip()
                    
                    # Decode URL encoding in the name (e.g., %27 -> ')
                    from urllib.parse import unquote
                    material_name = unquote(material_name)
                    
                    material_url = 'https://wiki.walkscape.app' + name_link['href']
                    
                    # Decode URL encoding in the URL
                    material_url = unquote(material_url)
                    
                    print(f"  Processing: {material_name}")
                    
                    # Extract keywords from table - handle <br/> separated keywords
                    keywords = []
                    if len(cells) >= 3:
                        keyword_cell = cells[2]
                        
                        # Find all keyword links (they have "Keyword" in the href)
                        keyword_links = keyword_cell.find_all('a', href=lambda x: x and 'Keyword' in x)
                        for link in keyword_links:
                            # Get the text from the link
                            kw_text = link.get_text().strip()
                            if kw_text and kw_text.lower() not in ['none', '']:
                                keywords.append(kw_text)
                        
                        # If no keyword links found, try getting all text
                        if not keywords:
                            keyword_text = keyword_cell.get_text(separator=', ', strip=True)
                            if keyword_text:
                                for kw in keyword_text.split(','):
                                    kw_clean = kw.strip()
                                    if kw_clean and kw_clean.lower() not in ['none', '']:
                                        keywords.append(kw_clean)
                    
                    # Download material page to get value and special sale
                    material_html = download_material_page(material_url)
                    if material_html:
                        value, fine_value, special_sell, special_sell_fine = extract_value_from_page(material_html)
                    else:
                        value, fine_value, special_sell, special_sell_fine = 0, 0, None, None
                    
                    # Add regular material
                    materials.append({
                        'name': material_name,  # Already decoded above
                        'keywords': keywords,
                        'value': value,
                        'special_sell': special_sell  # Only use normal special_sell, not fine
                    })
                    
                    # Add fine version
                    materials.append({
                        'name': material_name + ' (Fine)',  # Already decoded above
                        'keywords': keywords,
                        'value': fine_value if fine_value else value,
                        'special_sell': special_sell_fine  # Only use fine special_sell
                    })
    
    return materials


def resolve_special_sell_item(item_name, all_materials):
    """Resolve item name to Material or Currency reference string"""
    # Convert item name to constant name format
    const_name = item_name.upper().replace(' ', '_').replace("'", '').replace('-', '_').replace('(', '').replace(')', '')
    
    # Check if this is a currency first
    try:
        from util.autogenerated.currency import Currency
        for attr_name in dir(Currency):
            if not attr_name.startswith('_'):
                currency = getattr(Currency, attr_name)
                if hasattr(currency, 'name') and currency.name.lower() == item_name.lower():
                    return f'Currency.{attr_name}'
    except ImportError:
        pass
    
    # Check if this material exists in our list
    for mat in all_materials:
        mat_const = mat['name'].upper().replace(' ', '_').replace("'", '').replace('-', '_').replace('(', '').replace(')', '')
        if mat_const == const_name:
            return f'Material.{const_name}'
    
    # If not found, return None (will be resolved later or is an equipment item)
    return None

# ============================================================================
# MODULE GENERATION
# ============================================================================

def generate_materials_py(materials):
    """Generate the materials.py file"""
    output_file = get_output_file('materials.py')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Auto-generated materials data from Walkscape wiki', 'scrape_materials.py')
        write_imports(f, ['from typing import List, Optional, Tuple, Any'])
        
        lines = [
        'class MaterialInstance:',
        '    """Base class for material instances"""',
        '    def __init__(self, name: str, keywords: List[str], value: int, special_sell: Optional[Tuple[int, str]] = None):',
        '        self.name = name',
        '        self.keywords = keywords',
        '        self.value = value  # Coin value',
        '        self._special_sell_ref = special_sell  # (quantity, "Material.ENUM_NAME") or None',
        '        self._special_sell_cached = None',
        '    ',
        '    @property',
        '    def special_sell(self):',
        '        """Lazily resolve special_sell reference."""',
        '        if self._special_sell_cached is not None or self._special_sell_ref is None:',
        '            return self._special_sell_cached',
        '        qty, ref_str = self._special_sell_ref',
        '        # Resolve the reference - import Currency if needed',
        '        if ref_str.startswith("Currency."):',
        '            from util.autogenerated.currency import Currency',
        '        self._special_sell_cached = (qty, eval(ref_str))',
        '        return self._special_sell_cached',
        '    ',
        '    def __repr__(self):',
        '        return f"MaterialInstance({self.name})"',
        '    ',
        '    def has_fine_material(self) -> bool:',
        '        """Check if this material has a fine counterpart."""',
        '        # Convert material name to enum format',
        '        enum_name = self.name.upper().replace(" ", "_").replace("(", "").replace(")", "").replace("-", "_").replace("\'", "")',
        '        fine_enum_name = enum_name + "_FINE"',
        '        ',
        '        # Check if fine version exists',
        '        return hasattr(Material, fine_enum_name)',
        '',
        '',
        'class Material:',
        '    """All materials"""',
        '    ',
        ]
        # Add materials
        for material in materials:
            # Decode any URL encoding in the name first
            from urllib.parse import unquote
            clean_name = unquote(material['name'])
            
            # Create constant name from the decoded name
            const_name = clean_name.upper().replace(' ', '_').replace("'", '').replace('-', '_').replace('(', '').replace(')', '')
            
            # Format special_sell
            special_sell_str = 'None'
            if material.get('special_sell'):
                qty, item_ref = material['special_sell']
                if item_ref:
                    # Check if it's a Material reference or a plain string
                    if item_ref.startswith('Material.'):
                        # It's a reference, wrap in quotes so it can be eval'd
                        special_sell_str = f'({qty}, "{item_ref}")'
                    else:
                        # It's a plain string, escape and quote it properly
                        escaped_name = item_ref.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'")
                        special_sell_str = f'({qty}, "{escaped_name}")'
                else:
                    special_sell_str = 'None'
            
            # Escape the name properly for Python string
            escaped_name = material["name"].replace('\\', '\\\\').replace('"', '\\"')
            
            lines.extend([
            f'    {const_name} = MaterialInstance(',
            f'        name="{escaped_name}",',
            f'        keywords={material["keywords"]},',
            f'        value={material["value"]},',
            f'        special_sell={special_sell_str}',
            '    )',
            '',
            ])

        lines.extend([
        # Add lookup function
        '    @classmethod',
        '    def by_export_name(cls, export_name: str):',
        '        """Look up material by export name (e.g., "spruce_logs" or "spruce_logs_fine")"""',
        '        # Convert to constant name',
        '        const_name = export_name.upper()',
        '        ',
        '        if hasattr(cls, const_name):',
        '            return getattr(cls, const_name)',
        '        return None',
        ])
        
        write_lines(f, lines)
    print(f"✓ Generated {output_file} with {len(materials)} materials")

# ============================================================================
# MAIN LOGIC
# ============================================================================

def main():
    """Main scraping logic"""
    print("Step 1: Downloading Materials page...")
    html = download_page(MATERIALS_URL, CACHE_FILE, rescrape=RESCRAPE)
    
    if not html:
        print("Failed to download Materials page")
        return
    
    print("\nStep 2: Extracting materials...")
    materials = extract_materials(html)
    print(f"Found {len(materials)} materials from main page")
    
    # Scan folder for additional materials
    if SCAN_FOLDER_FOR_NEW_ITEMS:
        print("\nScanning cache folder for additional materials...")
        folder_materials = scan_cache_folder_for_items(CACHE_DIR, CACHE_FILE)
        if folder_materials:
            # Build set of existing material names (without " (Fine)" suffix)
            existing_names = set()
            for mat in materials:
                base_name = mat['name'].replace(' (Fine)', '')
                existing_names.add(base_name)
            
            # Process folder materials that aren't already in the list
            added_count = 0
            for item in folder_materials:
                material_name = item['name']
                
                # Skip if already in main list
                if material_name in existing_names:
                    continue
                
                print(f"  Processing: {material_name} (from folder)")
                
                # Read cached HTML
                material_html = read_cached_html(item['cache_file'])
                if material_html:
                    value, fine_value, special_sell, special_sell_fine = extract_value_from_page(material_html)
                else:
                    value, fine_value, special_sell, special_sell_fine = 0, 0, None, None
                
                # Add regular material
                materials.append({
                    'name': material_name,
                    'keywords': [],  # No keywords from folder scan
                    'value': value,
                    'special_sell': special_sell
                })
                
                # Add fine version
                materials.append({
                    'name': material_name + ' (Fine)',
                    'keywords': [],
                    'value': fine_value if fine_value else value,
                    'special_sell': special_sell_fine
                })
                
                added_count += 1
            
            if added_count > 0:
                print(f"  Added {added_count * 2} materials from folder (regular + fine)")
    
    print(f"\nTotal materials: {len(materials)}")
    
    print("\nStep 3: Resolving special_sell references...")
    for material in materials:
        if material.get('special_sell'):
            qty, item_name = material['special_sell']
            item_ref = resolve_special_sell_item(item_name, materials)
            if item_ref:
                material['special_sell'] = (qty, item_ref)
                print(f"  {material['name']}: {qty}x {item_ref}")
            else:
                # Keep as string if not found in materials (might be equipment or special currency)
                # Store as plain string, not wrapped in quotes (quotes will be added during generation)
                material['special_sell'] = (qty, item_name)
                print(f"  {material['name']}: {qty}x {item_name} (not in materials, keeping as string)")
    
    print("\nStep 4: Generating materials.py...")
    generate_materials_py(materials)
    
    # Report validation issues
    validator.report()

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    main()
