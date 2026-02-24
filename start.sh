#!/usr/bin/env bash
set -e

cd /app/backend
gunicorn -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000 main:app &

cd /app/frontend
npm run start -- -p 3000 &

nginx -g 'daemon off;'