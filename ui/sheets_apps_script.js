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
//   - Kozz integration: format-converting parser for external optimizer sync
//
// KOZZ INTEGRATION:
//   READ:  GET  ?action=kozz_read&tab=Gear  (or tab=all)
//          Returns items in Kozz JSON format (modifiers array with conditions)
//   WRITE: POST { "action": "kozz_upsert", "tab": "Gear", "items": [...] }
//          Accepts Kozz JSON format, converts to sheet multi-row, upserts for everyone
//          Kozz-only fields (uuid, wiki_slug, requirements) stored in kozz_data column
//          Gated stats (set_equipped, AP thresholds) stored in additional_data column
//
// MULTI-ROW FORMAT (Gear, Consumables, Collectibles, Pets):
//   - First row for an item has the item name + metadata
//   - Subsequent rows for the same item have empty name column
//   - Quality rows have quality name, stat rows under a quality have empty quality
//   - readTab returns ALL rows (including empty-name continuation rows)
//   - upsertMultiRows handles replacing entire item blocks atomically
// ============================================================================

// Tab definitions with column headers
var TAB_CONFIG = {
  'Activities': ['name', 'skill', 'base_steps', 'base_xp', 'max_efficiency', 'required_level', 'location', 'icon', 'icon_color', 'contributed_by', 'additional_data', 'kozz_data'],
  'Recipes': ['name', 'skill', 'base_steps', 'base_xp', 'max_efficiency', 'required_level', 'is_quality_item', 'icon', 'icon_color', 'contributed_by', 'additional_data', 'kozz_data'],
  'Services': ['name', 'skill', 'location', 'tier', 'stats_json', 'icon', 'icon_color', 'contributed_by', 'additional_data', 'kozz_data'],
  // Gear: multi-row format.
  // Row 1: name, slot, keywords, rarity, is_crafted, icon, icon_color, contributed_by
  //         + quality (first quality name), then stat rows under it
  // Continuation rows: empty name. Quality rows have quality name. Stat rows have skill/location/stat/value.
  'Gear': ['name', 'export_item_name', 'gear_set_export', 'slot', 'keywords', 'rarity', 'is_crafted', 'quality', 'item_value', 'skill', 'location', 'stat', 'value', 'icon', 'icon_color', 'icon_path', 'contributed_by', 'additional_data', 'data_status', 'kozz_data'],
  // Consumables: multi-row like Gear. Normal/Fine quality tiers.
  'Consumables': ['name', 'export_item_name', 'duration', 'quality', 'item_value', 'skill', 'location', 'stat', 'value', 'icon', 'icon_color', 'icon_path', 'contributed_by', 'additional_data', 'data_status', 'kozz_data'],
  // Collectibles: multi-row (no quality tiers, just base stats)
  'Collectibles': ['name', 'export_item_name', 'item_value', 'skill', 'location', 'stat', 'value', 'icon', 'icon_color', 'icon_path', 'contributed_by', 'additional_data', 'kozz_data'],
  // Pets: multi-row with level tiers (Egg, Level 1-4) and per-level stats + XP
  'Pets': ['name', 'export_item_name', 'egg_value', 'level', 'xp_to_next_level', 'skill', 'location', 'stat', 'value', 'icon', 'icon_color', 'icon_path', 'contributed_by', 'additional_data', 'kozz_data'],
  // Inputs: multi-row like Consumables (Normal/Fine quality, no duration)
  'Inputs': ['name', 'export_item_name', 'keywords', 'quality', 'item_value', 'skill', 'location', 'stat', 'value', 'icon', 'icon_color', 'icon_path', 'contributed_by', 'additional_data', 'data_status', 'kozz_data'],
  // Keywords: one row per keyword. "banned" means unique-per-gearset (only 1 tool with this keyword).
  'Keywords': ['name', 'banned', 'icon', 'icon_color', 'contributed_by', 'additional_data', 'kozz_data'],
  // Sync Status: shows last sync timestamps and pause control. NOT a data tab — just metadata.
  'Sync Status': ['tool', 'last_sync_time', 'sync_paused']
};

// Tabs that use multi-row format (continuation rows with empty name)
var MULTI_ROW_TABS = ['Gear', 'Consumables', 'Collectibles', 'Pets', 'Inputs'];


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

  // Seed the Sync Status tab with a _config row and a native checkbox for sync_paused
  var syncSheet = ss.getSheetByName('Sync Status');
  if (syncSheet) {
    var syncData = syncSheet.getDataRange().getValues();
    var hasConfig = false;
    for (var ci = 1; ci < syncData.length; ci++) {
      if (syncData[ci][0] && syncData[ci][0].toString().trim() === '_config') {
        hasConfig = true;
        break;
      }
    }
    if (!hasConfig) {
      var newRow = syncSheet.getLastRow() + 1;
      syncSheet.getRange(newRow, 1).setValue('_config');
      syncSheet.getRange(newRow, 2).setValue('');
      var pauseCell = syncSheet.getRange(newRow, 3);
      pauseCell.setValue(false);
      pauseCell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      Logger.log('Seeded _config row with sync_paused checkbox');
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
 * For multi-row tabs (Gear, Consumables, Collectibles, Pets), rows include
 * continuation rows with empty name. The upsert replaces entire item blocks.
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

    // Handle update_sync_status before tab validation (it doesn't use a tab)
    if (action === 'update_sync_status') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var result = updateSyncStatus(ss, data.tool || 'unknown', data.timestamp || new Date().toISOString());
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Kozz upsert: accepts Kozz JSON format, converts to sheet format, upserts for everyone
    if (action === 'kozz_upsert') {
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
      var kozzItems = data.items || data.rows || [];
      var result = kozzUpsertItems(tabName, kozzItems, sheet, headers);

      // Update sync status for kozz
      updateSyncStatus(ss, 'kozz', new Date().toISOString());

      result.tool = 'kozz';
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

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
      if (MULTI_ROW_TABS.indexOf(tabName) >= 0) {
        result = upsertMultiRows(sheet, headers, data.rows || []);
      } else {
        result = upsertRows(sheet, headers, data.rows || []);
      }
    } else if (action === 'delete') {
      if (MULTI_ROW_TABS.indexOf(tabName) >= 0) {
        result = deleteMultiRows(sheet, data.names || []);
      } else {
        result = deleteRows(sheet, data.names || []);
      }
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
 *
 * For multi-row tabs, ALL rows are returned (including continuation rows
 * with empty name). The caller groups them by item name.
 */
function doGet(e) {
  try {
    // Handle update_sync_status via GET (POST body is lost on redirect)
    var action = (e.parameter && e.parameter.action) || '';
    if (action === 'update_sync_status') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var result = updateSyncStatus(ss, e.parameter.tool || 'unknown', e.parameter.timestamp || new Date().toISOString());
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Check if sync is paused: GET ?action=check_paused
    if (action === 'check_paused') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var paused = isSyncPaused(ss);
      return ContentService.createTextOutput(JSON.stringify({ success: true, paused: paused }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Set pause state: GET ?action=set_paused&paused=true|false
    if (action === 'set_paused') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var pausedVal = (e.parameter.paused || '').toLowerCase() === 'true';
      var result = setSyncPaused(ss, pausedVal);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Kozz read: GET ?action=kozz_read&tab=Gear
    // Returns data converted to Kozz JSON format (modifiers with conditions)
    if (action === 'kozz_read') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var kozzTab = (e.parameter && e.parameter.tab) || 'all';
      var result = {};

      if (kozzTab === 'all') {
        for (var name in TAB_CONFIG) {
          if (name === 'Sync Status') continue;
          var rawRows = readTab(ss, name);
          result[name] = sheetToKozzFormat(rawRows, name);
        }
      } else if (TAB_CONFIG[kozzTab]) {
        var rawRows2 = readTab(ss, kozzTab);
        result[kozzTab] = sheetToKozzFormat(rawRows2, kozzTab);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: 'Invalid tab: ' + kozzTab
        })).setMimeType(ContentService.MimeType.JSON);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        tool: 'kozz',
        data: result
      })).setMimeType(ContentService.MimeType.JSON);
    }

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
 *
 * For multi-row tabs (Gear, Consumables, Collectibles, Pets), ALL rows are
 * returned including continuation rows with empty name. The caller is
 * responsible for grouping them by item.
 *
 * For single-row tabs, rows with empty name are skipped (truly empty rows).
 */
function readTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];  // Only headers or empty

  var headers = data[0];
  var isMultiRow = MULTI_ROW_TABS.indexOf(tabName) >= 0;
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    var allEmpty = true;
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
      if (data[i][j] !== '' && data[i][j] !== null && data[i][j] !== undefined) {
        allEmpty = false;
      }
    }

    // Skip completely empty rows
    if (allEmpty) continue;

    if (isMultiRow) {
      // Multi-row tabs: return ALL rows (including empty-name continuation rows)
      rows.push(row);
    } else {
      // Single-row tabs: skip rows with empty name
      if (row.name && row.name.toString().trim() !== '') {
        rows.push(row);
      }
    }
  }

  return rows;
}


/**
 * Upsert rows for single-row tabs — update existing rows by name, append new ones.
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
 * Upsert rows for multi-row tabs (Gear, Consumables, Collectibles, Pets).
 *
 * Multi-row items span multiple sheet rows. The first row has the item name;
 * continuation rows have empty name. To upsert:
 * 1. Group incoming rows by item name (first row with name starts a block)
 * 2. For each item block, find existing rows in the sheet and replace them
 * 3. If item doesn't exist, append the block at the end
 *
 * This is an atomic replace: all rows for an item are deleted and re-inserted.
 */
function upsertMultiRows(sheet, headers, rows) {
  if (!rows || rows.length === 0) {
    return { success: true, inserted: 0, updated: 0 };
  }

  // Group incoming rows into item blocks
  var itemBlocks = [];
  var currentBlock = null;
  for (var r = 0; r < rows.length; r++) {
    var rowName = (rows[r].name || '').toString().trim();
    if (rowName) {
      if (currentBlock) itemBlocks.push(currentBlock);
      currentBlock = { name: rowName, rows: [rows[r]] };
    } else if (currentBlock) {
      currentBlock.rows.push(rows[r]);
    }
  }
  if (currentBlock) itemBlocks.push(currentBlock);

  // Read existing sheet data to find item blocks
  var data = sheet.getDataRange().getValues();

  var inserted = 0;
  var updated = 0;

  // Process each item block (in reverse order of sheet position to preserve indices)
  for (var b = 0; b < itemBlocks.length; b++) {
    var block = itemBlocks[b];
    var blockNameLower = block.name.toLowerCase();

    // Find existing rows for this item in the sheet
    var existingStart = -1;
    var existingEnd = -1;
    for (var i = 1; i < data.length; i++) {
      var cellName = (data[i][0] || '').toString().trim();
      if (cellName && cellName.toLowerCase() === blockNameLower) {
        existingStart = i + 1;  // 1-based row number
        existingEnd = existingStart;
        // Find continuation rows (empty name until next named row or end)
        for (var j = i + 1; j < data.length; j++) {
          var nextName = (data[j][0] || '').toString().trim();
          if (nextName) break;  // Next item starts
          existingEnd = j + 1;
        }
        break;
      }
    }

    // Build values for all rows in this block
    var blockValues = [];
    for (var r2 = 0; r2 < block.rows.length; r2++) {
      var values = [];
      for (var h = 0; h < headers.length; h++) {
        var val = block.rows[r2][headers[h]];
        values.push(val !== undefined && val !== null ? val : '');
      }
      blockValues.push(values);
    }

    if (existingStart > 0) {
      // Replace existing block: delete old rows, insert new ones
      var oldCount = existingEnd - existingStart + 1;
      var newCount = blockValues.length;

      if (newCount <= oldCount) {
        // Overwrite existing rows, delete extras
        sheet.getRange(existingStart, 1, newCount, headers.length).setValues(blockValues);
        if (oldCount > newCount) {
          sheet.deleteRows(existingStart + newCount, oldCount - newCount);
        }
      } else {
        // Overwrite existing rows, insert extras
        sheet.getRange(existingStart, 1, oldCount, headers.length).setValues(blockValues.slice(0, oldCount));
        if (newCount > oldCount) {
          sheet.insertRowsAfter(existingStart + oldCount - 1, newCount - oldCount);
          sheet.getRange(existingStart + oldCount, 1, newCount - oldCount, headers.length)
            .setValues(blockValues.slice(oldCount));
        }
      }
      updated++;

      // Refresh data array after modification (indices shifted)
      data = sheet.getDataRange().getValues();
    } else {
      // Append new block
      for (var a = 0; a < blockValues.length; a++) {
        sheet.appendRow(blockValues[a]);
      }
      inserted++;
      data = sheet.getDataRange().getValues();
    }
  }

  return { success: true, inserted: inserted, updated: updated };
}


/**
 * Delete rows by name (single-row tabs).
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


/**
 * Delete multi-row item blocks by name.
 * Deletes the named row AND all continuation rows below it (empty name).
 */
function deleteMultiRows(sheet, names) {
  if (!names || names.length === 0) {
    return { success: true, deleted: 0 };
  }

  var nameLookup = {};
  for (var i = 0; i < names.length; i++) {
    nameLookup[names[i].toString().trim().toLowerCase()] = true;
  }

  var data = sheet.getDataRange().getValues();
  var deleted = 0;

  // Find blocks to delete (collect row ranges from bottom to top)
  var blocksToDelete = [];  // [{start, count}]
  for (var i = data.length - 1; i >= 1; i--) {
    var name = (data[i][0] || '').toString().trim();
    if (name && nameLookup[name.toLowerCase()]) {
      // Found a named row to delete. Count continuation rows below it.
      var count = 1;
      for (var j = i + 1; j < data.length; j++) {
        var nextName = (data[j][0] || '').toString().trim();
        if (nextName) break;
        count++;
      }
      blocksToDelete.push({ start: i + 1, count: count });  // 1-based
    }
  }

  // Delete from bottom to top
  for (var d = 0; d < blocksToDelete.length; d++) {
    sheet.deleteRows(blocksToDelete[d].start, blocksToDelete[d].count);
    deleted++;
  }

  return { success: true, deleted: deleted };
}



// ============================================================================
// KOZZ INTEGRATION — FORMAT-CONVERTING PARSER
// ============================================================================
//
// Kozz's optimizer uses a different data format (Pydantic JSON with modifiers
// and conditions arrays). These functions convert between the two formats so
// both tools share the same sheet data seamlessly.
//
// KOZZ FORMAT (Equipment example):
// {
//   "name": "Cool Sword", "slot": "tools", "quality": "None",
//   "value": 50, "keywords": ["Sword", "exact_item_cool_sword"],
//   "uuid": "item-cool_sword-abc123", "wiki_slug": "Special:MyLanguage/Cool_sword",
//   "requirements": [{"type": "skill_level", "target": "smithing", "value": 10}],
//   "modifiers": [
//     {"stat": "work_efficiency", "value": 5.0,
//      "conditions": [{"type": "skill_activity", "target": "smithing", "value": null}]},
//     {"stat": "double_action", "value": 3.0,
//      "conditions": [{"type": "global", "target": null, "value": null}]}
//   ]
// }
//
// SHEET FORMAT (multi-row):
//   Row 1: name=Cool Sword, slot=tools, quality=, skill=smithing, location=global, stat=work_efficiency, value=5.0
//   Row 2: name=,           slot=,     quality=, skill=global,   location=global, stat=double_action,   value=3.0
//   additional_data = JSON with gated stats (set_equipped, achievement_points, etc.)
//   kozz_data = JSON with Kozz-only fields (uuid, wiki_slug, requirements, id, etc.)
//
// READ:  GET  ?action=kozz_read&tab=Gear
//        Returns items in Kozz JSON format (modifiers + conditions)
//
// WRITE: POST { "action": "kozz_upsert", "tab": "Gear", "items": [...] }
//        Accepts Kozz JSON format, converts to sheet multi-row, upserts for everyone
//
// ============================================================================

// Condition types that go into additional_data (gated stats) rather than
// the skill/location columns. These are "extra" conditions beyond skill+location.
var GATED_CONDITION_TYPES = ['set_equipped', 'achievement_points', 'total_skill_level',
  'item_ownership', 'activity_completion', 'reputation', 'specific_activity'];


/**
 * Convert sheet multi-row data to Kozz JSON format.
 *
 * Groups multi-row items by name, then converts each item's flat
 * skill/location/stat/value rows into Kozz's modifiers array with conditions.
 *
 * @param {Object[]} rows - Raw rows from readTab() (flat key-value objects)
 * @param {string} tabName - Tab name for format-specific handling
 * @returns {Object[]} Array of items in Kozz JSON format
 */
function sheetToKozzFormat(rows, tabName) {
  var isMultiRow = MULTI_ROW_TABS.indexOf(tabName) >= 0;

  if (!isMultiRow) {
    // Single-row tabs (Activities, Recipes, Services, Keywords) — return as-is
    // but parse any JSON columns and merge kozz_data
    var results = [];
    for (var i = 0; i < rows.length; i++) {
      var item = {};
      for (var key in rows[i]) {
        item[key] = rows[i][key];
      }
      // Parse kozz_data JSON and merge into item
      if (item.kozz_data) {
        try {
          var kd = JSON.parse(item.kozz_data);
          for (var k in kd) { item[k] = kd[k]; }
        } catch (e) { /* keep as string */ }
      }
      // Parse additional_data JSON and merge
      if (item.additional_data) {
        try {
          var ad = JSON.parse(item.additional_data);
          for (var k2 in ad) { item[k2] = ad[k2]; }
        } catch (e) { /* keep as string */ }
      }
      results.push(item);
    }
    return results;
  }

  // Multi-row tabs: group by item name, then convert stat rows to modifiers
  var items = [];
  var currentItem = null;
  var currentQuality = '';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var rowName = (row.name || '').toString().trim();

    if (rowName) {
      // New item starts — push previous if exists
      if (currentItem) items.push(currentItem);

      currentItem = { name: rowName, modifiers: [] };
      currentQuality = '';

      // Copy metadata from first row
      if (row.export_item_name) currentItem.export_item_name = row.export_item_name;
      if (row.gear_set_export) currentItem.gear_set_export = row.gear_set_export;
      if (row.slot) currentItem.slot = row.slot;
      if (row.keywords) {
        var kwStr = row.keywords.toString().trim();
        currentItem.keywords = kwStr ? kwStr.split(',').map(function (k) { return k.trim(); }) : [];
      }
      if (row.rarity) currentItem.rarity = row.rarity;
      if (row.is_crafted !== '' && row.is_crafted !== undefined) currentItem.is_crafted = row.is_crafted;
      if (row.icon) currentItem.icon = row.icon;
      if (row.icon_color) currentItem.icon_color = row.icon_color;
      if (row.contributed_by) currentItem.contributed_by = row.contributed_by;
      if (row.item_value !== '' && row.item_value !== undefined) currentItem.value = row.item_value;
      if (row.egg_value !== '' && row.egg_value !== undefined) currentItem.value = row.egg_value;
      if (row.duration !== '' && row.duration !== undefined) currentItem.duration = row.duration;

      // Parse kozz_data and merge (uuid, wiki_slug, requirements, id, etc.)
      if (row.kozz_data) {
        try {
          var kd2 = JSON.parse(row.kozz_data);
          for (var kk in kd2) { currentItem[kk] = kd2[kk]; }
        } catch (e) { /* keep raw */ }
      }

      // Parse additional_data as gated modifiers
      if (row.additional_data) {
        try {
          var gated = JSON.parse(row.additional_data);
          // gated is {skill: {location: {stat: value}}} with extra condition info
          // or it could be a flat gated_stats structure — merge as-is
          if (gated && typeof gated === 'object') {
            currentItem._gated_stats = gated;
          }
        } catch (e) { /* ignore */ }
      }
    }

    if (!currentItem) continue;

    // Track quality changes
    if (row.quality !== '' && row.quality !== undefined && row.quality !== null) {
      var qStr = row.quality.toString().trim();
      if (qStr) currentQuality = qStr;
    }

    // Handle pet level
    if (row.level !== '' && row.level !== undefined && row.level !== null) {
      var lvlStr = row.level.toString().trim();
      if (lvlStr) currentQuality = lvlStr; // Use level as quality grouping for pets
    }

    // Convert stat row to modifier
    var stat = (row.stat || '').toString().trim();
    var val = row.value;
    if (stat && val !== '' && val !== undefined && val !== null) {
      var skill = (row.skill || 'global').toString().trim().toLowerCase();
      var location = (row.location || 'global').toString().trim().toLowerCase();

      // Build conditions array from skill + location
      var conditions = [];
      if (skill === 'global' && location === 'global') {
        conditions.push({ type: 'global', target: null, value: null });
      } else {
        if (skill !== 'global') {
          conditions.push({ type: 'skill_activity', target: skill, value: null });
        }
        if (location !== 'global') {
          // Determine if it's a region or specific location
          conditions.push({ type: 'location', target: location, value: null });
        }
      }

      var modifier = {
        stat: stat,
        value: parseFloat(val) || 0,
        conditions: conditions
      };

      // Tag with quality if present (for crafted items)
      if (currentQuality) {
        modifier._quality = currentQuality;
      }

      currentItem.modifiers.push(modifier);
    }
  }

  // Push last item
  if (currentItem) items.push(currentItem);

  // Post-process: merge gated stats into modifiers
  for (var idx = 0; idx < items.length; idx++) {
    var it = items[idx];
    if (it._gated_stats) {
      var gs = it._gated_stats;
      // Walk nested {skill: {location: {stat: value}}} or flat gated format
      _mergeGatedIntoModifiers(it, gs);
      delete it._gated_stats;
    }
  }

  return items;
}


/**
 * Merge gated stats (from additional_data) into the item's modifiers array.
 * Gated stats have conditions like set_equipped, achievement_points, etc.
 */
function _mergeGatedIntoModifiers(item, gatedStats) {
  // gatedStats can be nested {condType: {target: {value: {skill: {loc: {stat: val}}}}}}
  // or simpler structures. We store them as extra modifiers with gated conditions.
  for (var condType in gatedStats) {
    var condData = gatedStats[condType];
    if (typeof condData !== 'object') continue;

    for (var target in condData) {
      var targetData = condData[target];
      if (typeof targetData !== 'object') continue;

      for (var condVal in targetData) {
        var statBlock = targetData[condVal];
        if (typeof statBlock !== 'object') continue;

        for (var skill in statBlock) {
          var locBlock = statBlock[skill];
          if (typeof locBlock !== 'object') continue;

          for (var loc in locBlock) {
            var statMap = locBlock[loc];
            if (typeof statMap !== 'object') continue;

            for (var statName in statMap) {
              var conditions = [];
              conditions.push({ type: condType, target: target || null, value: parseInt(condVal) || null });
              if (skill !== 'global') {
                conditions.push({ type: 'skill_activity', target: skill, value: null });
              }
              if (loc !== 'global') {
                conditions.push({ type: 'location', target: loc, value: null });
              }

              item.modifiers.push({
                stat: statName,
                value: parseFloat(statMap[statName]) || 0,
                conditions: conditions
              });
            }
          }
        }
      }
    }
  }
}


/**
 * Convert Kozz JSON format items to sheet multi-row format and upsert.
 *
 * Accepts items in Kozz's native format (modifiers with conditions),
 * converts to the sheet's flat multi-row format, then upserts using
 * the existing upsertRows/upsertMultiRows functions.
 *
 * @param {string} tabName - Target tab
 * @param {Object[]} kozzItems - Items in Kozz JSON format
 * @param {Sheet} sheet - The sheet to write to
 * @param {string[]} headers - Column headers
 * @returns {Object} Result with counts
 */
function kozzUpsertItems(tabName, kozzItems, sheet, headers) {
  if (!kozzItems || kozzItems.length === 0) {
    return { success: true, inserted: 0, updated: 0 };
  }

  var isMultiRow = MULTI_ROW_TABS.indexOf(tabName) >= 0;

  if (!isMultiRow) {
    // Single-row tabs: extract kozz-only fields into kozz_data, map rest directly
    var sheetRows = [];
    for (var i = 0; i < kozzItems.length; i++) {
      var item = kozzItems[i];
      var sheetRow = {};
      var kozzExtra = {};

      for (var key in item) {
        if (headers.indexOf(key) >= 0) {
          sheetRow[key] = item[key];
        } else {
          // Kozz-only field — store in kozz_data
          kozzExtra[key] = item[key];
        }
      }

      if (Object.keys(kozzExtra).length > 0) {
        sheetRow.kozz_data = JSON.stringify(kozzExtra);
      }

      sheetRows.push(sheetRow);
    }

    return upsertRows(sheet, headers, sheetRows);
  }

  // Multi-row tabs: convert modifiers to flat stat rows
  var allSheetRows = [];

  for (var idx = 0; idx < kozzItems.length; idx++) {
    var item = kozzItems[idx];
    var name = (item.name || '').toString().trim();
    if (!name) continue;

    var modifiers = item.modifiers || [];
    var keywords = item.keywords || [];
    var kwStr = Array.isArray(keywords) ? keywords.join(',') : keywords.toString();

    // Collect kozz-only fields for kozz_data column
    var kozzFields = {};
    var SHEET_KNOWN_KEYS = ['name', 'export_item_name', 'gear_set_export', 'slot', 'keywords', 'rarity',
      'is_crafted', 'quality', 'item_value', 'value', 'skill', 'location', 'stat',
      'icon', 'icon_color', 'contributed_by', 'additional_data', 'data_status', 'kozz_data',
      'modifiers', 'duration', 'egg_value', 'level', 'xp_to_next_level'];
    for (var fk in item) {
      if (SHEET_KNOWN_KEYS.indexOf(fk) < 0) {
        kozzFields[fk] = item[fk];
      }
    }
    var kozzDataStr = Object.keys(kozzFields).length > 0 ? JSON.stringify(kozzFields) : '';

    // Separate modifiers into normal (skill/location) and gated (set_equipped, AP, etc.)
    var normalMods = [];
    var gatedMods = [];

    for (var m = 0; m < modifiers.length; m++) {
      var mod = modifiers[m];
      var conditions = mod.conditions || [];
      var hasGated = false;

      for (var c = 0; c < conditions.length; c++) {
        if (GATED_CONDITION_TYPES.indexOf(conditions[c].type) >= 0) {
          hasGated = true;
          break;
        }
      }

      if (hasGated) {
        gatedMods.push(mod);
      } else {
        normalMods.push(mod);
      }
    }

    // Build additional_data from gated modifiers
    // Format: {condType: {target: {value: {skill: {location: {stat: val}}}}}}
    var gatedObj = {};
    for (var g = 0; g < gatedMods.length; g++) {
      var gm = gatedMods[g];
      var gConditions = gm.conditions || [];
      var gCondType = 'global', gTarget = 'global', gValue = '0';
      var gSkill = 'global', gLoc = 'global';

      for (var gc = 0; gc < gConditions.length; gc++) {
        var cond = gConditions[gc];
        if (GATED_CONDITION_TYPES.indexOf(cond.type) >= 0) {
          gCondType = cond.type;
          gTarget = cond.target || 'global';
          gValue = (cond.value || 0).toString();
        } else if (cond.type === 'skill_activity') {
          gSkill = cond.target || 'global';
        } else if (cond.type === 'location' || cond.type === 'region') {
          gLoc = cond.target || 'global';
        }
      }

      if (!gatedObj[gCondType]) gatedObj[gCondType] = {};
      if (!gatedObj[gCondType][gTarget]) gatedObj[gCondType][gTarget] = {};
      if (!gatedObj[gCondType][gTarget][gValue]) gatedObj[gCondType][gTarget][gValue] = {};
      if (!gatedObj[gCondType][gTarget][gValue][gSkill]) gatedObj[gCondType][gTarget][gValue][gSkill] = {};
      if (!gatedObj[gCondType][gTarget][gValue][gSkill][gLoc]) gatedObj[gCondType][gTarget][gValue][gSkill][gLoc] = {};

      gatedObj[gCondType][gTarget][gValue][gSkill][gLoc][gm.stat] = gm.value;
    }

    var additionalDataStr = Object.keys(gatedObj).length > 0 ? JSON.stringify(gatedObj) : '';

    // Group normal modifiers by quality (for crafted items)
    var qualityGroups = {};
    var noQualityMods = [];
    for (var nm = 0; nm < normalMods.length; nm++) {
      var nmod = normalMods[nm];
      var qual = nmod._quality || '';
      if (qual) {
        if (!qualityGroups[qual]) qualityGroups[qual] = [];
        qualityGroups[qual].push(nmod);
      } else {
        noQualityMods.push(nmod);
      }
    }

    var isFirst = true;

    // Helper to build a sheet row
    function makeRow(skillVal, locVal, statVal, valueVal, qualVal) {
      var r = {};
      if (tabName === 'Gear') {
        r.name = isFirst ? name : '';
        r.export_item_name = isFirst ? (item.export_item_name || '') : '';
        r.gear_set_export = isFirst ? (item.gear_set_export || '') : '';
        r.slot = isFirst ? (item.slot || '') : '';
        r.keywords = isFirst ? kwStr : '';
        r.rarity = isFirst ? (item.rarity || '') : '';
        r.is_crafted = isFirst ? (item.is_crafted || '') : '';
        r.quality = qualVal || '';
        r.item_value = '';
        r.skill = skillVal;
        r.location = locVal;
        r.stat = statVal;
        r.value = valueVal;
        r.icon = isFirst ? (item.icon || '') : '';
        r.icon_color = isFirst ? (item.icon_color || '') : '';
        r.contributed_by = isFirst ? (item.contributed_by || '') : '';
        r.additional_data = isFirst ? additionalDataStr : '';
        r.kozz_data = isFirst ? kozzDataStr : '';
      } else if (tabName === 'Consumables') {
        r.name = isFirst ? name : '';
        r.export_item_name = isFirst ? (item.export_item_name || '') : '';
        r.duration = isFirst ? (item.duration || '') : '';
        r.quality = qualVal || '';
        r.item_value = '';
        r.skill = skillVal;
        r.location = locVal;
        r.stat = statVal;
        r.value = valueVal;
        r.icon = isFirst ? (item.icon || '') : '';
        r.icon_color = isFirst ? (item.icon_color || '') : '';
        r.contributed_by = isFirst ? (item.contributed_by || '') : '';
        r.additional_data = isFirst ? additionalDataStr : '';
        r.kozz_data = isFirst ? kozzDataStr : '';
      } else if (tabName === 'Collectibles') {
        r.name = isFirst ? name : '';
        r.export_item_name = isFirst ? (item.export_item_name || '') : '';
        r.item_value = isFirst ? (item.value || '') : '';
        r.skill = skillVal;
        r.location = locVal;
        r.stat = statVal;
        r.value = valueVal;
        r.icon = isFirst ? (item.icon || '') : '';
        r.icon_color = isFirst ? (item.icon_color || '') : '';
        r.contributed_by = isFirst ? (item.contributed_by || '') : '';
        r.additional_data = isFirst ? additionalDataStr : '';
        r.kozz_data = isFirst ? kozzDataStr : '';
      } else if (tabName === 'Pets') {
        r.name = isFirst ? name : '';
        r.export_item_name = isFirst ? (item.export_item_name || '') : '';
        r.egg_value = isFirst ? (item.value || '') : '';
        r.level = qualVal || '';
        r.xp_to_next_level = '';
        r.skill = skillVal;
        r.location = locVal;
        r.stat = statVal;
        r.value = valueVal;
        r.icon = isFirst ? (item.icon || '') : '';
        r.icon_color = isFirst ? (item.icon_color || '') : '';
        r.contributed_by = isFirst ? (item.contributed_by || '') : '';
        r.additional_data = isFirst ? additionalDataStr : '';
        r.kozz_data = isFirst ? kozzDataStr : '';
      } else if (tabName === 'Inputs') {
        r.name = isFirst ? name : '';
        r.export_item_name = isFirst ? (item.export_item_name || '') : '';
        r.quality = qualVal || '';
        r.item_value = '';
        r.skill = skillVal;
        r.location = locVal;
        r.stat = statVal;
        r.value = valueVal;
        r.icon = isFirst ? (item.icon || '') : '';
        r.icon_color = isFirst ? (item.icon_color || '') : '';
        r.contributed_by = isFirst ? (item.contributed_by || '') : '';
        r.additional_data = isFirst ? additionalDataStr : '';
        r.kozz_data = isFirst ? kozzDataStr : '';
      }
      isFirst = false;
      return r;
    }

    // Extract skill + location from a modifier's conditions
    function extractSkillLoc(mod) {
      var skill = 'global', loc = 'global';
      var conds = mod.conditions || [];
      for (var ci = 0; ci < conds.length; ci++) {
        if (conds[ci].type === 'skill_activity') skill = conds[ci].target || 'global';
        if (conds[ci].type === 'location' || conds[ci].type === 'region') loc = conds[ci].target || 'global';
      }
      return { skill: skill, loc: loc };
    }

    // Emit rows: no-quality mods first, then quality groups
    if (noQualityMods.length > 0) {
      for (var nq = 0; nq < noQualityMods.length; nq++) {
        var sl = extractSkillLoc(noQualityMods[nq]);
        allSheetRows.push(makeRow(sl.skill, sl.loc, noQualityMods[nq].stat, noQualityMods[nq].value, ''));
      }
    }

    var qualOrder = Object.keys(qualityGroups);
    for (var qi = 0; qi < qualOrder.length; qi++) {
      var qName = qualOrder[qi];
      var qMods = qualityGroups[qName];
      for (var qm = 0; qm < qMods.length; qm++) {
        var sl2 = extractSkillLoc(qMods[qm]);
        var qLabel = (qm === 0) ? qName : '';
        allSheetRows.push(makeRow(sl2.skill, sl2.loc, qMods[qm].stat, qMods[qm].value, qLabel));
      }
    }

    // If no modifiers at all, still emit one metadata row
    if (normalMods.length === 0 && gatedMods.length === 0) {
      allSheetRows.push(makeRow('', '', '', '', ''));
    }
  }

  // Now upsert using existing multi-row logic
  return upsertMultiRows(sheet, headers, allSheetRows);
}


/**
 * Update the Sync Status tab with the last sync timestamp for a tool.
 *
 * Each tool gets one row. If the row exists, update the timestamp.
 * If not, append a new row.
 *
 * Pre-seeded rows:
 *   - "walkscape_optimizer" — updated by the Walkscape server sync
 *   - "kozz" — available for kozz to update via POST
 *
 * Example POST body:
 * {
 *   "action": "update_sync_status",
 *   "tool": "walkscape_optimizer",
 *   "timestamp": "2026-03-10T10:05:00.000Z"
 * }
 */
function updateSyncStatus(ss, toolName, timestamp) {
  var sheet = ss.getSheetByName('Sync Status');
  if (!sheet) {
    return { success: false, error: 'Sync Status tab not found. Run initializeTabs() first.' };
  }

  var data = sheet.getDataRange().getValues();

  // Find existing row for this tool (column 0 = tool name)
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim().toLowerCase() === toolName.toLowerCase()) {
      // Update timestamp in column 1
      sheet.getRange(i + 1, 2).setValue(timestamp);
      return { success: true, action: 'updated', tool: toolName, timestamp: timestamp };
    }
  }

  // Not found — append new row
  sheet.appendRow([toolName, timestamp]);
  return { success: true, action: 'created', tool: toolName, timestamp: timestamp };
}


/**
 * Check if sync is paused.
 *
 * Looks for a row with tool="_config" in the Sync Status tab.
 * Column C (sync_paused) is a native checkbox (TRUE/FALSE boolean).
 */
function isSyncPaused(ss) {
  var sheet = ss.getSheetByName('Sync Status');
  if (!sheet) return false;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === '_config') {
      var val = data[i][2];
      // Checkbox returns boolean true/false; also handle string "true"
      return val === true || (typeof val === 'string' && val.trim().toLowerCase() === 'true');
    }
  }
  return false;
}


/**
 * Set the sync paused state.
 *
 * Creates or updates the "_config" row in the Sync Status tab.
 * Column C (sync_paused) is a native checkbox (TRUE/FALSE boolean).
 */
function setSyncPaused(ss, paused) {
  var sheet = ss.getSheetByName('Sync Status');
  if (!sheet) {
    return { success: false, error: 'Sync Status tab not found.' };
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === '_config') {
      var cell = sheet.getRange(i + 1, 3);
      cell.setValue(paused ? true : false);
      // Ensure it's a checkbox
      cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      return { success: true, paused: paused };
    }
  }

  // No _config row yet — create it
  var newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1).setValue('_config');
  sheet.getRange(newRow, 2).setValue('');
  var cell = sheet.getRange(newRow, 3);
  cell.setValue(paused ? true : false);
  cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  return { success: true, paused: paused };
}
