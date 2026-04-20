FROM node:20-slim

WORKDIR /app/backend

# Install system dependencies (minimal)
RUN apt-get update && apt-get install -y \
  curl \
  && rm -rf /var/lib/apt/lists/*

# Create directory for embedded ChromaDB persistence
RUN mkdir -p /tmp/chromadb && chmod 777 /tmp/chromadb

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend ./
COPY frontend /app/frontend

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD sh -c 'curl -f "http://localhost:${PORT:-3000}/health" || exit 1'

CMD ["node", "src/server.js"]
