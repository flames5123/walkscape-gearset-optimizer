# Bug Report System

## Overview

The bug report system allows users to submit detailed bug reports directly from the UI. Each report includes:

- User's description of the issue
- Screenshots of all tabs/pages
- Complete session state snapshot (frozen at report time)
- Browser and app version information
- Timestamp

## User Flow

1. User clicks the red megaphone button (📢) in the top-right header
2. Modal opens with a description field
3. User describes what happened
4. User clicks "Submit Report"
5. System automatically:
   - Captures screenshots of all tabs (Character, Gear, Activity)
   - Creates a snapshot of current session (new UUID)
   - Copies all character data, UI config, and gear sets to snapshot
   - Collects browser info (name, version, platform, screen size)
   - Stores everything in database

## Database Schema

### `bug_reports` Table

```sql
CREATE TABLE bug_reports (
    id TEXT PRIMARY KEY,                    -- Report UUID
    original_session_uuid TEXT NOT NULL,    -- User's current session
    snapshot_session_uuid TEXT NOT NULL,    -- Frozen snapshot session
    description TEXT NOT NULL,              -- User's description
    app_version TEXT NOT NULL,              -- App version (1.0.0)
    browser_info TEXT NOT NULL,             -- JSON browser details
    timestamp TIMESTAMP,                    -- When submitted
    screenshots_json TEXT,                  -- JSON: {tab_name: base64_data}
    reviewed BOOLEAN DEFAULT 0,             -- Review status
    reviewed_at TIMESTAMP,                  -- When reviewed
    reviewed_by TEXT,                       -- Reviewer name
    notes TEXT                              -- Review notes
)
```

## API Endpoints

### Submit Bug Report
```
POST /api/bug-reports
Body: {
    description: string (required, 1-5000 chars),
    app_version: string,
    browser_info: string (JSON),
    screenshots: {tab_name: base64_data}
}
Response: {
    success: true,
    report: {...}
}
```

### List Bug Reports
```
GET /api/bug-reports?reviewed=false
Response: {
    reports: [...],
    count: number
}
```

### Get Report Details
```
GET /api/bug-reports/{report_id}
Response: {
    report: {...},
    snapshot_session: {...},
    snapshot_gear_sets: [...]
}
```

### Mark as Reviewed
```
PATCH /api/bug-reports/{report_id}/review
Body: {
    reviewed_by: string (required),
    notes: string (optional)
}
Response: {
    success: true,
    message: "..."
}
```

## Review Tool

### Running the Review Tool

```bash
cd ui
python3 review_bug_reports.py
```

### Features

1. **List Unreviewed Reports**
   - Shows all unreviewed reports with summaries
   - Displays report ID, timestamp, and description preview

2. **Review Individual Reports**
   - Full report details (description, browser info, timestamps)
   - Session snapshot data (character, skills, reputation, gear sets)
   - Screenshot information

3. **Options per Report**
   - `[m]` Mark as reviewed (requires reviewer name)
   - `[e]` Export screenshots to files
   - `[s]` Skip to next report
   - `[q]` Quit review session

4. **Screenshot Export**
   - Exports to `bug_report_screenshots/{report_id}/`
   - One PNG file per tab
   - Preserves original quality

### Example Review Session

```
================================================================================
BUG REPORT REVIEW TOOL
================================================================================

Found 3 unreviewed report(s)

================================================================================
REPORT 1 of 3
================================================================================

Report ID: abc123...
Submitted: 2025-02-01T10:30:00
App Version: 1.0.0
Browser: Chrome 120.0
Platform: MacIntel
Screen: 1920x1080 (viewport: 1440x900)

Description:
--------------------------------------------------------------------------------
When I select Iron Sickle recipe, the materials section doesn't update
--------------------------------------------------------------------------------

Screenshots: 3 captured
  - Character Data
  - Gear Stats
  - Activity/Craft Selection

Session UUIDs:
  Original: user-session-uuid
  Snapshot: snapshot-uuid

================================================================================
SNAPSHOT SESSION DATA
================================================================================

  Character: TestUser
  Steps: 1,234,567
  Achievement Points: 150
  Coins: 50,000

  Skills:
    agility: 45
    carpentry: 30
    smithing: 52

  Gear Sets: 2
    - Travel Set
    - Crafting Set

================================================================================

Options:
  [m] Mark as reviewed
  [e] Export screenshots
  [s] Skip to next
  [q] Quit

Choice: m
Your name: John
Notes (optional): Fixed in v1.0.1

✓ Report abc123... marked as reviewed
```

## Frontend Components

### Bug Report Button
- Location: Header bar, top-right
- Style: Dark red background (#8b0000)
- Icon: Megaphone/alert icon
- Hover: Scales up slightly

### Bug Report Modal
- Max width: 600px
- Fields:
  - Description textarea (required, 5000 char limit)
  - Character counter
  - Status messages (info/success/error)
- Buttons:
  - Cancel (secondary)
  - Submit Report (primary, with spinner)

### Screenshot Capture
- Uses html2canvas library (CDN)
- Captures each column/tab separately
- Temporarily shows hidden tabs for capture
- Converts to base64 PNG data
- Includes in report submission

## Browser Info Collected

```javascript
{
    name: "Chrome",
    version: "120.0",
    userAgent: "Mozilla/5.0...",
    platform: "MacIntel",
    language: "en-US",
    screenResolution: "1920x1080",
    viewportSize: "1440x900"
}
```

## Session Snapshot

When a report is submitted, the system:

1. Creates new session UUID for snapshot
2. Copies `character_config` from original session
3. Copies `ui_config` from original session
4. Copies all gear sets from original session
5. Links both UUIDs in bug report

This ensures the report captures the exact state at submission time, even if the user continues using the app and changes settings.

## File Structure

```
ui/
├── app.py                      # Bug report API endpoints
├── database.py                 # Bug report CRUD methods
├── review_bug_reports.py       # Review tool (CLI)
├── sessions.db                 # SQLite database
├── static/
│   ├── index.html              # Bug report button & modal
│   ├── css/
│   │   └── styles.css          # Bug report styles
│   └── js/
│       ├── main.js             # Initializes bug report
│       └── bug_report.js       # Bug report module
└── BUG_REPORT_SYSTEM.md        # This file
```

## Future Enhancements

1. **Email Notifications**
   - Send email when new report submitted
   - Include report summary and link

2. **Web Review Interface**
   - View reports in browser instead of CLI
   - Filter by date, status, version
   - Inline screenshot viewing

3. **Report Analytics**
   - Most common issues
   - Browser/version breakdown
   - Time-to-resolution metrics

4. **Automatic Categorization**
   - Use keywords to categorize reports
   - Priority levels (low/medium/high)
   - Duplicate detection

5. **User Feedback Loop**
   - Notify users when their report is reviewed
   - Allow users to view their submitted reports
   - Status updates (investigating/fixed/wontfix)

## Troubleshooting

### Screenshots Not Capturing
- Check browser console for html2canvas errors
- Ensure CDN is accessible
- Try different browser

### Database Errors
- Check `sessions.db` file permissions
- Verify database schema is up to date
- Run migrations if needed

### Review Tool Not Finding Reports
- Check database path in `review_bug_reports.py`
- Ensure you're in the correct directory
- Verify reports exist: `sqlite3 sessions.db "SELECT COUNT(*) FROM bug_reports;"`

## Security Considerations

1. **PII in Screenshots**
   - Screenshots may contain character names
   - Consider anonymization for public sharing

2. **Session Data**
   - Snapshot sessions are separate from user sessions
   - No way to access user's live session from report

3. **Rate Limiting**
   - Consider adding rate limits to prevent spam
   - Currently no limits implemented

4. **Storage**
   - Screenshots stored as base64 in database
   - Can be large (100KB-500KB per screenshot)
   - Consider cleanup policy for old reports
