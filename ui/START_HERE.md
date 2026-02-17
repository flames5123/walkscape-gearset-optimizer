# 🚀 START HERE - Walkscape UI Docker Setup

**Welcome!** This guide will get you running in 5 minutes.

## What You're Setting Up

A web-based interface for the Walkscape Optimizer that runs in Docker on port 6969.

**Features:**
- Import your character from the game
- Manage multiple gear sets
- Optimize gear for activities, crafting, and travel
- View detailed stats and comparisons
- Export optimized gear back to the game

## Prerequisites

You need:
- ✅ Linux system (Ubuntu, Debian, Fedora, etc.)
- ✅ Docker installed
- ✅ 5 minutes

## Step 1: Install Docker (if needed)

Check if you have Docker:
```bash
docker --version
```

If not, install it:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**Important:** Log out and back in after installing Docker!

## Step 2: Start the UI

```bash
cd ui
./run-docker.sh start
```

You'll see:
```
Starting Walkscape UI...
✓ Container started!

Access the UI at: http://localhost:6969
```

## Step 3: Open Your Browser

Go to: **http://localhost:6969**

You should see the Walkscape UI!

## Step 4: Import Your Character

1. In Walkscape game:
   - Settings > Account > Export Character Data
   - Copy the entire JSON text

2. In the UI:
   - Click "Import Character" button
   - Paste the JSON
   - Click "Import"

Done! Your character is now loaded.

## Common Commands

```bash
# View logs
./run-docker.sh logs

# Stop
./run-docker.sh stop

# Restart
./run-docker.sh restart

# Get help
./run-docker.sh help
```

## Troubleshooting

### "Permission denied"
```bash
sudo usermod -aG docker $USER
# Log out and back in
```

### "Port already in use"
```bash
sudo lsof -i :6969
sudo kill -9 <PID>
```

### "Container won't start"
```bash
./run-docker.sh logs
./run-docker.sh rebuild
```

### Still having issues?
```bash
./test-docker-setup.sh
```

## What's Next?

Now that it's running:

1. **Create gear sets** - Organize your equipment
2. **Try the optimizers** - Find the best gear
3. **Explore features** - Check out all the tabs

## Documentation

Choose your path:

### 🏃 "I just want it to work"
→ You're done! Start using the UI at http://localhost:6969

### 📖 "I want to learn the basics"
→ Read [DOCKER_GETTING_STARTED.md](DOCKER_GETTING_STARTED.md)

### 📚 "I want to understand everything"
→ Read [DOCKER_SETUP.md](DOCKER_SETUP.md)

### 🔧 "I'm having problems"
→ Read [DOCKER_QUICKREF.md](DOCKER_QUICKREF.md)

### 💻 "I want to develop/modify"
→ Read [README.md](README.md)

### 📋 "I need a reference"
→ Read [DOCKER_FILES_OVERVIEW.md](DOCKER_FILES_OVERVIEW.md)

## Quick Reference

| Task | Command |
|------|---------|
| Start | `./run-docker.sh start` |
| Stop | `./run-docker.sh stop` |
| Logs | `./run-docker.sh logs` |
| Restart | `./run-docker.sh restart` |
| Rebuild | `./run-docker.sh rebuild` |
| Status | `./run-docker.sh status` |
| Help | `./run-docker.sh help` |

## Access Points

- **Main UI:** http://localhost:6969
- **API Docs:** http://localhost:6969/docs
- **Health Check:** http://localhost:6969/api/skills

## Data Location

Your data is saved in: `ui/sessions.db`

To backup:
```bash
cp ui/sessions.db ui/sessions.db.backup
```

## Getting Help

If you're stuck:

1. Run `./test-docker-setup.sh` to diagnose issues
2. Check `./run-docker.sh logs` for errors
3. Read [DOCKER_QUICKREF.md](DOCKER_QUICKREF.md) for solutions
4. Read [DOCKER_SETUP.md](DOCKER_SETUP.md) for details

## That's It!

You're ready to optimize your Walkscape gameplay. Enjoy!

---

**Questions?** Check the documentation files listed above.

**Problems?** Run `./test-docker-setup.sh` for automated diagnosis.

**Updates?** Run `git pull && ./run-docker.sh rebuild`
