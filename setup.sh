#!/bin/bash
# ============================================================
# Walkscape Optimizer - First-Time Setup
# ============================================================
# Run this after cloning the repository to:
# 1. Install Python dependencies
# 2. Scrape all game data from the wiki
# 3. Download all icons from the wiki
# 4. Initialize the database
# 5. Create your config file
#
# Usage: ./setup.sh
# ============================================================

set -e

echo "============================================================"
echo "  Walkscape Optimizer - Setup"
echo "============================================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "✗ Python 3 is required but not installed."
    exit 1
fi
echo "✓ Python 3 found: $(python3 --version)"

# Install dependencies
echo ""
echo "[1/5] Installing Python dependencies..."
pip3 install -r requirements.txt
echo "✓ Dependencies installed"

# Scrape game data
echo ""
echo "[2/5] Scraping game data from wiki..."
echo "  This downloads and parses wiki pages."
echo "  This will take about 15-20 minutes."
START_TIME=$SECONDS
python3 util/scrapers/scrape_all.py
ELAPSED=$(( SECONDS - START_TIME ))
echo "✓ Game data scraped ($(( ELAPSED / 60 ))m $(( ELAPSED % 60 ))s)"

# Download icons
echo ""
echo "[3/5] Downloading icons from wiki..."
echo "  This downloads SVG icons."
echo "  This will take about 10-15 minutes."
START_TIME=$SECONDS
python3 util/scrapers/scrape_all_icons.py
ELAPSED=$(( SECONDS - START_TIME ))
echo "✓ Icons downloaded ($(( ELAPSED / 60 ))m $(( ELAPSED % 60 ))s)"

# Initialize database
echo ""
echo "[4/5] Initializing database..."
if [ -f "ui/sessions.db" ]; then
    echo "  Database already exists, skipping."
else
    (cd ui && python3 init_database.py)
    echo "✓ Database initialized"
fi

# Create config
echo ""
echo "[5/5] Setting up configuration..."
if [ -f "my_config.py" ]; then
    echo "  my_config.py already exists, skipping."
else
    cp my_config.example.py my_config.py
    echo "✓ Created my_config.py from template"
    echo "  → Edit my_config.py and paste your character export"
fi

echo ""
echo "============================================================"
echo "  Setup complete!"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Edit my_config.py with your character export"
echo "  2. Run an optimizer:  python3 optimize_activity_gearsets.py"
echo "  3. Or start the UI:   uvicorn ui.app:app --reload --host 0.0.0.0 --port 8000"
echo ""
