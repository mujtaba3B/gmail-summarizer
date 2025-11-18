// ==UserScript==
// @name         Email News Summarizer
// @namespace    https://github.com/user/email_reader
// @version      0.1.0
// @description  Extract news links from the open email and summarize them via a Cloudflare Worker backend.
// @match        https://mail.google.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

// Tampermonkey globals
/* global GM_xmlhttpRequest */

(function () {
  const BACKEND_URL = "http://127.0.0.1:8787/summaries";
  const TEST_MODE_LIMIT = 50; // set >0 to limit articles for credit savings; set 0 to disable limit
  const MAX_ARTICLES = 100; // safety cap
  const DEBUG_FALLBACK_TO_FIRST_LINK = true;
  const READ_MORE_PHRASES = [
    "read more",
    "read now",
    "read the full story",
    "read the full article",
    "read story",
    "read article",
    "full article",
    "full story",
    "see full article",
    "see full story",
    "see more",
    "learn more",
    "continue reading",
    "continue to article",
    "view article",
    "view story",
    "read it here",
    "read here",
  ];
  const HEADLINE_MIN_WORDS = 5;
  const EXCLUDED_TEXT_PHRASES = [
    "unsubscribe",
    "manage preferences",
    "privacy",
    "terms",
    "view in browser",
    "forward to a friend",
    "contact us",
    "linkedin",
    "facebook",
    "instagram",
    "twitter",
    "x.com",
    "youtube",
  ];
  const EXCLUDED_HOSTNAMES = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "youtu.be"];
  const PANEL_ID = "email-news-summarizer-panel";
  const PANEL_CONTENT_ID = "email-news-summarizer-content";
  const PANEL_FOOTER_ID = "email-news-summarizer-footer";
  const PANEL_TITLE_ID = "email-news-summarizer-title";
  const TOPBAR_BUTTON_ID = "email-news-summarizer-topbar-btn";
  const state = { readingTime: "default", loading: false };
  let mounted = false;
  let lastDurationMs = null;

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.position = "fixed";
      panel.style.top = "64px";
      panel.style.right = "0";
      panel.style.bottom = "0";
      panel.style.width = "360px";
      panel.style.background = "#fff";
      panel.style.borderLeft = "1px solid #dadce0";
      panel.style.boxShadow = "-2px 0 8px rgba(0,0,0,0.08)";
      panel.style.zIndex = "9999";
      panel.style.display = "none";
      panel.style.fontFamily = "Arial, sans-serif";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.padding = "10px";
      header.style.borderBottom = "1px solid #dadce0";
      header.style.gap = "8px";

      const title = document.createElement("div");
      title.id = PANEL_TITLE_ID;
      title.textContent = "Summaries";
      title.style.fontFamily = '"Google Sans", "Roboto", "Arial", sans-serif';
      title.style.fontWeight = "600";
      title.style.fontSize = "16px";
      title.style.color = "#3c4043";
      header.appendChild(title);

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "×";
      closeBtn.style.background = "transparent";
      closeBtn.style.border = "none";
      closeBtn.style.fontSize = "18px";
      closeBtn.style.cursor = "pointer";
      closeBtn.onclick = () => togglePanel(false);
      header.appendChild(closeBtn);

      const content = document.createElement("div");
      content.id = PANEL_CONTENT_ID;
      content.style.padding = "10px";
      content.style.overflowY = "auto";
      content.style.height = "calc(100% - 160px)";

      const footer = document.createElement("div");
      footer.id = PANEL_FOOTER_ID;
      footer.style.position = "sticky";
      footer.style.bottom = "0";
      footer.style.left = "0";
      footer.style.right = "0";
      footer.style.padding = "10px";
      footer.style.borderTop = "1px solid #dadce0";
      footer.style.background = "#fff";
      footer.style.display = "flex";
      footer.style.flexDirection = "column";
      footer.style.gap = "6px";

      const select = document.createElement("select");
      ["quick", "default", "long"].forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option;
        opt.text = option.charAt(0).toUpperCase() + option.slice(1);
        if (option === state.readingTime) opt.selected = true;
        select.appendChild(opt);
      });
      select.style.width = "100%";
      select.style.height = "40px";
      select.style.border = "1px solid #dadce0";
      select.style.borderRadius = "4px";
      select.style.padding = "8px";
      select.style.boxSizing = "border-box";
      select.onchange = (event) => {
        const target = event.target;
        state.readingTime = (target && target.value) || "default";
      };

      const summarizeBtn = document.createElement("button");
      summarizeBtn.textContent = "✍️ Summarize";
      summarizeBtn.style.background = "#1a73e8";
      summarizeBtn.style.color = "#fff";
      summarizeBtn.style.border = "none";
      summarizeBtn.style.borderRadius = "6px";
      summarizeBtn.style.padding = "14px";
      summarizeBtn.style.cursor = "pointer";
      summarizeBtn.style.width = "100%";
      summarizeBtn.style.fontWeight = "bold";
      summarizeBtn.style.height = "48px";
      summarizeBtn.style.fontSize = "16px";
      summarizeBtn.onclick = handleSummarize;

      footer.appendChild(select);
      footer.appendChild(summarizeBtn);

      panel.appendChild(header);
      panel.appendChild(content);
      panel.appendChild(footer);
      document.body.appendChild(panel);
    }
    return panel;
  }

  function togglePanel(show) {
    const panel = ensurePanel();
    panel.style.display = show ? "block" : "none";
  }

  function ensureTopbarButton() {
    if (document.getElementById(TOPBAR_BUTTON_ID)) return;
    const utilitiesBar =
      document.querySelector(".gb_v.gb_qe.bGJ") ||
      document.querySelector(".gb_v.gb_qe") ||
      document.querySelector(".gb_v");
    if (!utilitiesBar) {
      console.warn("[summarizer] could not find Gmail utilities bar");
      return;
    }
    const btn = document.createElement("div");
    btn.id = TOPBAR_BUTTON_ID;
    btn.textContent = "✍️";
    btn.style.cursor = "pointer";
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "4px";
    btn.style.border = "1px solid #dadce0";
    btn.style.background = "#f9e8d2";
    btn.style.color = "#d35400";
    btn.style.fontWeight = "bold";
    btn.style.fontSize = "20px";
    btn.style.height = "36px";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.marginLeft = "8px";
    btn.onclick = () => togglePanel(true);
    utilitiesBar.appendChild(btn);
  }

  function isViewingEmail() {
    const hash = window.location.hash || "";
    const looksLikeThreadUrl = /#(inbox|label|category|search)\//.test(hash) && hash.split("/").length >= 2;
    const hasBody = document.querySelector("div.a3s") !== null;
    return looksLikeThreadUrl && hasBody;
  }

  function renderStatus(message) {
    console.log("[summarizer] status:", message);
    const content = getContentArea(true);
    if (!content) return;
    content.replaceChildren();
    const msg = document.createElement("div");
    msg.style.color = "#5f6368";
    msg.style.fontSize = "12px";
    msg.textContent = message;
    content.appendChild(msg);
  }

  function renderResults(results) {
    console.log("[summarizer] render results:", results);
    const content = getContentArea(true);
    if (!content) return;
    content.replaceChildren();

    if (!results || results.length === 0) {
      updateTitleCount(0);
      return;
    }
    updateTitleCount(results.length);

    if (lastDurationMs != null) {
      const meta = document.createElement("div");
      meta.style.color = "#3c4043";
      meta.style.fontSize = "12px";
      meta.style.marginBottom = "8px";
      meta.textContent = `Completed in ${(lastDurationMs / 1000).toFixed(2)} seconds`;
      content.appendChild(meta);
    }

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "10px";

    results.forEach((item) => {
      const card = document.createElement("div");
      card.style.padding = "10px";
      card.style.borderRadius = "6px";
      card.style.border = "1px solid #dadce0";
      card.style.background = "#fff";

      const link = document.createElement("a");
      link.href = item.url;
      link.textContent = item.headline || item.url;
      link.target = "_blank";
      link.style.fontWeight = "600";
      link.style.fontSize = "16px";
      link.style.color = "#1a73e8";
      link.style.display = "block";
      link.style.marginBottom = "6px";

      const ul = document.createElement("ul");
      ul.style.paddingLeft = "18px";
      ul.style.margin = "0";
      (item.bullets || []).forEach((bullet) => {
        const li = document.createElement("li");
        li.textContent = bullet;
        li.style.color = "#3c4043";
        li.style.fontSize = "14px";
        li.style.lineHeight = "20px";
        ul.appendChild(li);
      });

      card.appendChild(link);
      card.appendChild(ul);
      list.appendChild(card);
    });

    content.appendChild(list);
  }

  function getContentArea(forceShow) {
    const panel = ensurePanel();
    if (forceShow) togglePanel(true);
    return document.getElementById(PANEL_CONTENT_ID);
  }

  function updateTitleCount(count) {
    const titleEl = document.getElementById(PANEL_TITLE_ID);
    if (!titleEl) return;
    titleEl.textContent = count > 0 ? `Summaries (${count})` : "Summaries";
  }

  function extractLinks() {
    console.log("[summarizer] extracting links...");
    const emailBodies = Array.from(document.querySelectorAll("div.ii, div.a3s"));
    console.log("[summarizer] body count:", emailBodies.length);
    const links = new Set();
    emailBodies.forEach((body, idx) => {
      const anchors = body.querySelectorAll("a[href^='http']");
      console.log("[summarizer] anchors in body", idx, anchors.length);
      anchors.forEach((anchor) => {
        if (!anchor || !anchor.href) return;
        const text = (anchor.textContent || "").trim().toLowerCase();
        if (isExcludedText(text)) return;
        if (isExcludedHost(anchor.href)) return;
        if (matchesReadMore(text) || looksLikeHeadline(text)) {
          links.add(anchor.href);
          console.log("[summarizer] candidate link:", anchor.href, "text:", text);
        }
      });
    });
    console.log("[summarizer] raw candidate links:", Array.from(links));
    return Array.from(links);
  }

  async function handleSummarize() {
    console.log("[summarizer] handleSummarize start");
    state.loading = true;
    togglePanel(true);
    renderStatus("Collecting links...");
    const links = extractLinks();
    const uniqueArticles = filterUniqueLinks(links);
    let selected = uniqueArticles;

    if (uniqueArticles.length === 0) {
      state.loading = false;
      console.warn("[summarizer] no article candidates after filtering");
      if (DEBUG_FALLBACK_TO_FIRST_LINK) {
        const allLinks = extractAllLinks();
        if (allLinks.length > 0) {
          console.warn("[summarizer] fallback: sending first link for debug:", allLinks[0]);
          selected = allLinks;
        }
      }
      if (!selected || selected.length === 0) {
        renderStatus("No likely news article links detected in this email.");
        return;
      }
    }

    const count = selected.length;
    const cap = TEST_MODE_LIMIT > 0 ? Math.min(TEST_MODE_LIMIT, MAX_ARTICLES) : MAX_ARTICLES;
    const qualifier =
      TEST_MODE_LIMIT > 0 || MAX_ARTICLES
        ? ` (server will process up to ${cap} article(s))`
        : "";
    renderStatus("Summarizing " + count + " link(s)" + qualifier + "...");
    console.log("[summarizer] sending to backend:", selected);

    try {
      const started = performance.now();
      const response = await gmFetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({
          links: selected,
          readingTime: state.readingTime,
          articleLimit: TEST_MODE_LIMIT,
          maxArticles: MAX_ARTICLES,
        }),
      });

      if (!response.ok) {
        console.error("[summarizer] backend error body:", response.responseText);
        throw new Error("Backend error: " + response.status);
      }

      const payload = parseJson(response.responseText);
      console.log("[summarizer] backend payload:", payload);
      lastDurationMs = performance.now() - started;
      renderResults(payload.summaries || []);
    } catch (error) {
      console.error("[summarizer] failed:", error);
      renderStatus("Failed: " + (error && error.message ? error.message : "Unknown error"));
    } finally {
      console.log("[summarizer] handleSummarize end");
      state.loading = false;
    }
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return {};
    }
  }

  function gmFetch(url, options) {
    console.log("[summarizer] gmFetch ->", url, options);
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        url: url,
        method: options.method || "GET",
        headers: options.headers,
        data: options.data,
        responseType: "text",
        onload: function (res) {
          console.log("[summarizer] gmFetch onload", { status: res.status, len: (res.responseText || "").length });
          const enhanced = enhanceResponse(res);
          if (!enhanced.responseText || enhanced.responseText.length === 0) {
            fallbackFetch(url, options)
              .then((fallback) => {
                if (!fallback.responseText || fallback.responseText.length === 0) {
                  console.warn("[summarizer] empty responseText from GM_xmlhttpRequest and fallback fetch");
                }
                resolve(fallback);
              })
              .catch(reject);
            return;
          }
          resolve(enhanced);
        },
        onerror: reject,
        timeout: 30000,
      });
    });
  }

  function enhanceResponse(res) {
    return Object.assign({}, res, { ok: res.status >= 200 && res.status < 300 });
  }

  async function fallbackFetch(url, options) {
    const resp = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.data,
    });
    const text = await resp.text();
    return { status: resp.status, ok: resp.ok, responseText: text };
  }

  function filterUniqueLinks(urls) {
    return Array.from(new Set(urls.map(normalizeUrl))).filter(Boolean);
  }

  function extractAllLinks() {
    const anchors = Array.from(document.querySelectorAll("a[href^='http']"));
    const links = anchors.map((a) => a.href).filter(Boolean);
    console.log("[summarizer] all links (no filter):", links);
    return Array.from(new Set(links.map(normalizeUrl))).filter(Boolean);
  }

  function normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function matchesReadMore(text) {
    if (!text) return false;
    return READ_MORE_PHRASES.some((phrase) => text.includes(phrase));
  }

  function looksLikeHeadline(text) {
    if (!text) return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < HEADLINE_MIN_WORDS) return false;
    const alphaWords = words.filter((w) => /[a-zA-Z]/.test(w));
    if (alphaWords.length < HEADLINE_MIN_WORDS) return false;
    const upperRatio =
      alphaWords.filter((w) => w === w.toUpperCase()).length / Math.max(alphaWords.length, 1);
    if (upperRatio > 0.6) return false;
    return true;
  }

  function isExcludedText(text) {
    if (!text) return false;
    return EXCLUDED_TEXT_PHRASES.some((phrase) => text.includes(phrase));
  }

  function isExcludedHost(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      return EXCLUDED_HOSTNAMES.includes(hostname);
    } catch {
      return false;
    }
  }

  function bootstrapIfNeeded() {
    if (!isViewingEmail()) {
      mounted = false;
      removePanel();
      return;
    }
    if (mounted) return;
    mounted = true;
    ensurePanel();
    ensureTopbarButton();
  }

  function removePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  const observer = new MutationObserver(() => bootstrapIfNeeded());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", bootstrapIfNeeded);
  bootstrapIfNeeded();
})();
