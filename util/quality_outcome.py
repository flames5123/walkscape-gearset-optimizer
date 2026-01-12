#!/usr/bin/env python3
"""
Quality Outcome calculation for crafting.
Based on: https://wiki.walkscape.app/wiki/Quality_Outcome_(Mechanics)
"""

def calculate_quality_weights(recipe_level: int, quality_outcome: float):
    """
    Calculate quality weights based on recipe level and quality outcome bonus.
    
    Args:
        recipe_level: Recipe level requirement
        quality_outcome: Total quality outcome bonus (from gear + service + level)
        
    Returns:
        Dict with quality weights and percentages
    """
    # Starting weights
    starting_weights = {
        'Normal': 1000.0,
        'Good': 200.0,
        'Great': 50.0,
        'Excellent': 10.0,
        'Perfect': 2.5,
        'Eternal': 0.05
    }
    
    # Minimum weights
    minimum_weights = {
        'Normal': 4.0,
        'Good': 4.0,
        'Great': 4.0,
        'Excellent': 4.0,
        'Perfect': 2.0,
        'Eternal': 0.05
    }
    
    # Band starts (fixed)
    band_starts = {
        'Normal': 0,
        'Good': 100,
        'Great': 200,
        'Excellent': 300,
        'Perfect': 400,
        'Eternal': 500
    }
    
    # Calculate band ends
    band_ends = {}
    for i, quality in enumerate(['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'], 1):
        band_ends[quality] = (100 + recipe_level) * i
    
    # Calculate new weights
    calculated_weights = {}
    
    # Process from highest to lowest quality to handle the "never rarer than higher quality" rule
    qualities = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']
    
    for quality in qualities:
        band_start = band_starts[quality]
        band_end = band_ends[quality]
        starting_weight = starting_weights[quality]
        minimum_weight = minimum_weights[quality]
        
        if quality_outcome <= band_start:
            # QO is below band start, keep starting weight
            new_weight = starting_weight
        else:
            # Calculate slope
            slope = (starting_weight - minimum_weight) / (band_start - band_end)
            
            # Calculate new weight
            new_weight = starting_weight + (slope * (quality_outcome - band_start))
            
            # Take max of minimum weight and calculated weight
            new_weight = max(minimum_weight, new_weight)
        
        # Ensure this quality is never rarer than the next higher quality
        if quality != 'Eternal':
            next_quality_index = qualities.index(quality) - 1
            next_quality = qualities[next_quality_index]
            if next_quality in calculated_weights:
                new_weight = max(new_weight, calculated_weights[next_quality])
        
        calculated_weights[quality] = new_weight
    
    # Calculate percentages
    total_weight = sum(calculated_weights.values())
    percentages = {}
    for quality, weight in calculated_weights.items():
        percentages[quality] = (weight / total_weight) * 100.0
    
    return {
        'weights': calculated_weights,
        'percentages': percentages,
        'total_weight': total_weight
    }


def format_quality_table(recipe_level: int, quality_outcome: float):
    """
    Format a quality outcome table for display.
    
    Args:
        recipe_level: Recipe level requirement
        quality_outcome: Total quality outcome bonus
        
    Returns:
        Formatted string with weights and percentages
    """
    result = calculate_quality_weights(recipe_level, quality_outcome)
    weights = result['weights']
    percentages = result['percentages']
    
    lines = []
    lines.append("\nCRAFTING OUTCOME PROBABILITIES:")
    lines.append("=" * 70)
    lines.append(f"Recipe Level: {recipe_level}, Quality Outcome: {quality_outcome:.0f}")
    lines.append("")
    
    # Header
    lines.append(f"{'Quality':<12} {'Weight':>10} {'Percentage':>12} {'Odds':>20}")
    lines.append("-" * 70)
    
    # Rows for each quality
    qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']
    for quality in qualities:
        weight = weights[quality]
        pct = percentages[quality]
        
        # Calculate odds (1 in X)
        if pct > 0:
            odds = 100.0 / pct
            odds_str = f"1 in {odds:.0f}" if odds >= 2 else "guaranteed"
        else:
            odds_str = "impossible"
        
        lines.append(f"{quality:<12} {weight:>10.2f} {pct:>11.2f}% {odds_str:>20}")
    
    # Sum row
    lines.append("-" * 70)
    lines.append(f"{'Sum':<12} {result['total_weight']:>10.2f} {'100.00%':>12}")
    lines.append("=" * 70)
    
    return '\n'.join(lines)


if __name__ == '__main__':
    # Test with example values
    print(format_quality_table(recipe_level=20, quality_outcome=64))
    print()
    print(format_quality_table(recipe_level=20, quality_outcome=200))
