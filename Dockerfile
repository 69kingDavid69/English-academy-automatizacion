FROM node:20-slim

WORKDIR /app/backend

# Install system dependencies including Python for ChromaDB server
RUN apt-get update && apt-get install -y \
  curl \
  python3 \
  python3-pip \
  python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Install ChromaDB server (pinned for compatibility with chromadb JS client v3.x)
RUN python3 -m venv /opt/chroma-venv && \
  /opt/chroma-venv/bin/pip install --no-cache-dir chromadb>=1.0.0

# Make chroma command available
ENV PATH="/opt/chroma-venv/bin:$PATH"

# Create directory for ChromaDB data
RUN mkdir -p /tmp/chromadb && chmod 777 /tmp/chromadb

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend ./
COPY frontend /app/frontend
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD sh -c 'curl -f "http://localhost:${PORT:-3000}/health" || exit 1'

CMD ["/app/start.sh"]
