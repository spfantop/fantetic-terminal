#!/bin/bash
set -e

umask 077

GUACD_HOST="${GUACD_HOST:-localhost}"
GUACD_PORT="${GUACD_PORT:-4822}"

echo "[entrypoint] Starting guacd..."
GUACD_BIN="/opt/guacamole/sbin/guacd"
if [ ! -x "$GUACD_BIN" ]; then
    GUACD_BIN="guacd"
fi
"$GUACD_BIN" -b "$GUACD_HOST" -l "$GUACD_PORT" -f &
GUACD_PID=$!

echo "[entrypoint] Waiting for guacd on ${GUACD_HOST}:${GUACD_PORT}..."
for i in $(seq 1 30); do
    if nc -z "$GUACD_HOST" "$GUACD_PORT" 2>/dev/null; then
        echo "[entrypoint] guacd is ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "[entrypoint] guacd startup timed out."
        exit 1
    fi
    sleep 1
done

export GUACD_HOST="localhost"

echo "[entrypoint] Starting remote-gateway..."
node dist/server.js &
NODE_PID=$!

cleanup() {
    echo "[entrypoint] Shutting down..."
    kill "$NODE_PID" 2>/dev/null || true
    kill "$GUACD_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
    wait "$GUACD_PID" 2>/dev/null || true
    exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

wait -n "$GUACD_PID" "$NODE_PID" 2>/dev/null || true
cleanup
