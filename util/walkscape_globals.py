#!/usr/bin/env python3
"""
Global runtime configuration for Walkscape
Set by Character initialization
"""

# Global achievement points (set by Character class)
ACHIEVEMENT_POINTS = 133  # Default value


def set_achievement_points(ap: int):
    """Set achievement points and persist to file"""
    global ACHIEVEMENT_POINTS
    ACHIEVEMENT_POINTS = ap
    
    # Write to file
    with open(__file__, 'r') as f:
        lines = f.readlines()
    
    # Update the ACHIEVEMENT_POINTS line
    with open(__file__, 'w') as f:
        for line in lines:
            if line.startswith('ACHIEVEMENT_POINTS = '):
                f.write(f'ACHIEVEMENT_POINTS = {ap}  # Default value\n')
            else:
                f.write(line)


def get_achievement_points() -> int:
    """Get the current achievement points value."""
    return ACHIEVEMENT_POINTS
