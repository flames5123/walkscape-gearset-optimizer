# Database Setup Guide

## For New Installations

When setting up the Walkscape UI for the first time, you need to create the database.

### Option 1: Using the Init Script (Recommended)

```bash
cd ui/
python3 init_database.py
```

This creates a fresh `sessions.db` with all required tables:
- `sessions` - User session data (character config, UI preferences)
- `gear_sets` - Saved gear configurations
- `bug_reports` - User-submitted bug reports
- `api_access_audit` - API usage tracking
- `schema_migrations` - Database migration tracking

### Option 2: Let the App Create It

The application will automatically create the database on first run if it doesn't exist. However, using the init script is recommended as it's more explicit.

### Option 3: Docker

If running in Docker:
```bash
docker-compose run --rm walkscape-ui python3 /app/ui/init_database.py
```

## Database Location

The database file is stored at `ui/sessions.db` and is:
- ✅ Excluded from git (in `.gitignore`)
- ✅ Persisted as a Docker volume
- ✅ Unique to each installation

## Resetting the Database

**WARNING: This destroys all data!**

```bash
# Stop the application
docker-compose down

# Remove the database
rm sessions.db

# Recreate it
python3 init_database.py

# Restart the application
docker-compose up -d
```

Or use the force flag:
```bash
python3 init_database.py --force
```

## Database Schema

### sessions table
```sql
CREATE TABLE sessions (
    uuid TEXT PRIMARY KEY,
    character_config TEXT,      -- JSON: imported game data
    ui_config TEXT,             -- JSON: user preferences
    last_updated TIMESTAMP
);
```

### gear_sets table
```sql
CREATE TABLE gear_sets (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    slots_json TEXT NOT NULL,   -- JSON: gear configuration
    export_string TEXT,         -- Gearset export string
    is_optimized INTEGER,       -- 1 if from optimizer
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
    UNIQUE(session_uuid, name)
);
```

### bug_reports table
```sql
CREATE TABLE bug_reports (
    id TEXT PRIMARY KEY,
    original_session_uuid TEXT NOT NULL,
    snapshot_session_uuid TEXT NOT NULL,
    description TEXT NOT NULL,
    app_version TEXT NOT NULL,
    browser_info TEXT NOT NULL,
    timestamp TIMESTAMP,
    screenshots_json TEXT,      -- JSON: tab -> base64 screenshot
    reviewed BOOLEAN,
    reviewed_at TIMESTAMP,
    reviewed_by TEXT,
    notes TEXT,
    FOREIGN KEY (original_session_uuid) REFERENCES sessions(uuid),
    FOREIGN KEY (snapshot_session_uuid) REFERENCES sessions(uuid)
);
```

### api_access_audit table
```sql
CREATE TABLE api_access_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_uuid TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    timestamp TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);
```

### schema_migrations table
```sql
CREATE TABLE schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMP
);
```

## Migrations

Schema changes are managed via SQL migration files in `migrations/`.

See `migrations/README.md` for details on creating and applying migrations.

## Backup and Restore

### Backup
```bash
# Create a backup
cp sessions.db sessions.db.backup.$(date +%Y%m%d_%H%M%S)

# Or use sqlite3 dump
sqlite3 sessions.db .dump > backup.sql
```

### Restore
```bash
# From file copy
cp sessions.db.backup.20250209_150000 sessions.db

# From SQL dump
sqlite3 sessions.db < backup.sql
```

### Automated Backups

Add to crontab for daily backups:
```bash
crontab -e

# Add this line:
0 2 * * * cp /path/to/walkscape-ui/sessions.db /path/to/backups/sessions_$(date +\%Y\%m\%d).db
```

## Troubleshooting

### Database locked error
```bash
# Check for stale connections
lsof sessions.db

# Restart the application
docker-compose restart
```

### Corrupted database
```bash
# Check integrity
sqlite3 sessions.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
cp sessions.db.backup.YYYYMMDD_HHMMSS sessions.db
```

### Missing tables
```bash
# Reinitialize (WARNING: destroys data)
python3 init_database.py --force

# Or apply migrations
python3 apply_migrations.py
```

## Development vs Production

### Development (this computer)
- Database is local and temporary
- Can be reset anytime
- Used for testing

### Production (home server)
- Database contains real user data
- Should be backed up regularly
- Protected by `.gitignore`

## Security Notes

1. **Never commit sessions.db** - Contains user data
2. **Regular backups** - Set up automated backups
3. **File permissions** - Ensure only the app can read/write
   ```bash
   chmod 600 sessions.db
   ```
4. **Docker volumes** - Database persists even if container is removed
