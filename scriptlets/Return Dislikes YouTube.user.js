// ==UserScript==
// @name         Return Dislikes YouTube
// @match        https://youtube.com/*
// @match        https://*.youtube.com/*
// ==/UserScript==
(function () {
  "use strict";

  // API, cache, and DOM timing configuration.
  const API_URL = "https://returnyoutubedislikeapi.com/votes?videoId=";
  const CACHE_LIMIT = 100;
  const UI_WAIT_LIMIT = 6e3;
  const IS_MOBILE_SITE = location.hostname === "m.youtube.com";
  const formatter = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  // YouTube regularly changes its renderer structure. Each list is ordered
  // from the most specific/current selector to broader fallbacks.
  const DESKTOP_BUTTON_SELECTORS = [
    "dislike-button-view-model button",
    "dislike-button-view-model button-view-model > button",
    "dislike-button-view-model .ytSpecButtonViewModelHost button",
    "dislike-button-view-model .yt-spec-button-shape-next",
    "#segmented-dislike-button button",
    'button[aria-label*="Dislike" i]',
  ];

  const MOBILE_BUTTON_SELECTORS = [
    "ytm-segmented-like-dislike-button-renderer dislike-button-view-model button",
    "ytm-slim-video-action-bar-renderer dislike-button-view-model button",
    'ytm-segmented-like-dislike-button-renderer button[aria-label*="Dislike" i]',
    'ytm-slim-video-action-bar-renderer button[aria-label*="Dislike" i]',
    'ytm-like-button-renderer button[aria-label*="Dislike" i]',
    "dislike-button-view-model button",
    "#segmented-dislike-button button",
    'button[aria-label*="Dislike" i]',
  ];

  const MOBILE_LIKE_BUTTON_SELECTORS = [
    "ytm-segmented-like-dislike-button-renderer like-button-view-model button",
    "ytm-slim-video-action-bar-renderer like-button-view-model button",
    "ytm-segmented-like-dislike-button-renderer #segmented-like-button button",
    "ytm-slim-video-action-bar-renderer #segmented-like-button button",
    "like-button-view-model button",
    "#segmented-like-button button",
    'ytm-segmented-like-dislike-button-renderer button[aria-label^="Like" i]',
    'ytm-segmented-like-dislike-button-renderer button[aria-label^="Unlike" i]',
    'ytm-slim-video-action-bar-renderer button[aria-label^="Like" i]',
    'ytm-slim-video-action-bar-renderer button[aria-label^="Unlike" i]',
  ];

  const LIKE_TEXT_SELECTORS = [
    'like-button-view-model button span[role="text"]',
    "like-button-view-model button span",
    "#segmented-like-button button span",
    "ytm-like-button-renderer #text",
    'ytm-segmented-like-dislike-button-renderer button[aria-label*="Like" i] span',
  ];

  const SHORTS_ROOT_SELECTORS = [
    'ytd-reel-video-renderer[is-active-reel="true"]',
    'ytd-reel-video-renderer[tab-identifier="shorts"]',
    "ytm-reel-player-overlay-renderer",
    "ytd-reel-video-renderer",
  ];

  const SHORTS_COUNT_SELECTORS = [
    "#button-bar > reel-action-bar-view-model > dislike-button-view-model > toggle-button-view-model > button-view-model > label > div > span",
    'reel-action-bar-view-model dislike-button-view-model label div span[role="text"]',
    'dislike-button-view-model label span[role="text"]',
  ];

  const BASE_STYLE =
    ".return-youtube-dislike-button,.return-youtube-like-button{display:inline-flex!important;align-items:center!important;column-gap:8px!important;flex:0 0 auto!important;overflow:visible!important;width:auto!important;min-width:auto!important;margin-inline-end:12px!important}.return-youtube-dislike-count,.return-youtube-like-count{flex:0 0 auto;margin-left:0!important;white-space:nowrap}";

  // State for the current video, active request, scheduled update, UI observer,
  // and any styles applied to the desktop renderer.
  let currentVideoId = "";
  let currentDislikes = null;
  let currentLikes = null;
  let requestController = null;
  let requestVideoId = "";
  let updateTimer = 0;
  let updateDueAt = Infinity;
  let observer = null;
  let observerScope = null;
  let observerMode = "";
  let observerExpiry = 0;
  let styleElement = null;
  let desktopCss = "";
  let desktopRoot = null;

  // Bounded LRU cache of API results.
  const cache = new Map();

  function formatCount(v) {
    return formatter.format(v);
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  // Prefer the URL, then fall back to page metadata while YouTube is navigating.
  function getVideoId() {
    const u = new URL(location.href);
    if (u.pathname.startsWith("/shorts/"))
      return u.pathname.slice(8).split("/")[0] || "";

    const v = u.searchParams.get("v");
    if (v) return v;

    const m = document.querySelector(
      'meta[itemprop="videoId"],meta[itemprop="identifier"]',
    );
    if (m && m.content) return m.content;

    const o = document.querySelector('meta[property="og:video:url"]');
    if (o && o.content) {
      try {
        return new URL(o.content).searchParams.get("v") || "";
      } catch {}
    }

    return "";
  }

  // Return the first matching element from an ordered selector list.
  function findFirst(r, s) {
    for (const q of s) {
      const e = r.querySelector(q);
      if (e) return e;
    }
    return null;
  }

  // LRU cache access: a read moves the item to the newest position.
  function getCached(v) {
    if (!cache.has(v)) return;
    const d = cache.get(v);
    cache.delete(v);
    cache.set(v, d);
    return d;
  }

  function putCached(v, d) {
    cache.has(v) && cache.delete(v);
    cache.set(v, d);
    cache.size > CACHE_LIMIT && cache.delete(cache.keys().next().value);
  }

  // Create one shared style element for desktop pseudo-content and mobile spans.
  function ensureStyleElement() {
    if (styleElement && document.contains(styleElement)) return;

    styleElement = document.createElement("style");
    styleElement.id = "return-youtube-dislike-style";
    (document.head || document.documentElement).appendChild(styleElement);
    refreshStyles();
  }

  function refreshStyles() {
    styleElement && (styleElement.textContent = BASE_STYLE + "\n" + desktopCss);
  }

  // Remove presentation left behind by a previous renderer or video.
  function clearDesktop() {
    desktopCss = "";

    if (desktopRoot) {
      desktopRoot.removeAttribute("data-return-youtube-dislike");
      desktopRoot = null;
    }

    refreshStyles();
  }

  function clearInjectedCounts() {
    document
      .querySelectorAll(
        ".return-youtube-dislike-count,.return-youtube-like-count",
      )
      .forEach((e) => e.remove());

    document
      .querySelectorAll(
        ".return-youtube-dislike-button,.return-youtube-like-button",
      )
      .forEach((e) =>
        e.classList.remove(
          "return-youtube-dislike-button",
          "return-youtube-like-button",
        ),
      );
  }

  function clearPresentation() {
    clearDesktop();
    clearInjectedCounts();
  }

  // Request, observer, and timer cleanup used during YouTube SPA navigation.
  function abortRequest() {
    if (requestController) {
      requestController.abort();
      requestController = null;
    }
    requestVideoId = "";
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (observerExpiry) {
      clearTimeout(observerExpiry);
      observerExpiry = 0;
    }

    observerScope = null;
    observerMode = "";
  }

  function cancelScheduledUpdate() {
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = 0;
      updateDueAt = Infinity;
    }
  }

  function resetForNavigation() {
    cancelScheduledUpdate();
    abortRequest();
    stopObserver();
    clearPresentation();
    currentVideoId = "";
    currentDislikes = null;
    currentLikes = null;
  }

  // Debounce render work while preserving the earliest already-scheduled run.
  function scheduleUpdate(d = 0) {
    const n = performance.now() + d;
    if (updateTimer && n >= updateDueAt) return;

    updateTimer && clearTimeout(updateTimer);
    updateDueAt = n;
    updateTimer = setTimeout(
      () => {
        updateTimer = 0;
        updateDueAt = Infinity;
        updatePage();
      },
      Math.max(0, n - performance.now()),
    );
  }

  // Fetch vote data once per video. Desktop retains its original dislike-only
  // path; the mobile site also stores likes for YouTube's missing like counter.
  async function fetchDislikes(v) {
    const c = getCached(v);
    if (c !== undefined) return c;

    abortRequest();

    const a = new AbortController();
    requestController = a;
    requestVideoId = v;

    try {
      const r = await fetch(API_URL + encodeURIComponent(v), {
        signal: a.signal,
        credentials: "omit",
      });
      if (!r.ok) return null;

      const j = await r.json(),
        d = Number(j && j.dislikes);
      if (!Number.isFinite(d) || d < 0) return null;

      if (!IS_MOBILE_SITE) {
        putCached(v, d);
        return d;
      }

      const l = Number(j && j.likes),
        data = {
          dislikes: d,
          likes: Number.isFinite(l) && l >= 0 ? l : null,
        };

      putCached(v, data);
      return data;
    } catch {
      return null;
    } finally {
      if (requestController === a) {
        requestController = null;
        requestVideoId = "";
      }
    }
  }

  // Locate the watch renderer that belongs to the current video, tolerating the
  // temporarily empty video-id seen during navigation.
  function findDesktopRoot(v) {
    const roots = document.querySelectorAll("ytd-watch-flexy");
    let first = null,
      empty = null;

    for (const r of roots) {
      first || (first = r);
      const i = r.getAttribute("video-id");
      if (i === v) return r;
      !empty && !i && (empty = r);
    }

    return empty || first;
  }

  // Desktop behavior remains CSS-only: append the dislike count via ::after.
  function renderDesktop(d, r) {
    const b = findFirst(r, DESKTOP_BUTTON_SELECTORS);
    if (!b) return null;

    clearInjectedCounts();

    if (desktopRoot && desktopRoot !== r)
      desktopRoot.removeAttribute("data-return-youtube-dislike");

    desktopRoot = r;
    desktopRoot.setAttribute("data-return-youtube-dislike", "active");

    const t = " " + formatCount(d);
    desktopCss = `ytd-watch-flexy[data-return-youtube-dislike="active"] dislike-button-view-model button::after,ytd-watch-flexy[data-return-youtube-dislike="active"] dislike-button-view-model button-view-model>button::after,ytd-watch-flexy[data-return-youtube-dislike="active"] dislike-button-view-model .yt-spec-button-shape-next::after,ytd-watch-flexy[data-return-youtube-dislike="active"] #segmented-dislike-button button::after{content:${JSON.stringify(t)};margin-left:8px;font-weight:500;color:var(--yt-spec-text-primary,currentColor);white-space:nowrap}`;

    ensureStyleElement();
    refreshStyles();

    return { mode: "desktop", scope: r };
  }

  // Insert or update a mobile count span, copying YouTube's native text styling
  // when a suitable reference element exists.
  function ensureMobileCount(b, type, value, v, reference) {
    const countClass = `return-youtube-${type}-count`,
      buttonClass = `return-youtube-${type}-button`;
    let c = b.querySelector(`.${countClass}`);

    if (!c) {
      c = document.createElement("span");
      c.className = countClass;

      if (reference) {
        reference.classList.forEach((x) => c.classList.add(x));
        const s = getComputedStyle(reference);
        c.style.fontSize = s.fontSize;
        c.style.fontWeight = s.fontWeight;
        c.style.lineHeight = s.lineHeight;
        c.style.color = s.color;

        s.marginLeft &&
          s.marginLeft !== "0px" &&
          (c.style.marginLeft = s.marginLeft);
      } else {
        c.style.fontSize = "14px";
        c.style.fontWeight = "500";
        c.style.lineHeight = "36px";
        c.style.color = "currentColor";
      }

      b.classList.add(buttonClass);
      b.insertBefore(c, b.children[1] || null);
    }

    c.textContent = formatCount(value);
    c.dataset.videoId = v;
    return c;
  }

  // Add the mobile dislike count and add a like count only when YouTube has not
  // rendered a native numeric like count of its own.
  function renderMobile(d, l, v) {
    const r = document.querySelector("ytm-watch") || document,
      b = findFirst(r, MOBILE_BUTTON_SELECTORS),
      likeButton = findFirst(r, MOBILE_LIKE_BUTTON_SELECTORS);

    if (!b) return null;

    clearDesktop();
    ensureStyleElement();

    const dislikeCount = ensureMobileCount(
      b,
      "dislike",
      d,
      v,
      findFirst(r, LIKE_TEXT_SELECTORS),
    );

    const injectedLikeCount =
        likeButton && likeButton.querySelector(".return-youtube-like-count"),
      nativeLikeCount =
        likeButton &&
        [...likeButton.querySelectorAll("span")].some(
          (e) =>
            !e.classList.contains("return-youtube-like-count") &&
            /\d/.test(e.textContent),
        );

    l !== null &&
      likeButton &&
      (injectedLikeCount || !nativeLikeCount) &&
      ensureMobileCount(likeButton, "like", l, v, dislikeCount);

    return {
      mode: "mobile",
      scope:
        b.closest("ytm-watch") ||
        b.closest("ytm-slim-video-action-bar-renderer") ||
        b.closest("ytm-segmented-like-dislike-button-renderer") ||
        b.parentElement ||
        document.body,
    };
  }

  // Shorts already provides a count node, so replace its text directly.
  function renderShorts(d) {
    clearDesktop();
    clearInjectedCounts();

    const r = findFirst(document, SHORTS_ROOT_SELECTORS),
      c = findFirst(r || document, SHORTS_COUNT_SELECTORS);
    if (!c) return null;

    const t = formatCount(d);
    c.textContent.trim() !== t && (c.textContent = t);

    return {
      mode: "shorts",
      scope: r || c.closest("reel-action-bar-view-model") || document.body,
    };
  }

  // Watch the rendered control because YouTube may rebuild it after insertion.
  function watchRenderedUi(x) {
    const { mode: m, scope: s } = x;
    if (!s) return;
    if (observer && observerScope === s && observerMode === m) return;

    stopObserver();

    observer = new MutationObserver(() => {
      if (getVideoId() !== currentVideoId) {
        scheduleUpdate(0);
        return;
      }
      scheduleUpdate(m === "desktop" ? 80 : 50);
    });

    observerScope = s;
    observerMode = m;

    m === "desktop"
      ? observer.observe(s, {
          attributes: true,
          attributeFilter: ["video-id"],
        })
      : observer.observe(s, {
          childList: true,
          subtree: true,
          characterData: m === "shorts",
        });
  }

  // If the target controls do not exist yet, observe the page briefly and retry.
  function waitForUi() {
    if (observer && observerMode === "wait") return;

    stopObserver();

    const r = document.documentElement;
    if (!r) {
      scheduleUpdate(50);
      return;
    }

    observer = new MutationObserver(() => scheduleUpdate(80));
    observerScope = r;
    observerMode = "wait";
    observer.observe(r, { childList: true, subtree: true });

    observerExpiry = setTimeout(() => {
      observerMode === "wait" && stopObserver();
    }, UI_WAIT_LIMIT);
  }

  // Select the renderer appropriate to desktop, mobile watch pages, or Shorts.
  function renderCurrent() {
    if (
      !currentVideoId ||
      currentDislikes === null ||
      getVideoId() !== currentVideoId
    )
      return;

    let r;

    if (isShortsPage()) {
      r = renderShorts(currentDislikes);
    } else {
      const d = findDesktopRoot(currentVideoId);
      r = d
        ? renderDesktop(currentDislikes, d)
        : renderMobile(currentDislikes, currentLikes, currentVideoId);
    }

    r ? watchRenderedUi(r) : waitForUi();
  }

  // Synchronize state with the URL, fetch missing vote data, and render only if
  // the response still belongs to the current video.
  async function updatePage() {
    const v = getVideoId();

    if (!v) {
      currentVideoId && resetForNavigation();
      return;
    }

    if (v !== currentVideoId) {
      abortRequest();
      stopObserver();
      clearPresentation();
      currentVideoId = v;
      currentDislikes = null;
      currentLikes = null;
    }

    if (currentDislikes !== null) {
      renderCurrent();
      return;
    }

    if (requestController && requestVideoId === v) return;

    const data = await fetchDislikes(v);
    if (data === null || currentVideoId !== v || getVideoId() !== v) return;

    if (IS_MOBILE_SITE) {
      currentDislikes = data.dislikes;
      currentLikes = data.likes;
    } else {
      currentDislikes = data;
    }

    renderCurrent();
  }

  // YouTube is a single-page app, so listen to both desktop and mobile navigation
  // events in addition to normal browser lifecycle/media events.
  function onNavigationStart() {
    resetForNavigation();
  }

  function onNavigationFinish() {
    scheduleUpdate(80);
  }

  function onHistoryNavigation() {
    resetForNavigation();
    scheduleUpdate(80);
  }

  const passiveCapture = { capture: true, passive: true };

  document.addEventListener(
    "DOMContentLoaded",
    () => scheduleUpdate(0),
    passiveCapture,
  );
  window.addEventListener("load", () => scheduleUpdate(0), passiveCapture);
  window.addEventListener("pageshow", () => scheduleUpdate(50), passiveCapture);
  window.addEventListener("pagehide", resetForNavigation, passiveCapture);
  document.addEventListener(
    "yt-navigate-start",
    onNavigationStart,
    passiveCapture,
  );
  document.addEventListener(
    "yt-navigate-finish",
    onNavigationFinish,
    passiveCapture,
  );
  document.addEventListener(
    "ytm-navigate-start",
    onNavigationStart,
    passiveCapture,
  );
  document.addEventListener(
    "ytm-navigate-finish",
    onNavigationFinish,
    passiveCapture,
  );
  document.addEventListener(
    "yt-page-data-updated",
    () => scheduleUpdate(100),
    passiveCapture,
  );
  document.addEventListener(
    "spfdone",
    () => scheduleUpdate(100),
    passiveCapture,
  );
  document.addEventListener("loadedmetadata", () => scheduleUpdate(20), true);
  document.addEventListener("loadeddata", () => scheduleUpdate(20), true);
  document.addEventListener("play", () => scheduleUpdate(0), true);
  window.addEventListener("popstate", onHistoryNavigation, passiveCapture);
  document.addEventListener("visibilitychange", () => {
    document.hidden || scheduleUpdate(0);
  });

  scheduleUpdate(0);
})();
