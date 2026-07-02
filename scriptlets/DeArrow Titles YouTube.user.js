// ==UserScript==
// @name         Dearrow Titles YouTube
// @match        https://*.youtube.com/*
// ==/UserScript==
(() => {
  "use strict";
  const API = "https://sponsor.ajay.app",
    C = new Map(),
    P = new Map(),
    MAX = 600; // Extract a YouTube video ID from a URL.
  function vid(u) {
    try {
      u = new URL(u, location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
    } catch {}
    return null;
  } // Compute the SHA-256 hash used by the DeArrow API lookup.
  async function sha(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  } // Normalize title text before inserting it into the page.
  function clean(t) {
    return (t || "").replace(/‹/g, "<").replace(/\s+/g, " ").trim();
  } // Fetch and cache a DeArrow replacement title for a video ID.
  async function getTitle(id) {
    if (!id) return null;
    if (C.has(id)) return C.get(id);
    if (P.has(id)) return P.get(id);
    const q = (async () => {
      try {
        const h = (await sha(id)).slice(0, 4),
          r = await fetch(`${API}/api/branding/${h}?fetchAll=true`);
        if (!r.ok) return null;
        const j = await r.json(),
          x = j && j[id];
        if (!x || !Array.isArray(x.titles)) return null;
        const b = x.titles.find(
            (t) => t && t.title && t.original !== true && (t.locked || Number(t.votes) >= 0),
          ),
          out = b ? clean(b.title) : null;
        if (out) {
          C.set(id, out);
          if (C.size > MAX) C.delete(C.keys().next().value);
        }
        return out;
      } catch {
        return null;
      } finally {
        P.delete(id);
      }
    })();
    P.set(id, q);
    return q;
  } // Detect whether an element is inside a thumbnail area.
  function inThumb(e) {
    return !!e.closest?.(
      "ytd-thumbnail,ytm-thumbnail,yt-thumbnail-view-model,a#thumbnail,a.ytd-thumbnail,.thumbnail,.yt-thumbnail-view-model,.media-item-thumbnail-container,.compact-media-item-image,ytm-thumbnail-overlay-time-status-renderer",
    );
  } // Detect visual/media children that should not be overwritten as text.
  function hasVisual(e) {
    return !!e.querySelector?.(
      "img,picture,image,svg,ytd-thumbnail,ytm-thumbnail,yt-thumbnail-view-model,video,canvas",
    );
  } // Check whether an element is currently visible on the page.
  function visible(e) {
    if (!e || !(e instanceof Element)) return false;
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      +s.opacity !== 0 &&
      r.width > 0 &&
      r.height > 0
    );
  } // Filter out non-title text such as timestamps, view counts, and badges.
  function badText(t) {
    t = (t || "").trim();
    return (
      !t ||
      t.length < 3 ||
      /^\d+([:.]\d+)+$/.test(t) ||
      /^\d+[KMB]?\s+views?/i.test(t) ||
      /^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.test(t) ||
      /^(live|new|cc|hd|4k)$/i.test(t)
    );
  } // Choose the best text element inside a link to replace.
  function textTarget(a) {
    if (!a || inThumb(a) || hasVisual(a) || !visible(a)) return null;
    let best = null,
      score = 0;
    const w = document.createTreeWalker(a, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (!(n instanceof Element) || inThumb(n) || hasVisual(n) || !visible(n))
          return NodeFilter.FILTER_REJECT;
        const t = (n.textContent || "").trim();
        if (badText(t)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = w.currentNode; n; n = w.nextNode()) {
      const t = (n.textContent || "").trim();
      if (badText(t)) continue;
      let sc = t.length;
      if (/^H[1-6]$/.test(n.tagName)) sc += 200;
      if (n.tagName === "SPAN") sc += 20;
      if (sc > score) {
        score = sc;
        best = n;
      }
    }
    return best;
  } // Synchronize title and accessibility metadata on a link.
  function meta(a, t) {
    if (!a || !t || inThumb(a)) return;
    if (a.title !== undefined && a.title !== t) a.title = t;
    if (a.ariaLabel !== undefined && a.ariaLabel !== t) a.ariaLabel = t;
    if (a.getAttribute?.("aria-label") && a.getAttribute("aria-label") !== t)
      a.setAttribute("aria-label", t);
  } // Process one YouTube link and replace its visible title if available.
  async function processLink(a) {
    if (!(a instanceof HTMLAnchorElement)) return;
    const id = vid(a.href);
    if (!id || inThumb(a) || hasVisual(a)) return;
    const t = await getTitle(id);
    if (!t) return;
    const g = textTarget(a);
    if (!g) return;
    if ((g.textContent || "").trim() !== t) g.textContent = t;
    meta(a, t);
  } // Check whether a heading is likely the active watch-page title.
  function likelyWatchHeading(e) {
    if (!visible(e) || inThumb(e) || hasVisual(e)) return false;
    const t = (e.textContent || "").trim();
    if (badText(t)) return false;
    const r = e.getBoundingClientRect();
    return r.top >= 0 && r.top < innerHeight * 0.75;
  } // Update the watch-page title and document title.
  async function processWatch() {
    const id = vid(location.href);
    if (!id) return;
    const t = await getTitle(id);
    if (!t) return;
    const dt = `${t} - YouTube`;
    if (document.title !== dt) document.title = dt;
    let best = null,
      score = 0;
    document.querySelectorAll("h1,h2").forEach((e) => {
      if (!likelyWatchHeading(e)) return;
      let s = (e.textContent || "").trim().length + (e.tagName === "H1" ? 100 : 50);
      const r = e.getBoundingClientRect();
      s += Math.max(0, 300 - r.top);
      if (s > score) {
        score = s;
        best = e;
      }
    });
    if (best && (best.textContent || "").trim() !== t) best.textContent = t;
  } // Helper routine: scan.
  function scan(root = document) {
    root
      .querySelectorAll?.('a[href*="/watch?v="],a[href^="/shorts/"],a[href*="/embed/"]')
      .forEach(processLink);
    processWatch();
  } // Helper routine: node.
  function node(n) {
    if (!(n instanceof Element)) return;
    if (n.matches?.('a[href*="/watch?v="],a[href^="/shorts/"],a[href*="/embed/"]')) processLink(n);
    scan(n);
  }
  let z = null; // Helper routine: sched.
  function sched(d = 250) {
    clearTimeout(z);
    z = setTimeout(() => scan(), d);
  }
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) node(n);
    sched(700);
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-start", () => sched(100), true);
  document.addEventListener("yt-navigate-finish", () => sched(350), true);
  document.addEventListener("yt-page-data-updated", () => sched(350), true);
  window.addEventListener("popstate", () => sched(350), true);
  setInterval(processWatch, 2500);
  setInterval(() => scan(), 10000);
  scan();
})();
