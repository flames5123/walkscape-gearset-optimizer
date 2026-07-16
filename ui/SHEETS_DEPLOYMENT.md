# Google Sheets Sync — Deployment Guide

## Current Status
- **Test sheet** is fully wired up for development
- **Live sheet** needs the same setup steps applied

## Test Sheet (done)
- Sheet ID: `YOUR_TEST_SHEET_ID`
- Apps Script webhook: `https://script.google.com/macros/s/YOUR_APPS_SCRIPT_DEPLOYMENT_ID/exec`

## Steps to Deploy the Live Sheet

### 1. Set up the live Google Sheet
1. Open: https://docs.google.com/spreadsheets/d/1UvX2R5a5tCPEo30gXtF8fnWgu2DbXhzUwK-S7UF81aE
2. Go to **Extensions > Apps Script**
3. Delete any existing code in `Code.gs`
4. Paste the contents of `ui/sheets_apps_script.js`
5. Save (Ctrl+S)
6. Select `initializeTabs` from the function dropdown → click ▶ Run
7. Authorize when prompted (Google permissions)
8. Verify all 6 tabs were created: Activities, Recipes, Services, Gear, Consumables, Pets

### 2. Deploy the Apps Script as a Web App
1. In the Apps Script editor, click **Deploy > New deployment**
2. Click the gear icon → select **Web app**
3. Settings:
   - Description: `Walkscape Live Sync`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Copy the Web app URL (looks like `https://script.google.com/macros/s/.../exec`)

### 3. Make the sheet publicly readable
1. In the spreadsheet, click **Share** (top right)
2. Under "General access", change to **Anyone with the link → Viewer**

### 4. Get the tab GIDs
1. Click each tab in the spreadsheet
2. Note the `#gid=XXXXXXX` from the URL bar
3. Update `ui/sheets_config.py` — set the GIDs in the `TABS` dict for the live sheet
   (or if both sheets have the same GIDs after running initializeTabs, no change needed)

### 5. Set environment variables on the home server
Add to `docker-compose-homeserver.yml` under `environment:`:
```yaml
environment:
  - PYTHONUNBUFFERED=1
  - PYTHONPATH=/app
  - UVICORN_RELOAD=true
  - WALKSCAPE_ENV=production
  - WALKSCAPE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
```

### 6. Verify
```bash
# On the server, after deploying:
curl http://localhost:6969/api/sheets-sync/status

# Trigger a manual sync:
curl -X POST http://localhost:6969/api/sheets-sync/refresh
```

## How It Works
- **Reads**: CSV export from the public Google Sheet (no auth, no API key)
- **Writes**: POST JSON to the Apps Script webhook (deployed as web app)
- **Sync interval**: Every 5 minutes (background task in FastAPI)
- **Conflict resolution**: Sheet data only overwrites `source='sheet'` rows in the DB. User-created definitions are never touched.
- **Stale cleanup**: If a row is removed from the sheet, the corresponding `source='sheet'` DB entry is also removed on next sync.

## Sharing with the Other Site
The other person's site can:
1. **Read** from the same sheet using CSV export URLs (same as us)
2. **Write** by deploying their own Apps Script on the same sheet, or by using the same webhook URL
3. Both sites publish shared definitions → both sites read them → community data stays in sync

The sheet acts as the shared truth for community-contributed data. Each site's user-created definitions stay local to their own database.
