#!/bin/bash
cd "$(dirname "$0")"
PORT="${PORT:-3487}" HOST="${HOST:-127.0.0.1}" node server.js
