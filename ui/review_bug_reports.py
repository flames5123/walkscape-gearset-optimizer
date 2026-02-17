#!/usr/bin/env python3
"""
Bug Report Review Tool

Interactive CLI tool for reviewing submitted bug reports.
Displays unreviewed reports and allows marking them as reviewed.
"""

import sys
import json
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from ui.database import DatabaseManager

# ============================================================================
# CONFIGURATION
# ============================================================================

DATABASE_PATH = "sessions.db"  # Relative to project root, not ui/

# ============================================================================
# DISPLAY FUNCTIONS
# ============================================================================

def print_separator(char='=', length=80):
    """Print a separator line."""
    print(char * length)


def print_report_summary(report):
    """Print a summary of a bug report."""
    print(f"\nReport ID: {report['id']}")
    print(f"Submitted: {report['timestamp']}")
    print(f"App Version: {report['app_version']}")
    
    # Parse browser info
    try:
        browser_info = json.loads(report['browser_info'])
        print(f"Browser: {browser_info['name']} {browser_info['version']}")
        print(f"Platform: {browser_info['platform']}")
        print(f"Screen: {browser_info['screenResolution']} (viewport: {browser_info['viewportSize']})")
    except:
        print(f"Browser: {report['browser_info']}")
    
    print(f"\nDescription:")
    print("-" * 80)
    print(report['description'])
    print("-" * 80)
    
    # Screenshot info
    if report['screenshots_json']:
        screenshots = report['screenshots_json']
        print(f"\nScreenshots: {len(screenshots)} captured")
        for tab_name in screenshots.keys():
            print(f"  - {tab_name}")
    
    print(f"\nSession UUIDs:")
    print(f"  Original: {report['original_session_uuid']}")
    print(f"  Snapshot: {report['snapshot_session_uuid']}")


def print_session_summary(session):
    """Print a summary of session data."""
    if not session:
        print("  No session data")
        return
    
    char_config = session.get('character_config')
    if char_config:
        print(f"\n  Character: {char_config.get('name', 'Unknown')}")
        print(f"  Steps: {char_config.get('steps', 0):,}")
        print(f"  Achievement Points: {char_config.get('achievement_points', 0)}")
        print(f"  Coins: {char_config.get('coins', 0):,}")
        
        skills = char_config.get('skills', {})
        if skills:
            print(f"\n  Skills:")
            for skill, level in sorted(skills.items()):
                print(f"    {skill.capitalize()}: {level}")
        
        reputation = char_config.get('reputation', {})
        if reputation:
            print(f"\n  Reputation:")
            for faction, rep in sorted(reputation.items()):
                print(f"    {faction}: {rep}")
    else:
        print("  No character data")


def export_screenshots(report, output_dir="bug_report_screenshots"):
    """Export screenshots to files."""
    if not report['screenshots_json']:
        print("No screenshots to export")
        return
    
    # Create output directory
    report_dir = Path(output_dir) / report['id']
    report_dir.mkdir(parents=True, exist_ok=True)
    
    # Export each screenshot
    screenshots = report['screenshots_json']
    for tab_name, base64_data in screenshots.items():
        # Remove data URL prefix if present
        if ',' in base64_data:
            base64_data = base64_data.split(',', 1)[1]
        
        # Decode and save
        import base64
        image_data = base64.b64decode(base64_data)
        
        # Sanitize filename
        filename = tab_name.lower().replace(' ', '_').replace('/', '_') + '.png'
        filepath = report_dir / filename
        
        with open(filepath, 'wb') as f:
            f.write(image_data)
        
        print(f"  Exported: {filepath}")
    
    print(f"\nScreenshots exported to: {report_dir}")


# ============================================================================
# REVIEW FUNCTIONS
# ============================================================================

def review_report(db, report):
    """Interactive review of a single report."""
    print_separator()
    print_report_summary(report)
    
    # Show session data
    print("\n" + "=" * 80)
    print("SNAPSHOT SESSION DATA")
    print("=" * 80)
    
    snapshot_session = db.get_session(report['snapshot_session_uuid'])
    print_session_summary(snapshot_session)
    
    # Show gear sets
    gear_sets = db.get_gear_sets(report['snapshot_session_uuid'])
    if gear_sets:
        print(f"\n  Gear Sets: {len(gear_sets)}")
        for gs in gear_sets:
            print(f"    - {gs['name']}")
    
    print("\n" + "=" * 80)
    
    # Options
    while True:
        print("\nOptions:")
        print("  [m] Mark as reviewed")
        print("  [e] Export screenshots")
        print("  [s] Skip to next")
        print("  [q] Quit")
        
        choice = input("\nChoice: ").strip().lower()
        
        if choice == 'm':
            reviewer = input("Your name: ").strip()
            if not reviewer:
                print("Reviewer name required")
                continue
            
            notes = input("Notes (optional): ").strip()
            
            db.mark_report_reviewed(report['id'], reviewer, notes or None)
            print(f"\n✓ Report {report['id']} marked as reviewed")
            return True
        
        elif choice == 'e':
            export_screenshots(report)
        
        elif choice == 's':
            return False
        
        elif choice == 'q':
            return None
        
        else:
            print("Invalid choice")


def list_reports(db, show_reviewed=False):
    """List all reports."""
    reports = db.get_bug_reports(reviewed=False if not show_reviewed else None)
    
    if not reports:
        print("No reports found")
        return
    
    print(f"\nFound {len(reports)} report(s):")
    print_separator('-')
    
    for i, report in enumerate(reports, 1):
        status = "✓ REVIEWED" if report['reviewed'] else "○ UNREVIEWED"
        print(f"{i}. [{status}] {report['id'][:8]}... - {report['timestamp']}")
        print(f"   {report['description'][:100]}...")
        if report['reviewed']:
            print(f"   Reviewed by: {report['reviewed_by']} on {report['reviewed_at']}")
        print()


# ============================================================================
# MAIN FUNCTION
# ============================================================================

def main():
    """Main review loop."""
    print("=" * 80)
    print("BUG REPORT REVIEW TOOL")
    print("=" * 80)
    
    # Initialize database
    db = DatabaseManager(DATABASE_PATH)
    
    # Get unreviewed reports
    reports = db.get_bug_reports(reviewed=False)
    
    if not reports:
        print("\n✓ No unreviewed reports!")
        print("\nOptions:")
        print("  [l] List all reports (including reviewed)")
        print("  [q] Quit")
        
        choice = input("\nChoice: ").strip().lower()
        if choice == 'l':
            list_reports(db, show_reviewed=True)
        return
    
    print(f"\nFound {len(reports)} unreviewed report(s)")
    
    # Review each report
    for i, report in enumerate(reports, 1):
        print(f"\n\n{'=' * 80}")
        print(f"REPORT {i} of {len(reports)}")
        print(f"{'=' * 80}")
        
        result = review_report(db, report)
        
        if result is None:  # Quit
            break
        elif result:  # Marked as reviewed
            continue
        else:  # Skipped
            continue
    
    print("\n" + "=" * 80)
    print("Review session complete")
    print("=" * 80)


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
