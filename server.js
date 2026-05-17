/**
 * server.js  –  NeuralBase AI Knowledge Base
 * Production-ready Node/Express RAG server
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *  File Upload → Text Extraction → Chunking → Embedding → VectorStore
 *  Query      → Semantic/Keyword Retrieval → NVIDIA LLM → Structured Response
 *
 * ── Route Order (CRITICAL) ────────────────────────────────────────────────────
 *  All /api/* routes MUST appear before the catch-all app.get("*") at the end.
 */

"use strict";

require("dotenv").config();

const express = require("express");
const path    = require("path");
const multer  = require("multer");
const fetch   = require("node-fetch");

const { VectorStore }                                          = require("./lib/vectorStore");
const { embed, embedBatch, isEmbeddingAvailable, detectProvider, getProvider } = require("./lib/embedder");
const { chunkText }                                            = require("./lib/chunker");
const { parsePDF }                                             = require("./lib/pdfParser");
const DOCUMENTS                                                = require("./documents");

// ── App bootstrap ─────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── CORS ──────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (process.env.NODE_ENV !== "production" || !origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── Model registry ─────────────────────────────────────────────────────────────

const MODELS = [
  { id: "meta/llama-3.1-8b-instruct",   name: "Llama 3.1 8B",  tag: "Fast"    },
  { id: "meta/llama-3.3-70b-instruct",  name: "Llama 3.3 70B", tag: "Best"    },
  { id: "meta/llama-3.2-3b-instruct",   name: "Llama 3.2 3B",  tag: "Light"   },
];

const ALLOWED_MODEL_IDS = new Set(MODELS.map(m => m.id));

function getSafeModel(reqModel) {
  if (reqModel && ALLOWED_MODEL_IDS.has(reqModel)) return reqModel;
  const envModel = process.env.NVIDIA_MODEL;
  if (envModel && ALLOWED_MODEL_IDS.has(envModel)) return envModel;
  return "meta/llama-3.1-8b-instruct";
}

// ── Usage tracking ────────────────────────────────────────────────────────────

const usage = {
  totalQueries:  0,
  todayQueries:  0,
  lastDate:      new Date().toDateString(),
  recentQueries: [],
  feedbacks:     [],
};

function trackQuery(q) {
  const today = new Date().toDateString();
  if (today !== usage.lastDate) { usage.todayQueries = 0; usage.lastDate = today; }
  usage.totalQueries++;
  usage.todayQueries++;
  usage.recentQueries.unshift((q || "").slice(0, 120));
  if (usage.recentQueries.length > 20) usage.recentQueries.pop();
}

// ── Rate limiting (sliding window, per-IP) ────────────────────────────────────

const rateLimits = new Map();

function isRateLimited(ip, max = 60, windowMs = 60_000) {
  const now = Date.now();
  const rec = rateLimits.get(ip) || { count: 0, start: now };
  if (now - rec.start > windowMs) { rec.count = 0; rec.start = now; }
  rec.count++;
  rateLimits.set(ip, rec);
  return rec.count > max;
}

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [ip, rec] of rateLimits) {
    if (rec.start < cutoff) rateLimits.delete(ip);
  }
}, 300_000);

// ── Vector store & file upload ─────────────────────────────────────────────────

const store = new VectorStore(path.join(__dirname, "data", "vectors.json"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
    ];
    const name = file.originalname.toLowerCase();
    const isAllowed = allowed.includes(file.mimetype) ||
      name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".pdf");
    if (isAllowed) return cb(null, true);
    cb(Object.assign(new Error("Only PDF, TXT, and MD files are supported"), { code: "INVALID_TYPE" }));
  },
});

// ── In-memory knowledge graph & wiki store ─────────────────────────────────────

const graphStore = {
  nodes:        [],
  edges:        [],
  explorations: [],
  lastBuilt:    null,
};

// ── NVIDIA error classification ────────────────────────────────────────────────

function classifyNvidiaError(status, body) {
  if (status === 401) {
    return {
      userMessage: "The NVIDIA API key is invalid or has expired. Please check your NVIDIA_API_KEY in the .env file.",
      suggestion: "Visit https://build.nvidia.com to get a valid API key.",
    };
  }
  if (status === 402 || status === 429) {
    return {
      userMessage: "NVIDIA API quota or rate limit reached. Please wait a moment before asking again.",
      suggestion: "If this persists, your free-tier quota may be exhausted. Consider trying a smaller model like Mistral 7B.",
    };
  }
  if (status === 404) {
    return {
      userMessage: "The selected AI model is not available on your NVIDIA account.",
      suggestion: "Try switching to Mistral 7B (Light) or Llama 3.1 8B (Fast) in the model selector.",
    };
  }
  if (status === 503 || status === 502) {
    return {
      userMessage: "The NVIDIA API is temporarily unavailable. Please try again in a few seconds.",
      suggestion: "If this persists, try a different model from the selector at the top.",
    };
  }
  if (status >= 500) {
    return {
      userMessage: "The NVIDIA API encountered a server error. Please try again.",
      suggestion: "Try switching to a different model.",
    };
  }
  return {
    userMessage: "Unable to reach the AI model. Please check your connection and API key.",
    suggestion: "Verify your NVIDIA_API_KEY and try again.",
  };
}

// ── Startup: index built-in documents ─────────────────────────────────────────

async function initialize() {
  await store.load();
  await detectProvider();

  // Remove stale built-in documents that are no longer in DOCUMENTS
  const staticDocIds = new Set(DOCUMENTS.map(d => `static-${d.id}`));
  const storeDocIds  = store.getDocuments().map(d => d.id);
  let   removedStale = false;

  for (const id of storeDocIds) {
    if (id.startsWith("static-") && !staticDocIds.has(id)) {
      store.removeDocument(id);
      removedStale = true;
      console.log(`  🗑  Removed stale built-in document: ${id}`);
    }
  }

  // Index any new built-in documents
  let indexed = 0;
  for (const doc of DOCUMENTS) {
    const key = `static-${doc.id}`;
    if (store.hasDocument(key)) continue;

    const chunks = chunkText(doc.content, 500, 50);
    let embeddings = [];

    if (isEmbeddingAvailable()) {
      console.log(`  Indexing "${doc.title}"…`);
      embeddings = await embedBatch(chunks);
    }

    await store.addDocument({
      id:         key,
      title:      doc.title,
      category:   doc.category,
      source:     "built-in",
      chunks,
      embeddings: embeddings.filter(Boolean),
    });
    indexed++;
  }

  if (indexed > 0 || removedStale) await store.save();

  console.log(
    `\n  ✓  ${store.documentCount()} docs · ${store.chunkCount()} chunks · ` +
    `${isEmbeddingAvailable() ? `semantic (${getProvider()})` : "keyword"} search\n`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  API ROUTES  (all /api/* MUST appear before the catch-all at the bottom)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Health ─────────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    ok:                true,
    version:           "4.1.0",
    documents:         store.documentCount(),
    chunks:            store.chunkCount(),
    embeddingEnabled:  isEmbeddingAvailable(),
    embeddingProvider: getProvider(),
    model:             getSafeModel(),
    uptime:            Math.floor(process.uptime()),
  });
});

// ── Stats ──────────────────────────────────────────────────────────────────────

app.get("/api/stats", (_req, res) => {
  const today = new Date().toDateString();
  if (today !== usage.lastDate) { usage.todayQueries = 0; usage.lastDate = today; }

  res.json({
    documents:         store.documentCount(),
    chunks:            store.chunkCount(),
    embeddingEnabled:  isEmbeddingAvailable(),
    embeddingProvider: getProvider(),
    model:             getSafeModel(),
    totalQueries:      usage.totalQueries,
    todayQueries:      usage.todayQueries,
    feedbacks:         usage.feedbacks.length,
    graphNodes:        graphStore.nodes.length,
    graphEdges:        graphStore.edges.length,
    wikiPages:         graphStore.explorations.length,
    graphLastBuilt:    graphStore.lastBuilt,
  });
});

// ── Models ─────────────────────────────────────────────────────────────────────

app.get("/api/models", (_req, res) => {
  res.json({ models: MODELS, default: getSafeModel() });
});

// ── Usage ──────────────────────────────────────────────────────────────────────

app.get("/api/usage", (_req, res) => {
  const today = new Date().toDateString();
  if (today !== usage.lastDate) { usage.todayQueries = 0; usage.lastDate = today; }
  res.json({
    totalQueries:  usage.totalQueries,
    todayQueries:  usage.todayQueries,
    recentQueries: usage.recentQueries.slice(0, 10),
    feedbacks:     usage.feedbacks.length,
  });
});

// ── Feedback ───────────────────────────────────────────────────────────────────

app.post("/api/feedback", (req, res) => {
  const { query, feedback, messageIndex } = req.body;
  if (typeof feedback === "undefined") {
    return res.status(400).json({ error: "feedback is required" });
  }

  usage.feedbacks.push({
    query:        (query || "").slice(0, 200),
    feedback,
    messageIndex,
    timestamp:    new Date().toISOString(),
  });
  if (usage.feedbacks.length > 200) usage.feedbacks.shift();
  res.json({ success: true });
});

// ── Documents ──────────────────────────────────────────────────────────────────

app.get("/api/documents", (_req, res) => {
  const staticIds = new Set(DOCUMENTS.map(d => `static-${d.id}`));

  const staticDocs = DOCUMENTS.map(d => ({
    id:        `static-${d.id}`,
    title:     d.title,
    category:  d.category,
    source:    "built-in",
    preview:   d.content.slice(0, 180).trim() + "…",
    wordCount: d.content.split(/\s+/).length,
    protected: true,
    status:    "indexed",
  }));

  const uploadedDocs = store.getDocuments()
    .filter(d => !staticIds.has(d.id))
    .map(d => ({
      id:            d.id,
      title:         d.title,
      category:      d.category,
      source:        "uploaded",
      chunkCount:    d.chunkCount,
      hasEmbeddings: d.hasEmbeddings,
      uploadedAt:    d.uploadedAt,
      status:        "indexed",
      protected:     false,
    }));

  res.json({ documents: [...staticDocs, ...uploadedDocs] });
});

// ── File Upload (PDF, TXT, MD) – supports multiple files ──────────────────────

async function processOneFile(file) {
  const mimeType = file.mimetype;
  const fileName = file.originalname.toLowerCase();

  let text = "";
  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    text = await parsePDF(file.buffer);
  } else if (mimeType === "text/plain" || fileName.endsWith(".txt") || fileName.endsWith(".md")) {
    text = file.buffer.toString("utf8");
  } else {
    throw Object.assign(new Error("Unsupported file type."), { code: "INVALID_TYPE" });
  }

  if (!text || text.trim().length < 50) {
    throw new Error("Could not extract readable text. The file may be empty or image-only.");
  }

  const chunks = chunkText(text, 500, 50);
  if (chunks.length === 0) throw new Error("Document produced no indexable chunks.");

  const docId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const title = file.originalname
    .replace(/\.(pdf|txt|md)$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .slice(0, 120);

  let embeddings = [];
  if (isEmbeddingAvailable()) {
    try { embeddings = await embedBatch(chunks); }
    catch (e) { console.warn("Embedding failed:", e.message); }
  }

  await store.addDocument({
    id:         docId,
    title,
    category:   "Uploaded",
    source:     file.originalname,
    chunks,
    embeddings: embeddings.filter(Boolean),
  });

  return {
    id:            docId,
    title,
    chunkCount:    chunks.length,
    wordCount:     text.split(/\s+/).length,
    hasEmbeddings: embeddings.filter(Boolean).length > 0,
  };
}

app.post("/api/upload", upload.array("pdf", 20), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files provided. Please upload one or more PDF, TXT, or MD files." });
  }

  const results   = [];
  const errors    = [];

  for (const file of files) {
    try {
      const doc = await processOneFile(file);
      results.push(doc);
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
      console.warn("Upload error for", file.originalname, err.message);
    }
  }

  if (results.length > 0) await store.save();

  // Single-file backward-compat shape + multi-file shape
  res.json({
    success:   results.length > 0,
    documents: results,
    document:  results[0] || null,   // backwards compat
    errors,
    count:     results.length,
  });
});

// Multer error middleware
app.use((err, _req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum size is 15 MB." });
  }
  if (err && err.code === "INVALID_TYPE") {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

// ── Delete document ─────────────────────────────────────────────────────────────

app.delete("/api/documents/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Document ID is required" });

  if (id.startsWith("static-")) {
    return res.status(403).json({ error: "Built-in documents cannot be removed" });
  }

  if (!store.removeDocument(id)) {
    return res.status(404).json({ error: "Document not found" });
  }

  await store.save();
  res.json({ success: true });
});

// ── Chat (NVIDIA RAG) ──────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: "Rate limit reached (60 requests/min). Please wait a moment before trying again.",
    });
  }

  const {
    messages,
    model:             reqModel,
    topK             = 8,
    threshold        = 0.35,
    customSystemPrompt,
  } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required and must not be empty" });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === "your_nvidia_api_key_here" || apiKey.trim() === "") {
    return res.status(503).json({
      error: "NVIDIA API key is not configured. Add NVIDIA_API_KEY to your .env file.",
      suggestion: "Get a free API key at https://build.nvidia.com",
    });
  }

  // No documents uploaded yet
  if (store.documentCount() === 0) {
    return res.json({
      answer: "Your knowledge base is currently empty. Please upload one or more documents (PDF, TXT, or MD) in the **Documents** tab, then ask your question again.",
      sources: [],
      suggestions: [],
      docsUsed: [],
      searchMethod: "none",
      confidence: 0,
    });
  }

  const model         = getSafeModel(reqModel);
  const latestUserMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";

  trackQuery(latestUserMsg);

  // ── Retrieval pipeline ────────────────────────────────────────────────────

  let relevantChunks = [];
  let searchMethod   = "none";
  const topKNum      = Math.max(2, Math.min(20, Number(topK)));
  const threshNum    = Math.max(0, Math.min(1, Number(threshold)));

  if (store.chunkCount() > 0) {
    // 1. Semantic search
    if (isEmbeddingAvailable()) {
      try {
        const qEmb     = await embed(latestUserMsg);
        const semantic = store.search(qEmb, topKNum).filter(c => c.score >= threshNum);

        if (semantic.length > 0) {
          relevantChunks = semantic;
          searchMethod   = "semantic";
        } else {
          // 2. Widened semantic (lower threshold)
          const widened = store.search(qEmb, topKNum * 2).filter(c => c.score >= threshNum * 0.5);
          if (widened.length > 0) {
            relevantChunks = widened.slice(0, topKNum);
            searchMethod   = "semantic-widened";
          }
        }
      } catch (err) {
        console.warn("Semantic search failed, falling back to keyword:", err.message);
      }
    }

    // 3. Keyword/BM25 fallback
    if (relevantChunks.length === 0) {
      const keyword = store.keywordSearch(latestUserMsg, topKNum * 2);
      if (keyword.length > 0) {
        relevantChunks = keyword.slice(0, topKNum);
        searchMethod   = "keyword";
      }
    }

    // 4. Full-text fallback — inject all chunks so the model can't claim ignorance
    if (relevantChunks.length === 0) {
      relevantChunks = store.getAllChunksForFallback(60);
      searchMethod   = "full-corpus";
    }

    // Remove duplicate chunks (same text)
    const seen = new Set();
    relevantChunks = relevantChunks.filter(c => {
      const key = c.text.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Build context ─────────────────────────────────────────────────────────

  let context  = "";
  let docsUsed = [];

  if (relevantChunks.length > 0) {
    context  = relevantChunks
      .map((c, i) => `### [Source ${i + 1}] ${c.docTitle}\n\n${c.text}`)
      .join("\n\n---\n\n");
    docsUsed = [...new Set(relevantChunks.map(c => c.docTitle))];
  }

  // ── System prompt ─────────────────────────────────────────────────────────

  const defaultPrompt = `You are a document-grounded AI assistant. Your task is to answer questions STRICTLY using the uploaded documents provided below.

CRITICAL RULES — never break these:
1. NEVER invent information. NEVER add assumptions, best practices, recommendations, or external knowledge unless explicitly mentioned in the document.
2. If the answer cannot be found in the documentation, output this refusal message IMMEDIATELY as your ENTIRE response — no steps before it, no workarounds after it, no "however", no partial guesses:
   "I could not find sufficient information in the current knowledge base to answer this accurately. Please upload relevant documents or rephrase your question."
   Do NOT provide invented steps and then contradict yourself. Do NOT say "the documentation does not mention X, but here are some steps anyway". Refuse immediately and completely.
3. Never hallucinate, guess, or invent facts, names, steps, or figures — even as a "suggested" or "possible" answer.
4. Never infer connections between topics that are not explicitly stated in the documents. If the document describes Process A and Process B separately, do not combine them as a solution to Problem C unless the document explicitly says so.
5. Prefer exact workflows, terminology, button names, menu names, and examples from the documents.
6. Do not expand beyond the scope of the question. Do not add vague filler such as "manage payments", "monitor progress", "maintain schedules", or "ensure compliance" unless those exact phrases appear in the document.
7. Do NOT answer a different question than what was asked. If asked "how to manage X", do not list the steps to "create X" again — that is a different action. If the document does not cover managing/editing/deleting, refuse immediately.

ANSWER STYLE:
- Use clean, professional formatting.
- Use step-by-step numbered structure for processes or workflows (1. 2. 3.). Do NOT restart numbering mid-answer.
- Sub-steps within a step → indent with 2 spaces and use a dash (  - sub item).
- General info or requirements → bullet points (- item).
- Do NOT mix numbered lists and bullet lists at the same level.
- Use ## headings only when the answer has 2 or more distinct major sections.
- Mention exact UI labels, button names, and menu names from the document.
- Include examples from the document when available.
- End with a short purpose/result statement when appropriate.
- Keep answers concise and direct. No repeated sentences. No restating the question.

GOOD ANSWER CHARACTERISTICS:
- Accurate and document-grounded.
- Structured and easy to follow.
- Uses exact terminology from source documents.
- No generic filler text.

BAD ANSWER CHARACTERISTICS (never do these):
- Adding extra assumptions not in the document.
- Explaining things not mentioned in the docs.
- Giving "best practice" advice not present in the source.
- Using vague wording like "manage payments", "monitor progress", "maintain schedules", or "ensure compliance" unless explicitly written in the document.

OUTPUT FORMAT:
- Title (if the answer is a multi-step process)
- Step-by-step instructions
- Short concluding line (optional)

At the very end of your answer, on a new line, output EXACTLY:
FOLLOW_UPS:["Specific follow-up question 1?","Specific follow-up question 2?","Specific follow-up question 3?"]
The follow-up questions must:
- Be specific to the topic answered.
- ONLY reference topics, features, or steps explicitly covered in the provided documentation.
- NEVER suggest questions about topics not present in the documents (e.g. do not ask about editing or deleting something if the document does not cover it).
- If fewer than 3 valid document-grounded follow-ups exist, output only as many as are genuinely supported. Do not invent questions to fill the quota.

DOCUMENTATION:
${context}`;

  const systemPrompt = customSystemPrompt
    ? `${customSystemPrompt}\n\nDOCUMENTATION:\n${context}\n\nAt the end output: FOLLOW_UPS:["Question 1?","Question 2?","Question 3?"]`
    : defaultPrompt;

  // ── Build source metadata (send before streaming starts) ──────────────────

  const sources = relevantChunks.map(c => ({
    title:      c.docTitle,
    score:      parseFloat((c.score || 0).toFixed(3)),
    chunkIndex: c.chunkIndex,
    preview:    c.text.slice(0, 200).trim() + (c.text.length > 200 ? "…" : ""),
  }));

  const confidence = sources.length > 0 ? parseFloat(sources[0].score.toFixed(3)) : 0;

  // ── NVIDIA API call (streaming SSE) ───────────────────────────────────────

  let nvResp;
  try {
    nvResp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
        "Accept":        "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
        ],
        temperature: 0.05,
        top_p:       0.85,
        max_tokens:  1200,
        stream:      true,
      }),
    });
  } catch (networkErr) {
    console.error("NVIDIA network error:", networkErr.message);
    return res.status(502).json({
      error: "Could not connect to the NVIDIA API. Please check your internet connection and try again.",
    });
  }

  if (!nvResp.ok) {
    const errText = await nvResp.text().catch(() => "");
    console.error(`NVIDIA API ${nvResp.status}:`, errText.slice(0, 400));
    const { userMessage, suggestion } = classifyNvidiaError(nvResp.status, errText);

    if (relevantChunks.length > 0) {
      const fallbackAnswer = `The AI model is currently unavailable (${userMessage.split(".")[0]}), but here are the most relevant passages:\n\n` +
        relevantChunks.slice(0, 3).map((c, i) =>
          `**[${i + 1}] ${c.docTitle}**\n${c.text.slice(0, 500)}${c.text.length > 500 ? "…" : ""}`
        ).join("\n\n---\n\n");
      return res.json({
        answer: fallbackAnswer, model, searchMethod, suggestions: [], docsUsed, sources, confidence,
        warning: `${userMessage} ${suggestion}`,
      });
    }
    return res.status(502).json({ error: userMessage, suggestion });
  }

  // ── Stream SSE to client ───────────────────────────────────────────────────

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send metadata first so client knows sources immediately
  res.write(`data: ${JSON.stringify({ type: "meta", searchMethod, sources, docsUsed, confidence, model })}\n\n`);

  let fullAnswer = "";

  try {
    const reader  = nvResp.body;
    let   partial = "";

    for await (const chunk of reader) {
      partial += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const obj   = JSON.parse(raw);
          const delta = obj.choices?.[0]?.delta?.content;
          if (delta) {
            fullAnswer += delta;
            res.write(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`);
          }
        } catch { /* skip malformed SSE line */ }
      }
    }
  } catch (streamErr) {
    console.error("Stream read error:", streamErr.message);
  }

  // ── Parse follow-ups from complete answer ──────────────────────────────────

  let suggestions = [];
  const followUpsRx = /FOLLOW_UPS\s*:\s*(\[[\s\S]*?\])/i;
  const match = fullAnswer.match(followUpsRx);
  if (match?.[1]) {
    try { suggestions = JSON.parse(match[1]); } catch { suggestions = []; }
    fullAnswer = fullAnswer.replace(followUpsRx, "").trim();
  }
  fullAnswer = fullAnswer.replace(/FOLLOW_UPS\s*:?\s*/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!Array.isArray(suggestions)) suggestions = [];
  suggestions = suggestions.filter(s => typeof s === "string" && s.trim().length > 3).map(s => s.trim()).slice(0, 3);

  res.write(`data: ${JSON.stringify({ type: "done", suggestions, fullAnswer })}\n\n`);
  res.end();
});

// ── Sample questions (fixed set based on knowledge base topic) ──────────────────

const FIXED_SAMPLE_QUESTIONS = [
  "How do I create a new Evening Study session?",
  "How can I add students to Evening Study?",
  "How do I add fully paid and instalment students together?",
  "How do I notify parents about attendance?",
  "Can staff send notifications directly from attendance records?",
  "How do I send a school-wide notification?",
  "How do I create a notification category?",
  "How can I edit an existing calendar event?",
  "How are staff added to the school database?",
  "Can teachers register as both Staff and Parent?",
  "How do I send a notification to one parent only?",
  "How do I manage Evening Study time slots?",
  "How do I create student payment groups?",
];

app.get("/api/sample-questions", (_req, res) => {
  res.json({ questions: FIXED_SAMPLE_QUESTIONS });
});

// ── Knowledge Graph ─────────────────────────────────────────────────────────────

app.get("/api/graph", (_req, res) => {
  res.json({
    nodes:     graphStore.nodes,
    edges:     graphStore.edges,
    lastBuilt: graphStore.lastBuilt,
  });
});

app.post("/api/graph/build", async (req, res) => {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === "your_nvidia_api_key_here") {
    return res.status(503).json({ error: "NVIDIA API key is not configured." });
  }

  if (store.documentCount() === 0) {
    return res.status(400).json({ error: "No documents in the knowledge base. Upload documents first." });
  }

  try {
    const allStoreDocs = store.getDocuments();
    // Limit to 6 docs max to keep graph readable
    const sourceDocs = allStoreDocs.slice(0, 6);

    const nodes    = [];
    const edges    = [];
    const nodeMap  = new Map();
    const edgeSeen = new Set();
    let   nodeId   = 0;

    function getOrCreate(label, type) {
      const key = label.toLowerCase().trim();
      if (nodeMap.has(key)) return nodeMap.get(key);
      const id = `n${nodeId++}`;
      nodes.push({ id, label: label.slice(0, 28), type });
      nodeMap.set(key, id);
      return id;
    }

    function addEdge(source, target, label) {
      if (source === target) return;
      const k = `${source}→${target}`;
      if (edgeSeen.has(k)) return;
      edgeSeen.add(k);
      edges.push({ source, target, label: (label || "").slice(0, 20) });
    }

    // Noise filters
    const NOISE_PATTERNS = [
      /^(january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d+)?$/i,
      /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
      /^\d[\d\s\/\-\.]*$/,
      /^(http|www\.|\.com|\.ie|\.org|\.net)/i,
      /^(the|a|an|and|or|but|for|nor|so|yet|in|on|at|to|by|of|as|is|it|be|do|has|was|are|with|from|this|that|these|those|then|than|your|you|we|our|their|its)$/i,
    ];
    const GENERIC_LABELS = new Set([
      "system","feature","user","data","information","content","process","step",
      "item","option","section","page","form","button","screen","view","list",
      "text","field","value","type","name","date","time","number","email","term",
      "overview","example","note","detail","description","summary","click","select",
    ]);

    function isNoisy(label) {
      if (!label || label.length < 3) return true;
      if (NOISE_PATTERNS.some(rx => rx.test(label.trim()))) return true;
      if (GENERIC_LABELS.has(label.toLowerCase().split(" ")[0])) return true;
      if (GENERIC_LABELS.has(label.toLowerCase())) return true;
      return false;
    }

    // Process each document — extract exactly 3 quality concepts
    for (const doc of sourceDocs) {
      const docChunks  = store.chunks.filter(c => c.docId === doc.id);
      const sampleText = docChunks.slice(0, 2).map(c => c.text).join("\n").slice(0, 600);
      const docLabel   = (doc.title || doc.id).slice(0, 28);
      const docNodeId  = getOrCreate(docLabel, "Document");

      const prompt = `You are extracting key concepts from a school management system document.

Read this text and extract exactly 3 important named concepts, features, or actions.
RULES:
- Only use terms that APPEAR in the text
- Each label must be 2-4 words, meaningful and specific (e.g. "Evening Study", "Mark Attendance", "Send Notification")
- Do NOT include: months, dates, numbers, URLs, generic words like "system" "user" "data"
- type must be one of: Concept, Process, Technology, Entity

Return ONLY valid JSON array, no other text:
[{"label":"Specific Term","type":"Concept","rel":"has"},{"label":"Another Term","type":"Process","rel":"enables"},{"label":"Third Term","type":"Entity","rel":"contains"}]

Text:
${sampleText}

JSON:`;

      try {
        const nvResp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method:  "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body:    JSON.stringify({
            model:       "meta/llama-3.1-8b-instruct",
            messages:    [{ role: "user", content: prompt }],
            temperature: 0.05,
            max_tokens:  200,
            stream:      false,
          }),
        });

        if (nvResp.ok) {
          const data = await nvResp.json();
          const raw  = data.choices?.[0]?.message?.content || "";
          const match = raw.match(/\[[\s\S]*?\]/);
          if (match) {
            let items;
            try { items = JSON.parse(match[0]); } catch { items = []; }
            let count = 0;
            for (const item of items) {
              if (count >= 3) break;
              if (!item.label) continue;
              const label = item.label.trim().slice(0, 28);
              if (isNoisy(label)) continue;
              const type = ["Entity","Process","Concept","Technology"].includes(item.type) ? item.type : "Concept";
              const nid = getOrCreate(label, type);
              if (nid !== docNodeId) {
                addEdge(docNodeId, nid, item.rel || "has");
                count++;
              }
            }
          }
        }
      } catch (e) {
        console.warn("Graph extraction error for:", docLabel, e.message);
      }
    }

    // Cross-link docs that share concept nodes
    const docNodeIds = sourceDocs
      .map(d => nodeMap.get((d.title || d.id).slice(0,28).toLowerCase().trim()))
      .filter(Boolean);
    for (let i = 0; i < docNodeIds.length; i++) {
      for (let j = i + 1; j < docNodeIds.length; j++) {
        const aTargets = edges.filter(e => e.source === docNodeIds[i]).map(e => e.target);
        const bTargets = edges.filter(e => e.source === docNodeIds[j]).map(e => e.target);
        if (aTargets.some(id => bTargets.includes(id))) {
          addEdge(docNodeIds[i], docNodeIds[j], "related");
        }
      }
    }

    // Hard cap: max 30 nodes, 50 edges for clean readable graph
    const finalNodes    = nodes.slice(0, 30);
    const finalNodeIds  = new Set(finalNodes.map(n => n.id));
    const finalEdges    = edges
      .filter(e => finalNodeIds.has(e.source) && finalNodeIds.has(e.target))
      .slice(0, 50);

    graphStore.nodes     = finalNodes;
    graphStore.edges     = finalEdges;
    graphStore.lastBuilt = new Date().toISOString();

    res.json({
      nodes:     finalNodes,
      edges:     finalEdges,
      message:   `Graph built: ${finalNodes.length} nodes, ${finalEdges.length} edges from ${sourceDocs.length} documents`,
      lastBuilt: graphStore.lastBuilt,
    });

  } catch (err) {
    console.error("Graph build error:", err.message);
    res.status(500).json({ error: "Failed to build knowledge graph. Please try again." });
  }
});


// ── Graph node: generate AI answer on click ────────────────────────────────────

app.post("/api/graph/node-answer", async (req, res) => {
  const { label, type, model: reqModel } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === "your_nvidia_api_key_here") {
    return res.status(503).json({ error: "NVIDIA API key not configured." });
  }

  let context = "";
  try {
    if (isEmbeddingAvailable()) {
      const qEmb = await embed(label);
      const hits  = store.search(qEmb, 5).map(c => c.text);
      context = hits.join("\n\n");
    } else {
      const hits = store.keywordSearch ? store.keywordSearch(label, 5) : [];
      context = hits.map(c => c.text).join("\n\n");
    }
  } catch (e) {}

  if (!context.trim()) {
    context = store.chunks
      .filter(c => c.text.toLowerCase().includes(label.toLowerCase()))
      .slice(0, 3).map(c => c.text).join("\n\n") || "No specific context found.";
  }

  const model = getSafeModel(reqModel);
  const prompt = `You are a knowledgeable assistant. Based on the documentation below, explain the concept "${label}" (type: ${type || "concept"}) clearly and concisely in 3-5 sentences. Include key points and any important steps or details.\n\nDOCUMENTATION:\n${context.slice(0, 2000)}\n\nAnswer:`;

  try {
    const nvResp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 400, stream: false }),
    });
    if (!nvResp.ok) {
      const body = await nvResp.json().catch(() => ({}));
      const classified = classifyNvidiaError(nvResp.status, body);
      return res.status(nvResp.status).json({ error: classified.userMessage });
    }
    const data = await nvResp.json();
    const answer = data.choices?.[0]?.message?.content || "No answer generated.";
    res.json({ answer, label, type });
  } catch (err) {
    console.error("Node answer error:", err.message);
    res.status(500).json({ error: "Failed to generate answer for this node." });
  }
});

// ── Wiki ──────────────────────────────────────────────────────────────────────

app.get("/api/wiki", (_req, res) => {
  res.json({ pages: graphStore.explorations });
});

app.post("/api/wiki/save", (req, res) => {
  const { query, answer, sources, searchMethod } = req.body;
  if (!query?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: "query and answer are required" });
  }

  const existing = graphStore.explorations.findIndex(e => e.query === query);
  const entry = {
    id:           existing >= 0 ? graphStore.explorations[existing].id : `wiki-${Date.now()}`,
    query,
    answer,
    sources:      sources || [],
    searchMethod: searchMethod || "keyword",
    date:         new Date().toISOString(),
  };

  if (existing >= 0) graphStore.explorations[existing] = entry;
  else               graphStore.explorations.unshift(entry);

  if (graphStore.explorations.length > 50) graphStore.explorations.pop();
  res.json({ success: true, page: entry });
});

app.post("/api/wiki/compile", async (req, res) => {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === "your_nvidia_api_key_here") {
    return res.status(503).json({ error: "NVIDIA API key is not configured." });
  }

  if (store.documentCount() === 0) {
    return res.status(400).json({ error: "No documents in the knowledge base. Upload documents first." });
  }

  try {
    const allStoreDocs = store.getDocuments();
    const allChunks    = store.chunks;

    const context = allStoreDocs.slice(0, 8).map(doc => {
      const chunks  = allChunks.filter(c => c.docId === doc.id).slice(0, 2).map(c => c.text).join(" ");
      const content = chunks || "";
      return `## ${doc.title}\n${content.slice(0, 600)}`;
    }).join("\n\n---\n\n");

    const topics = allStoreDocs.slice(0, 6).map(d => d.title);
    const pages  = [];

    for (const topic of topics) {
      const prompt = `You are a professional technical writer. Using ONLY the documentation below, write a comprehensive wiki article about "${topic}".

Structure:
## Overview
2-3 sentence summary of what this covers.

## Key Steps / Features
Numbered list of the most important steps or features.

## Notes
Any important caveats, tips, or warnings.

Length: 200-300 words. Professional enterprise tone. Use only information from the provided documentation.

DOCUMENTATION:
${context.slice(0, 2800)}`;

      try {
        const nvResp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method:  "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body:    JSON.stringify({
            model:       "meta/llama-3.1-8b-instruct",
            messages:    [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens:  800,
            stream:      false,
          }),
        });

        if (nvResp.ok) {
          const data    = await nvResp.json();
          const content = data.choices?.[0]?.message?.content || "";
          pages.push({
            id:           `compiled-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            query:        topic,
            answer:       content,
            sources:      [{ title: topic }],
            searchMethod: "compiled",
            date:         new Date().toISOString(),
            compiled:     true,
          });
        }
      } catch (e) {
        console.warn("Wiki compile failed for topic:", topic, e.message);
      }
    }

    graphStore.explorations = [
      ...pages,
      ...graphStore.explorations.filter(e => !e.compiled),
    ].slice(0, 50);

    res.json({ success: true, pages, count: pages.length });

  } catch (err) {
    console.error("Wiki compile error:", err.message);
    res.status(500).json({ error: "Failed to compile wiki. Please try again." });
  }
});

app.delete("/api/wiki/:id", (req, res) => {
  const { id } = req.params;
  const idx = graphStore.explorations.findIndex(e => e.id === id);
  if (idx < 0) return res.status(404).json({ error: "Wiki page not found" });
  graphStore.explorations.splice(idx, 1);
  res.json({ success: true });
});

// ── Global error handler ───────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum size is 15 MB." });
  }
  res.status(500).json({
    error: "An unexpected server error occurred. Please try again.",
  });
});

// ── SPA catch-all — MUST BE LAST ──────────────────────────────────────────────

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Boot ───────────────────────────────────────────────────────────────────────

initialize()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`  🚀  NeuralBase running at http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error("Initialization error:", err.message);
    app.listen(PORT, () => {
      console.log(`  🚀  NeuralBase running at http://localhost:${PORT} (degraded mode)\n`);
    });
  });
