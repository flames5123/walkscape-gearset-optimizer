# Walkscape UI - Web Interface

A modern web interface for the Walkscape Optimizer Toolkit. Import your character, manage gear sets, and optimize your gameplay through an intuitive browser-based UI.

## Features

- 📊 **Character Management** - Import and view your character stats, skills, and reputation
- 🎒 **Gear Set Manager** - Create, edit, and organize multiple gear sets
- 🎯 **Activity Optimizer** - Find the best gear for any activity
- 🔨 **Crafting Optimizer** - Optimize gear for crafting recipes
- 🗺️ **Travel Optimizer** - Plan efficient routes between locations
- 📈 **Real-time Stats** - See how gear affects your performance
- 💾 **Session Persistence** - Your data is saved automatically
- 🐛 **Bug Reporting** - Built-in bug report system with screenshots

## Quick Start

### First-Time Setup

**Initialize the database:**
```bash
cd ui
python3 init_database.py
```

This creates `sessions.db` with all required tables. See [DATABASE_SETUP.md](DATABASE_SETUP.md) for details.

### Option 1: Docker (Recommended for Linux)

```bash
cd ui
./run-docker.sh start
```

Open http://localhost:6969 in your browser.

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for detailed Docker instructions.

### Option 2: Local Python

```bash
# Install dependencies
pip install -r ui/requirements.txt

# Run the server
cd ui
uvicorn app:app --host 0.0.0.0 --port 6969

# Or use the Python module syntax from project root
uvicorn ui.app:app --host 0.0.0.0 --port 6969
```

Open http://localhost:6969 in your browser.

## System Requirements

**Minimum:**
- Python 3.11+
- 512MB RAM
- Modern web browser (Chrome, Firefox, Safari, Edge)

**For Docker:**
- Docker 20.10+
- Docker Compose 1.29+

## Project Structure

```
ui/
├── app.py                  # FastAPI application
├── database.py             # SQLite database manager
├── catalog.py              # Item catalog builder
├── optimize_worker.py      # Background optimization worker
├── requirements.txt        # Python dependencies
├── sessions.db             # SQLite database (auto-created)
├── static/                 # Frontend files
│   ├── index.html         # Main HTML page
│   ├── css/
│   │   └── styles.css     # Styles
│   └── js/
│       ├── main.js        # Main application logic
│       └── components/    # UI components
├── Dockerfile             # Docker image definition
├── docker-compose.yml     # Docker Compose config
├── run-docker.sh          # Quick start script
├── DOCKER_SETUP.md        # Docker documentation
└── README.md              # This file
```

## API Endpoints

The UI provides a REST API for all operations:

### Session Management
- `GET /api/session/{uuid}` - Get or create session
- `POST /api/session/{uuid}/import` - Import character data
- `PATCH /api/session/{uuid}/config` - Update configuration

### Gear Sets
- `GET /api/session/{uuid}/gearsets` - List all gear sets
- `POST /api/session/{uuid}/gearsets` - Create/update gear set
- `DELETE /api/session/{uuid}/gearsets/{id}` - Delete gear set

### Static Data
- `GET /api/items` - Get item catalog
- `GET /api/catalog` - Get flat item list
- `GET /api/skills` - Get skill definitions
- `GET /api/activities` - Get activity data

### Bug Reports
- `POST /api/bug-reports` - Submit bug report
- `GET /api/bug-reports` - List bug reports
- `PATCH /api/bug-reports/{id}/review` - Mark as reviewed

Full API documentation: http://localhost:6969/docs (when running)

## Usage Guide

### 1. Import Your Character

1. In Walkscape: Settings > Account > Export Character Data
2. Copy the JSON text
3. In the UI: Click "Import Character" button
4. Paste the JSON and click "Import"

Your character data is now loaded and saved to your session.

### 2. Create Gear Sets

**From Current Gear:**
1. Import your character (includes equipped gear)
2. Click "Save Current Gear" in the Gear tab
3. Name your gear set

**From Scratch:**
1. Click "New Gear Set" in the Gear tab
2. Click each slot to select items
3. Name and save

**From Export String:**
1. In Walkscape: Equipment > Gear sets > Export Gearset
2. In the UI: Click "Import Gear Set"
3. Paste the export string

### 3. Optimize Gear

**For Activities:**
1. Go to Activity tab
2. Select an activity (e.g., "Skate Skiing")
3. Choose optimization goal (steps/reward, XP/step, etc.)
4. Click "Optimize"
5. View results and export to game

**For Crafting:**
1. Go to Crafting tab
2. Select a recipe (e.g., "Iron Sickle")
3. Select a service (e.g., "Tidal Workshop")
4. Choose target quality (Normal, Good, Great, etc.)
5. Click "Optimize"
6. View materials needed and export gear

**For Travel:**
1. Go to Travel tab
2. Select start and end locations
3. Click "Optimize Route"
4. View route and gear recommendations

### 4. Manage Settings

Click the gear icon (⚙️) in the top-right to:
- Toggle owned items filter
- Set character level manually
- Configure optimization preferences
- View session information

### 5. Report Bugs

Click the megaphone icon (📢) to report issues:
- Describe the problem
- Screenshots are captured automatically
- Your settings are included
- Submit and continue using the app

## Configuration

### Database Location

Data is stored in `ui/sessions.db` (SQLite).

To reset all data:
```bash
rm ui/sessions.db
```

### Port Configuration

**Local Python:**
```bash
uvicorn ui.app:app --host 0.0.0.0 --port 8080
```

**Docker:**
Edit `ui/docker-compose.yml`:
```yaml
ports:
  - "8080:6969"
```

### CORS Settings

For production, edit `ui/app.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Development

### Running Tests

```bash
# API tests
python3 ui/tests/test_api.py

# Database tests
python3 ui/tests/test_database.py

# Catalog tests
python3 ui/tests/test_catalog.py

# All tests
python3 -m pytest ui/tests/
```

### Live Reload

For development with auto-reload:
```bash
uvicorn ui.app:app --reload --host 0.0.0.0 --port 6969
```

### Debugging

Enable debug logging:
```python
# In ui/app.py
import logging
logging.basicConfig(level=logging.DEBUG)
```

View logs:
```bash
# Docker
docker-compose logs -f

# Local
# Logs appear in terminal
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 6969
lsof -i :6969

# Kill the process
kill -9 <PID>

# Or use a different port
uvicorn ui.app:app --port 8080
```

### Database Locked

```bash
# Stop the server
# Remove lock file
rm ui/sessions.db-journal

# Restart
```

### Import Errors

```bash
# Ensure you're in the project root
cd /path/to/walkscape-optimizer

# Run with module syntax
python3 -m uvicorn ui.app:app --host 0.0.0.0 --port 6969
```

### Static Files Not Loading

Check that paths are correct:
- Static files: `ui/static/`
- Assets: `assets/` (in project root)

The app mounts both directories:
- `/static` → `ui/static/`
- `/assets` → `assets/`

### Character Import Fails

Common issues:
- Invalid JSON format
- Old export format (re-export from game)
- Missing required fields

Check the error message in the UI for details.

## Performance

### Optimization Speed

Typical optimization times:
- Activity: 0.2-0.5 seconds
- Crafting: 1-3 seconds
- Travel: 3-5 seconds (for 66 routes)

### Database Size

Expected database growth:
- Empty: ~100KB
- With character + 10 gear sets: ~500KB
- With 100 bug reports: ~5MB

### Memory Usage

Typical memory usage:
- Server: 50-100MB
- Browser: 100-200MB

## Security Notes

**Default setup is for local use only:**
- No authentication
- HTTP only (no HTTPS)
- Permissive CORS
- World-readable database

**For production:**
1. Add authentication middleware
2. Use HTTPS with valid certificates
3. Restrict CORS origins
4. Set secure cookie flags
5. Use proper database permissions
6. Consider PostgreSQL instead of SQLite

## Browser Compatibility

Tested and working on:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

Requires:
- JavaScript enabled
- LocalStorage enabled
- Cookies enabled

## Contributing

When contributing to the UI:

1. **Follow the style guide** - See `STYLE_GUIDE.md`
2. **Test your changes** - Run the test suite
3. **Update documentation** - Keep README.md current
4. **Check browser compatibility** - Test in multiple browsers

## Support

For issues or questions:

1. Check this README
2. Check [DOCKER_SETUP.md](DOCKER_SETUP.md) for Docker issues
3. Check [QUICK_START.md](QUICK_START.md) for bug reporting
4. Review the main project [README.md](../README.md)
5. Check the API docs at http://localhost:6969/docs

## Version

UI Version: 1.0.0

Last updated: February 5, 2026

## License

Part of the Walkscape Optimizer Toolkit.

Data extracted from the [Walkscape Wiki](https://wiki.walkscape.app/).
