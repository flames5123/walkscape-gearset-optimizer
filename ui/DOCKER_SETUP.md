# Walkscape UI - Docker Setup Guide

Run the Walkscape UI in a Docker container on port 6969.

## Quick Start

### Option 1: Using Docker Compose (Recommended)

```bash
# Navigate to the ui directory
cd ui

# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

The UI will be available at: **http://localhost:6969**

### Option 2: Using Docker Directly

```bash
# Navigate to the project root
cd /path/to/walkscape-optimizer

# Build the image
docker build -f ui/Dockerfile -t walkscape-ui .

# Run the container
docker run -d \
  --name walkscape-ui \
  -p 6969:6969 \
  -v $(pwd)/ui/sessions.db:/app/ui/sessions.db \
  walkscape-ui

# View logs
docker logs -f walkscape-ui

# Stop the container
docker stop walkscape-ui
docker rm walkscape-ui
```

## What Gets Installed

The Docker image includes:
- Python 3.11
- FastAPI web framework
- Uvicorn ASGI server
- All Python dependencies from `ui/requirements.txt`
- The entire Walkscape optimizer codebase (needed for `util` imports)

## Port Configuration

The container runs on **port 6969** by default.

To use a different port:

**Docker Compose:**
```yaml
# Edit ui/docker-compose.yml
ports:
  - "8080:6969"  # Maps host port 8080 to container port 6969
```

**Docker CLI:**
```bash
docker run -d -p 8080:6969 walkscape-ui
```

## Data Persistence

The `sessions.db` SQLite database is mounted as a volume to persist:
- User sessions
- Character data
- Gear sets
- Bug reports
- API access logs

**Location:** `ui/sessions.db` on your host machine

To reset all data:
```bash
# Stop the container
docker-compose down

# Delete the database
rm ui/sessions.db

# Restart
docker-compose up -d
```

## Development Mode

For active development with live code updates:

```yaml
# Edit ui/docker-compose.yml - add these volumes:
volumes:
  - ./sessions.db:/app/ui/sessions.db
  - ./static:/app/ui/static
  - ./app.py:/app/ui/app.py
  - ./database.py:/app/ui/database.py
  - ./catalog.py:/app/ui/catalog.py
  - ../util:/app/util
```

Then restart:
```bash
docker-compose down
docker-compose up -d
```

**Note:** You'll need to restart the container for Python changes to take effect. For auto-reload:

```yaml
# Change the CMD in Dockerfile to:
CMD ["uvicorn", "ui.app:app", "--host", "0.0.0.0", "--port", "6969", "--reload"]
```

## Accessing the UI

Once running, open your browser to:
- **Main UI:** http://localhost:6969
- **API Docs:** http://localhost:6969/docs (FastAPI auto-generated)
- **Health Check:** http://localhost:6969/api/skills

## Troubleshooting

### Container Won't Start

Check logs:
```bash
docker-compose logs
```

Common issues:
- Port 6969 already in use → Change port mapping
- Permission denied on sessions.db → `chmod 666 ui/sessions.db`
- Build fails → Ensure you're in the correct directory

### Can't Access UI

1. **Check container is running:**
   ```bash
   docker ps | grep walkscape-ui
   ```

2. **Check port mapping:**
   ```bash
   docker port walkscape-ui
   ```

3. **Test from inside container:**
   ```bash
   docker exec -it walkscape-ui curl http://localhost:6969/api/skills
   ```

4. **Check firewall:**
   ```bash
   # Linux
   sudo ufw allow 6969
   
   # Or use iptables
   sudo iptables -A INPUT -p tcp --dport 6969 -j ACCEPT
   ```

### Database Locked

If you see "database is locked" errors:
```bash
# Stop the container
docker-compose down

# Check for stale locks
rm ui/sessions.db-journal

# Restart
docker-compose up -d
```

### Import Errors

If you see Python import errors:
```bash
# Rebuild the image
docker-compose build --no-cache
docker-compose up -d
```

### Performance Issues

The container uses minimal resources by default. To allocate more:

```yaml
# Add to docker-compose.yml under 'walkscape-ui':
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
    reservations:
      cpus: '1'
      memory: 512M
```

## Production Deployment

For production use:

1. **Use a reverse proxy (nginx/traefik):**
   ```nginx
   server {
       listen 80;
       server_name walkscape.yourdomain.com;
       
       location / {
           proxy_pass http://localhost:6969;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

2. **Enable HTTPS:**
   - Use Let's Encrypt with certbot
   - Update CORS settings in `ui/app.py`
   - Set `secure=True` for cookies

3. **Set resource limits:**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
   ```

4. **Enable health checks:**
   ```yaml
   healthcheck:
     test: ["CMD", "curl", "-f", "http://localhost:6969/api/skills"]
     interval: 30s
     timeout: 10s
     retries: 3
   ```

5. **Use environment variables:**
   ```yaml
   environment:
     - DATABASE_PATH=/data/sessions.db
     - LOG_LEVEL=INFO
   ```

## Updating

To update to the latest code:

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Backup

To backup your data:

```bash
# Backup database
cp ui/sessions.db ui/sessions.db.backup

# Or use docker cp
docker cp walkscape-ui:/app/ui/sessions.db ./sessions.db.backup
```

## Monitoring

View real-time logs:
```bash
# All logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100

# Specific service
docker-compose logs -f walkscape-ui
```

Check resource usage:
```bash
docker stats walkscape-ui
```

## Cleanup

Remove everything:
```bash
# Stop and remove containers
docker-compose down

# Remove images
docker rmi walkscape-ui

# Remove volumes (WARNING: deletes data)
docker-compose down -v
```

## System Requirements

**Minimum:**
- Docker 20.10+
- Docker Compose 1.29+
- 512MB RAM
- 1GB disk space

**Recommended:**
- Docker 24.0+
- Docker Compose 2.0+
- 1GB RAM
- 2GB disk space

## Security Notes

1. **Default setup is for local development only**
   - No authentication
   - HTTP only (no HTTPS)
   - Permissive CORS

2. **For production:**
   - Add authentication middleware
   - Use HTTPS with valid certificates
   - Restrict CORS origins
   - Set secure cookie flags
   - Use environment variables for secrets

3. **Database security:**
   - The SQLite database is world-readable by default
   - Set proper permissions: `chmod 600 ui/sessions.db`
   - Consider using PostgreSQL for production

## Support

If you encounter issues:

1. Check the logs: `docker-compose logs`
2. Verify the build: `docker-compose build --no-cache`
3. Test the API: `curl http://localhost:6969/api/skills`
4. Check the main README.md for general troubleshooting

## Version

Docker setup version: 1.0.0

Last updated: February 5, 2026
