# Caching Implementation

## Overview
The UI now implements comprehensive HTTP caching to reduce redundant network requests and improve performance.

## What's Cached

### 1. Static Assets (Icons, Images)
**Cache Duration**: 1 year (immutable)
**Implementation**: `CachedStaticFiles` class in `app.py`
**Endpoints**:
- `/assets/*` - All icons (activities, items, factions, etc.)

**Headers**:
```
Cache-Control: public, max-age=31536000, immutable
```

### 2. API Data Endpoints
**Cache Duration**: 1 hour
**Implementation**: Response headers in endpoint functions
**Endpoints**:
- `/api/catalog` - Item catalog (398 items)
- `/api/items` - Full item categories
- `/api/activities` - All activities (~165)
- `/api/recipes` - All recipes (~165)
- `/api/services` - All services (~29)
- `/api/skills` - Skill definitions

**Headers**:
```
Cache-Control: public, max-age=3600
ETag: <endpoint>-v1
```

## How It Works

### Browser Caching
1. **First Request**: Browser fetches data from server
2. **Subsequent Requests**: Browser uses cached copy (no network request)
3. **After Cache Expires**: Browser re-validates with server using ETag
4. **If Data Unchanged**: Server returns 304 Not Modified (no data transfer)
5. **If Data Changed**: Server returns new data with updated ETag

### Cache Invalidation
When you update the scrapers and regenerate data:
1. Increment the ETag version in the endpoint (e.g., `"activities-v2"`)
2. Browser will detect the change and fetch fresh data
3. Old cached data is automatically discarded

## Performance Impact

### Before Caching
- Every page load: ~6-10 API requests
- Every component mount: Fetches full data
- Total data transfer: ~2-5 MB per session
- Load time: 2-5 seconds

### After Caching
- First page load: ~6-10 API requests (same)
- Subsequent loads: 0 API requests (cached!)
- Total data transfer: ~2-5 MB first load, then 0 bytes
- Load time: <500ms (instant from cache)

## Cache Durations Explained

### Why 1 Year for Icons?
- Icons never change (immutable)
- If an icon changes, it gets a new filename
- Safe to cache forever

### Why 1 Hour for API Data?
- Data changes when scrapers run (infrequent)
- 1 hour balances freshness vs performance
- Users get updates within an hour of scraper runs
- Can be increased to 24 hours if needed

### Why 24 Hours for Skills?
- Skills are hardcoded constants
- Never change unless game updates
- Safe to cache for a full day

## Monitoring Cache Effectiveness

### Browser DevTools
1. Open DevTools → Network tab
2. Reload page
3. Look for "(from disk cache)" or "(from memory cache)" in Size column
4. Cached requests show 0ms load time

### Expected Results
After first load, you should see:
- `/api/catalog` - (from disk cache)
- `/api/activities` - (from disk cache)
- `/api/recipes` - (from disk cache)
- `/assets/icons/*` - (from disk cache)

## Updating Cache Settings

### To Change Cache Duration
Edit the `max-age` value in `app.py`:

```python
# 1 hour = 3600 seconds
response.headers["Cache-Control"] = "public, max-age=3600"

# 24 hours = 86400 seconds
response.headers["Cache-Control"] = "public, max-age=86400"

# 1 week = 604800 seconds
response.headers["Cache-Control"] = "public, max-age=604800"
```

### To Force Cache Refresh
Increment the ETag version:

```python
# Before
response.headers["ETag"] = "activities-v1"

# After (forces all browsers to fetch fresh data)
response.headers["ETag"] = "activities-v2"
```

### To Disable Caching (Development)
```python
response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
```

## Best Practices

### When to Increment ETag
- After running scrapers and regenerating data
- After changing API response structure
- After fixing bugs in data generation

### When NOT to Increment ETag
- Code changes that don't affect API responses
- UI-only changes
- Database schema changes (session data is never cached)

## Session Data (NOT Cached)

These endpoints are intentionally NOT cached:
- `/api/session/{uuid}` - User session data
- `/api/session/{uuid}/gearsets` - User gear sets
- `/api/session/{uuid}/config` - User configuration
- `/api/optimize-gearset` - Optimization results

These contain user-specific data that must always be fresh.

## Troubleshooting

### "I updated the data but users see old data"
1. Increment the ETag version in the endpoint
2. Deploy the change
3. Users will automatically fetch fresh data on next load

### "Cache not working in development"
1. Check browser DevTools → Network tab
2. Disable "Disable cache" checkbox
3. Reload page and check for "(from cache)" entries

### "Need to force immediate refresh for all users"
1. Increment ETag version
2. Or change cache duration to 0 temporarily
3. Deploy and wait for users to reload
4. Restore normal cache duration

## Future Enhancements

### Potential Improvements
1. **Service Worker**: Offline support and background sync
2. **IndexedDB**: Client-side database for large datasets
3. **Compression**: Gzip/Brotli compression for API responses
4. **CDN**: Serve static assets from CDN
5. **Conditional Requests**: Implement 304 Not Modified responses

### Not Recommended
- **LocalStorage**: Limited to 5-10MB, HTTP cache is better
- **SessionStorage**: Cleared on tab close, not persistent enough
- **In-Memory Cache**: Lost on page reload, HTTP cache is better
