/**
 * pdfParser.js  –  Extract plain text from a PDF buffer.
 *
 * Uses `pdf-parse` under the hood.  Strips common PDF artefacts
 * (ligatures, soft-hyphens, non-breaking spaces) and normalises
 * whitespace so the chunker gets clean input.
 */

"use strict";

let _pdfParse = null;

function getPdfParse() {
  if (!_pdfParse) {
    try {
      _pdfParse = require("pdf-parse");
    } catch (err) {
      throw new Error(
        "pdf-parse is not installed. Run: npm install pdf-parse\n" + err.message
      );
    }
  }
  return _pdfParse;
}

/**
 * Parse a PDF from a Buffer and return cleaned plain text.
 *
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function parsePDF(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("parsePDF expects a Buffer");
  }

  const pdfParse = getPdfParse();

  const result = await pdfParse(buffer, {
    // Increase the page limit for large PDFs
    max: 0,
  });

  let text = result.text || "";

  // ── Clean up common PDF extraction artefacts ──────────────────────────────

  text = text
    // Non-breaking spaces → regular spaces
    .replace(/\u00a0/g, " ")
    // Soft hyphens (hyphenation artefacts)
    .replace(/\u00ad/g, "")
    // Common ligatures
    .replace(/\ufb01/g, "fi")
    .replace(/\ufb02/g, "fl")
    .replace(/\ufb00/g, "ff")
    .replace(/\ufb03/g, "ffi")
    .replace(/\ufb04/g, "ffl")
    // Zero-width characters
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    // Bullet / list characters → dash
    .replace(/[\u2022\u2023\u25e6\u2043\u2219]/g, "-")
    // Em/en dashes → regular dash
    .replace(/[\u2013\u2014]/g, "-")
    // Curly quotes → straight quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    // Collapse runs of blank lines
    .replace(/\n{3,}/g, "\n\n")
    // Collapse multiple spaces (but not newlines)
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}

module.exports = { parsePDF };
