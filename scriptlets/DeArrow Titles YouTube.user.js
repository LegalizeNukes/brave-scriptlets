// ==UserScript==
// @name         DeArrow Titles YouTube
// @match        https://*.youtube.com/*
// @run-at       document-start
// ==/UserScript==
(() => {
  "use strict";

  // API endpoints and general limits.
  const BRANDING_API = "https://sponsor.ajay.app";
  const FAST_TITLE_API = "https://dearrow-thumb.ajay.app";
  const VIDEO_LINK_SELECTOR =
    'a[href*="/watch?v="],a[href^="/shorts/"],a[href*="/embed/"]';
  const CACHE_LIMIT = 600;
  const RECOVERY_INTERVAL = 1e4;

  // Title caches and request-tracking collections:
  // titleCache: DeArrow titles; appliedTitleCache: titles already applied to links;
  // brandingRequests/watchTitleRequests: in-flight API requests;
  // linkState: per-link state; pendingRoots: changed DOM roots.
  const titleCache = new Map();
  const appliedTitleCache = new Map();
  const brandingRequests = new Map();
  const watchTitleRequests = new Map();
  const linkState = new WeakMap();
  const pendingRoots = new Set();

  let fullScanTimer = 0;
  let fullScanDueAt = Infinity;
  let watchUpdateTimer = 0;
  let watchUpdateDueAt = Infinity;
  let mutationBatchTimer = 0;
  let mutationRecoveryTimer = 0;
  let recoveryTimer = 0;
  let documentObserver = null;
  let titleObserver = null;
  let observedTitleElement = null;
  let headingObserver = null;
  let observedHeading = null;
  let clickedTitle = null;
  let clickRetryInterval = 0;

  // Extract a YouTube video ID from watch, Shorts, or embed URLs.
  function getVideoId(x) {
    try {
      const u = new URL(x, location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/"))
        return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/embed/"))
        return u.pathname.split("/")[2] || null;
    } catch {}
    return null;
  }

  // Normalize a DeArrow title before inserting it into the page.
  function cleanTitle(t) {
    return (t || "")
      .replace(/[<>‹›]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Read from the title cache and refresh the entry's LRU position.
  function getCachedTitle(v) {
    if (!titleCache.has(v)) return;
    const t = titleCache.get(v);
    titleCache.delete(v);
    titleCache.set(v, t);
    return t;
  }

  // Store a title (including null results) in the bounded LRU cache.
  function putCachedTitle(v, t) {
    titleCache.has(v) && titleCache.delete(v);
    titleCache.set(v, t);
    titleCache.size > CACHE_LIMIT &&
      titleCache.delete(titleCache.keys().next().value);
  }

  // Remember titles applied to links so a click can update the watch page early.
  function rememberAppliedTitle(v, t) {
    appliedTitleCache.has(v) && appliedTitleCache.delete(v);
    appliedTitleCache.set(v, t);
    appliedTitleCache.size > CACHE_LIMIT &&
      appliedTitleCache.delete(appliedTitleCache.keys().next().value);
  }

  // Fetch the preferred non-original title from the full DeArrow API.
  // Concurrent requests for the same video share one promise.
  async function fetchBrandingTitle(v) {
    if (!v) return null;
    const c = getCachedTitle(v);
    if (c !== undefined) return c;
    if (brandingRequests.has(v)) return brandingRequests.get(v);
    const p = (async () => {
      try {
        const r = await fetch(
          `${BRANDING_API}/api/branding?videoID=${encodeURIComponent(v)}`,
          { credentials: "omit" },
        );
        if (!r.ok) return null;
        const x = await r.json();
        if (!x || !Array.isArray(x.titles))
          return (putCachedTitle(v, null), null);
        const b = x.titles.find(
            (t) =>
              t &&
              t.title &&
              t.original !== true &&
              (t.locked || Number(t.votes) >= 0),
          ),
          o = b ? cleanTitle(b.title) : null;
        return (putCachedTitle(v, o), o);
      } catch {
        return null;
      } finally {
        brandingRequests.delete(v);
      }
    })();
    brandingRequests.set(v, p);
    return p;
  }

  // Fast-path lookup: the thumbnail endpoint exposes the title in a header, so
  // the response body can be cancelled immediately.
  async function fetchFastTitle(v) {
    if (!v) return null;
    try {
      const r = await fetch(
          `${FAST_TITLE_API}/api/v1/getThumbnail?videoID=${encodeURIComponent(v)}`,
          { credentials: "omit", cache: "force-cache" },
        ),
        t = cleanTitle(r.headers.get("X-Title"));
      r.body?.cancel().catch(() => {});
      return t || null;
    } catch {
      return null;
    }
  }

  // Resolve the current watch-page title through the fast endpoint first,
  // falling back to the complete branding response when needed.
  async function getWatchTitle(v) {
    if (!v) return null;
    const c = getCachedTitle(v);
    if (c !== undefined) return c;
    if (watchTitleRequests.has(v)) return watchTitleRequests.get(v);
    const p = (async () => {
      const t = await fetchFastTitle(v);
      return t ? (putCachedTitle(v, t), t) : fetchBrandingTitle(v);
    })().finally(() => watchTitleRequests.delete(v));
    watchTitleRequests.set(v, p);
    return p;
  }

  // Thumbnail containers are deliberately excluded from title-text searches.
  function isThumbnailElement(e) {
    return !!e.closest?.(
      "ytd-thumbnail,ytm-thumbnail,yt-thumbnail-view-model,a#thumbnail,a.ytd-thumbnail,.thumbnail,.yt-thumbnail-view-model,.media-item-thumbnail-container,.compact-media-item-image,ytm-thumbnail-overlay-time-status-renderer",
    );
  }

  // Reject elements whose descendants are visual media rather than title text.
  function hasVisualDescendant(e) {
    return !!e.querySelector?.(
      "img,picture,image,svg,ytd-thumbnail,ytm-thumbnail,yt-thumbnail-view-model,video,canvas",
    );
  }

  // YouTube often keeps old renderers in the DOM; only visible elements count.
  function isVisible(e) {
    if (!e || !(e instanceof Element)) return false;
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      Number(s.opacity) !== 0 &&
      r.width > 0 &&
      r.height > 0
    );
  }

  // Filter metadata-like text such as durations, view counts, and badges.
  function isMetadataText(t) {
    const v = (t || "").trim();
    return (
      !v ||
      v.length < 3 ||
      /^\d+([:.]\d+)+$/.test(v) ||
      /^\d+[KMB]?\s+views?/i.test(v) ||
      /^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.test(v) ||
      /^(live|new|cc|hd|4k)$/i.test(v)
    );
  }

  // Find the most likely title node inside a video link. Headings and spans
  // receive a small score bonus to avoid selecting adjacent metadata.
  function findLinkTitleNode(a) {
    if (!a || isThumbnailElement(a) || hasVisualDescendant(a) || !isVisible(a))
      return null;
    let b = null,
      s = 0;
    const w = document.createTreeWalker(a, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (
          !(n instanceof Element) ||
          isThumbnailElement(n) ||
          hasVisualDescendant(n) ||
          !isVisible(n)
        )
          return NodeFilter.FILTER_REJECT;
        return isMetadataText((n.textContent || "").trim())
          ? NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = w.currentNode; n; n = w.nextNode()) {
      const t = (n.textContent || "").trim();
      if (isMetadataText(t)) continue;
      let q = t.length;
      /^H[1-6]$/.test(n.tagName) && (q += 200);
      n.tagName === "SPAN" && (q += 20);
      if (q > s) {
        s = q;
        b = n;
      }
    }
    return b;
  }

  // Keep tooltip and accessibility labels synchronized with the visible title.
  function updateLinkMetadata(a, t) {
    if (!a || !t || isThumbnailElement(a)) return;
    a.title !== undefined && a.title !== t && (a.title = t);
    a.ariaLabel !== undefined && a.ariaLabel !== t && (a.ariaLabel = t);
    a.getAttribute?.("aria-label") &&
      a.getAttribute("aria-label") !== t &&
      a.setAttribute("aria-label", t);
  }

  // Apply a resolved title only if the link is still connected and still points
  // to the same video (important because YouTube reuses DOM nodes).
  function applyLinkTitle(a, v, t) {
    if (
      !a.isConnected ||
      getVideoId(a.href) !== v ||
      isThumbnailElement(a) ||
      hasVisualDescendant(a)
    )
      return;
    const g = findLinkTitleNode(a);
    if (!g) return;
    (g.textContent || "").trim() !== t && (g.textContent = t);
    updateLinkMetadata(a, t);
    linkState.set(a, { videoId: v, title: t });
    rememberAppliedTitle(v, t);
  }

  // Resolve and update one watch/Shorts/embed link.
  async function processLink(a) {
    if (!(a instanceof HTMLAnchorElement)) return;
    const v = getVideoId(a.href);
    if (!v || isThumbnailElement(a) || hasVisualDescendant(a)) return;
    const p = linkState.get(a);
    if (p && p.videoId === v && p.title) {
      applyLinkTitle(a, v, p.title);
      return;
    }
    const t = await fetchBrandingTitle(v);
    t && applyLinkTitle(a, v, t);
  }

  // A watch-page heading must be visible, text-like, and near the viewport top.
  function isLikelyHeading(e) {
    if (!isVisible(e) || isThumbnailElement(e) || hasVisualDescendant(e))
      return false;
    const t = (e.textContent || "").trim();
    if (isMetadataText(t)) return false;
    const r = e.getBoundingClientRect();
    return r.top >= 0 && r.top < innerHeight * 0.75;
  }

  // Reapply the DeArrow title if YouTube rewrites the current heading.
  function observeHeading(e) {
    if (!e || e === observedHeading) return;
    headingObserver && headingObserver.disconnect();
    observedHeading = e;
    headingObserver = new MutationObserver(() => scheduleWatchUpdate(0));
    headingObserver.observe(e, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Apply a title to both the desktop watch-page heading and browser-tab title.
  // Candidate headings are scored so the active video's title wins.
  function applyDesktopWatchTitle(v, t) {
    if (!t || getVideoId(location.href) !== v) return false;
    const d = `${t} - YouTube`;
    document.title !== d && (document.title = d);
    let b = null,
      s = 0;
    document.querySelectorAll("h1,h2").forEach((e) => {
      if (!isLikelyHeading(e)) return;
      let q =
          (e.textContent || "").trim().length + (e.tagName === "H1" ? 100 : 50),
        r = e.getBoundingClientRect();
      q += Math.max(0, 300 - r.top);
      if (q > s) {
        s = q;
        b = e;
      }
    });
    if (!b) return false;
    const e = b.querySelector("yt-formatted-string") || b;
    observeHeading(e);
    const n = [...e.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (!n) return false;
    (n.data || "").trim() !== t && (n.data = t);
    return true;
  }

  // Apply the title to the mobile watch-page heading. Mobile YouTube nests the
  // visible title across attributed-string text nodes, so replace the first
  // meaningful node and clear any remaining fragments.
  function applyMobileWatchTitle(v, t) {
    if (!t || getVideoId(location.href) !== v) return false;

    const d = `${t} - YouTube`;
    document.title !== d && (document.title = d);

    const b = document.querySelector(".slim-video-information-title");
    if (!b) return false;

    const e =
      b.querySelector(
        ".ytAttributedStringHost:not(.cbCustomTitle),.yt-core-attributed-string:not(.cbCustomTitle),yt-formatted-string:not(.cbCustomTitle)",
      ) || b;
    observeHeading(e);

    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    const a = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n.data || "").trim()) a.push(n);
    }
    if (!a.length) return false;

    if ((e.textContent || "").trim() !== t) {
      a[0].data = t;
      for (let i = 1; i < a.length; i++) a[i].data = "";
    }
    return true;
  }

  // Keep desktop and mobile title replacement paths independent.
  function applyCurrentWatchTitle(v, t) {
    return location.hostname === "m.youtube.com"
      ? applyMobileWatchTitle(v, t)
      : applyDesktopWatchTitle(v, t);
  }

  // Resolve and update the current watch page, using the clicked link's cached
  // title when available to avoid briefly showing YouTube's original title.
  function updateWatchPage() {
    const v = getVideoId(location.href);
    if (!v) {
      headingObserver && headingObserver.disconnect();
      headingObserver = null;
      observedHeading = null;
      return;
    }
    if (observedHeading && !observedHeading.isConnected) {
      headingObserver && headingObserver.disconnect();
      headingObserver = null;
      observedHeading = null;
    }
    const t =
      clickedTitle && clickedTitle.videoId === v
        ? clickedTitle.title
        : (appliedTitleCache.get(v) ?? getCachedTitle(v));
    if (t !== undefined) {
      t && applyCurrentWatchTitle(v, t);
      return;
    }
    getWatchTitle(v).then((t) => t && applyCurrentWatchTitle(v, t));
  }

  // Scan a DOM root for video links.
  function scanLinks(r = document) {
    r instanceof HTMLAnchorElement &&
      r.matches(VIDEO_LINK_SELECTOR) &&
      processLink(r);
    r.querySelectorAll?.(VIDEO_LINK_SELECTOR).forEach(processLink);
  }

  // Run a complete link scan and update the active watch page.
  function scanPage(r = document) {
    scanLinks(r);
    scheduleWatchUpdate(0);
  }

  // Coalesce full-page scans, while allowing an earlier request to supersede a
  // later one.
  function scheduleFullScan(d = 250) {
    const n = performance.now() + d;
    if (fullScanTimer && n >= fullScanDueAt) return;
    fullScanTimer && clearTimeout(fullScanTimer);
    fullScanDueAt = n;
    fullScanTimer = setTimeout(
      () => {
        fullScanTimer = 0;
        fullScanDueAt = Infinity;
        scanPage();
      },
      Math.max(0, n - performance.now()),
    );
  }

  // Coalesce watch-page title updates independently from link scans.
  function scheduleWatchUpdate(d = 0) {
    const n = performance.now() + d;
    if (watchUpdateTimer && n >= watchUpdateDueAt) return;
    watchUpdateTimer && clearTimeout(watchUpdateTimer);
    watchUpdateDueAt = n;
    watchUpdateTimer = setTimeout(
      () => {
        watchUpdateTimer = 0;
        watchUpdateDueAt = Infinity;
        updateWatchPage();
      },
      Math.max(0, n - performance.now()),
    );
  }

  // Queue a changed DOM root for a small batched scan.
  function queueMutationRoot(r) {
    if (!(r instanceof Element)) return;
    pendingRoots.add(r);
    if (!mutationBatchTimer)
      mutationBatchTimer = setTimeout(flushMutationRoots, 50);
  }

  // Remove nested/duplicate mutation roots, then scan only the smallest useful
  // set of changed subtrees.
  function flushMutationRoots() {
    mutationBatchTimer = 0;
    const a = [...pendingRoots];
    pendingRoots.clear();
    const m = [];
    for (const r of a) {
      if (!r.isConnected) continue;
      if (m.some((p) => p.contains(r))) continue;
      for (let i = m.length - 1; i >= 0; i--)
        r.contains(m[i]) && m.splice(i, 1);
      m.push(r);
    }
    for (const r of m) scanLinks(r);
    scheduleWatchUpdate(0);
  }

  // Observe replacement of the document's <title> node during SPA navigation.
  function observeDocumentTitle() {
    const e = document.querySelector("title");
    if (!e || e === observedTitleElement) return;
    titleObserver && titleObserver.disconnect();
    observedTitleElement = e;
    titleObserver = new MutationObserver(() => scheduleWatchUpdate(0));
    titleObserver.observe(e, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Schedule a fallback scan after a burst of DOM mutations settles.
  function scheduleRecoveryScan() {
    clearTimeout(mutationRecoveryTimer);
    mutationRecoveryTimer = setTimeout(() => {
      mutationRecoveryTimer = 0;
      scheduleFullScan(0);
    }, 700);
  }

  // Main document observer callback: queue changed links/subtrees and reconnect
  // the <title> observer if YouTube replaced that element.
  function handleMutations(ms) {
    let tc = false;
    for (const m of ms) {
      if (m.type === "attributes" && m.target instanceof HTMLAnchorElement) {
        queueMutationRoot(m.target);
        continue;
      }
      for (const n of m.addedNodes)
        if (n instanceof Element) {
          queueMutationRoot(n);
          (n.tagName === "TITLE" || n.querySelector?.("title")) && (tc = true);
        }
    }
    tc && observeDocumentTitle();
    scheduleRecoveryScan();
  }

  // Schedule both thumbnail-link and watch-page work after navigation events.
  function scheduleNavigationUpdate(d = 350) {
    scheduleFullScan(d);
    scheduleWatchUpdate(d);
  }

  // Periodic low-frequency recovery scan for UI changes without useful events.
  function runRecoveryLoop() {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      document.hidden || scheduleFullScan(0);
      runRecoveryLoop();
    }, RECOVERY_INTERVAL);
  }

  // Capture the clicked thumbnail's already-resolved title and try applying it
  // every 40 ms during navigation, stopping as soon as the new heading exists.
  function handleLinkClick(e) {
    const a =
      e.target instanceof Element && e.target.closest(VIDEO_LINK_SELECTOR);
    if (!(a instanceof HTMLAnchorElement)) return;
    const v = getVideoId(a.href);
    if (!v) return;
    clearInterval(clickRetryInterval);
    clickRetryInterval = 0;
    clickedTitle = null;
    const p = linkState.get(a),
      t =
        p && p.videoId === v
          ? p.title
          : (appliedTitleCache.get(v) ?? getCachedTitle(v));
    if (!t) return;
    clickedTitle = { videoId: v, title: t };
    let n = 0;
    clickRetryInterval = setInterval(() => {
      const d = getVideoId(location.href) === v && applyCurrentWatchTitle(v, t);
      if (d || ++n >= 75) {
        clearInterval(clickRetryInterval);
        clickRetryInterval = 0;
        clickedTitle?.videoId === v && (clickedTitle = null);
      }
    }, 40);
  }

  // Install observers and navigation hooks once documentElement is available.
  function start() {
    const r = document.documentElement;
    if (!r) {
      setTimeout(start, 0);
      return;
    }
    documentObserver = new MutationObserver(handleMutations);
    documentObserver.observe(r, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    observeDocumentTitle();
    const o = { capture: true, passive: true };
    document.addEventListener("click", handleLinkClick, o);
    document.addEventListener(
      "yt-navigate-start",
      () => scheduleNavigationUpdate(100),
      o,
    );
    document.addEventListener(
      "yt-navigate-finish",
      () => {
        scheduleFullScan(350);
        scheduleWatchUpdate(0);
      },
      o,
    );
    document.addEventListener(
      "ytm-navigate-start",
      () => scheduleNavigationUpdate(100),
      o,
    );
    document.addEventListener(
      "ytm-navigate-finish",
      () => scheduleNavigationUpdate(350),
      o,
    );
    document.addEventListener(
      "yt-page-data-updated",
      () => scheduleNavigationUpdate(350),
      o,
    );
    document.addEventListener(
      "spfdone",
      () => scheduleNavigationUpdate(350),
      o,
    );
    window.addEventListener("popstate", () => scheduleNavigationUpdate(350), o);
    window.addEventListener("pageshow", () => scheduleNavigationUpdate(80), o);
    document.addEventListener(
      "loadedmetadata",
      () => scheduleNavigationUpdate(80),
      true,
    );
    document.addEventListener(
      "loadeddata",
      () => scheduleNavigationUpdate(80),
      true,
    );
    document.addEventListener("visibilitychange", () => {
      document.hidden || scheduleNavigationUpdate(0);
    });
    scanPage();
    runRecoveryLoop();
  }

  start();
})();
