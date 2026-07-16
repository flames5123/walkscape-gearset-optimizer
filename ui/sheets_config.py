#!/usr/bin/env python3
"""
Google Sheets configuration for community data sync.

Sheet IDs and tab configuration for the generic definitions sync system.
Uses CSV export for reads (no auth needed) and Apps Script webhook for writes.
"""

import os

# ============================================================================
# SYNC TOGGLE
# ============================================================================

# Set to False to completely disable the Google Sheets sync background loop.
# Useful when not actively using generic definitions from sheets.
SHEETS_SYNC_ENABLED = False

# ============================================================================
# SHEET IDS
# ============================================================================

# Test sheet — used for local development and testing
SHEETS_TEST_ID = 'YOUR_TEST_SHEET_ID'

# Live/production sheet — used on the home server
# Public community data sheet (read-only, view in browser):
# https://docs.google.com/spreadsheets/d/1UvX2R5a5tCPEo30gXtF8fnWgu2DbXhzUwK-S7UF81aE/edit
SHEETS_LIVE_ID = 'YOUR_LIVE_SHEET_ID'


def get_sheet_id() -> str:
    """Get the active sheet ID based on environment.

    Set WALKSCAPE_ENV=production to use the live sheet.
    Defaults to test sheet for safety.
    """
    env = os.environ.get('WALKSCAPE_ENV', 'test').lower()
    if env == 'production':
        return SHEETS_LIVE_ID
    return SHEETS_TEST_ID


def get_apps_script_url() -> str | None:
    """Get the Apps Script webhook URL for publishing data back to the sheet.

    Set WALKSCAPE_SHEETS_WEBHOOK_URL env var to the deployed Apps Script URL.
    Falls back to the test webhook URL for local development.
    Returns None if not configured (writes will be skipped).
    """
    url = os.environ.get('WALKSCAPE_SHEETS_WEBHOOK_URL')
    if url:
        return url

    # Default to test webhook for local development
    env = os.environ.get('WALKSCAPE_ENV', 'test').lower()
    if env != 'production':
        return 'https://script.google.com/macros/s/YOUR_APPS_SCRIPT_DEPLOYMENT_ID/exec'

    # Production webhook (live sheet)
    return 'https://script.google.com/macros/s/YOUR_APPS_SCRIPT_DEPLOYMENT_ID/exec'


# ============================================================================
# TAB CONFIGURATION
# ============================================================================

# Tab names and their GIDs (Google Sheets tab identifiers)
# GIDs are assigned when tabs are created — update these after setup
TABS = {
    'Activities': {
        'gid': 0,  # First tab is always gid=0
        'columns': ['name', 'skill', 'base_steps', 'base_xp', 'max_efficiency',
                     'required_level', 'location', 'icon', 'icon_color',
                     'contributed_by', 'additional_data', 'kozz_data'],
    },
    'Recipes': {
        'gid': None,
        'columns': ['name', 'skill', 'base_steps', 'base_xp', 'max_efficiency',
                     'required_level', 'is_quality_item', 'icon', 'icon_color',
                     'contributed_by', 'additional_data', 'kozz_data'],
    },
    'Services': {
        'gid': None,
        'columns': ['name', 'skill', 'location', 'tier', 'stats_json', 'icon', 'icon_color',
                     'contributed_by', 'additional_data', 'kozz_data'],
    },
    # Gear tab — multi-row format:
    # Row 1: name + metadata (slot, keywords, rarity, is_crafted, icon, icon_color)
    #         + first quality name + first stat
    # Continuation rows: empty name. Quality rows have quality name.
    # Stat rows have skill/location/stat/value.
    'Gear': {
        'gid': None,
        'columns': ['name', 'export_item_name', 'gear_set_export', 'slot', 'keywords', 'rarity', 'is_crafted',
                     'quality', 'item_value', 'skill', 'location', 'stat', 'value',
                     'icon', 'icon_color', 'icon_path', 'contributed_by',
                     'additional_data', 'kozz_data'],
    },
    # Consumables — multi-row like Gear. Normal/Fine quality tiers.
    'Consumables': {
        'gid': None,
        'columns': ['name', 'export_item_name', 'duration', 'quality', 'item_value',
                     'skill', 'location', 'stat', 'value',
                     'icon', 'icon_color', 'icon_path', 'contributed_by',
                     'additional_data', 'kozz_data'],
    },
    # Collectibles — multi-row (no quality tiers, just base stats)
    'Collectibles': {
        'gid': None,
        'columns': ['name', 'export_item_name', 'item_value', 'skill', 'location', 'stat', 'value',
                     'icon', 'icon_color', 'icon_path', 'contributed_by',
                     'additional_data', 'kozz_data'],
    },
    # Pets — multi-row like Collectibles
    'Pets': {
        'gid': None,
        'columns': ['name', 'export_item_name', 'egg_value', 'level', 'xp_to_next_level',
                     'skill', 'location', 'stat', 'value',
                     'icon', 'icon_color', 'icon_path', 'contributed_by',
                     'additional_data', 'kozz_data'],
    },
    # Inputs — multi-row like Consumables (Normal/Fine quality tiers, no duration)
    'Inputs': {
        'gid': None,
        'columns': ['name', 'export_item_name', 'quality', 'item_value',
                     'skill', 'location', 'stat', 'value',
                     'icon', 'icon_color', 'icon_path', 'contributed_by',
                     'additional_data', 'kozz_data'],
    },
    # Keywords — one row per keyword
    # "banned" = 1 means unique-per-gearset (only 1 tool with this keyword allowed)
    # New keywords default to banned=1 (safe default)
    'Keywords': {
        'gid': None,
        'columns': ['name', 'banned', 'icon', 'icon_color', 'contributed_by',
                     'additional_data', 'kozz_data'],
    },
}

# Tabs that use multi-row format (continuation rows with empty name)
MULTI_ROW_TABS = {'Gear', 'Consumables', 'Collectibles', 'Pets', 'Inputs'}

# All tabs that are actively synced
ACTIVE_SYNC_TABS = ['Activities', 'Recipes', 'Services', 'Gear',
                    'Consumables', 'Collectibles', 'Pets', 'Inputs', 'Keywords']


def csv_export_url(sheet_id: str, gid: int) -> str:
    """Build the CSV export URL for a specific tab."""
    return f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}'
