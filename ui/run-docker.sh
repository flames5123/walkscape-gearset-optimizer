#!/bin/bash
# Quick start script for Walkscape UI Docker container

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Walkscape UI - Docker Quick Start${NC}"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# Determine docker-compose command
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    COMPOSE_CMD="docker compose"
fi

# Parse command line arguments
ACTION=${1:-start}

case $ACTION in
    start)
        echo -e "${GREEN}Starting Walkscape UI...${NC}"
        $COMPOSE_CMD up -d
        echo ""
        echo -e "${GREEN}✓ Container started!${NC}"
        echo ""
        echo "Access the UI at: http://localhost:6969"
        echo "View logs: $COMPOSE_CMD logs -f"
        echo "Stop: $COMPOSE_CMD down"
        ;;
    
    stop)
        echo -e "${GREEN}Stopping Walkscape UI...${NC}"
        $COMPOSE_CMD down
        echo -e "${GREEN}✓ Container stopped${NC}"
        ;;
    
    restart)
        echo -e "${GREEN}Restarting Walkscape UI...${NC}"
        $COMPOSE_CMD restart
        echo -e "${GREEN}✓ Container restarted${NC}"
        ;;
    
    logs)
        echo -e "${GREEN}Showing logs (Ctrl+C to exit)...${NC}"
        $COMPOSE_CMD logs -f
        ;;
    
    build)
        echo -e "${GREEN}Building Docker image...${NC}"
        $COMPOSE_CMD build --no-cache
        echo -e "${GREEN}✓ Build complete${NC}"
        ;;
    
    rebuild)
        echo -e "${GREEN}Rebuilding and restarting...${NC}"
        $COMPOSE_CMD down
        $COMPOSE_CMD build --no-cache
        $COMPOSE_CMD up -d
        echo -e "${GREEN}✓ Rebuild complete${NC}"
        echo ""
        echo "Access the UI at: http://localhost:6969"
        ;;
    
    status)
        echo -e "${GREEN}Container status:${NC}"
        docker ps | grep walkscape-ui || echo "Container not running"
        ;;
    
    clean)
        echo -e "${RED}Removing container and image...${NC}"
        $COMPOSE_CMD down
        docker rmi walkscape-ui 2>/dev/null || true
        echo -e "${GREEN}✓ Cleanup complete${NC}"
        ;;
    
    reset)
        echo -e "${RED}WARNING: This will delete all data (sessions, gear sets, etc.)${NC}"
        read -p "Are you sure? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            $COMPOSE_CMD down
            rm -f sessions.db sessions.db-journal
            echo -e "${GREEN}✓ Database reset${NC}"
            echo "Run './run-docker.sh start' to restart with fresh database"
        else
            echo "Reset cancelled"
        fi
        ;;
    
    shell)
        echo -e "${GREEN}Opening shell in container...${NC}"
        docker exec -it walkscape-ui /bin/bash
        ;;
    
    help|*)
        echo "Usage: ./run-docker.sh [command]"
        echo ""
        echo "Commands:"
        echo "  start    - Start the container (default)"
        echo "  stop     - Stop the container"
        echo "  restart  - Restart the container"
        echo "  logs     - View container logs"
        echo "  build    - Build the Docker image"
        echo "  rebuild  - Rebuild and restart"
        echo "  status   - Show container status"
        echo "  clean    - Remove container and image"
        echo "  reset    - Delete database and reset"
        echo "  shell    - Open shell in container"
        echo "  help     - Show this help"
        echo ""
        echo "Examples:"
        echo "  ./run-docker.sh start"
        echo "  ./run-docker.sh logs"
        echo "  ./run-docker.sh rebuild"
        ;;
esac
