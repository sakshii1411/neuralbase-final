/**
 * vectorStore.js  –  Persistent vector store with cosine similarity search
 * and BM25-style keyword fallback. Exposes a flat `chunks` array for graph
 * building so callers can iterate over raw chunk text.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Cosine similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── BM25-style keyword scorer ────────────────────────────────────────────────

function bm25Score(text, tokens, k1 = 1.5, b = 0.75, avgLen = 200) {
  const words  = text.toLowerCase().split(/\W+/).filter(Boolean);
  const docLen = words.length;
  const freq   = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  let score = 0;
  for (const token of tokens) {
    const tf = freq[token] || 0;
    if (tf === 0) continue;
    const idf = Math.log(1 + 1 / (0.5 + 0.5)); // simplified – single-doc IDF = ln(2)
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLen))));
  }
  return score;
}

// ── VectorStore class ─────────────────────────────────────────────────────────

class VectorStore {
  constructor(filePath) {
    this.filePath  = filePath;
    this._docs     = new Map(); // id → { id, title, category, source, chunkCount, hasEmbeddings, uploadedAt }
    this.chunks    = [];        // flat array of { docId, docTitle, chunkIndex, text, embedding? }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async load() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(this.filePath)) return;

      const raw  = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw);

      this._docs  = new Map((data.docs  || []).map(d => [d.id, d]));
      this.chunks = data.chunks || [];
    } catch (err) {
      console.warn("VectorStore load error (starting fresh):", err.message);
      this._docs  = new Map();
      this.chunks = [];
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const data = {
        docs:   [...this._docs.values()],
        chunks: this.chunks,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data), "utf8");
    } catch (err) {
      console.error("VectorStore save error:", err.message);
    }
  }

  // ── Document management ───────────────────────────────────────────────────

  hasDocument(id) {
    return this._docs.has(id);
  }

  documentCount() {
    return this._docs.size;
  }

  chunkCount() {
    return this.chunks.length;
  }

  getDocuments() {
    return [...this._docs.values()];
  }

  /**
   * Add a document with pre-chunked text (and optional per-chunk embeddings).
   *
   * @param {object} opts
   * @param {string}   opts.id        – unique doc id
   * @param {string}   opts.title
   * @param {string}   opts.category
   * @param {string}   opts.source    – "built-in" | original filename
   * @param {string[]} opts.chunks    – array of text strings
   * @param {number[][]} [opts.embeddings]  – parallel array of embedding vectors
   */
  async addDocument({ id, title, category, source, chunks, embeddings = [] }) {
    // Remove stale version first
    this.removeDocument(id);

    const hasEmb = embeddings.length > 0 && embeddings.length === chunks.length;

    this._docs.set(id, {
      id,
      title,
      category,
      source,
      chunkCount:    chunks.length,
      hasEmbeddings: hasEmb,
      uploadedAt:    new Date().toISOString(),
    });

    for (let i = 0; i < chunks.length; i++) {
      const c = {
        docId:      id,
        docTitle:   title,
        chunkIndex: i,
        text:       chunks[i],
      };
      if (hasEmb) c.embedding = embeddings[i];
      this.chunks.push(c);
    }
  }

  removeDocument(id) {
    if (!this._docs.has(id)) return false;
    this._docs.delete(id);
    this.chunks = this.chunks.filter(c => c.docId !== id);
    return true;
  }

  // ── Semantic search ────────────────────────────────────────────────────────

  /**
   * Return top-K chunks by cosine similarity with queryEmbedding.
   * Only considers chunks that actually have an .embedding stored.
   */
  search(queryEmbedding, topK = 5) {
    if (!queryEmbedding || this.chunks.length === 0) return [];

    const scored = this.chunks
      .filter(c => c.embedding && c.embedding.length)
      .map(c => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  // ── Keyword / BM25 search ─────────────────────────────────────────────────

  keywordSearch(query, topK = 8) {
    if (!query || this.chunks.length === 0) return [];

    const tokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    if (tokens.length === 0) return this.chunks.slice(0, topK).map(c => ({ ...c, score: 0 }));

    // Estimate average chunk length for BM25
    const avgLen = Math.max(
      1,
      this.chunks.reduce((s, c) => s + c.text.split(/\s+/).length, 0) / this.chunks.length
    );

    const scored = this.chunks
      .map(c => ({ ...c, score: bm25Score(c.text, tokens, 1.5, 0.75, avgLen) }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  // ── Full-corpus retrieval ─────────────────────────────────────────────────
  // Used as last-resort fallback so the LLM never claims ignorance because
  // a small topK window missed the relevant chunk.

  getAllChunksForFallback(maxChunks = 60) {
    return this.chunks.slice(0, maxChunks);
  }
}

module.exports = { VectorStore };
