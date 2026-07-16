#!/usr/bin/env python3
"""
Google Sheets Setup Script for Walkscape Community Data Sync.

Run this once to:
1. Print the Apps Script code to paste into the Google Sheet
2. Test CSV read access to the sheet
3. Verify tab structure

Usage:
    python3 ui/setup_sheets.py [--test | --live]

Default: --test (uses the test sheet)
"""

import sys
import csv
import io
import urllib.request
import urllib.error

from ui.sheets_config import (
    SHEETS_TEST_ID, SHEETS_LIVE_ID, TABS, ACTIVE_SYNC_TABS, csv_export_url
)


# ============================================================================
# APPS SCRIPT CODE GENERATOR
# ============================================================================

APPS_SCRIPT_CODE = r'''
// ============================================================================
// Walkscape Community Data - Apps Script
// ============================================================================
// Paste this into Extensions > Apps Script on the Google Sheet.
// Then deploy as Web App:
//   1. Click Deploy > New deployment
//   2. Type: Web app
//   3. Execute as: Me
//   4. Who has access: Anyone
//   5. Copy the URL — that's your WALKSCAPE_SHEETS_WEBHOOK_URL
//
// This script handles:
//   - doPost(): Receives JSON data from the Walkscape server and upserts rows
//   - doGet(): Returns sheet data as JSON (alternative to CSV export)
//   - Auto-creates tabs with correct headers if they don't exist
// ============================================================================

// Tab definitions with column headers
var TAB_CONFIG = {
  'Activities': ['name', 'skill', 'base_steps', 'base_xp', 'max_efficiency', 'required_level', 'location', 'icon'],
  'Recipes': ['name', 'skill', 'base_steps', 'base_xp', 'max_efficiency', 'required_level', 'service', 'icon'],
  'Services': ['name', 'skill', 'location', 'stats_json', 'icon'],
  'Gear': ['name', 'slot', 'skill', 'location', 'work_efficiency', 'double_action', 'double_rewards', 'steps_add', 'steps_percent', 'quality_outcome', 'no_material_consumed', 'bonus_xp_percent'],
  'Consumables': ['name', 'skill', 'duration', 'work_efficiency', 'double_action', 'double_rewards', 'steps_add', 'steps_percent', 'quality_outcome', 'no_material_consumed', 'bonus_xp_percent'],
  'Pets': ['name', 'work_efficiency', 'double_action', 'double_rewards', 'steps_add', 'steps_percent', 'quality_outcome', 'no_material_consumed', 'bonus_xp_percent', 'find_collectibles', 'find_gems', 'find_bird_nests', 'fine_material_finding', 'chest_finding']
};


/**
 * Initialize all tabs with headers. Run this manually once from the script editor.
 * Menu: Run > initializeTabs
 */
function initializeTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  for (var tabName in TAB_CONFIG) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      Logger.log('Created tab: ' + tabName);
    }
    
    // Set headers in row 1
    var headers = TAB_CONFIG[tabName];
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4a86c8');
    headerRange.setFontColor('#ffffff');
    
    // Auto-resize columns
    for (var i = 1; i <= headers.length; i++) {
      sheet.autoResizeColumn(i);
    }
    
    // Freeze header row
    sheet.setFrozenRows(1);
    
    Logger.log('Initialized tab: ' + tabName + ' with ' + headers.length + ' columns');
  }
  
  // Delete the default "Sheet1" if it exists and we have our tabs
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
      Logger.log('Deleted default Sheet1');
    } catch (e) {
      Logger.log('Could not delete Sheet1: ' + e);
    }
  }
  
  Logger.log('✓ All tabs initialized!');
  SpreadsheetApp.getUi().alert('All tabs initialized successfully!');
}


/**
 * Handle POST requests — upsert rows from the Walkscape server.
 * 
 * Expected JSON body:
 * {
 *   "action": "upsert",
 *   "tab": "Activities",
 *   "rows": [
 *     {"name": "New Activity", "skill": "hunting", "base_steps": 250, ...},
 *     ...
 *   ]
 * }
 * 
 * Or for delete:
 * {
 *   "action": "delete",
 *   "tab": "Activities",
 *   "names": ["Activity to delete", ...]
 * }
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'upsert';
    var tabName = data.tab;
    
    if (!tabName || !TAB_CONFIG[tabName]) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Invalid tab: ' + tabName
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Tab not found: ' + tabName + '. Run initializeTabs() first.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = TAB_CONFIG[tabName];
    var result;
    
    if (action === 'upsert') {
      result = upsertRows(sheet, headers, data.rows || []);
    } else if (action === 'delete') {
      result = deleteRows(sheet, data.names || []);
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Handle GET requests — return sheet data as JSON.
 * 
 * Query params:
 *   ?tab=Activities  — return all rows from the Activities tab
 *   ?tab=all         — return all tabs
 */
function doGet(e) {
  try {
    var tabName = (e.parameter && e.parameter.tab) || 'all';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};
    
    if (tabName === 'all') {
      for (var name in TAB_CONFIG) {
        result[name] = readTab(ss, name);
      }
    } else {
      result[tabName] = readTab(ss, tabName);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      data: result
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Read all rows from a tab as array of objects.
 */
function readTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];  // Only headers or empty
  
  var headers = data[0];
  var rows = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    // Skip empty rows
    if (row.name && row.name.toString().trim() !== '') {
      rows.push(row);
    }
  }
  
  return rows;
}


/**
 * Upsert rows — update existing rows by name, append new ones.
 */
function upsertRows(sheet, headers, rows) {
  if (!rows || rows.length === 0) {
    return { success: true, inserted: 0, updated: 0 };
  }
  
  var data = sheet.getDataRange().getValues();
  var nameCol = 0;  // 'name' is always the first column
  
  // Build index of existing names -> row numbers (1-based)
  var existingNames = {};
  for (var i = 1; i < data.length; i++) {
    var name = data[i][nameCol];
    if (name && name.toString().trim() !== '') {
      existingNames[name.toString().trim().toLowerCase()] = i + 1;  // 1-based row number
    }
  }
  
  var inserted = 0;
  var updated = 0;
  
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var rowName = (row.name || '').toString().trim();
    if (!rowName) continue;
    
    // Build row values in column order
    var values = [];
    for (var h = 0; h < headers.length; h++) {
      var val = row[headers[h]];
      values.push(val !== undefined && val !== null ? val : '');
    }
    
    var existingRow = existingNames[rowName.toLowerCase()];
    if (existingRow) {
      // Update existing row
      sheet.getRange(existingRow, 1, 1, values.length).setValues([values]);
      updated++;
    } else {
      // Append new row
      sheet.appendRow(values);
      inserted++;
    }
  }
  
  return { success: true, inserted: inserted, updated: updated };
}


/**
 * Delete rows by name.
 */
function deleteRows(sheet, names) {
  if (!names || names.length === 0) {
    return { success: true, deleted: 0 };
  }
  
  var nameLookup = {};
  for (var i = 0; i < names.length; i++) {
    nameLookup[names[i].toString().trim().toLowerCase()] = true;
  }
  
  var data = sheet.getDataRange().getValues();
  var deleted = 0;
  
  // Delete from bottom to top to preserve row indices
  for (var i = data.length - 1; i >= 1; i--) {
    var name = data[i][0];
    if (name && nameLookup[name.toString().trim().toLowerCase()]) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  
  return { success: true, deleted: deleted };
}
'''.strip()


# ============================================================================
# SHEET VERIFICATION
# ============================================================================

def test_csv_read(sheet_id: str, tab_name: str, gid: int) -> dict:
    """Test reading a tab via CSV export.

    Returns:
        Dict with 'success', 'headers', 'row_count', 'error'.
    """
    url = csv_export_url(sheet_id, gid)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'WalkscapeSync/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode('utf-8')

        reader = csv.reader(io.StringIO(content))
        rows = list(reader)

        if not rows:
            return {'success': True, 'headers': [], 'row_count': 0, 'error': None}

        return {
            'success': True,
            'headers': rows[0],
            'row_count': len(rows) - 1,  # Exclude header
            'error': None,
            'sample': rows[1] if len(rows) > 1 else None,
        }
    except urllib.error.HTTPError as e:
        return {'success': False, 'headers': [], 'row_count': 0,
                'error': f'HTTP {e.code}: {e.reason}'}
    except Exception as e:
        return {'success': False, 'headers': [], 'row_count': 0,
                'error': str(e)}


def verify_sheet(sheet_id: str):
    """Verify all active sync tabs are readable and have correct headers."""
    print(f"\n📋 Verifying sheet: {sheet_id}")
    print("=" * 60)

    all_ok = True

    for tab_name in ACTIVE_SYNC_TABS:
        tab_config = TABS[tab_name]
        gid = tab_config['gid']

        if gid is None:
            print(f"  ⚠  {tab_name}: GID not set — tab may not exist yet")
            print(f"     Run initializeTabs() in Apps Script first,")
            print(f"     then update GIDs in sheets_config.py")
            all_ok = False
            continue

        result = test_csv_read(sheet_id, tab_name, gid)

        if not result['success']:
            print(f"  ✗  {tab_name} (gid={gid}): {result['error']}")
            all_ok = False
            continue

        expected = tab_config['columns']
        actual = result['headers']

        if actual == expected:
            print(f"  ✓  {tab_name} (gid={gid}): Headers match, {result['row_count']} data rows")
        else:
            print(f"  ⚠  {tab_name} (gid={gid}): Header mismatch!")
            print(f"     Expected: {expected}")
            print(f"     Got:      {actual}")
            all_ok = False

    return all_ok


# ============================================================================
# MAIN
# ============================================================================

def main():
    # Parse args
    use_live = '--live' in sys.argv
    sheet_id = SHEETS_LIVE_ID if use_live else SHEETS_TEST_ID
    env_name = 'LIVE' if use_live else 'TEST'

    print("=" * 60)
    print("  Walkscape Google Sheets Setup")
    print("=" * 60)
    print(f"\n  Target: {env_name} sheet")
    print(f"  Sheet ID: {sheet_id}")
    print(f"  URL: https://docs.google.com/spreadsheets/d/{sheet_id}")

    # Step 1: Print Apps Script code
    print("\n" + "=" * 60)
    print("  STEP 1: Apps Script Code")
    print("=" * 60)
    print("""
  To set up the Google Sheet:

  1. Open the spreadsheet in your browser
  2. Go to Extensions > Apps Script
  3. Delete any existing code in Code.gs
  4. Paste the code below
  5. Click the 💾 Save button
  6. Run the 'initializeTabs' function:
     - Select 'initializeTabs' from the function dropdown
     - Click ▶ Run
     - Authorize when prompted
  7. Deploy as Web App:
     - Click Deploy > New deployment
     - Type: Web app
     - Execute as: Me
     - Who has access: Anyone
     - Click Deploy
     - Copy the URL
  8. Set the URL as an environment variable:
     WALKSCAPE_SHEETS_WEBHOOK_URL=<the URL>
""")

    # Write Apps Script to a file for easy copy
    script_path = 'ui/sheets_apps_script.js'
    with open(script_path, 'w') as f:
        f.write(APPS_SCRIPT_CODE)
    print(f"  📄 Apps Script code saved to: {script_path}")
    print(f"     (Copy the contents into the Google Sheet's Apps Script editor)")

    # Step 2: Verify sheet access
    print("\n" + "=" * 60)
    print("  STEP 2: Verify Sheet Access")
    print("=" * 60)

    ok = verify_sheet(sheet_id)

    if ok:
        print("\n  ✓ All tabs verified! Sheet is ready for sync.")
    else:
        print("\n  ⚠ Some tabs need attention. Follow the steps above to fix.")
        print("    After running initializeTabs(), note the GID for each tab:")
        print("    (visible in the URL when you click a tab: ...gid=XXXXXXX)")
        print("    Then update TABS in ui/sheets_config.py with the correct GIDs.")

    # Step 3: Print GID discovery instructions
    print("\n" + "=" * 60)
    print("  STEP 3: Update Tab GIDs")
    print("=" * 60)
    print("""
  After running initializeTabs() in Apps Script:

  1. Click each tab in the spreadsheet
  2. Look at the URL — it ends with #gid=XXXXXXX
  3. Update the GIDs in ui/sheets_config.py:

     TABS = {
         'Activities': {'gid': 0, ...},        # First tab is always 0
         'Recipes': {'gid': XXXXXXX, ...},      # From URL
         'Services': {'gid': XXXXXXX, ...},     # From URL
         ...
     }

  4. Run this script again to verify:
     python3 ui/setup_sheets.py""" + ('' if not use_live else ' --live') + """
""")

    print("=" * 60)
    print("  Setup complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
