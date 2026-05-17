/**
 * app.js  –  NeuralBase frontend application
 * Single-page app controller: routing, chat, documents, graph, wiki, settings
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════════════════════════ */

const state = {
  currentView:     "dashboard",
  currentModel:    "",
  chatHistory:     [],
  topK:            8,
  threshold:       0.35,
  customPrompt:    "",
  graphData:       { nodes: [], edges: [] },
  graphScale:      1,
  graphOffset:     { x: 0, y: 0 },
  graphNodes:      [],
  graphDragging:   null,
  graphAnimId:     null,
  currentWikiPage: null,
  documents:       [],
  messageIndex:    0,
};

/* ═══════════════════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════════════════ */

function $(id)  { return document.getElementById(id); }
function qs(sel){ return document.querySelector(sel); }

function toast(msg, type = "info", duration = 3500) {
  const container = $("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = "all 250ms ease";
    el.style.opacity    = "0";
    el.style.transform  = "translateX(32px)";
    setTimeout(() => el.remove(), 260);
  }, duration);
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IE", { day:"2-digit", month:"short", year:"numeric" });
  } catch { return iso; }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Full Markdown-to-HTML renderer.
 * Handles: headings, nested numbered/bullet lists (indented), bold, italic,
 * inline code, code blocks, horizontal rules, tables, blank lines.
 */
function markdownToHtml(raw) {
  if (!raw) return "";

  const lines  = raw.split(/\r?\n/);
  const output = [];
  let   i      = 0;

  // Returns indent level (0, 1, 2…) based on leading spaces
  function indentLevel(line) {
    const m = line.match(/^(\s*)/);
    return m ? Math.floor(m[1].length / 2) : 0;
  }

  function isBullet(line)    { return /^\s*[-*+]\s/.test(line); }
  function isNumbered(line)  { return /^\s*\d+\.\s/.test(line); }
  function isListItem(line)  { return isBullet(line) || isNumbered(line); }
  function isBlank(line)     { return line.trim() === ""; }

  // Recursively build a nested list from a block of lines
  function buildList(listLines, baseIndent) {
    if (listLines.length === 0) return "";
    const firstLine = listLines[0];
    const tag = isNumbered(firstLine) ? "ol" : "ul";
    const cls = tag === "ol" ? "md-ol" : "md-ul";

    let html  = `<${tag} class="${cls}">`;
    let j     = 0;

    while (j < listLines.length) {
      const line    = listLines[j];
      if (isBlank(line)) { j++; continue; }
      const lvl     = indentLevel(line);
      if (lvl < baseIndent) break;
      if (lvl > baseIndent) { j++; continue; } // skip; handled as sub-list

      // Strip list marker
      const text = line.replace(/^\s*(\d+\.|-|\*|\+)\s+/, "");

      // Collect continuation / sub-list lines
      const children = [];
      j++;
      while (j < listLines.length && !isBlank(listLines[j])) {
        const nextLvl = indentLevel(listLines[j]);
        if (isListItem(listLines[j]) && nextLvl <= baseIndent) break;
        children.push(listLines[j]);
        j++;
      }

      const childHtml = children.length > 0 ? buildList(children, baseIndent + 1) : "";
      html += `<li>${inlineHtml(text)}${childHtml}</li>`;
    }

    html += `</${tag}>`;
    return html;
  }

  while (i < lines.length) {
    const line = lines[i];

    // ── Code block ────────────────────────────────────────────────────────────
    if (/^```/.test(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      output.push(`<pre class="md-pre"><code class="md-code">${codeLines.join("\n")}</code></pre>`);
      i++;
      continue;
    }

    // ── Heading ───────────────────────────────────────────────────────────────
    const headMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headMatch) {
      const level = Math.min(headMatch[1].length, 3);
      output.push(`<h${level + 2} class="md-h${level}">${inlineHtml(headMatch[2])}</h${level + 2}>`);
      i++;
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      output.push(`<hr class="md-hr" />`);
      i++;
      continue;
    }

    // ── Table ─────────────────────────────────────────────────────────────────
    if (/\|/.test(line) && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1])) {
      const tableLines = [line];
      i++;
      while (i < lines.length && /\|/.test(lines[i])) { tableLines.push(lines[i]); i++; }
      output.push(buildTable(tableLines));
      continue;
    }

    // ── List (numbered or bullet, including nested) ────────────────────────────
    if (isListItem(line)) {
      const listLines = [];
      while (i < lines.length) {
        const cur  = lines[i];
        const next = lines[i + 1] || "";
        if (isBlank(cur) && !isListItem(next) && !(/^\s+/.test(next))) break;
        listLines.push(cur);
        i++;
      }
      output.push(buildList(listLines, 0));
      continue;
    }

    // ── Blank line ────────────────────────────────────────────────────────────
    if (isBlank(line)) { i++; continue; }

    // ── Paragraph ─────────────────────────────────────────────────────────────
    const paraLines = [];
    while (i < lines.length && !isBlank(lines[i]) &&
           !/^(#{1,3}\s|```|\d+\.\s*\S|[-*+]\s|[-*_]{3,})/.test(lines[i]) &&
           !/\|/.test(lines[i])) {
      paraLines.push(inlineHtml(lines[i]));
      i++;
    }
    if (paraLines.length > 0) {
      output.push(`<p class="md-p">${paraLines.join(" ")}</p>`);
    }
  }

  return output.join("\n");
}

function inlineHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold+italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, `<code class="md-inline-code">$1</code>`)
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>`);
}

function buildTable(rows) {
  if (rows.length < 2) return "";
  const parseCells = row => row.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);

  const headers  = parseCells(rows[0]);
  const dataRows = rows.slice(2); // skip separator row

  const thead = `<thead><tr>${headers.map(h => `<th>${inlineHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${dataRows.map(r =>
    `<tr>${parseCells(r).map(c => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`
  ).join("")}</tbody>`;

  return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   API helpers
   ═══════════════════════════════════════════════════════════════════════════════ */

async function api(path, opts = {}) {
  const res  = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Navigation
   ═══════════════════════════════════════════════════════════════════════════════ */

const VIEW_TITLES = {
  dashboard: "Dashboard",
  chat:      "Ask AI",
  documents: "Documents",
  graph:     "Knowledge Graph",
  wiki:      "Wiki",
  settings:  "Settings",
};

function navigateTo(view) {
  if (state.currentView === view) return;
  state.currentView = view;

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("active", v.id === `view-${view}`);
  });

  $("topbar-title").textContent = VIEW_TITLES[view] || view;
  $("sidebar").classList.remove("open");

  if (view === "documents") loadDocuments();
  if (view === "wiki")      loadWiki();
  if (view === "graph")     loadGraph();
  if (view === "chat")      updateSampleQuestions();
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════════════════════════════ */

async function loadDashboard() {
  try {
    const [stats, usageData] = await Promise.all([
      api("/api/stats"),
      api("/api/usage"),
    ]);

    document.querySelectorAll(".stat-card").forEach(c => c.classList.remove("skeleton"));

    $("stat-docs").textContent    = stats.documents;
    $("stat-chunks").textContent  = stats.chunks.toLocaleString();
    $("stat-queries").textContent = usageData.todayQueries;
    $("stat-total").textContent   = usageData.totalQueries.toLocaleString();
    $("stat-nodes").textContent   = stats.graphNodes;
    $("stat-wiki").textContent    = stats.wikiPages;

    $("info-search").textContent      = stats.embeddingEnabled ? "Semantic (vector)" : "Keyword (BM25)";
    $("info-embed").textContent       = stats.embeddingProvider || "—";
    $("info-graph-built").textContent = stats.graphLastBuilt ? formatDate(stats.graphLastBuilt) : "Not yet";
    $("info-api-status").textContent  = "NVIDIA NIM ✓";

    const list = $("recent-queries-list");
    if (usageData.recentQueries && usageData.recentQueries.length > 0) {
      list.innerHTML = usageData.recentQueries
        .map(q => `<div class="recent-query-item">${escapeHtml(q)}</div>`)
        .join("");
    }

    $("settings-engine").textContent = stats.embeddingEnabled
      ? `Semantic – ${stats.embeddingProvider}`
      : "Keyword BM25";

    const badge = $("embedding-badge");
    const label = $("embedding-label");
    label.textContent = stats.embeddingEnabled ? "semantic" : "keyword";
    badge.style.background = stats.embeddingEnabled
      ? "rgba(124,58,237,0.15)"
      : "rgba(6,182,212,0.12)";
    badge.style.color = stats.embeddingEnabled
      ? "var(--violet-light)"
      : "var(--cyan-light)";

  } catch (err) {
    console.warn("Dashboard load error:", err.message);
  }

  try {
    const health = await api("/api/health");
    $("settings-uptime").textContent = `${Math.floor(health.uptime / 60)}m ${health.uptime % 60}s`;
    $("status-dot").className   = "status-dot ok";
    $("status-label").textContent = "Connected";
  } catch {
    $("status-dot").className   = "status-dot error";
    $("status-label").textContent = "Offline";
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Models
   ═══════════════════════════════════════════════════════════════════════════════ */

async function loadModels() {
  try {
    const { models, default: def } = await api("/api/models");
    const selects = [$("model-select"), $("settings-model")];

    selects.forEach(sel => {
      if (!sel) return;
      sel.innerHTML = models.map(m =>
        `<option value="${m.id}" ${m.id === def ? "selected" : ""}>${m.name} · ${m.tag}</option>`
      ).join("");
    });

    state.currentModel = def;
  } catch (err) {
    console.warn("Models load error:", err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Chat
   ═══════════════════════════════════════════════════════════════════════════════ */

function renderMessage(role, content, meta = {}) {
  const idx   = state.messageIndex++;
  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;
  msgEl.dataset.index = idx;

  if (role === "user") {
    msgEl.innerHTML = `
      <div class="message-role">You</div>
      <div class="message-bubble user-bubble">${escapeHtml(content)}</div>
    `;
    return msgEl;
  }

  // Assistant message — render markdown
  const answerHtml = markdownToHtml(content);

  // Relevance badge — based on actual retrieval score, no fake percentages
  let confidenceBadge = "";
  if (meta.confidence !== undefined && meta.sources && meta.sources.length > 0) {
    const score = meta.confidence;
    let level, label;
    // Cosine similarity from all-MiniLM-L6-v2 typically ranges 0.3–0.75 for good matches
    if (score >= 0.55) { level = "high";   label = "High Relevance"; }
    else if (score >= 0.35) { level = "medium"; label = "Medium Relevance"; }
    else               { level = "low";    label = "Low Relevance"; }
    confidenceBadge = `<span class="confidence-badge confidence-${level}" title="Semantic similarity: ${score.toFixed(3)}">${label}</span>`;
  }

  // Warning banner (e.g., API fallback)
  let warningBanner = "";
  if (meta.warning) {
    warningBanner = `<div class="answer-warning">⚠ ${escapeHtml(meta.warning)}</div>`;
  }

  let html = `
    <div class="message-role">NeuralBase AI ${confidenceBadge}</div>
    ${warningBanner}
    <div class="message-bubble assistant-bubble">
      <div class="md-content">${answerHtml}</div>
    </div>
  `;

  // Sources accordion
  if (meta.sources && meta.sources.length > 0) {
    const method = meta.searchMethod || "keyword";
    html += `
      <div class="sources-card">
        <div class="sources-header" onclick="toggleSources(this)">
          <span class="source-badge ${method}">${method}</span>
          <span class="sources-label">Sources: ${escapeHtml((meta.docsUsed || []).join(", ") || "—")}</span>
          <span class="sources-toggle">▾</span>
        </div>
        <div class="sources-body collapsed">
          ${meta.sources.map(s => `
            <div class="source-item">
              <div class="source-title">${escapeHtml(s.title)}</div>
              <div class="source-preview">${escapeHtml(s.preview || "")}</div>
              ${s.score > 0 ? `
                <div class="source-score">
                  <div class="score-bar">
                    <div class="score-fill" style="width:${Math.min(100, Math.round(s.score * 100))}%"></div>
                  </div>
                  <span>Score: ${s.score.toFixed(3)}</span>
                </div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  // Follow-up suggestions
  if (meta.suggestions && meta.suggestions.length > 0) {
    html += `
      <div class="followup-chips">
        ${meta.suggestions.map(s =>
          `<button class="chip" onclick="app.useChip(this)">${escapeHtml(s)}</button>`
        ).join("")}
      </div>
    `;
  }

  // Feedback
  html += `
    <div class="feedback-row">
      <span>Was this helpful?</span>
      <button class="feedback-btn" onclick="sendFeedback(this, ${idx}, 1)" title="Helpful">👍</button>
      <button class="feedback-btn" onclick="sendFeedback(this, ${idx}, -1)" title="Not helpful">👎</button>
      <button class="feedback-btn copy-answer-btn" onclick="copyAnswer(this)" data-answer="${escapeHtml(content)}" title="Copy answer">⎘ Copy</button>
      ${meta.searchMethod ? `<span class="search-method-label">${meta.searchMethod} search</span>` : ""}
    </div>
  `;

  msgEl.innerHTML = html;
  return msgEl;
}

function toggleSources(header) {
  const body = header.nextElementSibling;
  body.classList.toggle("collapsed");
  header.querySelector(".sources-toggle").textContent = body.classList.contains("collapsed") ? "▾" : "▴";
}

function copyAnswer(btn) {
  const text = btn.dataset.answer || "";
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✓ Copied";
    btn.classList.add("copy-success");
    setTimeout(() => { btn.textContent = orig; btn.classList.remove("copy-success"); }, 2000);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.textContent = "⎘ Copy"; }, 2000);
  });
}

async function sendFeedback(btn, idx, value) {
  btn.classList.toggle("active-up",   value === 1);
  btn.classList.toggle("active-down", value === -1);
  const row = btn.closest(".feedback-row");
  if (row) {
    row.querySelectorAll(".feedback-btn").forEach(b => {
      if (b !== btn) b.classList.remove("active-up", "active-down");
    });
  }
  const latestUser = [...state.chatHistory].reverse().find(m => m.role === "user");
  try {
    await api("/api/feedback", {
      method: "POST",
      body:   JSON.stringify({ query: latestUser?.content || "", feedback: value, messageIndex: idx }),
    });
  } catch { /* silent */ }
}

async function sendMessage(userText) {
  if (!userText?.trim()) return;

  const messagesEl = $("chat-messages");
  const welcome    = $("chat-welcome");
  if (welcome)    welcome.classList.add("hidden");
  if (messagesEl) messagesEl.classList.remove("hidden");

  state.chatHistory.push({ role: "user", content: userText });
  messagesEl.appendChild(renderMessage("user", userText));

  // ── Streaming assistant bubble ────────────────────────────────────────────
  const assistantEl = document.createElement("div");
  assistantEl.className = "message assistant";
  assistantEl.innerHTML = `
    <div class="message-role">NeuralBase AI</div>
    <div class="message-bubble assistant-bubble" id="streaming-bubble">
      <div class="loading-bubble">
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
      </div>
      <div class="loading-status" id="loading-status">Searching documents…</div>
    </div>
  `;
  messagesEl.appendChild(assistantEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Cycle loading messages
  const loadingStatus = assistantEl.querySelector("#loading-status");
  let loadingStep = 0;
  const loadingMessages = ["Searching documents…", "Retrieving relevant chunks…", "Generating grounded answer…"];
  const loadingInterval = setInterval(() => {
    loadingStep = (loadingStep + 1) % loadingMessages.length;
    if (loadingStatus) loadingStatus.textContent = loadingMessages[loadingStep];
  }, 1800);

  const sendBtn = $("send-btn");
  sendBtn.disabled = true;

  let metaData   = null;
  let accText    = "";
  let bubbleEl   = assistantEl.querySelector("#streaming-bubble");
  let streaming  = false;

  try {
    const response = await fetch("/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        messages:           state.chatHistory,
        model:              state.currentModel,
        topK:               state.topK,
        threshold:          state.threshold,
        customSystemPrompt: state.customPrompt || undefined,
      }),
    });

    // Non-streaming error (e.g. 400, 503, 404)
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
      const errData = await response.json().catch(() => ({ error: `Server error (HTTP ${response.status})` }));
      let msg = errData.error || errData.detail || `Request failed (HTTP ${response.status})`;

      // Give helpful hints based on status
      if (response.status === 404 || response.status === 400) {
        msg = `The selected model is not available. Please switch to "Llama 3.1 8B · Fast" from the model selector at the top and try again.`;
      } else if (response.status === 429) {
        msg = `Rate limit reached. Please wait a moment and try again.`;
      } else if (response.status === 401 || response.status === 403) {
        msg = `API key error. Please check your NVIDIA_API_KEY in the .env file.`;
      } else if (response.status >= 500) {
        msg = `The AI service is temporarily unavailable. Try switching to "Llama 3.1 8B · Fast" and retry.`;
      }
      throw new Error(msg);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   partial = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        try {
          const obj = JSON.parse(raw);

          if (obj.type === "meta") {
            metaData = obj;
          }

          if (obj.type === "delta") {
            if (!streaming) {
              // First token — clear loading dots, start text
              clearInterval(loadingInterval);
              bubbleEl.innerHTML = "";
              streaming = true;
            }
            accText += obj.text;
            bubbleEl.innerHTML = markdownToHtml(accText);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }

          if (obj.type === "done") {
            clearInterval(loadingInterval);
            // Final clean answer + follow-ups
            const finalText = obj.fullAnswer || accText;
            state.chatHistory.push({ role: "assistant", content: finalText });

            const meta = {
              sources:      metaData?.sources      || [],
              searchMethod: metaData?.searchMethod || "keyword",
              suggestions:  obj.suggestions        || [],
              docsUsed:     metaData?.docsUsed     || [],
              confidence:   metaData?.confidence   || 0,
            };

            // Re-render the full message with sources/suggestions
            const newMsg = renderMessage("assistant", finalText, meta);
            assistantEl.replaceWith(newMsg);
            messagesEl.scrollTop = messagesEl.scrollHeight;

            // Auto-save to wiki
            const notFound = finalText.includes("could not find sufficient information") ||
                             finalText.includes("knowledge base is currently empty");
            if (!notFound) {
              api("/api/wiki/save", {
                method: "POST",
                body:   JSON.stringify({
                  query:        userText,
                  answer:       finalText,
                  sources:      meta.sources,
                  searchMethod: meta.searchMethod,
                }),
              }).catch(() => {});
            }
          }
        } catch { /* skip malformed SSE */ }
      }
    }

  } catch (err) {
    clearInterval(loadingInterval);
    const bubble = assistantEl.querySelector(".message-bubble");
    if (bubble) {
      bubble.innerHTML = `
        <div class="error-bubble-inner">
          <div class="error-icon">⚠</div>
          <div class="error-text">
            <strong>Something went wrong</strong>
            <span>${escapeHtml(err.message)}</span>
          </div>
        </div>
      `;
      bubble.classList.add("error-bubble");
    }
    toast(err.message, "error", 6000);
  }

  sendBtn.disabled    = false;
  $("chat-input").style.height = "auto";
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Documents
   ═══════════════════════════════════════════════════════════════════════════════ */

async function loadDocuments() {
  const list = $("doc-list");
  list.innerHTML = `
    <div class="doc-card skeleton"><div style="height:80px"></div></div>
    <div class="doc-card skeleton"><div style="height:80px"></div></div>
    <div class="doc-card skeleton"><div style="height:80px"></div></div>
  `;

  try {
    const { documents } = await api("/api/documents");
    state.documents = documents;
    renderDocumentList(documents);
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>Failed to load documents: ${escapeHtml(err.message)}</p></div>`;
    toast("Failed to load documents", "error");
  }
}

function renderDocumentList(documents) {
  const list  = $("doc-list");
  const count = $("doc-count-label");

  count.textContent = `${documents.length} document${documents.length !== 1 ? "s" : ""}`;

  if (documents.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">◻</div>
        <p>No documents indexed yet. Upload a PDF, TXT, or MD file to get started.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = documents.map(doc => {
    const isBuiltIn    = doc.source === "built-in";
    const uploadedDate = doc.uploadedAt ? formatDate(doc.uploadedAt) : "";
    const statusClass  = doc.status === "indexed" ? "status-indexed" : "status-processing";
    const statusLabel  = doc.status || "indexed";

    return `
      <div class="doc-card" id="doc-${doc.id.replace(/[^a-zA-Z0-9-_]/g, "_")}">
        <div class="doc-card-header">
          <div class="doc-title">${escapeHtml(doc.title)}</div>
          <span class="doc-badge uploaded">
            Indexed
          </span>
        </div>
        <div class="doc-category">${escapeHtml(doc.category || "General")}</div>
        ${doc.preview ? `<div class="doc-preview">${escapeHtml(doc.preview)}</div>` : ""}
        <div class="doc-meta">
          <span class="doc-status ${statusClass}">● ${statusLabel}</span>
          ${doc.chunkCount   ? `<span>${doc.chunkCount} chunks</span>` : ""}
          ${doc.wordCount    ? `<span>${doc.wordCount.toLocaleString()} words</span>` : ""}
          ${doc.hasEmbeddings ? `<span class="embed-badge">⬡ embedded</span>` : ""}
          ${uploadedDate     ? `<span>${uploadedDate}</span>` : ""}
        </div>
        ${!isBuiltIn ? `
          <div class="doc-actions">
            <button class="btn-delete" onclick="deleteDocument('${escapeHtml(doc.id)}', '${escapeHtml(doc.title).replace(/'/g, "\\'")}')">
              Delete
            </button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

async function deleteDocument(id, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

  try {
    await api(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast(`"${title}" deleted`, "success");
    await loadDocuments();
    await loadDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* Upload handling */

function setupUpload() {
  const zone    = $("upload-zone");
  const input   = $("pdf-file-input");
  const prog    = $("upload-progress");
  const fill    = $("progress-fill");
  const label   = $("progress-label");
  const content = $("upload-content");

  const ALLOWED_TYPES = ["application/pdf", "text/plain", "text/markdown"];
  const ALLOWED_EXTS  = [".pdf", ".txt", ".md"];

  function isAllowedFile(file) {
    const name = file.name.toLowerCase();
    return ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTS.some(e => name.endsWith(e));
  }

  function startUpload(files) {
    const validFiles = Array.from(files).filter(f => {
      if (!isAllowedFile(f)) { toast(`"${f.name}" is not a supported type`, "error"); return false; }
      if (f.size > 15 * 1024 * 1024) { toast(`"${f.name}" exceeds 15 MB limit`, "error"); return false; }
      return true;
    });
    if (validFiles.length === 0) return;

    content.classList.add("hidden");
    prog.classList.remove("hidden");
    fill.style.width = "0%";
    label.textContent = validFiles.length === 1
      ? `Processing "${validFiles[0].name}"…`
      : `Processing ${validFiles.length} files…`;

    let pct = 0;
    const interval = setInterval(() => {
      pct = Math.min(pct + Math.random() * 8, 88);
      fill.style.width = pct + "%";
    }, 200);

    const formData = new FormData();
    for (const f of validFiles) formData.append("pdf", f);

    fetch("/api/upload", { method: "POST", body: formData })
      .then(r => r.json())
      .then(data => {
        clearInterval(interval);
        fill.style.width = "100%";

        if (!data.success && data.errors?.length > 0 && !data.documents?.length) {
          const msg = data.errors[0]?.error || "Upload failed";
          label.textContent = `Error: ${msg}`;
          toast(msg, "error");
          setTimeout(resetUploadUI, 3500);
          return;
        }

        const count = data.documents?.length || 0;
        if (count === 1) {
          label.textContent = `✓ "${data.documents[0].title}" indexed (${data.documents[0].chunkCount} chunks)`;
          toast(`"${data.documents[0].title}" uploaded and indexed`, "success");
        } else {
          label.textContent = `✓ ${count} files indexed`;
          toast(`${count} files uploaded and indexed`, "success");
        }
        if (data.errors?.length > 0) {
          data.errors.forEach(e => toast(`⚠ ${e.file}: ${e.error}`, "error", 5000));
        }

        setTimeout(() => {
          resetUploadUI();
          loadDocuments();
          loadDashboard();
          updateSampleQuestions();
        }, 2000);
      })
      .catch(err => {
        clearInterval(interval);
        label.textContent = `Upload failed: ${err.message}`;
        toast("Upload failed: " + err.message, "error");
        setTimeout(resetUploadUI, 3500);
      });
  }

  function resetUploadUI() {
    content.classList.remove("hidden");
    prog.classList.add("hidden");
    fill.style.width = "0%";
    input.value = "";
  }

  input.addEventListener("change", e => {
    if (e.target.files.length > 0) startUpload(e.target.files);
  });

  zone.addEventListener("click", e => {
    const ignoreTags = ["BUTTON", "A", "INPUT"];
    if (!ignoreTags.includes(e.target.tagName)) input.click();
  });

  zone.addEventListener("dragover", e => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) startUpload(e.dataTransfer.files);
  });
}

/* Fixed sample questions — always shown */

const DEFAULT_QUESTIONS = [
  "How do I create a new Evening Study session?",
  "How can I add students using groups or classes?",
  "Can recurring days be selected while creating sessions?",
  "How do I mark attendance for Evening Study?",
  "How can I send notifications to parents or guardians?",
  "How do staff members view assigned sessions?",
  "How do I manage Evening Study time slots?",
  "How can I edit an existing Evening Study session?",
  "How do I create student payment groups?",
  "How do I manage calendar events in the system?",
];

function renderSampleQuestions() {
  const chips = $("welcome-chips");
  if (!chips) return;
  chips.innerHTML = DEFAULT_QUESTIONS.map(q =>
    `<button class="chip" onclick="app.useChip(this)">${escapeHtml(q)}</button>`
  ).join("");
}

async function updateSampleQuestions() {
  // Always render default questions immediately
  renderSampleQuestions();

  // Then try to fetch from server (in case server has custom ones)
  try {
    const { questions } = await api("/api/sample-questions");
    if (!questions || questions.length === 0) return;
    const chips = $("welcome-chips");
    if (!chips) return;
    chips.innerHTML = questions.map(q =>
      `<button class="chip" onclick="app.useChip(this)">${escapeHtml(q)}</button>`
    ).join("");
  } catch { /* keep defaults already rendered */ }
}

/* Clear the chat conversation */

function clearChat() {
  state.chatHistory = [];
  state.messageIndex = 0;
  const messagesEl = $("chat-messages");
  const welcome    = $("chat-welcome");
  // Clear messages and hide the messages area
  if (messagesEl) {
    messagesEl.innerHTML = "";
    messagesEl.classList.add("hidden");
  }
  // Show welcome screen with sample questions
  if (welcome) welcome.classList.remove("hidden");
  const input = $("chat-input");
  if (input) { input.value = ""; input.style.height = "auto"; }
  const charCount = $("char-count");
  if (charCount) charCount.textContent = "0 / 2000";
  // Refresh sample question chips
  renderSampleQuestions();
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Knowledge Graph
   ═══════════════════════════════════════════════════════════════════════════════ */

const GRAPH_COLORS = {
  Document:   "#7C3AED",
  Concept:    "#06B6D4",
  Entity:     "#10B981",
  Process:    "#F59E0B",
  Technology: "#F43F5E",
  Category:   "#A78BFA",
};

function colorForType(type) {
  return GRAPH_COLORS[type] || "#8B9EB7";
}

async function loadGraph() {
  try {
    const data = await api("/api/graph");
    if (data.nodes && data.nodes.length > 0) {
      renderGraph(data.nodes, data.edges);
    } else {
      const empty = $("graph-empty");
      if (empty) empty.classList.remove("hidden");
    }
  } catch { /* silent */ }
}

async function buildGraph() {
  const btn     = $("build-graph-btn");
  const spinner = $("graph-spinner");
  const empty   = $("graph-empty");

  btn.disabled    = true;
  btn.textContent = "Building…";
  spinner.classList.remove("hidden");
  empty.classList.add("hidden");

  try {
    const data = await api("/api/graph/build", { method: "POST", body: "{}" });
    spinner.classList.add("hidden");

    if (data.nodes && data.nodes.length > 0) {
      renderGraph(data.nodes, data.edges);
      toast(`Graph built: ${data.nodes.length} nodes, ${data.edges.length} edges`, "success");
    } else {
      empty.classList.remove("hidden");
      toast("No graph data extracted. Try uploading more documents.", "info");
    }

    await loadDashboard();
  } catch (err) {
    spinner.classList.add("hidden");
    empty.classList.remove("hidden");
    toast("Graph build failed: " + err.message, "error");
  }

  btn.disabled  = false;
  btn.innerHTML = `<span class="btn-icon">◈</span> Build Graph`;
}

function renderGraph(nodes, edges) {
  state.graphData = { nodes, edges };

  const empty  = $("graph-empty");
  const canvas = $("graph-canvas");
  const legend = $("graph-legend");

  empty.classList.add("hidden");

  const types = [...new Set(nodes.map(n => n.type))];
  legend.innerHTML = types.map(t => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colorForType(t)}"></div>
      <span>${t}</span>
    </div>
  `).join("");

  const container = $("graph-container");
  const W = container.clientWidth  || 800;
  const H = container.clientHeight || 580;

  canvas.width  = W;
  canvas.height = H;

  // Size nodes by connectivity
  const connectivity = new Map();
  for (const n of nodes) connectivity.set(n.id, 0);
  for (const e of edges) {
    connectivity.set(e.source, (connectivity.get(e.source) || 0) + 1);
    connectivity.set(e.target, (connectivity.get(e.target) || 0) + 1);
  }

  state.graphNodes = nodes.map((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const r     = Math.min(W, H) * 0.32;
    const conn  = connectivity.get(n.id) || 0;
    const nodeR = n.type === "Document" ? 26 : Math.max(16, 12 + conn * 2);
    return {
      ...n,
      x:  W / 2 + r * Math.cos(angle),
      y:  H / 2 + r * Math.sin(angle),
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      r:  nodeR,
    };
  });

  state.graphScale  = 1;
  state.graphOffset = { x: 0, y: 0 };

  if (state.graphAnimId) cancelAnimationFrame(state.graphAnimId);
  simulateGraph(canvas, edges, W, H);
}

function simulateGraph(canvas, edges, W, H) {
  const ctx     = canvas.getContext("2d");
  const nodes   = state.graphNodes;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  let   iteration = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const grd = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)/2);
    grd.addColorStop(0, "rgba(28,20,60,0.6)");
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(state.graphOffset.x, state.graphOffset.y);
    ctx.scale(state.graphScale, state.graphScale);

    // Edges with gradient
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const grad = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
      grad.addColorStop(0, colorForType(src.type) + "55");
      grad.addColorStop(1, colorForType(tgt.type) + "55");
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Edge labels removed — they clutter the view at scale
    }

    // Nodes
    for (const node of nodes) {
      const color = colorForType(node.type);

      // Outer glow ring
      ctx.shadowColor = color;
      ctx.shadowBlur  = 20;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = color + "44";
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Node circle
      const nodeGrad = ctx.createRadialGradient(node.x - node.r * 0.3, node.y - node.r * 0.3, 1, node.x, node.y, node.r);
      nodeGrad.addColorStop(0, color + "EE");
      nodeGrad.addColorStop(1, color + "99");
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fillStyle = nodeGrad;
      ctx.fill();

      // Inner ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r - 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.30)";
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Label inside node (short)
      const shortLabel = node.label.length > 12 ? node.label.slice(0, 10) + "…" : node.label;
      ctx.fillStyle    = "#FFFFFF";
      ctx.font         = `bold ${node.r > 20 ? 9 : 8}px DM Sans, sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(shortLabel, node.x, node.y);

      // Type label below node
      ctx.fillStyle    = color;
      ctx.font         = `7px DM Sans, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(node.type, node.x, node.y + node.r + 4);
    }

    ctx.restore();
  }

  function physics() {
    if (iteration > 350) { draw(); state.graphAnimId = requestAnimationFrame(physics); return; }
    iteration++;
    const alpha = Math.max(0.008, 1 - iteration / 350);

    // Repulsion between all node pairs
    for (const node of nodes) {
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        // Stronger repulsion so nodes don't overlap
        const f  = (5500 / (d * d)) * alpha;
        node.vx += (dx / d) * f;
        node.vy += (dy / d) * f;
      }
      // Gravity toward center
      node.vx += (W / 2 - node.x) * 0.006 * alpha;
      node.vy += (H / 2 - node.y) * 0.006 * alpha;
    }

    // Spring forces along edges — shorter ideal length for tighter layout
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;
      const dx  = tgt.x - src.x;
      const dy  = tgt.y - src.y;
      const d   = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealLen = src.type === "Document" || tgt.type === "Document" ? 160 : 110;
      const f   = (d - idealLen) * 0.03 * alpha;
      src.vx += (dx / d) * f;
      src.vy += (dy / d) * f;
      tgt.vx -= (dx / d) * f;
      tgt.vy -= (dy / d) * f;
    }

    for (const node of nodes) {
      node.vx *= 0.75;   // higher damping = settles faster, less scatter
      node.vy *= 0.75;
      node.x  += node.vx;
      node.y  += node.vy;
      node.x = Math.max(node.r + 10, Math.min(W - node.r - 10, node.x));
      node.y = Math.max(node.r + 10, Math.min(H - node.r - 10, node.y));
    }

    draw();
    state.graphAnimId = requestAnimationFrame(physics);
  }

  state.graphAnimId = requestAnimationFrame(physics);
}

function setupGraphInteraction() {
  const canvas  = $("graph-canvas");
  const tooltip = $("graph-tooltip");

  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left - state.graphOffset.x) / state.graphScale;
    const my   = (e.clientY - rect.top  - state.graphOffset.y) / state.graphScale;

    let hit = null;
    for (const n of state.graphNodes) {
      const dx = n.x - mx, dy = n.y - my;
      if (Math.sqrt(dx*dx + dy*dy) < n.r + 4) { hit = n; break; }
    }

    if (hit) {
      tooltip.classList.remove("hidden");
      tooltip.style.left = (e.clientX - canvas.getBoundingClientRect().left + 12) + "px";
      tooltip.style.top  = (e.clientY - canvas.getBoundingClientRect().top  - 20) + "px";
      tooltip.innerHTML  = `<strong>${escapeHtml(hit.label)}</strong><br/><span style="color:var(--text-3)">${hit.type}</span><br/><em style="color:var(--accent-1);font-size:10px">Click for details</em>`;
      canvas.style.cursor = "pointer";
    } else {
      tooltip.classList.add("hidden");
      canvas.style.cursor = state.graphDragging ? "grabbing" : "grab";
    }

    if (state.graphDragging) {
      state.graphDragging.x  = mx;
      state.graphDragging.y  = my;
      state.graphDragging.vx = 0;
      state.graphDragging.vy = 0;
    }
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.classList.add("hidden");
    state.graphDragging = null;
    canvas.style.cursor = "grab";
  });

  let mouseDownNode = null;
  let mouseDownTime = 0;

  canvas.addEventListener("mousedown", e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left - state.graphOffset.x) / state.graphScale;
    const my   = (e.clientY - rect.top  - state.graphOffset.y) / state.graphScale;
    mouseDownNode = null;
    mouseDownTime = Date.now();
    for (const n of state.graphNodes) {
      const dx = n.x - mx, dy = n.y - my;
      if (Math.sqrt(dx*dx + dy*dy) < n.r + 4) {
        state.graphDragging = n;
        mouseDownNode = n;
        break;
      }
    }
  });

  canvas.addEventListener("mouseup", e => {
    const elapsed = Date.now() - mouseDownTime;
    if (mouseDownNode && elapsed < 250) {
      // It's a click, not a drag
      showNodePanel(mouseDownNode);
    }
    state.graphDragging = null;
    mouseDownNode = null;
  });

  // Touch support for mobile
  canvas.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const mx = (t.clientX - rect.left - state.graphOffset.x) / state.graphScale;
    const my = (t.clientY - rect.top  - state.graphOffset.y) / state.graphScale;
    mouseDownNode = null;
    mouseDownTime = Date.now();
    for (const n of state.graphNodes) {
      const dx = n.x - mx, dy = n.y - my;
      if (Math.sqrt(dx*dx + dy*dy) < n.r + 12) { mouseDownNode = n; break; }
    }
  }, { passive: true });

  canvas.addEventListener("touchend", () => {
    const elapsed = Date.now() - mouseDownTime;
    if (mouseDownNode && elapsed < 300) showNodePanel(mouseDownNode);
    mouseDownNode = null;
  }, { passive: true });

  $("graph-zoom-in").addEventListener("click",  () => { state.graphScale = Math.min(3, state.graphScale * 1.2); });
  $("graph-zoom-out").addEventListener("click", () => { state.graphScale = Math.max(0.3, state.graphScale / 1.2); });
  $("graph-reset").addEventListener("click",    () => { state.graphScale = 1; state.graphOffset = { x: 0, y: 0 }; });

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    state.graphScale = Math.min(3, Math.max(0.3, state.graphScale * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });
}

async function showNodePanel(node) {
  const panel       = $("graph-node-panel");
  const typeEl      = $("node-panel-type");
  const labelEl     = $("node-panel-label");
  const connEl      = $("node-panel-connections");
  const loading     = $("node-panel-loading");
  const textEl      = $("node-panel-text");

  typeEl.textContent  = node.type || "Concept";
  typeEl.style.background = colorForType(node.type) + "33";
  typeEl.style.color      = colorForType(node.type);
  labelEl.textContent = node.label;

  // Show connected nodes
  const edges   = state.graphData.edges || [];
  const nodeMap = new Map(state.graphNodes.map(n => [n.id, n]));
  const connected = edges
    .filter(e => e.source === node.id || e.target === node.id)
    .map(e => {
      const otherId = e.source === node.id ? e.target : e.source;
      const other   = nodeMap.get(otherId);
      return other ? `<span class="node-conn-chip" style="border-color:${colorForType(other.type)}44;color:${colorForType(other.type)}">${escapeHtml(other.label)}</span>` : null;
    })
    .filter(Boolean)
    .slice(0, 6);

  connEl.innerHTML = connected.length
    ? `<div class="node-conn-label">Connections (${connected.length})</div><div class="node-conn-chips">${connected.join("")}</div>`
    : "";

  textEl.innerHTML = "";
  loading.classList.remove("hidden");
  panel.classList.remove("hidden");

  try {
    const data = await api("/api/graph/node-answer", {
      method: "POST",
      body:   JSON.stringify({ label: node.label, type: node.type, model: state.currentModel }),
    });
    loading.classList.add("hidden");
    textEl.innerHTML = markdownToHtml(data.answer || "No information available for this concept.");
  } catch (err) {
    loading.classList.add("hidden");
    textEl.textContent = "Could not load answer: " + err.message;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Wiki
   ═══════════════════════════════════════════════════════════════════════════════ */

async function loadWiki() {
  const content = $("wiki-content");
  if (!content) return;

  try {
    const { pages } = await api("/api/wiki");

    if (!pages || pages.length === 0) {
      // Safe empty state — rebuild instead of relying on moved DOM node
      content.innerHTML = `
        <div class="empty-state" id="wiki-empty">
          <div class="empty-icon">◑</div>
          <p>Upload documents and click <strong>Compile Wiki</strong> to auto-generate documentation summaries.</p>
        </div>
      `;
      return;
    }

    content.innerHTML = pages.map(p => `
      <div class="wiki-card" onclick="openWikiModal('${escapeHtml(p.id)}')">
        <div class="wiki-card-title">
          ${escapeHtml(p.query)}
          ${p.compiled ? '<span class="wiki-compiled-badge">AI compiled</span>' : ""}
        </div>
        <div class="wiki-card-preview">${escapeHtml((p.answer || "").slice(0, 200))}</div>
        <div class="wiki-card-meta">
          <span>${formatDate(p.date)}</span>
          <span>${escapeHtml(p.searchMethod || "")}</span>
        </div>
      </div>
    `).join("");

    window._wikiPages = pages;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load wiki: ${escapeHtml(err.message)}</p></div>`;
  }
}

function openWikiModal(id) {
  const page = (window._wikiPages || []).find(p => p.id === id);
  if (!page) return;
  $("wiki-modal-title").textContent = page.query;
  $("wiki-modal-body").innerHTML    = markdownToHtml(page.answer || "");
  $("wiki-modal-meta").textContent  = `${formatDate(page.date)} · ${page.searchMethod || ""} search`;
  state.currentWikiPage = page;
  $("wiki-modal-overlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeWikiModal() {
  $("wiki-modal-overlay").classList.add("hidden");
  document.body.style.overflow = "";
  state.currentWikiPage = null;
}

async function compileWiki() {
  const btn = $("compile-wiki-btn");
  btn.disabled    = true;
  btn.textContent = "Compiling…";

  // Show loading state in wiki content
  const content = $("wiki-content");
  if (content) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" style="animation: spin 1.5s linear infinite; display:inline-block">◑</div>
        <p>Generating AI summaries from your documents…</p>
      </div>
    `;
  }

  try {
    const data = await api("/api/wiki/compile", { method: "POST", body: "{}" });
    toast(`Wiki compiled: ${data.count} pages generated`, "success");
    await loadWiki();
  } catch (err) {
    toast("Wiki compile failed: " + err.message, "error");
    await loadWiki(); // restore whatever state exists
  }
  btn.disabled  = false;
  btn.innerHTML = `<span class="btn-icon">◑</span> Compile Wiki`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════════════════ */

function setupSettings() {
  const topkRange   = $("topk-range");
  const topkVal     = $("topk-val");
  const threshRange = $("threshold-range");
  const threshVal   = $("threshold-val");

  topkRange.addEventListener("input", () => {
    state.topK          = parseInt(topkRange.value);
    topkVal.textContent = topkRange.value;
  });

  threshRange.addEventListener("input", () => {
    state.threshold      = parseInt(threshRange.value) / 100;
    threshVal.textContent = state.threshold.toFixed(2);
  });

  $("save-prompt-btn").addEventListener("click", () => {
    state.customPrompt = $("custom-prompt").value.trim();
    toast(state.customPrompt ? "Custom prompt saved" : "Prompt cleared – using default", "success");
  });

  $("model-select").addEventListener("change", e => {
    state.currentModel = e.target.value;
    const s = $("settings-model");
    if (s) s.value = e.target.value;
  });

  $("settings-model").addEventListener("change", e => {
    state.currentModel = e.target.value;
    $("model-select").value = e.target.value;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Global public API
   ═══════════════════════════════════════════════════════════════════════════════ */

window.app = {
  useChip(btn) {
    const text = btn.textContent.trim();
    navigateTo("chat");
    setTimeout(() => {
      $("chat-input").value = text;
      sendMessage(text);
    }, 150);
  },
  clearChat,
};

window.toggleSources  = toggleSources;
window.sendFeedback   = sendFeedback;
window.deleteDocument = deleteDocument;
window.openWikiModal  = openWikiModal;
window.clearChat      = clearChat;

/* ═══════════════════════════════════════════════════════════════════════════════
   Initialise
   ═══════════════════════════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

  // Nav routing
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  // Mobile hamburger
  $("hamburger").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
  });

  // Chat input
  const input   = $("chat-input");
  const sendBtn = $("send-btn");
  const charCnt = $("char-count");

  input.addEventListener("input", () => {
    input.style.height  = "auto";
    input.style.height  = Math.min(input.scrollHeight, 180) + "px";
    charCnt.textContent = `${input.value.length} / 2000`;
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) { input.value = ""; charCnt.textContent = "0 / 2000"; sendMessage(text); }
    }
  });

  sendBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (text) { input.value = ""; charCnt.textContent = "0 / 2000"; sendMessage(text); }
  });

  // Clear chat
  const clearBtn = $("clear-chat-btn");
  if (clearBtn) clearBtn.addEventListener("click", clearChat);

  // Upload
  setupUpload();

  // Graph
  setupGraphInteraction();
  $("build-graph-btn").addEventListener("click", buildGraph);

  // Wiki
  $("compile-wiki-btn").addEventListener("click", compileWiki);
  $("wiki-modal-close").addEventListener("click", closeWikiModal);
  $("wiki-modal-overlay").addEventListener("click", e => {
    if (e.target === $("wiki-modal-overlay")) closeWikiModal();
  });
  $("wiki-modal-save").addEventListener("click", async () => {
    if (!state.currentWikiPage) return;
    try {
      await api("/api/wiki/save", { method: "POST", body: JSON.stringify(state.currentWikiPage) });
      toast("Saved to wiki", "success");
    } catch (err) { toast(err.message, "error"); }
  });

  // Settings
  setupSettings();

  // Boot
  $("status-dot").className     = "status-dot loading";
  $("status-label").textContent = "Connecting…";

  Promise.all([loadModels(), loadDashboard(), updateSampleQuestions()]).catch(console.warn);
  setInterval(loadDashboard, 30_000);
});
