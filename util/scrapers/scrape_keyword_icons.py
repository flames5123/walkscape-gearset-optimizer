#!/usr/bin/env python3
"""
Download keyword icons from Walkscape wiki.

Scrapes the Keywords wiki page and downloads SVG icons for each keyword.
The page uses a gallery-like structure with images rather than tables.

Icons are saved to: assets/icons/keywords/
"""

import requests
from pathlib import Path
from bs4 import BeautifulSoup
from scraper_utils import download_page, get_cache_file, sanitize_filename

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
WIKI_URL = 'https://wiki.walkscape.app/wiki/Keywords'
CACHE_FILE = get_cache_file('keywords_cache.html')
OUTPUT_DIR = Path('assets/icons/keywords')

# Keywords to skip (if any)
SKIP_KEYWORDS = [
    'Keywords.svg',  # Main page icon, not a keyword
]

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_icon(url: str, filename: str) -> bool:
    """Download a single icon SVG file."""
    if not url:
        return False
    
    try:
        # Ensure URL is absolute
        if url.startswith('/'):
            url = 'https://wiki.walkscape.app' + url
        elif not url.startswith('http'):
            url = 'https://wiki.walkscape.app/' + url
        
        print(f"  Downloading: {url}")
        
        # Download the file
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        # Create output directory if needed
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        
        # Save to file
        output_path = OUTPUT_DIR / filename
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"    ✓ Saved to {output_path}")
        return True
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False

def extract_keyword_name(src: str) -> str:
    """Extract keyword name from image source path."""
    # Example: /images/2/2f/Keyword_Fishing.svg -> Fishing
    # Example: /images/7/79/Keyword_Alcohol.svg -> Alcohol
    
    if not src:
        return None
    
    # Get filename from path
    filename = src.split('/')[-1]
    
    # Remove .svg extension
    if filename.endswith('.svg'):
        filename = filename[:-4]
    
    # Check if it starts with "Keyword_"
    if filename.startswith('Keyword_'):
        # Remove "Keyword_" prefix
        keyword = filename[8:]
        return keyword
    
    return None

# ============================================================================
# SCRAPING FUNCTIONS
# ============================================================================

def scrape_keyword_icons():
    """Scrape keyword icons from wiki."""
    print("Downloading keyword icons from wiki...")
    
    # Download wiki page
    html = download_page(WIKI_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        print("✗ Failed to download wiki page")
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Find all images on the page
    images = soup.find_all('img')
    print(f"Found {len(images)} images on page\n")
    
    keywords = []
    
    for img in images:
        src = img.get('src', '')
        
        # Skip if not an SVG
        if not src.endswith('.svg'):
            continue
        
        # Skip if in skip list
        filename = src.split('/')[-1]
        if filename in SKIP_KEYWORDS:
            continue
        
        # Extract keyword name
        keyword_name = extract_keyword_name(src)
        
        if not keyword_name:
            # Not a keyword icon (doesn't have Keyword_ prefix)
            continue
        
        # Create filename without "Keyword_" prefix (lowercase)
        clean_filename = keyword_name.lower() + '.svg'
        
        keywords.append({
            'name': keyword_name,
            'src': src,
            'filename': clean_filename
        })
        
        print(f"  Found: {keyword_name}")
    
    if not keywords:
        print("\n✗ No keyword icons found")
    
    return keywords

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Keyword Icon Scraper ===\n")
    
    keywords = scrape_keyword_icons()
    
    if keywords:
        print(f"\n✓ Found {len(keywords)} keyword icons")
        print("\nDownloading icons...\n")
        
        success_count = 0
        for keyword in keywords:
            name = keyword['name']
            src = keyword['src']
            filename = keyword['filename']
            
            print(f"{name}")
            if download_icon(src, filename):
                success_count += 1
        
        print(f"\n✓ Downloaded {success_count}/{len(keywords)} icons")
        print(f"✓ Icons saved to {OUTPUT_DIR}/")
    else:
        print("\n✗ No icons to download")
