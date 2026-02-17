#!/usr/bin/env python3
"""
Currency data for Walkscape
Auto-generated - represents in-game currencies
DO NOT EDIT MANUALLY
"""


class CurrencyInstance:
    """Represents a currency type."""
    
    def __init__(self, name: str):
        self.name = name
    
    def __str__(self) -> str:
        return self.name
    
    def __repr__(self) -> str:
        return f"Currency({self.name})"


class Currency:
    """All currencies in Walkscape."""
    
    COIN = CurrencyInstance(name="Coins")
    ADVENTURERS_GUILD_TOKEN = CurrencyInstance(name="Adventurers' guild token")


# Lookup dictionary for quick access
CURRENCIES_BY_NAME = {
    'Coins': Currency.COIN,
    "Adventurers' guild token": Currency.ADVENTURERS_GUILD_TOKEN,
}


def resolve_currency(name: str):
    """
    Resolve a currency name to a Currency enum reference string.
    
    Args:
        name: Currency name (e.g., "Coins", "Adventurers' guild token")
    
    Returns:
        String reference like "Currency.COIN" or None if not found
    """
    # Try exact match first
    if name in CURRENCIES_BY_NAME:
        currency = CURRENCIES_BY_NAME[name]
        # Find the attribute name
        for attr_name in dir(Currency):
            if not attr_name.startswith('_'):
                if getattr(Currency, attr_name) is currency:
                    return f"Currency.{attr_name}"
    
    # Try case-insensitive match
    name_lower = name.lower()
    for currency_name, currency_obj in CURRENCIES_BY_NAME.items():
        if currency_name.lower() == name_lower:
            # Find the attribute name
            for attr_name in dir(Currency):
                if not attr_name.startswith('_'):
                    if getattr(Currency, attr_name) is currency_obj:
                        return f"Currency.{attr_name}"
    
    return None
