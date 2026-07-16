#!/usr/bin/env python3
"""
Test script to verify HTTP caching headers are set correctly.
"""

import requests
import sys

BASE_URL = "http://localhost:8000"

def test_endpoint(endpoint, expected_max_age):
    """Test that an endpoint has correct cache headers."""
    url = f"{BASE_URL}{endpoint}"
    print(f"\nTesting {endpoint}...")
    
    try:
        response = requests.get(url)
        
        # Check status code
        if response.status_code != 200:
            print(f"  ✗ Status: {response.status_code}")
            return False
        
        # Check Cache-Control header
        cache_control = response.headers.get('Cache-Control', '')
        if not cache_control:
            print(f"  ✗ No Cache-Control header")
            return False
        
        # Check max-age
        if f"max-age={expected_max_age}" not in cache_control:
            print(f"  ✗ Cache-Control: {cache_control}")
            print(f"    Expected max-age={expected_max_age}")
            return False
        
        # Check ETag header
        etag = response.headers.get('ETag', '')
        if not etag:
            print(f"  ⚠ No ETag header (optional)")
        
        print(f"  ✓ Cache-Control: {cache_control}")
        if etag:
            print(f"  ✓ ETag: {etag}")
        
        return True
        
    except requests.exceptions.ConnectionError:
        print(f"  ✗ Could not connect to {BASE_URL}")
        print(f"    Make sure the server is running: python3 app.py")
        return False
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False


def main():
    """Test all cached endpoints."""
    print("=" * 60)
    print("HTTP Caching Test")
    print("=" * 60)
    
    tests = [
        # Endpoint, Expected max-age (seconds)
        ("/api/catalog", 3600),      # 1 hour
        ("/api/items", 3600),         # 1 hour
        ("/api/activities", 3600),    # 1 hour
        ("/api/recipes", 3600),       # 1 hour
        ("/api/services", 3600),      # 1 hour
        ("/api/skills", 86400),       # 24 hours
    ]
    
    results = []
    for endpoint, max_age in tests:
        results.append(test_endpoint(endpoint, max_age))
    
    # Summary
    print("\n" + "=" * 60)
    passed = sum(results)
    total = len(results)
    print(f"Results: {passed}/{total} tests passed")
    print("=" * 60)
    
    if passed == total:
        print("✓ All caching headers configured correctly!")
        return 0
    else:
        print("✗ Some tests failed. Check the output above.")
        return 1


if __name__ == '__main__':
    sys.exit(main())
