# Getting Started with Docker - 5 Minute Guide

The absolute fastest way to get the Walkscape UI running on Linux.

## TL;DR

```bash
cd ui
./run-docker.sh start
# Open http://localhost:6969
```

## Prerequisites Check

Do you have Docker installed?
```bash
docker --version
```

If not, install it:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Log out and back in
```

## Quick Start

### 1. Navigate to UI Directory
```bash
cd walkscape-optimizer/ui
```

### 2. Start the Container
```bash
./run-docker.sh start
```

You'll see:
```
Starting Walkscape UI...
✓ Container started!

Access the UI at: http://localhost:6969
View logs: docker-compose logs -f
Stop: docker-compose down
```

### 3. Open Your Browser
```
http://localhost:6969
```

That's it! The UI is now running.

## First Time Setup

### Import Your Character

1. In Walkscape game:
   - Settings > Account > Export Character Data
   - Copy the JSON text

2. In the UI:
   - Click "Import Character" button
   - Paste the JSON
   - Click "Import"

Your character is now loaded!

### Create a Gear Set

1. Click "New Gear Set" in the Gear tab
2. Click each slot to select items
3. Name it and save

Or import from game:
1. In Walkscape: Equipment > Gear sets > Export Gearset
2. In UI: Click "Import Gear Set"
3. Paste and save

## Common Commands

```bash
# View logs
./run-docker.sh logs

# Stop
./run-docker.sh stop

# Restart
./run-docker.sh restart

# Rebuild after updates
./run-docker.sh rebuild

# Check status
./run-docker.sh status

# Get help
./run-docker.sh help
```

## Troubleshooting

### "Port already in use"
```bash
# Find what's using port 6969
sudo lsof -i :6969

# Kill it
sudo kill -9 <PID>

# Or change port in docker-compose.yml
```

### "Permission denied"
```bash
# Add yourself to docker group
sudo usermod -aG docker $USER

# Log out and back in
```

### "Container won't start"
```bash
# Check logs
./run-docker.sh logs

# Rebuild
./run-docker.sh rebuild
```

### "Can't access UI"
```bash
# Check container is running
docker ps | grep walkscape-ui

# Test API
curl http://localhost:6969/api/skills

# Check firewall
sudo ufw allow 6969
```

## What's Running?

When you start the container:
- FastAPI web server on port 6969
- SQLite database for your data
- Static file server for the UI
- Background optimization worker

Your data is saved in `ui/sessions.db` and persists between restarts.

## Stopping and Starting

```bash
# Stop (keeps your data)
./run-docker.sh stop

# Start again later
./run-docker.sh start

# Your data is still there!
```

## Updating

When new code is available:
```bash
git pull
./run-docker.sh rebuild
```

## Resetting

To start fresh (deletes all data):
```bash
./run-docker.sh reset
```

## Next Steps

Now that it's running:

1. **Import your character** - Get your data into the UI
2. **Create gear sets** - Organize your equipment
3. **Try the optimizers** - Find the best gear for activities
4. **Explore features** - Check out all the tabs

## Documentation

- **Quick reference:** [DOCKER_QUICKREF.md](DOCKER_QUICKREF.md)
- **Full setup guide:** [DOCKER_SETUP.md](DOCKER_SETUP.md)
- **Installation help:** [INSTALLATION.md](INSTALLATION.md)
- **UI features:** [README.md](README.md)

## Getting Help

If something doesn't work:

1. Check the logs: `./run-docker.sh logs`
2. Run the test: `./test-docker-setup.sh`
3. Read the troubleshooting section above
4. Check the full documentation

## Tips

- The UI auto-saves your data
- You can have multiple gear sets
- Optimization takes a few seconds
- Export strings work directly in-game
- Bug reports include screenshots automatically

## That's It!

You're ready to optimize your Walkscape gameplay. Have fun!

---

**Need more details?** See [DOCKER_SETUP.md](DOCKER_SETUP.md) for the complete guide.

**Having issues?** Run `./test-docker-setup.sh` to diagnose problems.
