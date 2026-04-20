#!/bin/sh
set -e

echo "Starting ChromaDB server..."
chroma run --host 0.0.0.0 --port 8000 --path /tmp/chromadb &
CHROMA_PID=$!

# Wait for ChromaDB to be ready
echo "Waiting for ChromaDB to be ready..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -sf http://localhost:8000/api/v2/heartbeat > /dev/null 2>&1; then
    echo "ChromaDB is ready!"
    break
  fi
  # Try v1 endpoint as fallback
  if curl -sf http://localhost:8000/api/v1/heartbeat > /dev/null 2>&1; then
    echo "ChromaDB is ready! (v1 API)"
    break
  fi
  RETRY=$((RETRY + 1))
  echo "ChromaDB not ready yet (attempt $RETRY/$MAX_RETRIES)..."
  sleep 2
done

if [ $RETRY -eq $MAX_RETRIES ]; then
  echo "WARNING: ChromaDB may not be fully ready, starting Node.js anyway..."
fi

echo "Starting Node.js application..."
exec node src/server.js
