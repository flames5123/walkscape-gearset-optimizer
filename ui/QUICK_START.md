# Bug Report System - Quick Start

## For Users

### How to Report a Bug

1. **Click the Report Button**
   - Look for the dark red megaphone button (📢) in the top-right corner of the header
   - It's next to the settings gear icon

2. **Describe the Issue**
   - A modal will open with a text field
   - Describe what happened in detail
   - You have up to 5000 characters

3. **Submit**
   - Click "Submit Report"
   - The system will automatically:
     - Capture screenshots of all tabs
     - Save your current settings
     - Record browser information
   - You'll see a success message when done

4. **Continue Using the App**
   - Your report is saved
   - You can continue using the app normally
   - Your settings won't be affected

### What Gets Included

Your report automatically includes:
- ✓ Screenshots of Character, Gear, and Activity tabs
- ✓ Your character data (skills, reputation, items)
- ✓ Your current gear sets
- ✓ Browser name and version
- ✓ Screen resolution
- ✓ App version
- ✓ Timestamp

### Privacy

- Your report is stored locally in the database
- Only you and the developer can see it
- Character names are visible in screenshots
- No passwords or sensitive data are collected

## For Developers

### Quick Review

```bash
# Navigate to UI directory
cd ui

# Run review tool
python3 review_bug_reports.py

# Follow prompts to review reports
```

### Review Options

When viewing a report, you can:
- `[m]` Mark as reviewed (requires your name)
- `[e]` Export screenshots to files
- `[s]` Skip to next report
- `[q]` Quit

### Export Screenshots

Screenshots are exported to:
```
bug_report_screenshots/
└── {report-id}/
    ├── character_data.png
    ├── gear_stats.png
    └── activity_craft_selection.png
```

### Database Location

Reports are stored in:
```
ui/sessions.db
```

Table: `bug_reports`

### API Testing

Test the API endpoints:

```bash
# List unreviewed reports
curl http://localhost:8000/api/bug-reports?reviewed=false

# Get specific report
curl http://localhost:8000/api/bug-reports/{report-id}

# Mark as reviewed
curl -X PATCH http://localhost:8000/api/bug-reports/{report-id}/review \
  -H "Content-Type: application/json" \
  -d '{"reviewed_by": "Your Name", "notes": "Fixed in v1.0.1"}'
```

## Troubleshooting

### Button Not Visible
- Check if header is rendered
- Look for red megaphone icon next to settings
- Try refreshing the page

### Modal Not Opening
- Check browser console for errors
- Verify JavaScript is enabled
- Try different browser

### Screenshots Not Capturing
- Check if html2canvas loaded from CDN
- Verify internet connection
- Check browser console for errors

### Submission Fails
- Check network tab for API errors
- Verify server is running
- Check database permissions

## Testing

Run the test suite to verify everything works:

```bash
python3 ui/test_bug_report_system.py
```

Expected output:
```
✓ Database initialized
✓ Created test session
✓ Created bug report
✓ Found unreviewed reports
✓ Marked as reviewed
✓ All tests passed!
```

## Need Help?

1. Check `BUG_REPORT_SYSTEM.md` for detailed documentation
2. Run `test_bug_report_system.py` to verify setup
3. Check browser console for JavaScript errors
4. Review server logs for API errors

## Version

Current version: 1.0.0

Last updated: February 1, 2025
