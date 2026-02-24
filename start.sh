#!/usr/bin/env bash
set -euo pipefail

echo "[BOOT] Render PORT=${PORT:-10000}"

# Render PORT로 nginx listen 변경
PORT_VAL="${PORT:-10000}"
sed -i "s/listen 10000;/listen ${PORT_VAL};/g" /etc/nginx/nginx.conf

# 1) FastAPI (로그를 stdout으로)
echo "[BOOT] Starting FastAPI..."
cd /app/backend
python3 -m gunicorn -k uvicorn.workers.UvicornWorker \
  -w 2 \
  -b 127.0.0.1:8000 \
  --access-logfile - \
  --error-logfile - \
  app.main:app &
BE_PID=$!

# 2) Next.js (로그를 stdout으로)
echo "[BOOT] Starting Next.js..."
cd /app/frontend
npm run start -- -p 3000 &
FE_PID=$!

# 3) Nginx
echo "[BOOT] Starting Nginx..."
nginx

# 4) 간단 헬스 체크(1~2초 기다렸다가)
sleep 2
echo "[CHECK] FastAPI local check..."
curl -sSf http://127.0.0.1:8000/api/health >/dev/null && echo "[OK] FastAPI up" || echo "[WARN] FastAPI not responding"

echo "[CHECK] Next local check..."
curl -sSf http://127.0.0.1:3000/ >/dev/null && echo "[OK] Next up" || echo "[WARN] Next not responding"

# 5) 둘 중 하나라도 죽으면 컨테이너 종료(=> Render 로그로 원인 바로 보임)
echo "[BOOT] PIDs: BE=${BE_PID}, FE=${FE_PID}"
wait -n "${BE_PID}" "${FE_PID}"
echo "[FATAL] One of the services exited. Shutting down."
exit 1
