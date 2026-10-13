#!/bin/bash
# ==============================================================================
# SceneShop — PM2 Management Script
# Usage:
#   ./pm2.sh          # Start or reload SceneShop with PM2
#   ./pm2.sh start    # Start or reload SceneShop
#   ./pm2.sh restart  # Restart the application
#   ./pm2.sh stop     # Stop the application
#   ./pm2.sh logs     # View live logs
#   ./pm2.sh status   # Show process status
#   ./pm2.sh delete   # Remove process from PM2
# ==============================================================================

set -e
cd "$(dirname "$0")"

# 1. Verify Node.js >= 20
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed. Please install Node.js 20+ LTS."
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js 20+ LTS is required. Current version is $(node -v)."
  exit 1
fi

# 2. Resolve PM2 command (global pm2 or npx pm2)
if command -v pm2 >/dev/null 2>&1; then
  PM2_CMD="pm2"
elif npx pm2 -v >/dev/null 2>&1; then
  PM2_CMD="npx pm2"
else
  echo "PM2 not found. Installing PM2 globally..."
  npm install -g pm2 || {
    echo "Could not install pm2 globally. Falling back to local npx..."
    PM2_CMD="npx pm2"
  }
fi

# 3. Create logs folder
mkdir -p logs

# 4. Load environment variables if available
if [ -f sceneshop.env ]; then
  set -a
  . ./sceneshop.env
  set +a
  echo "Loaded environment from sceneshop.env"
elif [ -f .env ]; then
  set -a
  . ./.env
  set +a
  echo "Loaded environment from .env"
fi

# 5. Check dependencies
if [ ! -d "node_modules/express" ]; then
  echo "Installing dependencies..."
  npm install --omit=dev --no-audit --no-fund
fi

ACTION="${1:-start}"

case "$ACTION" in
  start)
    echo "Starting / Reloading SceneShop via PM2..."
    $PM2_CMD start ecosystem.config.cjs
    $PM2_CMD save
    $PM2_CMD status
    echo ""
    echo "SceneShop is running under PM2!"
    echo "View logs with:   ./pm2.sh logs"
    echo "Stop server with: ./pm2.sh stop"
    ;;
  restart)
    echo "Restarting SceneShop..."
    $PM2_CMD restart sceneshop
    $PM2_CMD status
    ;;
  reload)
    echo "Reloading SceneShop (zero-downtime)..."
    $PM2_CMD reload sceneshop
    $PM2_CMD status
    ;;
  stop)
    echo "Stopping SceneShop..."
    $PM2_CMD stop sceneshop
    $PM2_CMD status
    ;;
  logs)
    $PM2_CMD logs sceneshop
    ;;
  status)
    $PM2_CMD status sceneshop
    ;;
  delete)
    echo "Deleting SceneShop from PM2..."
    $PM2_CMD delete sceneshop
    $PM2_CMD save
    ;;
  *)
    echo "Unknown command: $ACTION"
    echo "Usage: ./pm2.sh [start|restart|reload|stop|logs|status|delete]"
    exit 1
    ;;
esac
