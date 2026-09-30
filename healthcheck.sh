#!/bin/bash
# Star Office UI Health Check
# Checks if backend is responding, restarts if not

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_URL="${STAR_OFFICE_HEALTH_URL:-http://127.0.0.1:19000/health}"
LOG_FILE="${STAR_OFFICE_HEALTH_LOG:-$SCRIPT_DIR/healthcheck.log}"

# Log timestamp
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health check starting..." >> "$LOG_FILE"

# Check backend
if curl -sS "$BACKEND_URL" > /dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend is healthy" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend is NOT healthy - restarting..." >> "$LOG_FILE"
    systemctl restart star-office-backend.service
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend restarted" >> "$LOG_FILE"
fi
