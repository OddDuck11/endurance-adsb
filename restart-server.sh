#!/bin/bash
# Restart Endurance web server with watchlist API support

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Stopping existing web server on port 8080..."
pkill -f "python3 -m http.server 8080"
pkill -f "watchlist-server.py"

sleep 2

echo "Starting Endurance Watchlist Server..."
cd "$SCRIPT_DIR"
nohup python3 watchlist-server.py > server.log 2>&1 &

sleep 1

if pgrep -f "watchlist-server.py" > /dev/null; then
    echo "✓ Server started successfully on http://localhost:8080"
    echo "  - Military Log: http://localhost:8080/military-log.html"
    echo "  - Watchlist: http://localhost:8080/watchlist.html"
    echo "  - Logs: $SCRIPT_DIR/server.log"
else
    echo "✗ Failed to start server"
    echo "Check logs: $SCRIPT_DIR/server.log"
    exit 1
fi
