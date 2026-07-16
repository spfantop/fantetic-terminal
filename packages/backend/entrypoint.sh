#!/bin/sh
set -eu

data_path="${APP_BACKEND_DATA_PATH:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data_path"
  chown -R node:node "$data_path"
  exec su-exec node "$@"
fi

exec "$@"
