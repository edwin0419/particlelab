FROM node:20-alpine AS fe-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim AS be-builder
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=be-builder /usr/local /usr/local
COPY backend/ /app/backend/
COPY --from=fe-builder /app/frontend /app/frontend

COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=10000
EXPOSE 10000
CMD ["/app/start.sh"]
