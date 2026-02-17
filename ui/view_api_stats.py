#!/usr/bin/env python3
"""
View API access statistics and audit logs.

Displays usage analytics from the api_access_audit table including:
- Overall statistics (total requests, unique sessions)
- Requests by endpoint
- Requests by day
- Top active sessions
- Individual session history
"""

import sys
from datetime import datetime
from database import DatabaseManager


def print_header(title: str):
    """Print a formatted section header."""
    print(f"\n{'=' * 80}")
    print(f"  {title}")
    print(f"{'=' * 80}\n")


def print_stats(days: int = 7):
    """Print overall API access statistics.
    
    Args:
        days: Number of days to look back (default: 7)
    """
    db = DatabaseManager("sessions.db")
    stats = db.get_api_access_stats(days=days)
    
    print_header(f"API Access Statistics (Last {days} Days)")
    
    print(f"Total Requests:    {stats['total_requests']:,}")
    print(f"Unique Sessions:   {stats['unique_sessions']:,}")
    
    if stats['total_requests'] > 0:
        avg_per_session = stats['total_requests'] / max(stats['unique_sessions'], 1)
        print(f"Avg per Session:   {avg_per_session:.1f}")
    
    # Requests by endpoint
    if stats['requests_by_endpoint']:
        print_header("Requests by Endpoint")
        print(f"{'Endpoint':<50} {'Count':>10} {'%':>8}")
        print("-" * 70)
        
        total = stats['total_requests']
        for endpoint, count in sorted(stats['requests_by_endpoint'].items(), 
                                      key=lambda x: x[1], reverse=True):
            pct = (count / total * 100) if total > 0 else 0
            print(f"{endpoint:<50} {count:>10,} {pct:>7.1f}%")
    
    # Requests by day
    if stats['requests_by_day']:
        print_header("Requests by Day")
        print(f"{'Date':<15} {'Count':>10}")
        print("-" * 27)
        
        for day, count in sorted(stats['requests_by_day'].items(), reverse=True):
            print(f"{day:<15} {count:>10,}")
    
    # Top sessions
    if stats['top_sessions']:
        print_header("Top 10 Most Active Sessions")
        print(f"{'Session UUID':<40} {'Requests':>10}")
        print("-" * 52)
        
        for session_uuid, count in stats['top_sessions']:
            # Truncate UUID for display
            display_uuid = session_uuid[:36] if len(session_uuid) > 36 else session_uuid
            print(f"{display_uuid:<40} {count:>10,}")


def print_session_history(session_uuid: str, limit: int = 50):
    """Print API access history for a specific session.
    
    Args:
        session_uuid: Session UUID to query
        limit: Maximum number of records to show (default: 50)
    """
    db = DatabaseManager("sessions.db")
    logs = db.get_session_api_access(session_uuid=session_uuid, limit=limit)
    
    print_header(f"API Access History for Session: {session_uuid}")
    
    if not logs:
        print("No API access logs found for this session.")
        return
    
    print(f"Showing {len(logs)} most recent requests:\n")
    print(f"{'Timestamp':<20} {'Method':<8} {'Endpoint':<40}")
    print("-" * 70)
    
    for log in logs:
        timestamp = log['timestamp'][:19]  # Trim microseconds
        method = log['method']
        endpoint = log['endpoint']
        
        # Truncate long endpoints
        if len(endpoint) > 40:
            endpoint = endpoint[:37] + "..."
        
        print(f"{timestamp:<20} {method:<8} {endpoint:<40}")
    
    # Summary stats for this session
    print(f"\n{'=' * 70}")
    print(f"Total requests shown: {len(logs)}")
    
    # Count by endpoint
    endpoint_counts = {}
    for log in logs:
        endpoint = log['endpoint']
        endpoint_counts[endpoint] = endpoint_counts.get(endpoint, 0) + 1
    
    print(f"\nEndpoint breakdown:")
    for endpoint, count in sorted(endpoint_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {endpoint}: {count}")


def print_usage():
    """Print usage instructions."""
    print("Usage:")
    print("  python view_api_stats.py                    # Show 7-day stats")
    print("  python view_api_stats.py --days 30          # Show 30-day stats")
    print("  python view_api_stats.py --session UUID     # Show session history")
    print("  python view_api_stats.py --session UUID --limit 100  # Show more history")


def main():
    """Main entry point."""
    args = sys.argv[1:]
    
    # Debug: print args
    # print(f"DEBUG: args = {args}")
    
    # Parse arguments
    if not args or args[0] in ['-h', '--help']:
        print_usage()
        return
    
    if args[0] == '--days':
        if len(args) < 2:
            print("Error: --days requires a number")
            print_usage()
            return
        
        try:
            days = int(args[1])
            print_stats(days=days)
        except ValueError as e:
            print(f"Error: Invalid number '{args[1]}' - {e}")
            print(f"DEBUG: args = {args}")
            return
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
            return
    
    elif args[0] == '--session':
        if len(args) < 2:
            print("Error: --session requires a UUID")
            print_usage()
            return
        
        session_uuid = args[1]
        limit = 50
        
        # Check for --limit flag
        if len(args) >= 4 and args[2] == '--limit':
            try:
                limit = int(args[3])
            except ValueError:
                print(f"Error: Invalid limit '{args[3]}'")
                return
        
        print_session_history(session_uuid=session_uuid, limit=limit)
    
    else:
        print(f"Error: Unknown option '{args[0]}'")
        print_usage()
        return


if __name__ == '__main__':
    main()
