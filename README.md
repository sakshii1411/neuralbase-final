# NeuralBase — AI Knowledge Base

Production-ready RAG (Retrieval-Augmented Generation) knowledge base built with Node.js, Express, NVIDIA NIM, and semantic search. Built as an Independent Technical Exercise prototype demonstrating searchable AI knowledge bases.

---

## Features

- **File Upload & Indexing** — drag-and-drop PDF, TXT, and MD upload with semantic chunking
- **Semantic Search** — local Xenova/all-MiniLM-L6-v2 embeddings, auto BM25 keyword fallback
- **Accurate RAG Chat** — answers strictly grounded in uploaded documents, never hallucinated
- **Knowledge Graph** — AI-extracted concept graph visualized with canvas force simulation
- **Wiki Generator** — auto-compiles documentation summaries from indexed content
- **Dashboard** — live stats: documents, chunks, queries, graph nodes, wiki pages
- **Model Selector** — Llama 3.1 8B / Llama 3.3 70B / Mistral 7B via NVIDIA NIM
- **Source Attribution** — every answer shows source docs, search method, and similarity scores
- **Confidence Scores** — retrieval confidence shown per answer
- **Follow-up Suggestions** — AI generates contextual follow-up questions per answer
- **Multi-format Upload** — PDF, TXT, MD files supported
- **Rate Limiting** — 60 req/min per IP, sliding window
- **Professional Error Handling** — no raw API errors shown to users
- **Responsive UI** — desktop, tablet, and mobile

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and add your NVIDIA API key
```

Get a free NVIDIA API key at **https://build.nvidia.com**

### 3. Start the server
```bash
npm start
# Development (auto-reload):
npm run dev
```

Open **http://localhost:3000**

### 4. Upload your first document

Go to the **Documents** tab → drag and drop a PDF, TXT, or MD file → it will be indexed automatically. Then go to **Ask AI** and ask questions about it.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NVIDIA_API_KEY` | ✅ Yes | — | NVIDIA NIM API key from build.nvidia.com |
| `NVIDIA_MODEL` | No | `meta/llama-3.1-8b-instruct` | Default LLM model |
| `PORT` | No | `3000` | HTTP port |
| `NODE_ENV` | No | `development` | Set to `production` on Render |

---

## Render Deployment

1. Push your project to a GitHub repository (**do not commit `.env`**)
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — review and confirm
5. In **Environment**, add:
   - `NVIDIA_API_KEY` → your key (mark as secret)
   - `NODE_ENV` → `production`
6. Click **Deploy**

> **Note:** The free Render plan spins down after inactivity. First request after sleep may take ~30 seconds.

---

## RAG Pipeline

```
Upload (PDF/TXT/MD)
    ↓
Text Extraction + Cleaning
    ↓
Smart Chunking (500 words, 50-word overlap)
    ↓
Semantic Embeddings (Xenova all-MiniLM-L6-v2)
    ↓  stored in vectors.json
Query
    ↓
1. Semantic search (cosine similarity)
2. Widened semantic (lower threshold)
3. BM25 keyword fallback
4. Full-corpus fallback
    ↓
Deduplication + Top-K selection
    ↓
NVIDIA NIM LLM (Llama / Mistral)
    ↓
Grounded answer + source attribution + follow-ups
```

---

## Project Structure

```
neuralbase/
├── server.js          # Express server — all API routes
├── documents.js       # Built-in documents (empty by default)
├── lib/
│   ├── vectorStore.js # Persistent vector store (cosine + BM25)
│   ├── embedder.js    # Xenova embedding provider with fallback
│   ├── chunker.js     # Smart text chunker with overlap
│   └── pdfParser.js   # PDF text extraction
├── public/
│   ├── index.html     # SPA shell
│   ├── app.js         # Frontend controller
│   └── style.css      # Dark dashboard theme
├── data/              # Auto-created — stores vectors.json
├── .model-cache/      # Auto-created — Xenova model weights
├── .env.example       # Environment template
├── render.yaml        # Render deployment config
└── package.json
```

---

## API Reference

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | System health check |
| GET | `/api/stats` | Document/chunk/query stats |
| GET | `/api/models` | Available LLM models |
| GET | `/api/usage` | Query usage tracking |
| POST | `/api/feedback` | Submit answer feedback |
| GET | `/api/documents` | List all documents |
| POST | `/api/upload` | Upload file (PDF/TXT/MD, multipart/form-data) |
| DELETE | `/api/documents/:id` | Delete uploaded document |
| POST | `/api/chat` | RAG chat completion |
| GET | `/api/graph` | Fetch knowledge graph |
| POST | `/api/graph/build` | Build graph from documents |
| GET | `/api/wiki` | List wiki pages |
| POST | `/api/wiki/save` | Save a wiki page |
| POST | `/api/wiki/compile` | AI-compile wiki from all docs |
| DELETE | `/api/wiki/:id` | Delete wiki page |

---

## Tech Stack

- **Runtime** — Node.js 18+
- **Server** — Express 4
- **LLM** — NVIDIA NIM (Llama 3.3 70B / Llama 3.1 8B / Mistral 7B)
- **Embeddings** — Xenova/all-MiniLM-L6-v2 (local, no extra key required)
- **Search** — Cosine similarity (semantic) + BM25 (keyword fallback)
- **PDF** — pdf-parse
- **Frontend** — Vanilla JS + Canvas API (knowledge graph)
- **Fonts** — Syne + DM Sans + JetBrains Mono

---

## Interview Demo Checklist

- [ ] Server starts with `npm start` and shows `✓ docs · chunks · semantic search`
- [ ] Upload a PDF → status shows "indexed" in Documents tab
- [ ] Ask a question → answer references the uploaded document
- [ ] Sources accordion shows matched chunks with scores
- [ ] Confidence badge appears on answers
- [ ] "Not found" response appears for out-of-scope questions
- [ ] Build Graph → knowledge graph renders with nodes/edges from uploaded docs
- [ ] Compile Wiki → wiki pages generated from uploaded content
- [ ] Switch model in model selector → next message uses new model
- [ ] Invalid API key → clean error message (not raw 401 error)
- [ ] No built-in sample documents contaminating the knowledge base

---

## Key Design Decisions

**Why no built-in documents?** The exercise requirement is a *searchable* knowledge base — the value comes from indexing your own content. Pre-loaded sample docs would give misleading demo results.

**Why Xenova local embeddings?** No additional API key required, runs locally, works offline, and is fast enough for demonstration-scale corpora (~thousands of chunks).

**Why cosine similarity + BM25 fallback?** Semantic search handles paraphrasing and synonyms; BM25 handles exact keyword matches and ensures no query goes unanswered even when embeddings aren't available.
