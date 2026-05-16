/**
 * embedder.js  –  Embedding provider with automatic detection and fallback.
 *
 * Priority:
 *   1. @xenova/transformers  (local, no key required)
 *   2. Keyword-only fallback (always available)
 *
 * The NVIDIA embedding API can be optionally wired in if you have a suitable
 * embedding model available on your org, but the free-tier key works fine
 * without it.  The chat completions API is NOT used here.
 */

"use strict";

let _pipeline      = null;
let _available     = false;
let _provider      = "keyword";
let _detected      = false;

// ── Provider detection ────────────────────────────────────────────────────────

/**
 * Called once at boot.  Tries to load the local Xenova model.
 * Never throws – always falls back gracefully.
 */
async function detectProvider() {
  if (_detected) return;
  _detected = true;

  console.log("  ⚡  Detecting embedding provider…");

  try {
    // Dynamically import so the whole server doesn't crash if the package is
    // missing or the model download fails.
    const { pipeline, env } = await import("@xenova/transformers");

    // Keep model files in the project's .model-cache directory
    env.cacheDir = ".model-cache";

    // Suppress progress bars in production
    if (process.env.NODE_ENV === "production") {
      env.allowLocalModels = true;
    }

    console.log("  ⏳  Loading embedding model (first run may download ~25 MB)…");

    _pipeline  = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    _available = true;
    _provider  = "xenova/all-MiniLM-L6-v2";

    console.log("  ✓  Semantic embeddings ready (Xenova all-MiniLM-L6-v2)");
  } catch (err) {
    console.warn("  ⚠  Embeddings unavailable, using keyword search:", err.message);
    _available = false;
    _provider  = "keyword";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function isEmbeddingAvailable() {
  return _available;
}

function getProvider() {
  return _provider;
}

/**
 * Embed a single text string.
 * Returns a Float32Array / number[] of the embedding vector.
 * Throws if embeddings are not available.
 */
async function embed(text) {
  if (!_available || !_pipeline) {
    throw new Error("Embeddings are not available. Keyword fallback should be used.");
  }

  const maxLen = 512;
  const truncated = text.slice(0, maxLen * 5); // rough char limit before tokenisation

  const output = await _pipeline(truncated, { pooling: "mean", normalize: true });

  // output.data is a Float32Array – convert to plain JS array for JSON serialisation
  return Array.from(output.data);
}

/**
 * Embed an array of texts in one go.
 * Falls back to per-item embedding if batch fails.
 */
async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    try {
      results.push(await embed(text));
    } catch {
      results.push(null);
    }
  }
  return results;
}

module.exports = { detectProvider, isEmbeddingAvailable, getProvider, embed, embedBatch };
