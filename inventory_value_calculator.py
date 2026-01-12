#!/usr/bin/env python3
"""
Calculate the value of inventory items where quantity > 2, keeping 1 of each.
"""

from util.character_export_util import Character
from my_config import CHARACTER_EXPORT


def calculate_sellable_value(character: Character, min_quantity: int = 3, keep_quantity: int = 1):
    """
    Calculate the value of items you can sell.
    
    Args:
        character: Character object
        min_quantity: Minimum quantity to consider selling (default 3 = more than 2)
        keep_quantity: How many to keep (default 1)
    
    Returns:
        tuple: (total_value, items_list)
    """
    sellable_items = []
    total_value = 0
    
    for item, qty in character.items.items():
        if qty >= min_quantity and hasattr(item, 'value'):
            sell_qty = qty - keep_quantity
            sell_value = item.value * sell_qty
            total_value += sell_value
            
            # Get item name
            if hasattr(item, 'name'):
                item_name = item.name
            else:
                item_name = str(item)
            
            sellable_items.append({
                'name': item_name,
                'total_qty': qty,
                'sell_qty': sell_qty,
                'keep_qty': keep_quantity,
                'unit_value': item.value,
                'total_value': sell_value
            })
    
    # Sort by total value descending
    sellable_items.sort(key=lambda x: x['total_value'], reverse=True)
    
    return total_value, sellable_items


def print_sellable_items(character: Character, min_quantity: int = 3, keep_quantity: int = 1):
    """Print a formatted report of sellable items."""
    total_value, items = calculate_sellable_value(character, min_quantity, keep_quantity)
    
    print(f"\n{'='*80}")
    print(f"INVENTORY VALUE CALCULATOR")
    print(f"{'='*80}")
    print(f"Character: {character.name}")
    print(f"Criteria: Items with {min_quantity}+ quantity, keeping {keep_quantity} of each")
    print(f"{'='*80}\n")
    
    if not items:
        print("No items meet the criteria.")
        return
    
    # Print header
    print(f"{'Item Name':<40} {'Have':<6} {'Sell':<6} {'Keep':<6} {'Unit':<10} {'Total Value':<12}")
    print(f"{'-'*40} {'-'*6} {'-'*6} {'-'*6} {'-'*10} {'-'*12}")
    
    # Print each item
    for item in items:
        print(f"{item['name']:<40} {item['total_qty']:<6} {item['sell_qty']:<6} "
              f"{item['keep_qty']:<6} {item['unit_value']:<10,} {item['total_value']:<12,}")
    
    # Print summary
    print(f"{'-'*80}")
    print(f"{'TOTAL VALUE:':<40} {'':<6} {'':<6} {'':<6} {'':<10} {total_value:<12,}")
    print(f"{'='*80}\n")
    
    # Print by category
    print("\nBREAKDOWN BY CATEGORY:")
    print(f"{'='*80}")
    
    equipment_value = 0
    material_value = 0
    consumable_value = 0
    other_value = 0
    
    for item_dict in items:
        # Find the actual item object
        item_obj = None
        for item, qty in character.items.items():
            if hasattr(item, 'name') and item.name == item_dict['name']:
                item_obj = item
                break
        
        if item_obj:
            if hasattr(item_obj, 'slot'):
                equipment_value += item_dict['total_value']
            elif hasattr(item_obj, '__class__'):
                class_name = item_obj.__class__.__name__
                if 'Material' in class_name:
                    material_value += item_dict['total_value']
                elif 'Consumable' in class_name:
                    consumable_value += item_dict['total_value']
                else:
                    other_value += item_dict['total_value']
            else:
                other_value += item_dict['total_value']
        else:
            other_value += item_dict['total_value']
    
    print(f"Equipment:  {equipment_value:>12,} coins")
    print(f"Materials:  {material_value:>12,} coins")
    print(f"Consumables: {consumable_value:>12,} coins")
    print(f"Other:      {other_value:>12,} coins")
    print(f"{'-'*80}")
    print(f"TOTAL:      {total_value:>12,} coins")
    print(f"{'='*80}\n")


if __name__ == '__main__':
    # Load character
    character = Character(CHARACTER_EXPORT)
    
    # Calculate and print sellable items (quantity > 2, keeping 1)
    print_sellable_items(character, min_quantity=3, keep_quantity=1)
