# Database Migrations

This folder contains SQL migration files that modify the database schema.

## Naming Convention

Migrations must be named: `YYYYMMDD_HHMMSS_description.sql`

Example: `20250209_143000_add_user_preferences.sql`

## Creating a Migration

1. Create a new file with the current timestamp:
   ```bash
   touch migrations/$(date +%Y%m%d_%H%M%S)_your_description.sql
   ```

2. Write your SQL in the file:
   ```sql
   -- Add a new column to the gearsets table
   ALTER TABLE gearsets ADD COLUMN notes TEXT;
   
   -- Create an index
   CREATE INDEX idx_gearsets_user ON gearsets(user_id);
   ```

3. Commit and push to GitHub

4. On your home PC, run `./deploy.sh` or just `python3 apply_migrations.py`

## Migration Guidelines

- **One-way only**: Migrations should only go forward, no rollbacks
- **Idempotent when possible**: Use `IF NOT EXISTS` clauses
- **Test locally first**: Always test migrations on your dev machine
- **Backup before major changes**: Consider backing up sessions.db before big schema changes

## Example Migrations

### Adding a column
```sql
ALTER TABLE gearsets ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

### Creating a table
```sql
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT,
    UNIQUE(user_id, preference_key)
);
```

### Creating an index
```sql
CREATE INDEX IF NOT EXISTS idx_gearsets_activity ON gearsets(activity_type);
```

## Checking Migration Status

To see which migrations have been applied:
```sql
sqlite3 sessions.db "SELECT * FROM schema_migrations ORDER BY applied_at;"
```

## Manual Application

If you need to manually apply a migration:
```bash
sqlite3 sessions.db < migrations/20250209_143000_your_migration.sql
```

Then record it:
```bash
sqlite3 sessions.db "INSERT INTO schema_migrations (filename) VALUES ('20250209_143000_your_migration.sql');"
```
