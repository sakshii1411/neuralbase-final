<div align="center">

# ⬡ NeuralBase

### AI-Powered Knowledge Base with RAG, Semantic Search & Knowledge Graph Visualization

[![Live Demo](https://img.shields.io/badge/Live%20Demo-neuralbase--final.onrender.com-6366f1?style=for-the-badge&logo=render&logoColor=white)](https://neuralbase-final.onrender.com)
[![Version](https://img.shields.io/badge/Version-4.1-10b981?style=for-the-badge)](#)
[![NVIDIA NIM](https://img.shields.io/badge/Powered%20by-NVIDIA%20NIM-76b900?style=for-the-badge&logo=nvidia&logoColor=white)](https://integrate.api.nvidia.com)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](#)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge)](#license)

<br/>

> Upload your documents. Ask anything. NeuralBase answers strictly from your own knowledge — no hallucinations, no guessing.

<br/>

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Usage Guide](#usage-guide)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

**NeuralBase** is a production-ready, self-hosted AI knowledge base system. It lets you ingest your own documents (PDFs, text files, Markdown) and query them using a Retrieval-Augmented Generation (RAG) pipeline powered by NVIDIA NIM language models.

Every answer is grounded strictly in your uploaded content — the system will not speculate beyond what your documents contain. Alongside natural-language Q&A, NeuralBase automatically extracts a visual **knowledge graph** of concepts from your corpus and compiles a **wiki** of AI-generated summaries, giving you multiple lenses into your data.

---

## Features

| Feature | Description |
|---|---|
| 🤖 **Ask AI (RAG)** | Semantic search over your documents with LLM-generated answers, strictly grounded in your content |
| 📄 **Document Management** | Upload up to 20 files (PDF, TXT, MD) up to 15 MB each; documents are chunked, embedded, and indexed automatically |
| 🔮 **Knowledge Graph** | AI extracts key concepts and relationships from your corpus and renders them as an interactive, zoomable canvas graph |
| 📖 **Wiki Compilation** | One-click generation of AI-written wiki pages summarising each major topic in your knowledge base |
| 📊 **Live Dashboard** | Real-time stats — indexed chunks, query counts, graph nodes, wiki pages, system health |
| ⚙️ **Configurable Retrieval** | Tune Top-K chunks (default 8) and similarity threshold (default 0.35) directly from the UI |
| 🧠 **Custom System Prompt** | Override the base prompt to steer the AI's tone, focus, and output style |
| 🔄 **Multi-Model Support** | Switch between Llama 3.1 8B, 3.3 70B, and 3.2 3B from the Settings panel without restarting |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                        │
│   Dashboard │ Ask AI │ Documents │ Knowledge Graph │ Wiki   │
│              Vanilla JS · HTML5 · CSS3                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (18 routes)
┌──────────────────────────▼──────────────────────────────────┐
│                  Node.js + Express Backend                  │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Ingestion  │   │  RAG Engine  │   │  Graph Builder  │  │
│  │  Pipeline   │──▶│  (Retrieve + │   │  (Concept       │  │
│  │  chunk /    │   │   Generate)  │   │   Extraction)   │  │
│  │  embed /    │   └──────┬───────┘   └────────┬────────┘  │
│  │  index      │          │                    │            │
│  └─────────────┘   ┌──────▼───────┐   ┌────────▼────────┐  │
│                    │  NVIDIA NIM  │   │  JSON Vector    │  │
│                    │  (LLM API)   │   │  Store + BM25   │  │
│                    └──────────────┘   └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**RAG Pipeline — step by step:**

1. **Ingest** — Uploaded documents are parsed with `pdf-parse`, split into 500-word overlapping chunks (50-word sliding window), and embedded using the local `Xenova/all-MiniLM-L6-v2` model via `@xenova/transformers`.
2. **Index** — Chunk embeddings are stored in a local JSON file (`data/vectors.json`) via a custom `VectorStore` class with cosine similarity search. If embeddings are unavailable, BM25 keyword scoring activates automatically.
3. **Retrieve** — At query time, the user's question is embedded and the top-K most similar chunks are retrieved by cosine similarity (or BM25 fallback).
4. **Generate** — Retrieved chunks + the question are sent to NVIDIA NIM via a plain HTTP request; the LLM synthesises a grounded answer with follow-up suggestions.
5. **Graph** — A separate NVIDIA NIM call extracts named concepts and relationships from indexed documents, stored in memory and rendered as a force-directed canvas graph.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 18+ |
| **Web Framework** | Express.js |
| **LLM Provider** | NVIDIA NIM (`integrate.api.nvidia.com`) |
| **LLM Models** | Llama 3.1 8B (default · Fast), Llama 3.3 70B (Best), Llama 3.2 3B (Light) |
| **Embeddings** | `@xenova/transformers` — `Xenova/all-MiniLM-L6-v2` (local, ~25 MB, no API key needed) |
| **Search Fallback** | BM25 keyword scoring (automatic when embeddings unavailable) |
| **Vector Store** | Custom JSON-file store with cosine similarity (`data/vectors.json`) |
| **Document Parsing** | `pdf-parse` (PDF), built-in Node.js (TXT, MD) |
| **Graph Visualisation** | HTML5 Canvas API + custom JavaScript physics simulation |
| **Frontend** | Vanilla JavaScript · HTML5 · CSS3 (Single Page App) |
| **File Uploads** | `multer` (in-memory storage) |
| **Deployment** | Render.com |

---

## Getting Started

### Prerequisites

- **Node.js 18** or higher — [download here](https://nodejs.org)
- A valid **NVIDIA NIM API key** — [get one free at build.nvidia.com](https://build.nvidia.com)
- Git

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/sakshii1411/neuralbase-final.git
cd neuralbase-final

# 2. Install dependencies
npm install
```

> The first run will automatically download the `Xenova/all-MiniLM-L6-v2` embedding model (~25 MB) into `.model-cache/`. This is a one-time download.

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
NVIDIA_API_KEY=your_nvidia_nim_api_key_here

# Optional overrides
NVIDIA_MODEL=meta/llama-3.1-8b-instruct
PORT=3000
NODE_ENV=development
```

> ⚠️ Never commit your `.env` file. It is already listed in `.gitignore`.

**Available models for `NVIDIA_MODEL`:**

| Value | Name | Speed |
|---|---|---|
| `meta/llama-3.1-8b-instruct` | Llama 3.1 8B | Fast (default) |
| `meta/llama-3.3-70b-instruct` | Llama 3.3 70B | Best quality |
| `meta/llama-3.2-3b-instruct` | Llama 3.2 3B | Lightest |

### Running Locally

```bash
# Production mode
node server.js

# Development mode (auto-restart on file changes)
npm run dev
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

The terminal will confirm which embedding mode is active:
- `✓ Semantic embeddings ready (Xenova all-MiniLM-L6-v2)` — full semantic search
- `⚠ Embeddings unavailable, using keyword search` — BM25 fallback

---

## Usage Guide

### 1 — Upload Documents

Navigate to the **Documents** tab. Drag and drop or browse to upload PDFs, `.txt`, or `.md` files (up to 20 files, 15 MB each). The system will automatically parse, chunk, embed, and index your content. Dashboard counters update in real time.

### 2 — Ask AI

Go to the **Ask AI** tab and type your question. NeuralBase retrieves the most relevant chunks from your indexed documents using cosine similarity and generates a grounded answer via NVIDIA NIM. Each answer shows:
- A **relevance badge** (HIGH / MEDIUM) based on the top chunk's similarity score
- **Source citations** — the exact documents the answer came from
- **Follow-up suggestions** — auto-generated related questions

```
Shift + Enter   →  new line in your query
Enter           →  send query
```

### 3 — Build the Knowledge Graph

Once documents are indexed, open the **Knowledge Graph** tab and click **Build Graph**. The AI extracts key concepts and relationships and renders them as an interactive force-directed canvas graph. Click any node to see its description and connections.

### 4 — Compile the Wiki

In the **Wiki** tab, click **Compile Wiki** to generate AI-written summary pages across your documents. Every query you make is also automatically saved as a wiki exploration page — the knowledge base grows with every use.

### 5 — Tune Settings

Under **Settings** you can:
- Switch the active LLM model (applies to the next query)
- Adjust **Top-K Chunks** — how many retrieved passages the LLM sees (default: `8`)
- Adjust **Similarity Threshold** — minimum relevance score to include a chunk (default: `0.35`)
- Write a **Custom System Prompt** to steer the AI's tone or output format

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `NVIDIA_API_KEY` | — | Your NVIDIA NIM API key (required) |
| `NVIDIA_MODEL` | `meta/llama-3.1-8b-instruct` | LLM model to use |
| `PORT` | `3000` | Port the Express server listens on |
| `NODE_ENV` | `development` | Set to `production` on deployment |
| Top-K Chunks (UI) | `8` | Chunks passed to LLM per query |
| Similarity Threshold (UI) | `0.35` | Minimum cosine similarity to retrieve a chunk |

---

## Deployment

NeuralBase is configured for one-click deployment on **[Render](https://render.com)** via the included `render.yaml`.

### Deploy to Render

1. Fork this repository to your GitHub account.
2. Create a new **Web Service** on Render and connect your fork.
3. Set the following environment variable in the Render dashboard:

   | Key | Value |
   |---|---|
   | `NVIDIA_API_KEY` | your NVIDIA NIM key |

   Render will automatically use the `render.yaml` config:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Runtime:** Node.js

4. Click **Deploy**. Your live URL will be available within a few minutes.

> **Note:** The free tier on Render spins down after inactivity. The first request after a cold start may take 30–60 seconds while the embedding model reloads.

---

## Project Structure

```
neuralbase-final/
├── server.js               # Main Express server — 18 API routes
├── documents.js            # Built-in sample documents
├── package.json            # Node.js dependencies & scripts
├── render.yaml             # Render.com deployment config
├── .gitignore
│
├── lib/
│   ├── embedder.js         # @xenova/transformers embedding pipeline + BM25 fallback
│   ├── vectorStore.js      # JSON-file vector store with cosine similarity search
│   ├── chunker.js          # Sliding-window text chunker (500 words, 50-word overlap)
│   └── pdfParser.js        # PDF text extraction via pdf-parse
│
├── public/
│   ├── index.html          # Single-page application shell
│   ├── app.js              # Frontend SPA logic + HTML5 Canvas graph renderer
│   └── style.css           # Styles
│
└── data/
    └── vectors.json        # Persisted chunk embeddings (auto-created, git-ignored)
```

### API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Server and embedding status |
| GET | `/api/stats` | Dashboard stats (chunks, nodes, wiki pages) |
| GET | `/api/models` | Available LLM models |
| GET | `/api/usage` | Query usage tracking |
| POST | `/api/feedback` | Submit answer feedback |
| GET | `/api/documents` | List indexed documents |
| POST | `/api/upload` | Upload and index documents |
| DELETE | `/api/documents/:id` | Remove a document and its chunks |
| POST | `/api/chat` | RAG query — retrieve + generate |
| GET | `/api/sample-questions` | Suggested starter questions |
| GET | `/api/graph` | Fetch current knowledge graph |
| POST | `/api/graph/build` | Build graph from indexed documents |
| POST | `/api/graph/node-answer` | Get LLM explanation for a graph node |
| GET | `/api/wiki` | Fetch saved wiki pages |
| POST | `/api/wiki/save` | Save a query-answer as a wiki page |
| POST | `/api/wiki/compile` | Compile cross-document wiki summaries |
| DELETE | `/api/wiki/:id` | Delete a wiki page |

---

## License

MIT © [Sakshi Awasthi](https://github.com/sakshii1411)

---

<div align="center">

Built by [Sakshi Awasthi](https://github.com/sakshii1411) · Powered by NVIDIA NIM · Deployed on Render

</div>
