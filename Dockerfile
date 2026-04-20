FROM node:20-slim

WORKDIR /app/backend

# Install system dependencies for @xenova/transformers (ONNX runtime)
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  curl \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --omit=dev

# Pre-download embedding model during build to avoid cold-start delay
RUN node -e "import('@xenova/transformers').then(({pipeline}) => pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2'))"

COPY backend ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD sh -c 'curl -f "http://localhost:${PORT:-3000}/health" || exit 1'

CMD ["node", "src/server.js"]
