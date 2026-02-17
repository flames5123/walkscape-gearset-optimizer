#!/usr/bin/env python3
"""
Initialize a fresh sessions.db database with proper schema.

This script creates a new database file with all required tables.
Run this when setting up the application for the first time.

Usage:
    python3 init_database.py [--force]

Options:
    --force    Overwrite existing database (WARNING: destroys all data)
"""

import sys
import os
from pathlib import Path
from database import DatabaseManager


def init_database(db_path: str = "sessions.db", force: bool = False):
    """Initialize a fresh database.
    
    Args:
        db_path: Path to database file
        force: If True, overwrite existing database
    """
    db_file = Path(db_path)
    
    # Check if database already exists
    if db_file.exists():
        if not force:
            print(f"❌ Database already exists at {db_path}")
            print("   Use --force to overwrite (WARNING: destroys all data)")
            return False
        else:
            print(f"⚠️  Removing existing database at {db_path}")
            db_file.unlink()
    
    print(f"📝 Creating new database at {db_path}")
    
    # Create database manager (this initializes the schema)
    db = DatabaseManager(db_path)
    
    print("✓ Database initialized successfully!")
    print("\nCreated tables:")
    print("  - sessions (user session data)")
    print("  - gear_sets (saved gear configurations)")
    print("  - bug_reports (user-submitted issues)")
    print("  - api_access_audit (API usage tracking)")
    print("  - schema_migrations (migration tracking)")
    
    return True


def main():
    """Main entry point."""
    force = '--force' in sys.argv
    
    if force:
        print("⚠️  WARNING: Force mode enabled - existing database will be destroyed!")
        response = input("Are you sure? Type 'yes' to continue: ")
        if response.lower() != 'yes':
            print("Aborted.")
            return
    
    success = init_database(force=force)
    
    if success:
        print("\n🎉 Database is ready to use!")
        print("\nNext steps:")
        print("  1. Start the application: docker-compose up -d")
        print("  2. Access the UI at http://localhost:6969")
    else:
        sys.exit(1)


if __name__ == '__main__':
    main()
