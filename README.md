# Academy Support Bot

Production-ready AI customer support assistant for a language academy.
Built with DeepSeek, RAG (ChromaDB + local embeddings), Telegram, n8n, and Render.

---

## Architecture

```
[Student] --> [Telegram Bot / HTTP Webhook]
                      |
                [Render Web URLs]  <-- public HTTPS
                      |
              [n8n Workflow]
              Trigger -> Backend -> Response -> Escalation path
                      |
             [Node.js Backend]  :PORT
              /api/query  /admin/*  /widget  /admin
                      |
              [RAG Pipeline]
         [ChromaDB Private Service] + ChromaDB default embedding function
                      |
              [DeepSeek Chat API]
              Strict RAG prompt, 0 temperature, escalation detection
                      |
              [Human Escalation]
              Telegram notification to admin on low confidence
```

---

## Prerequisites

- Node.js 18+
- Docker + Docker Compose
- A DeepSeek API key (https://platform.deepseek.com)
- A Telegram bot token (from @BotFather)
- A Render account for public deployment (https://render.com)

---

## Setup

### 1. Clone and configure environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

Required values in `.env`:
- `DEEPSEEK_API_KEY` - Your DeepSeek API key
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token for user interactions
- `TELEGRAM_BOT_TOKEN_ADMIN` - (Recommended) Separate bot token for escalation notifications
- `ESCALATION_CHAT_ID` - Telegram chat ID to receive escalation alerts (your personal chat ID)
- `ADMIN_TOKEN` - (Optional) Secret token for the admin dashboard. Leave empty to disable authentication (default).
- `WEBHOOK_SECRET` - Random string for Telegram webhook security

### 2. Start infrastructure (ChromaDB + n8n)

```bash
docker compose up -d
```

The default ports are configured to avoid common conflicts:
- ChromaDB: `8001` (mapped from container port 8000)
- n8n: `5679` (mapped from container port 5678)

If you need different ports, edit the `.env` file or set environment variables:
```bash
CHROMA_HOST_PORT=18000 \
N8N_HOST_PORT=15678 \
N8N_WEBHOOK_URL=http://localhost:15678 \
docker compose up -d
```

Verify ChromaDB is running:
```bash
curl http://localhost:8001/api/v2/heartbeat
```

n8n is available at: http://localhost:5679
(default credentials: admin / changeme — change in docker-compose.yml)

### 3. Install backend dependencies

```bash
cd backend
npm install
```

### 4. Run document ingestion

This reads all `.txt` and `.md` files from `backend/documents/`, chunks them,
generates local embeddings, and stores them in ChromaDB.

```bash
cd backend
npm run ingest
```

If you changed the local Chroma port (default: 8001), run:

```bash
cd backend
CHROMA_URL=http://localhost:8001 npm run ingest
```

The system uses ChromaDB's default embedding function (no large model downloads required).

### 5. Start the backend

```bash
cd backend
npm run dev       # development (auto-restart on changes)
npm start         # production
```

The server starts on the port defined by the `PORT` environment variable (default: 3001). Verify:
```bash
curl http://localhost:3001/health
```

For local development with Telegram bot polling:
```bash
cd backend
PORT=4000 TELEGRAM_MODE=polling npm run dev
```

For local development without Telegram bot (to avoid polling conflicts):
```bash
cd backend
PORT=4000 TELEGRAM_MODE=none npm run dev
```

Telegram modes:
- `polling`: Local development (auto-receives messages)
- `webhook`: Production (requires HTTPS endpoint)
- `none`: Disables Telegram bot (useful for testing API only)

---

## Render Deployment

This repository now includes [`render.yaml`](./render.yaml), a Render Blueprint that creates:

- A public backend web service
- A private ChromaDB service with persistent disk
- A public n8n web service
- A managed Postgres database for n8n

### Deploy the stack

1. Push this repository to GitHub.
2. In Render, choose `New > Blueprint`.
3. Connect the repository and deploy the Blueprint from `render.yaml`.
4. Provide the required secret values during the first sync:
   - `DEEPSEEK_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_BOT_TOKEN_ADMIN` - Separate bot for escalation notifications
   - `ESCALATION_CHAT_ID` - Your personal Telegram chat ID
   - `ADMIN_TOKEN` - (Optional) Leave empty to disable admin authentication
   - `WEBHOOK_URL`
   - `N8N_EDITOR_BASE_URL`

For `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL`, use your n8n public URL, for example:

```text
https://english-academy-n8n.onrender.com
```

### Render-specific behavior

- The backend auto-detects `RENDER_EXTERNAL_URL`, so Telegram webhook registration works on Render without manually setting `TELEGRAM_WEBHOOK_URL`.
- `AUTO_INGEST_ON_BOOT=true` is enabled for the Render backend, so the first deploy indexes `backend/documents/` into Chroma automatically.
- n8n connects to the backend over Render private networking using `BACKEND_HOSTPORT`, so it does not depend on a public backend URL internally.

---

## n8n Workflow Import

1. Open n8n at http://localhost:5679
2. Go to Workflows > Import
3. Select `n8n/workflows/academy-bot-workflow.json`
4. Set environment variables in n8n Settings:
   - `BACKEND_HOSTPORT`: `host.docker.internal:3000`
5. Activate the workflow

If your local backend uses another port, change `BACKEND_HOSTPORT` accordingly, for example:

```text
host.docker.internal:3001
```

The webhook URL will be:
```text
http://localhost:5679/webhook/academy-webhook
```

On Render it will be:
```text
https://<your-n8n-service>.onrender.com/webhook/academy-webhook
```

---

## Accessing the Frontend

### Admin Dashboard
```text
http://localhost:3001/admin
```
If `ADMIN_TOKEN` is set, enter it to connect. If empty, the dashboard connects automatically.

Features:
- View and resolve escalations
- Monitor system health
- Test RAG queries directly

### Chat Widget
```text
http://localhost:3001/widget
```

To embed on any website, add this iframe or include the widget files:
```html
<script>
  // Point to your public URL
  window.ACADEMY_CHAT_URL = 'https://your-backend.onrender.com';
</script>
<iframe src="https://your-backend.onrender.com/widget"
        style="position:fixed;bottom:0;right:0;width:400px;height:600px;border:none;z-index:9999">
</iframe>
```

---

## API Reference

### POST /api/query

Query the RAG system directly (used by n8n and the widget).

```json
// Request
{
  "userId": "user123",
  "message": "How much does the B2 course cost?",
  "channel": "webhook",
  "username": "optional"
}

// Response
{
  "reply": "The Intermediate/Upper Intermediate level costs $150 USD per month...",
  "escalated": false,
  "confidence": 0.82,
  "latencyMs": 1240
}
```

### GET /api/admin/escalations

Returns all escalation events. Requires `x-admin-token` header.

### POST /api/admin/escalations/:id/resolve

Marks an escalation as resolved.

### GET /api/admin/health

Returns system health metrics (uptime, memory).

---

## Adding or Updating Documents

1. Add `.txt` or `.md` files to `backend/documents/`
2. Re-run ingestion:
   ```bash
   cd backend
   npm run ingest
   ```
   This rebuilds the vector store from scratch.

---

## Language Support

This system includes automatic language detection for Spanish and English:

- **Automatic detection**: Based on common words and special characters (á, é, í, ó, ú, ñ, ¿, ¡)
- **Consistent responses**: The LLM is instructed to reply in the same language as the user's question
- **Localized messages**: Pre-defined messages for escalations and errors in both languages
- **Off-topic handling**: When users ask unrelated questions, the response matches their language

Examples:
- English query: "What time do you open?" → English response
- Spanish query: "¿A qué hora abren?" → Spanish response
- Off-topic English: "What's for dinner?" → "I can only help with questions about..."
- Off-topic Spanish: "¿Qué hay para cenar?" → "Solo puedo ayudar con preguntas sobre..."

---

## Render Services

The default `render.yaml` provisions these services:

| Service | Type | Purpose |
|---------|------|---------|
| `english-academy-backend` | Web service | Public API, Telegram webhook, admin UI, widget |
| `english-academy-chromadb` | Private service | Internal vector database with persistent disk |
| `english-academy-n8n` | Web service | Public automation/webhook UI |
| `english-academy-n8n-db` | Render Postgres | Persistent n8n workflow storage |

---

## Token Optimization Strategy

This system is optimized for minimum API cost:

| Strategy | Implementation |
|----------|---------------|
| Cheap LLM | DeepSeek-chat (~20x cheaper than GPT-4o) |
| Local embeddings | ChromaDB default embedding function — zero cost |
| Context compression | Whitespace normalization before sending to LLM |
| History pruning | Only last 5 exchanges kept in context |
| Output limit | `max_tokens: 512` prevents runaway outputs |
| Temperature 0 | Deterministic, no wasted tokens on creative sampling |
| Early escalation | Low-confidence queries escalate before hitting LLM |

Estimated cost per 1000 queries: ~$0.05-0.15 USD (DeepSeek pricing, 2024)

---

## Suggested MCPs and Additional Tools

| Tool | Use Case | Status |
|------|----------|--------|
| **memory MCP** | Persist user preferences across sessions | Optional |
| **Redis** | Replace in-memory conversation store for multi-instance | Recommended for production |
| **Sentry** | Error tracking and alerting | Recommended |
| **Prometheus + Grafana** | Metrics dashboard for latency, escalation rate | Optional |
| **Supabase** | Persistent escalation log with full SQL queries | Optional |

---

## Environment Variables Reference

See `.env.example` for all variables with descriptions.

---

## Project Structure

```
academy-support-bot/
├── backend/
│   ├── src/
│   │   ├── config/env.js          # Environment config
│   │   ├── middleware/logger.js   # Winston logger
│   │   ├── prompts/systemPrompt.js # RAG system prompt + few-shots
│   │   ├── routes/
│   │   │   ├── telegram.js        # Telegram bot handler
│   │   │   └── webhook.js         # HTTP API + admin endpoints
│   │   ├── services/
│   │   │   ├── rag.js             # Main RAG pipeline
│   │   │   ├── deepseek.js        # DeepSeek API client
│   │   │   ├── vectorstore.js     # ChromaDB retrieval
│   │   │   └── escalation.js      # Escalation logic
│   │   ├── ingestion/
│   │   │   ├── ingest.js          # Ingestion pipeline runner
│   │   │   └── chunker.js         # Text chunking with overlap
│   │   └── app.js                 # Express server entry point
│   ├── documents/                 # Knowledge base documents
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── admin/                     # Admin dashboard (HTML/CSS/JS)
│   └── widget/                    # Embeddable chat widget
├── n8n/workflows/                 # Importable n8n workflow JSON
├── docker-compose.yml             # ChromaDB + n8n services
├── render.yaml                    # Render Blueprint for backend + Chroma + n8n
├── .env.example
└── README.md
```
