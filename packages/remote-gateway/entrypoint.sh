#!/bin/bash
set -e

umask 077

GUACD_HOST="${GUACD_HOST:-localhost}"
GUACD_PORT="${GUACD_PORT:-4822}"

if [ -z "${REMOTE_GATEWAY_SHARED_SECRET:-}" ]; then
    echo "[entrypoint] Waiting for Docker runtime secrets..."
    for i in $(seq 1 30); do
        if [ -r /app/data/.env ]; then
            REMOTE_GATEWAY_SHARED_SECRET="$(sed -n 's/^REMOTE_GATEWAY_SHARED_SECRET=//p' /app/data/.env | tail -n 1)"
            if [ "${#REMOTE_GATEWAY_SHARED_SECRET}" -ge 32 ]; then
                export REMOTE_GATEWAY_SHARED_SECRET
                break
            fi
        fi
        sleep 1
    done
fi

if [ "$(id -u)" -eq 0 ]; then
    if [ "${#REMOTE_GATEWAY_SHARED_SECRET}" -lt 32 ]; then
        echo "[entrypoint] REMOTE_GATEWAY_SHARED_SECRET is unavailable."
        exit 1
    fi

    # 仅 root 可读取后端以 0600 权限写入的数据文件；随后立即降权运行 Gateway。
    exec su-exec guacd "$0" --run
fi

if [ "${#REMOTE_GATEWAY_SHARED_SECRET}" -lt 32 ]; then
    echo "[entrypoint] REMOTE_GATEWAY_SHARED_SECRET is unavailable."
    exit 1
fi

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

shutdown() {
    local exit_code="${1:-0}"
    trap - SIGTERM SIGINT SIGQUIT
    echo "[entrypoint] Shutting down..."
    kill "$NODE_PID" 2>/dev/null || true
    kill "$GUACD_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
    wait "$GUACD_PID" 2>/dev/null || true
    exit "$exit_code"
}

trap 'shutdown 0' SIGTERM SIGINT SIGQUIT

EXITED_PID=''
if wait -n -p EXITED_PID "$GUACD_PID" "$NODE_PID" 2>/dev/null; then
    CHILD_EXIT_CODE=0
else
    CHILD_EXIT_CODE=$?
fi

if [ "$CHILD_EXIT_CODE" -eq 0 ]; then
    echo "[entrypoint] Child process ${EXITED_PID:-unknown} exited unexpectedly with status 0."
    CHILD_EXIT_CODE=1
else
    echo "[entrypoint] Child process ${EXITED_PID:-unknown} exited with status $CHILD_EXIT_CODE."
fi
shutdown "$CHILD_EXIT_CODE"
