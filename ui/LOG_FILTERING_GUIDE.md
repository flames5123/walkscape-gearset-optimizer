# Log Filtering Quick Reference

## Getting Session UUID

### From Browser Console
```javascript
// Get session UUID from cookie
document.cookie.split('; ').find(row => row.startsWith('session_uuid=')).split('=')[1]
```

### From Network Tab
1. Open DevTools → Network tab
2. Look at any API request
3. Check the `Cookie` header for `session_uuid=...`

## Common Log Queries

### View All Logs for a Session
```bash
# Using grep (first 8 chars of UUID)
grep "[abcd1234]" /path/to/logs

# Using journalctl (if running as systemd service)
journalctl -u walkscape-ui | grep "[abcd1234]"

# Using Docker logs
docker logs walkscape-ui 2>&1 | grep "[abcd1234]"
```

### Character Import Logs
```bash
# See all import activity
grep "[abcd1234]" logs | grep "PARSING ITEMS"

# See item quality detection
grep "[abcd1234]" logs | grep "Crafted:"

# See final results
grep "[abcd1234]" logs | grep "FINAL RESULTS"
```

### Optimization Logs
```bash
# See optimization start
grep "[abcd1234]" logs | grep "Starting optimization"

# See optimization completion
grep "[abcd1234]" logs | grep "Optimization complete"

# See optimization errors
grep "[abcd1234]" logs | grep "❌"

# See full optimization flow
grep "[abcd1234]" logs | grep -E "(Starting optimization|Subprocess completed|Optimization complete|Saved gearset)"
```

### Service Selection Logs
```bash
# See service stats debugging
grep "[abcd1234]" logs | grep "DEBUG: Adding location"
```

### Error Tracking
```bash
# All errors for a session
grep "[abcd1234]" logs | grep "❌"

# Failed optimizations
grep "[abcd1234]" logs | grep "optimization failed"

# Parse errors
grep "[abcd1234]" logs | grep "Failed to parse"
```

### Settings Changes
```bash
# See optimization settings saves
grep "[abcd1234]" logs | grep "Saving optimization settings"

# See config updates
grep "[abcd1234]" logs | grep "Updated.*to"
```

## Real-Time Monitoring

### Follow Logs for a Session
```bash
# Using tail
tail -f /path/to/logs | grep "[abcd1234]"

# Using journalctl
journalctl -u walkscape-ui -f | grep "[abcd1234]"

# Using Docker
docker logs -f walkscape-ui 2>&1 | grep "[abcd1234]"
```

### Watch for Errors
```bash
# Watch for any errors
tail -f /path/to/logs | grep "❌"

# Watch for specific session errors
tail -f /path/to/logs | grep "[abcd1234]" | grep "❌"
```

## Advanced Queries

### Count Operations by Session
```bash
# Count optimizations per session
grep "Starting optimization" logs | cut -d']' -f1 | sort | uniq -c

# Count imports per session
grep "PARSING ITEMS" logs | cut -d']' -f1 | sort | uniq -c
```

### Find Sessions with Errors
```bash
# List all sessions that had errors
grep "❌" logs | cut -d']' -f1 | sort -u
```

### Performance Analysis
```bash
# Find slow optimizations (look for timeout messages)
grep "timed out" logs

# Find sessions with multiple optimization attempts
grep "Starting optimization" logs | cut -d']' -f1 | sort | uniq -c | sort -rn
```

### Time-Based Filtering
```bash
# Logs from today
grep "$(date +%Y-%m-%d)" logs | grep "[abcd1234]"

# Logs from last hour (if timestamps in logs)
grep "$(date -d '1 hour ago' +%Y-%m-%d\ %H)" logs | grep "[abcd1234]"
```

## Log Rotation

If using log rotation, search across multiple files:

```bash
# Search current and rotated logs
zgrep "[abcd1234]" /var/log/walkscape-ui/app.log*

# Search with journalctl (handles rotation automatically)
journalctl -u walkscape-ui --since "2 days ago" | grep "[abcd1234]"
```

## Debugging Workflow

### 1. User Reports Issue
```bash
# Get their session UUID from browser
# Example: abcd1234-5678-90ef-ghij-klmnopqrstuv

# Filter all logs for that session
grep "[abcd1234]" logs > session_abcd1234.log
```

### 2. Identify Problem Area
```bash
# Check for errors
grep "❌" session_abcd1234.log

# Check optimization flow
grep -E "(Starting optimization|Subprocess|complete|Saved)" session_abcd1234.log

# Check import flow
grep -E "(Processing.*items|PARSING|FINAL RESULTS)" session_abcd1234.log
```

### 3. Deep Dive
```bash
# Get full context around an error
grep -B 10 -A 10 "❌" session_abcd1234.log

# See all subprocess output
grep -A 50 "STDOUT:" session_abcd1234.log
```

## Tips

1. **Use the first 8 characters** of the UUID for grep (that's what's in the logs)
2. **Combine with other filters** to narrow down results
3. **Use -A and -B flags** with grep to see context around matches
4. **Save filtered logs** to a file for easier analysis
5. **Use color** with `grep --color=always` for better readability

## Example: Full Debug Session

```bash
# 1. Get session UUID from user
SESSION="abcd1234"

# 2. Extract all logs for that session
grep "[$SESSION]" /var/log/walkscape-ui/app.log > debug_$SESSION.log

# 3. Check for errors
echo "=== ERRORS ==="
grep "❌" debug_$SESSION.log

# 4. Check optimization flow
echo "=== OPTIMIZATION FLOW ==="
grep -E "(Starting optimization|Subprocess completed|Optimization complete)" debug_$SESSION.log

# 5. Check import flow
echo "=== IMPORT FLOW ==="
grep -E "(Processing.*items|PARSING ITEMS|FINAL RESULTS)" debug_$SESSION.log

# 6. Get timing information
echo "=== TIMING ==="
grep -E "(Starting|completed|complete|Saved)" debug_$SESSION.log | head -20
```
