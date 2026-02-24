# ---- build frontend ----
    FROM node:20-bullseye AS fe-builder
    WORKDIR /app/frontend
    COPY frontend/package*.json ./
    RUN npm ci
    COPY frontend/ ./
    RUN npm run build
    
    # ---- build backend deps ----
    FROM python:3.11-slim AS be-builder
    WORKDIR /app/backend
    COPY backend/requirements.txt ./
    RUN pip install --no-cache-dir -r requirements.txt
    
    # ---- runtime (node + python + nginx) ----
    FROM node:20-bullseye
    WORKDIR /app
    
    # python + nginx
    RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip nginx curl \
        && rm -rf /var/lib/apt/lists/*

    RUN pip3 install --no-cache-dir gunicorn "uvicorn[standard]"
    
    # backend python deps
    COPY --from=be-builder /usr/local /usr/local
    COPY backend/ /app/backend/
    
    # frontend (build 결과 + node_modules 포함)
    COPY --from=fe-builder /app/frontend /app/frontend
    
    # nginx + start script
    COPY nginx.conf /etc/nginx/nginx.conf
    COPY start.sh /app/start.sh
    RUN chmod +x /app/start.sh
    
    ENV PORT=10000
    EXPOSE 10000
    
    CMD ["/app/start.sh"]