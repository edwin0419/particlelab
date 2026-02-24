# ---- build frontend ----
    FROM node:20-bullseye AS fe-builder
    WORKDIR /app/frontend
    COPY frontend/package*.json ./
    RUN npm ci
    COPY frontend/ ./
    RUN npm run build
    
# ---- runtime (node + python + nginx) ----
FROM node:20-bullseye
WORKDIR /app
    
    # python + nginx
    RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip nginx curl \
        && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir gunicorn "uvicorn[standard]"

# backend code + python deps (install in runtime Python to avoid version mismatch)
COPY backend/ /app/backend/
RUN python3 -m pip install --no-cache-dir -r /app/backend/requirements.txt
RUN python3 -c "import fastapi, sqlmodel, PIL, eval_type_backport; print('backend deps ok')"
    
    # frontend (build 결과 + node_modules 포함)
    COPY --from=fe-builder /app/frontend /app/frontend
    
    # nginx + start script
    COPY nginx.conf /etc/nginx/nginx.conf
    COPY start.sh /app/start.sh
    RUN chmod +x /app/start.sh
    
    ENV PORT=10000
    EXPOSE 10000
    
    CMD ["/app/start.sh"]
