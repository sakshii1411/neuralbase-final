/**
 * chunker.js  –  Smart text chunker with sliding-window overlap.
 *
 * Splits on sentence/paragraph boundaries where possible to avoid
 * breaking mid-thought, then enforces a hard word-count limit.
 */

"use strict";

/**
 * Split text into overlapping chunks of approximately `chunkWords` words
 * with `overlapWords` of sliding-window overlap between adjacent chunks.
 *
 * @param {string} text
 * @param {number} chunkWords   target words per chunk (default 500)
 * @param {number} overlapWords word overlap between chunks (default 50)
 * @returns {string[]}
 */
function chunkText(text, chunkWords = 500, overlapWords = 50) {
  if (!text || typeof text !== "string") return [];

  // Normalise whitespace
  const normalised = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g,   "\n")
    .replace(/\t/g,   " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();

  if (normalised.length === 0) return [];

  // ── 1. Split into sentences ──────────────────────────────────────────────
  // Simple sentence splitter that handles common abbreviations.
  const rawSentences = normalised
    .split(/(?<=[.!?])\s+(?=[A-Z\d"'])/g)
    .flatMap(s => {
      // Also split on newline sequences (paragraph breaks)
      return s.split(/\n{2,}/);
    })
    .map(s => s.trim())
    .filter(Boolean);

  // ── 2. Accumulate sentences into chunks ──────────────────────────────────
  const chunks = [];
  const buffer = [];   // sentence strings currently in the window
  let   bufferWords = 0;

  function flush() {
    const text = buffer.join(" ").trim();
    if (text.length > 0) chunks.push(text);
  }

  function wordCount(s) {
    return s.split(/\s+/).filter(Boolean).length;
  }

  for (const sentence of rawSentences) {
    const sw = wordCount(sentence);

    if (bufferWords + sw > chunkWords && buffer.length > 0) {
      flush();

      // ── Overlap: keep last `overlapWords` words from the current buffer
      const overlap = [];
      let kept = 0;
      for (let i = buffer.length - 1; i >= 0 && kept < overlapWords; i--) {
        const wc = wordCount(buffer[i]);
        if (kept + wc > overlapWords) break;
        overlap.unshift(buffer[i]);
        kept += wc;
      }

      buffer.splice(0, buffer.length, ...overlap);
      bufferWords = kept;
    }

    // If a single sentence exceeds chunkWords, hard-split it by words
    if (sw > chunkWords) {
      const words = sentence.split(/\s+/);
      for (let i = 0; i < words.length; i += chunkWords - overlapWords) {
        const part = words.slice(i, i + chunkWords).join(" ");
        if (part.trim()) chunks.push(part.trim());
      }
      // Don't add to buffer – it's been handled
      continue;
    }

    buffer.push(sentence);
    bufferWords += sw;
  }

  if (buffer.length > 0) flush();

  return chunks.filter(c => c.trim().length > 0);
}

module.exports = { chunkText };
