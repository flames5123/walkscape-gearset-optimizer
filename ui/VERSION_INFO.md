# Version Info Display

## What It Does

Shows the last commit time in the "About Walkscape Optimizer" modal.

Example: "Last updated: 2026-02-09 23:53:42 -0800 (2 minutes ago)"

## How It Works

**Simple**: The API calls `git log` directly every time someone opens the About modal.

- No files to maintain
- No scripts to run
- No manual updates needed
- Always shows the actual latest commit
- Git calculates the relative time correctly

## Files Changed

1. **ui/static/index.html** - Added version display section
2. **ui/static/css/styles.css** - Styled the version section
3. **ui/static/js/about.js** - Fetches version from API
4. **ui/app.py** - `/api/version` endpoint runs git commands
5. **ui/Dockerfile** - Installs git in container

## That's It!

Just commit and push. The version info will automatically show the correct commit time.

Works in:
- ✅ Local development (reads from your local git)
- ✅ Docker (reads from mounted git directory)
- ✅ Home server (reads from git after deploy)

No maintenance required!
