# Dev Container Setup

This directory contains the development container configuration for the Walkscape Optimizer Toolkit.

## Quick Start

### Using VS Code (Recommended)

1. Install [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open this project in VS Code
3. Click "Reopen in Container" when prompted
4. Wait ~30 seconds for setup to complete
5. Edit `my_config.py` and start optimizing!

### Using Docker Directly

```bash
# Build and run
docker build -t walkscape-optimizer -f .devcontainer/Dockerfile .
docker run -it -v $(pwd):/workspace walkscape-optimizer bash

# Inside container
python3 optimize_activity_gearsets.py
```

## What's Included

- **Python 3.12** - Latest stable Python
- **beautifulsoup4** - For wiki scrapers (optional - only needed if regenerating data)
- **VS Code Python extensions** - IntelliSense and type checking
- **Git** - Version control

## Configuration Files

- `devcontainer.json` - Main configuration
- `Dockerfile` - Container image definition
- `../requirements.txt` - Python dependencies

## No External Dependencies Required

The optimizers work with **Python standard library only**. BeautifulSoup4 is only needed if you want to regenerate data from the wiki.

**To use the optimizers:**
1. Edit `my_config.py` with your character export
2. Run any optimizer script
3. That's it!

**To regenerate data from wiki:**
```bash
pip install beautifulsoup4
python3 util/scrapers/rescrape_all.py
```

## Troubleshooting

**Container won't start:**
- Make sure Docker is running
- Try: Command Palette > "Dev Containers: Rebuild Container"

**Python not found:**
- The container uses Python 3.12 at `/usr/local/bin/python`
- Alias `python` points to `python3`

**Permission issues:**
- Container runs as `vscode` user (non-root)
- All files are accessible with proper permissions

## Performance

- **Fast startup**: Uses pre-built Microsoft Python image
- **Persistent cache**: Wiki scraper cache persists between rebuilds
- **Lightweight**: Only installs what's needed

