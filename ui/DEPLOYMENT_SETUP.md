# Deployment Setup Guide

This guide explains how to set up automatic deployment from GitHub to your home server.

## Architecture

```
Dev Machine (this computer)
    ↓ git push
GitHub Private Repo
    ↓ git pull (manual or automated)
Home Server
    ↓ Flask auto-reload
Running Application
```

## Initial Setup (One-Time)

### 1. Create GitHub Repository

```bash
# On this computer (dev machine)
cd ui/
git init
git add .
git commit -m "Initial commit"

# Create a private repo on GitHub, then:
git remote add origin git@github.com:yourusername/walkscape-ui.git
git branch -M main
git push -u origin main
```

### 2. Clone on Home Server

```bash
# SSH into your home server
ssh user@your-home-server

# Clone the repo
cd /path/to/your/apps/
git clone git@github.com:yourusername/walkscape-ui.git
cd walkscape-ui

# Make deploy script executable
chmod +x deploy.sh

# Install dependencies
pip3 install -r requirements.txt
```

### 3. Set Up Docker (if using Docker)

Your existing `docker-compose.yml` should work. Just make sure it mounts the correct paths:

```yaml
volumes:
  - .:/app
  - ./sessions.db:/app/sessions.db  # Persist database
```

## Daily Workflow

### On Dev Machine (this computer)

```bash
# Make changes to code
# Test locally

# Commit and push
git add .
git commit -m "Add new feature"
git push origin main
```

### On Home Server

**Option A: Manual deployment**
```bash
cd /path/to/walkscape-ui
./deploy.sh
```

**Option B: Automated with cron (recommended)**
```bash
# Edit crontab
crontab -e

# Add this line to check for updates every 5 minutes:
*/5 * * * * cd /path/to/walkscape-ui && ./deploy.sh >> deploy.log 2>&1
```

**Option C: Webhook (advanced)**
Set up a GitHub webhook to trigger deployment on push. Requires exposing an endpoint.

## Database Migrations

### Creating a Migration

When you need to change the database schema:

```bash
# On dev machine
cd ui/

# Create migration file
touch migrations/$(date +%Y%m%d_%H%M%S)_add_user_preferences.sql

# Edit the file with your SQL
nano migrations/20250209_143000_add_user_preferences.sql
```

Example migration:
```sql
-- Add user preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT,
    UNIQUE(user_id, preference_key)
);

CREATE INDEX IF NOT EXISTS idx_prefs_user ON user_preferences(user_id);
```

```bash
# Commit and push
git add migrations/
git commit -m "Add user preferences migration"
git push origin main
```

### Applying Migrations

Migrations are automatically applied when you run `./deploy.sh` on the home server.

Or manually:
```bash
python3 apply_migrations.py
```

## Important Files

- **`deploy.sh`** - Main deployment script (pulls code, applies migrations)
- **`apply_migrations.py`** - Database migration runner
- **`migrations/`** - SQL migration files
- **`.gitignore`** - Excludes sessions.db from git
- **`sessions.db`** - Database (only on home server, never committed)

## Troubleshooting

### Flask not reloading after deployment

Check that Flask is running in development mode with auto-reload:
```python
# In app.py
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

Or in Docker:
```yaml
environment:
  - FLASK_ENV=development
  - FLASK_DEBUG=1
```

### Migration failed

1. Check the error in the output
2. Fix the migration SQL
3. If needed, manually rollback:
   ```bash
   sqlite3 sessions.db
   # Manually undo the changes
   # Delete the migration record:
   DELETE FROM schema_migrations WHERE filename = 'problematic_migration.sql';
   ```
4. Push the fixed migration

### Database conflicts

If you accidentally modified the database on both machines:

1. **Backup both databases**
   ```bash
   cp sessions.db sessions.db.backup
   ```

2. **Choose one as source of truth** (usually home server)

3. **On dev machine**: Delete local sessions.db, it will be recreated

### Git conflicts

If you have uncommitted changes on home server:
```bash
# Stash local changes
git stash

# Pull updates
git pull origin main

# Reapply local changes (if needed)
git stash pop
```

## Security Considerations

1. **Private repo**: Keep the GitHub repo private
2. **SSH keys**: Use SSH keys for authentication, not passwords
3. **Database backups**: Regularly backup sessions.db
   ```bash
   # Add to crontab for daily backups
   0 2 * * * cp /path/to/sessions.db /path/to/backups/sessions_$(date +\%Y\%m\%d).db
   ```
4. **Secrets**: Never commit API keys or passwords. Use environment variables.

## Automated Deployment with Systemd (Advanced)

For a more robust setup, create a systemd service:

```bash
# /etc/systemd/system/walkscape-deploy.service
[Unit]
Description=Walkscape UI Deployment Watcher
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/walkscape-ui
ExecStart=/usr/bin/python3 /path/to/walkscape-ui/watch_and_deploy.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Then create `watch_and_deploy.py` to poll GitHub for changes.

## Quick Reference

```bash
# Dev machine workflow
git add .
git commit -m "Description"
git push origin main

# Home server workflow (manual)
cd /path/to/walkscape-ui
./deploy.sh

# Home server workflow (automated)
# Just wait 5 minutes for cron to run

# Check migration status
sqlite3 sessions.db "SELECT * FROM schema_migrations;"

# View deployment logs (if using cron)
tail -f deploy.log
```
