<div align="center">

# ⬡ NeuralBase

### AI-Powered Knowledge Base with RAG, Semantic Search & Knowledge Graph Visualization

[![Live Demo](https://img.shields.io/badge/Live%20Demo-neuralbase--final.onrender.com-6366f1?style=for-the-badge&logo=render&logoColor=white)](https://neuralbase-final.onrender.com)
[![Version](https://img.shields.io/badge/Version-4.1-10b981?style=for-the-badge)](#)
[![NVIDIA NIM](https://img.shields.io/badge/Powered%20by-NVIDIA%20NIM-76b900?style=for-the-badge&logo=nvidia&logoColor=white)](https://integrate.api.nvidia.com)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](#)
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
- [Contributing](#contributing)
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
| 🔮 **Knowledge Graph** | AI extracts key concepts and relationships from your corpus and renders them as an interactive, zoomable graph |
| 📖 **Wiki Compilation** | One-click generation of AI-written wiki pages summarising each major topic in your knowledge base |
| 📊 **Live Dashboard** | Real-time stats — indexed chunks, query counts, graph nodes, wiki pages, system health |
| ⚙️ **Configurable Retrieval** | Tune Top-K chunks (default 8) and similarity threshold (default 0.35) directly from the UI |
| 🧠 **Custom System Prompt** | Override the base prompt to steer the AI's tone, focus, and output style |
| 🔄 **Multi-Model Support** | Switch the active LLM from the Settings panel without restarting the server |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                        │
│   Dashboard │ Ask AI │ Documents │ Knowledge Graph │ Wiki   │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                     Python Backend                          │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Ingestion  │   │  RAG Engine  │   │  Graph Builder  │  │
│  │  Pipeline   │──▶│  (Retrieve + │   │  (Concept       │  │
│  │  chunk/     │   │   Generate)  │   │   Extraction)   │  │
│  │  embed/     │   └──────┬───────┘   └────────┬────────┘  │
│  │  index      │          │                    │            │
│  └─────────────┘   ┌──────▼───────┐   ┌────────▼────────┐  │
│                    │  NVIDIA NIM  │   │  Vector Store   │  │
│                    │  (LLM API)   │   │  (Embeddings)   │  │
│                    └──────────────┘   └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**RAG Pipeline — step by step:**

1. **Ingest** — Uploaded documents are parsed, split into overlapping chunks, and embedded via a sentence embedding model.
2. **Index** — Chunk embeddings are stored in a vector index for fast similarity lookup.
3. **Retrieve** — At query time, the user's question is embedded and the top-K most similar chunks are retrieved.
4. **Generate** — Retrieved chunks + the question are sent to NVIDIA NIM; the LLM synthesises a grounded answer.
5. **Graph** — A separate AI pass extracts named concepts and their relationships, stored as a graph and rendered in the browser.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Language** | Python 3.10+ |
| **Web Framework** | Flask / FastAPI |
| **LLM Provider** | NVIDIA NIM (`integrate.api.nvidia.com`) |
| **Embeddings** | Sentence Transformers / NVIDIA Embedding Models |
| **Vector Search** | FAISS / ChromaDB |
| **Graph Processing** | NetworkX |
| **Frontend** | Vanilla JS, HTML5, CSS3 (Single Page App) |
| **Graph Visualisation** | D3.js / Vis.js |
| **Deployment** | Render.com |
| **Document Parsing** | PyMuPDF (PDF), standard Python (TXT, MD) |

---

## Getting Started

### Prerequisites

- Python **3.10** or higher
- A valid **NVIDIA NIM API key** — [get one here](https://integrate.api.nvidia.com)
- `pip` or `uv` for package management
- Git

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/sakshii1411/neuralbase-final.git
cd neuralbase-final

# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # macOS / Linux
venv\Scripts\activate           # Windows

# 3. Install dependencies
pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file in the project root:

```env
# NVIDIA NIM
NVIDIA_API_KEY=your_nvidia_nim_api_key_here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# App settings (optional overrides)
TOP_K_CHUNKS=8
SIMILARITY_THRESHOLD=0.35
MAX_UPLOAD_SIZE_MB=15
MAX_UPLOAD_FILES=20

# Flask / server
FLASK_ENV=production
SECRET_KEY=your_secret_key_here
PORT=5000
```

> ⚠️ Never commit your `.env` file. It is already listed in `.gitignore`.

### Running Locally

```bash
# Start the development server
python app.py
```

Open your browser at **[http://localhost:5000](http://localhost:5000)**.

---

## Usage Guide

### 1 — Upload Documents

Navigate to the **Documents** tab. Drag and drop or browse to upload PDFs, `.txt`, or `.md` files (up to 20 files, 15 MB each). The system will automatically chunk, embed, and index your content. Watch the dashboard counters update in real time.

### 2 — Ask AI

Go to the **Ask AI** tab and type your question. NeuralBase will retrieve the most relevant chunks from your indexed documents and generate a grounded answer. It will not answer questions that fall outside your uploaded content.

```
Shift + Enter   →  new line in your query
Enter           →  send query
```

### 3 — Build the Knowledge Graph

Once documents are indexed, open the **Knowledge Graph** tab and click **Build Graph**. The AI will extract key concepts and relationships, then render them as an interactive, pannable, zoomable concept map. Click any node to see its details.

### 4 — Compile the Wiki

In the **Wiki** tab, click **Compile Wiki**. NeuralBase generates a structured wiki page for each major topic it finds across your documents. Individual pages can be saved, edited, or exported.

### 5 — Tune Settings

Under **Settings** you can:

- Switch the active LLM (changes apply to the next query)
- Adjust **Top-K Chunks** — how many retrieved passages the LLM sees (default: `8`)
- Adjust **Similarity Threshold** — minimum relevance score to include a chunk (default: `0.35`)
- Write a **Custom System Prompt** to steer the AI's behaviour, tone, or output format

---

## Configuration

All runtime behaviour can be adjusted either via `.env` or directly in the **Settings** UI.

| Setting | Default | Description |
|---|---|---|
| `TOP_K_CHUNKS` | `8` | Number of document chunks passed to the LLM per query |
| `SIMILARITY_THRESHOLD` | `0.35` | Minimum cosine similarity for a chunk to be retrieved |
| `MAX_UPLOAD_SIZE_MB` | `15` | Per-file upload limit |
| `MAX_UPLOAD_FILES` | `20` | Maximum files in the knowledge base at once |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |

---

## Deployment

NeuralBase is configured for one-click deployment on **[Render](https://render.com)**.

### Deploy to Render

1. Fork this repository to your GitHub account.
2. Create a new **Web Service** on Render and connect your fork.
3. Set the following in the Render dashboard under **Environment**:

   | Key | Value |
   |---|---|
   | `NVIDIA_API_KEY` | your NVIDIA NIM key |
   | `SECRET_KEY` | a long random string |
   | `PYTHON_VERSION` | `3.10.0` |

4. Render will auto-detect the `requirements.txt` and build command. Set the **Start Command** to:

   ```
   python app.py
   ```

5. Click **Deploy**. Your live URL will be available within a few minutes.

> **Note:** The free tier on Render spins down after inactivity. The first request after a cold start may take 30–60 seconds.

---

## Project Structure

```
neuralbase-final/
├── app.py                  # Main application entry point
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variable template
├── .gitignore
│
├── core/
│   ├── ingestion.py        # Document parsing, chunking, embedding
│   ├── retrieval.py        # Vector similarity search
│   ├── generation.py       # NVIDIA NIM LLM calls & RAG pipeline
│   ├── graph_builder.py    # Concept extraction & graph construction
│   └── wiki_compiler.py    # Wiki page generation
│
├── static/
│   ├── app.js              # Frontend SPA logic
│   ├── style.css           # Styles
│   └── graph.js            # Knowledge graph visualisation
│
├── templates/
│   └── index.html          # Single-page application shell
│
└── uploads/                # Temporary file storage (git-ignored)
```

---

## Contributing

Contributions, bug reports, and feature requests are welcome!

```bash
# Fork the repo, then:
git checkout -b feature/your-feature-name
git commit -m "feat: describe your change"
git push origin feature/your-feature-name
# Open a Pull Request
```

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and keep PRs focused on a single concern.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<div align="center">

Built by [Sakshi Awasthi](https://github.com/sakshii1411) · Powered by NVIDIA NIM · Deployed on Render

</div>
