# English Academy - AI Support Bot

AI-powered customer support chatbot for a language academy. Uses RAG (Retrieval-Augmented Generation) with ChromaDB for knowledge retrieval and DeepSeek LLM for response generation.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           Docker Container (Production)          │
│                                                  │
│  ┌���─────────────┐       ┌────────────────────┐  │
│  │ ChromaDB     │◄─────►│  Node.js Backend   │  │
│  │ Server :8000 │       │  (Express) :3000   │  │
│  └──────��───────┘       └────────┬───────────┘  │
│                                  │               │
└──────────────────────────────────┼───────────────┘
                                   │
                    ┌──────────────┼─────────���────┐
                    │              │              │
              ┌─────▼────┐  ┌─────▼────┐  ┌─────▼────┐
              │ Frontend  │  │ Telegram │  │ DeepSeek │
              │  Widget   │  │   Bot    │  │   API    │
              └──────────┘  └──────────┘  └──────────┘
```

**Key design decision:** ChromaDB runs inside the same container as the Node.js backend. The ChromaDB JavaScript client is HTTP-only (no embedded mode support), so a ChromaDB server process is started alongside the Node app via `start.sh`. Data is ephemeral on Render but automatically rebuilt on every deploy via `AUTO_INGEST_ON_BOOT=true`.

## Local Development

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- DeepSeek API key
- Telegram bot token (from @BotFather)

### Setup

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your actual values

# 2. Start ChromaDB and n8n via Docker Compose
docker compose up -d

# 3. Install backend dependencies
cd backend && npm install

# 4. Run document ingestion
npm run ingest

# 5. Start backend in dev mode
npm run dev
```

### Local Ports

| Service         | Port  | URL                          |
|-----------------|-------|------------------------------|
| Backend API     | 3001  | http://localhost:3001        |
| ChromaDB        | 8001  | http://localhost:8001        |
| n8n             | 5679  | http://localhost:5679        |
| Frontend widget | 3001  | http://localhost:3001/widget |
| Admin dashboard | 3001  | http://localhost:3001/admin  |

### Test Endpoints

```bash
# Health check
curl http://localhost:3001/health

# Detailed health (ChromaDB status, document count)
curl http://localhost:3001/health/detailed

# Query the chatbot
curl -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"What courses do you offer?"}'

# Run document ingestion manually
cd backend && npm run ingest
```

### Telegram Modes

- `polling` — Local development (auto-receives messages)
- `webhook` — Production (requires HTTPS endpoint)
- `none` — Disables Telegram bot (useful for testing API only)

## Production Deployment (Render)

### How It Works

The app deploys as a **single Docker container** on Render. The container runs two processes:

1. **ChromaDB server** on port 8000 (internal, not exposed externally)
2. **Node.js backend** on port 3000 (exposed via Render)

The `start.sh` script orchestrates startup:
1. Launches ChromaDB server
2. Waits for ChromaDB to respond to heartbeat
3. Starts Node.js
4. On boot, `AUTO_INGEST_ON_BOOT=true` indexes all documents into ChromaDB

### Deploy

1. Push to GitHub
2. In Render: New > Blueprint > Connect repo > Deploy from `render.yaml`
3. Set required secret values:
   - `DEEPSEEK_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_BOT_TOKEN_ADMIN`
   - `ESCALATION_CHAT_ID`

### Render Services

| Service | Type | Purpose |
|---------|------|---------|
| `english-academy-backend` | Web (Docker) | API, Telegram webhook, widget, ChromaDB |
| `english-academy-n8n` | Web (Image) | Automation/webhook UI |
| `english-academy-n8n-db` | Postgres | n8n workflow storage |

### Render-Specific Behavior

- Backend auto-detects `RENDER_EXTERNAL_URL` for Telegram webhook registration
- `AUTO_INGEST_ON_BOOT=true` rebuilds the knowledge base on every deploy
- ChromaDB data is ephemeral (stored in `/tmp/chromadb`) — acceptable because it's rebuilt from source documents on boot

## Environment Variables

| Variable                  | Description                              | Default |
|---------------------------|------------------------------------------|---------|
| `DEEPSEEK_API_KEY`        | DeepSeek API key                         | Required |
| `TELEGRAM_BOT_TOKEN`      | Telegram bot token                       | Required |
| `TELEGRAM_BOT_TOKEN_ADMIN`| Admin bot for escalation replies         | — |
| `TELEGRAM_MODE`           | `webhook`, `polling`, or `none`          | `polling` |
| `CHROMA_URL`              | ChromaDB server URL                      | `http://localhost:8000` |
| `CHROMA_COLLECTION`       | Collection name                          | `academy_knowledge` |
| `AUTO_INGEST_ON_BOOT`     | Index documents on startup               | `false` |
| `RAG_SIMILARITY_THRESHOLD`| Min cosine similarity to consider        | `0.45` |
| `RAG_TOP_K`              | Final chunks sent to LLM                  | `4` |
| `CHUNK_SIZE`             | Max characters per chunk                  | `800` |
| `CHUNK_OVERLAP`          | Overlap between chunks                    | `150` |
| `ESCALATION_CHAT_ID`      | Telegram chat ID for escalation alerts   | — |
| `ESCALATION_THRESHOLD`    | Below this score, skip LLM and escalate  | `0.40` |
| `PORT`                    | Server port                              | `3000` |

## RAG Pipeline

1. Documents in `backend/documents/` are chunked and embedded on boot
2. User query is embedded and matched against ChromaDB (cosine similarity)
3. Candidates below `RAG_SIMILARITY_THRESHOLD` are discarded
4. Remaining candidates are re-ranked (65% vector similarity + 35% keyword overlap)
5. Top-K context is trimmed to 1800 tokens and sent to DeepSeek LLM
6. If confidence is too low, the query is escalated to a human agent via Telegram

## Adding or Updating Documents

1. Add `.txt` or `.md` files to `backend/documents/`
2. Re-run ingestion:
   ```bash
   cd backend && npm run ingest
   ```
3. In production, just redeploy — `AUTO_INGEST_ON_BOOT` handles it automatically

## Channels

- **Frontend widget** — Embedded chat at `/widget`
- **Telegram bot** — Webhook in production, polling in development
- **REST API** — Direct `POST /api/query` for integrations (n8n, custom apps)

## Project Structure

```
├── Dockerfile              # Multi-process container (ChromaDB + Node.js)
├── start.sh                # Startup: ChromaDB → wait → Node.js
├── render.yaml             # Render Blueprint
├── docker-compose.yml      # Local development services
├── backend/
│   ├── src/
│   │   ├── server.js       # Entry point
│   │   ├── app.js          # Express app setup
│   │   ├── config/         # Environment config
│   │   ├── routes/         # API, Telegram, admin, site routes
│   │   ├── services/       # RAG, vector store, reranker, escalation
│   │   ├── ingestion/      # Document chunking and indexing
│   │   └─��� middleware/     # Logger, rate limiter
│   └── documents/          # Knowledge base source files (.txt, .md)
└── frontend/               # Chat widget and admin dashboard
```

## Language Support

Automatic language detection for Spanish and English:
- Replies match the user's language
- Escalation and error messages are localized
- Off-topic detection works in both languages
