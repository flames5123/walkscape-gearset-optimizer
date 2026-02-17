# Walkscape UI - Installation Guide

Complete installation instructions for running the Walkscape UI on Linux with Docker.

## Prerequisites

- Linux system (Ubuntu, Debian, Fedora, etc.)
- Internet connection
- Terminal access
- ~2GB free disk space

## Installation Steps

### Step 1: Install Docker

**Ubuntu/Debian:**
```bash
# Update package index
sudo apt-get update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (to run without sudo)
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
```

**Fedora/RHEL:**
```bash
sudo dnf install docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
# Log out and back in
```

**Arch Linux:**
```bash
sudo pacman -S docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
# Log out and back in
```

### Step 2: Install Docker Compose

**Ubuntu/Debian (if not already installed):**
```bash
sudo apt-get install docker-compose-plugin
```

**Other systems:**
```bash
# Download latest version
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make executable
sudo chmod +x /usr/local/bin/docker-compose
```

### Step 3: Verify Installation

```bash
# Check Docker
docker --version

# Check Docker Compose
docker-compose --version
# or
docker compose version

# Test Docker
docker run hello-world
```

### Step 4: Clone/Download the Project

```bash
# If using git
git clone <repository-url>
cd walkscape-optimizer/ui

# Or download and extract the ZIP
# Then navigate to the ui directory
```

### Step 5: Test the Setup

```bash
# Navigate to ui directory
cd ui

# Make scripts executable
chmod +x run-docker.sh test-docker-setup.sh

# Run the test script
./test-docker-setup.sh
```

The test script will:
- ✓ Check Docker installation
- ✓ Check Docker Compose
- ✓ Verify Docker daemon is running
- ✓ Check required files exist
- ✓ Test port availability
- ✓ Check disk space
- ✓ Optionally build and test the container

### Step 6: Start the UI

```bash
# Start the container
./run-docker.sh start

# Or manually
docker-compose up -d
```

### Step 7: Access the UI

Open your browser to: **http://localhost:6969**

You should see the Walkscape UI interface.

## Post-Installation

### Configure Firewall (if needed)

**UFW (Ubuntu):**
```bash
sudo ufw allow 6969/tcp
```

**Firewalld (Fedora/RHEL):**
```bash
sudo firewall-cmd --permanent --add-port=6969/tcp
sudo firewall-cmd --reload
```

**iptables:**
```bash
sudo iptables -A INPUT -p tcp --dport 6969 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4
```

### Set Up Auto-Start (optional)

To start the container automatically on boot:

```bash
# Edit docker-compose.yml and ensure restart policy is set
# (already configured in the provided file)

# Enable Docker service
sudo systemctl enable docker
```

### Create Desktop Shortcut (optional)

Create `~/.local/share/applications/walkscape-ui.desktop`:
```ini
[Desktop Entry]
Type=Application
Name=Walkscape UI
Comment=Walkscape Optimizer Web Interface
Exec=xdg-open http://localhost:6969
Icon=applications-games
Terminal=false
Categories=Game;
```

## Verification

After installation, verify everything works:

```bash
# Check container is running
docker ps | grep walkscape-ui

# Check logs
./run-docker.sh logs

# Test API
curl http://localhost:6969/api/skills

# Open in browser
xdg-open http://localhost:6969
```

## Troubleshooting

### Docker Permission Denied

If you get "permission denied" errors:
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in
# Or run this to apply immediately (temporary)
newgrp docker
```

### Port Already in Use

If port 6969 is in use:
```bash
# Find what's using it
sudo lsof -i :6969

# Kill the process
sudo kill -9 <PID>

# Or change the port in docker-compose.yml
```

### Container Won't Start

```bash
# Check logs
./run-docker.sh logs

# Rebuild
./run-docker.sh rebuild

# Check Docker daemon
sudo systemctl status docker
```

### Can't Access UI from Browser

1. Check container is running: `docker ps`
2. Check firewall: `sudo ufw status`
3. Test locally: `curl http://localhost:6969/api/skills`
4. Check browser console for errors

### Database Issues

```bash
# Reset database
./run-docker.sh reset

# Or manually
./run-docker.sh stop
rm sessions.db sessions.db-journal
./run-docker.sh start
```

## Uninstallation

To completely remove the UI:

```bash
# Stop and remove container
./run-docker.sh clean

# Remove data
rm sessions.db sessions.db-journal

# Remove Docker images (optional)
docker system prune -a
```

To uninstall Docker:
```bash
# Ubuntu/Debian
sudo apt-get purge docker-ce docker-ce-cli containerd.io
sudo rm -rf /var/lib/docker

# Fedora/RHEL
sudo dnf remove docker docker-compose
sudo rm -rf /var/lib/docker
```

## Updating

To update to the latest version:

```bash
# Pull latest code
git pull

# Rebuild and restart
./run-docker.sh rebuild
```

## Alternative: Local Python Installation

If you prefer not to use Docker:

```bash
# Install Python 3.11+
sudo apt-get install python3.11 python3-pip

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn app:app --host 0.0.0.0 --port 6969
```

## System Requirements

**Minimum:**
- 1 CPU core
- 512MB RAM
- 1GB disk space
- Linux kernel 3.10+

**Recommended:**
- 2 CPU cores
- 1GB RAM
- 2GB disk space
- Linux kernel 4.0+

## Security Considerations

The default setup is for **local use only**:
- No authentication
- HTTP only (no HTTPS)
- Binds to all interfaces (0.0.0.0)

For production or remote access:
1. Set up a reverse proxy (nginx)
2. Enable HTTPS with Let's Encrypt
3. Add authentication
4. Restrict CORS origins
5. Use a firewall

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for production deployment guide.

## Getting Help

If you encounter issues:

1. Run the test script: `./test-docker-setup.sh`
2. Check logs: `./run-docker.sh logs`
3. Review [DOCKER_SETUP.md](DOCKER_SETUP.md)
4. Check [DOCKER_QUICKREF.md](DOCKER_QUICKREF.md)
5. Read the main [README.md](README.md)

## Next Steps

After installation:

1. **Import your character:**
   - In Walkscape: Settings > Account > Export Character Data
   - In UI: Click "Import Character" and paste the JSON

2. **Create gear sets:**
   - Import from game or create manually
   - Organize by purpose (travel, activities, crafting)

3. **Start optimizing:**
   - Try the Activity optimizer
   - Test the Crafting optimizer
   - Plan travel routes

4. **Explore features:**
   - View detailed stats
   - Compare items
   - Report bugs with the built-in system

## Support

For additional help:
- Check the documentation in the `ui/` directory
- Review the main project README
- Check the API docs at http://localhost:6969/docs

## Version

Installation guide version: 1.0.0

Last updated: February 5, 2026
