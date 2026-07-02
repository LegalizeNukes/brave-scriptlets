// ==UserScript==
// @name         Return Dislikes YouTube
// @match        https://*.youtube.com/*
// ==/UserScript==
(function () {
  "use strict";
  const A = "https://returnyoutubedislikeapi.com/votes?videoId=",
    nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }),
    F = (n) => nf.format(n);
  let V0 = null,
    AF = null,
    sch = false,
    so = null,
    cache = new Map(),
    CL = 100; // Extract the current YouTube video ID from URL or page metadata.
  function V() {
    const u = new URL(location.href);
    if (u.pathname.startsWith("/shorts/")) return u.pathname.slice(8).split("/")[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = document.querySelector("meta[itemprop='videoId'],meta[itemprop='identifier']");
    if (m && m.content) return m.content;
    const og = document.querySelector('meta[property="og:video:url"]');
    if (og && og.content) {
      try {
        return new URL(og.content).searchParams.get("v");
      } catch {}
    }
    return null;
  } // Return whether the current page is a Shorts page.
  function Q() {
    return location.pathname.startsWith("/shorts/");
  } // Disconnect the active Shorts/UI observer.
  function CS() {
    if (so) {
      so.disconnect();
      so = null;
    }
  } // Abort the current fetch request, if one is active.
  function AB() {
    if (AF) {
      AF.abort();
      AF = null;
    }
  } // Remove previously injected dislike-count elements.
  function rm() {
    document.querySelectorAll(".return-youtube-dislike-count").forEach((e) => e.remove());
  } // Fully reset UI state and pending network work.
  function RN() {
    CS();
    AB();
    rm();
  } // Store API data in the bounded cache.
  function PC(v, d) {
    if (cache.has(v)) cache.delete(v);
    cache.set(v, d);
    if (cache.size > CL) cache.delete(cache.keys().next().value);
  } // Find the dislike button in available YouTube layouts.
  function DB() {
    return (
      document.querySelector("dislike-button-view-model button") ||
      document.querySelector('button[aria-label*="Dislike" i]') ||
      document.querySelector(
        'ytm-segmented-like-dislike-button-renderer button[aria-label*="Dislike" i]',
      ) ||
      document.querySelector('ytm-like-button-renderer button[aria-label*="Dislike" i]')
    );
  } // Find a nearby like-count text element to copy styling from.
  function LT() {
    const b =
      document.querySelector("like-button-view-model button") ||
      document.querySelector('button[aria-label*="Like" i]') ||
      document.querySelector(
        'ytm-segmented-like-dislike-button-renderer button[aria-label*="Like" i]',
      ) ||
      document.querySelector('ytm-like-button-renderer button[aria-label*="Like" i]');
    return b
      ? b.querySelector("span") ||
          document.querySelector(
            "#segmented-like-button button span,ytm-like-button-renderer #text,ytm-slim-video-action-bar-renderer #text",
          )
      : null;
  } // Write or inject dislike-count UI on regular watch pages.
  function RW(d, v) {
    const st = performance.now(); // Helper routine: I.
    function I() {
      if (V() !== v) return;
      const b = DB();
      if (!b) {
        if (performance.now() - st < 6e3) setTimeout(I, 200);
        return;
      }
      let old = b.querySelector(".return-youtube-dislike-count");
      if (old) old.remove();
      const l = LT(),
        s = document.createElement("span");
      s.className = "return-youtube-dislike-count";
      if (l) {
        l.classList.forEach((c) => s.classList.add(c));
        const cs = getComputedStyle(l);
        s.style.fontSize = cs.fontSize;
        s.style.fontWeight = cs.fontWeight;
        s.style.lineHeight = cs.lineHeight;
        s.style.color = cs.color;
        s.style.marginLeft = cs.marginLeft && cs.marginLeft !== "0px" ? cs.marginLeft : "8px";
      } else {
        s.style.marginLeft = "8px";
        s.style.fontSize = "14px";
        s.style.fontWeight = "500";
        s.style.lineHeight = "36px";
        s.style.color = "currentColor";
      }
      s.textContent = F(d);
      b.style.display = "inline-flex";
      b.style.overflow = "visible";
      b.style.width = "auto";
      b.style.minWidth = "auto";
      if (!b.style.paddingRight) b.style.paddingRight = "8px";
      b.children.length > 0 ? b.insertBefore(s, b.children[1] || null) : b.appendChild(s);
    }
    I();
  } // Update the Shorts dislike count and keep it in sync.
  function RH(d, v) {
    const t = F(d); // Main update routine for the current video.
    function U() {
      if (V() !== v) {
        CS();
        return;
      }
      const a =
        document.querySelector(
          "#button-bar > reel-action-bar-view-model > dislike-button-view-model > toggle-button-view-model > button-view-model > label > div > span",
        ) ||
        document.querySelector(
          'reel-action-bar-view-model dislike-button-view-model label div span[role="text"]',
        );
      if (a && a.textContent.trim() !== t) a.textContent = t;
    }
    U();
    CS();
    const c =
      document.querySelector(
        "ytd-reel-video-renderer[is-active-reel='true'],ytd-reel-video-renderer[tab-identifier='shorts'],ytd-reel-video-renderer,ytm-reel-player-overlay-renderer",
      ) || document.body;
    so = new MutationObserver(U);
    so.observe(c, { childList: true, subtree: true, characterData: true });
  } // Get dislike data from the Return YouTube Dislike API.
  async function GD(v) {
    if (cache.has(v)) return cache.get(v);
    AB();
    const c = new AbortController();
    AF = c;
    try {
      const r = await fetch(A + encodeURIComponent(v), { signal: c.signal });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !("dislikes" in j)) return null;
      PC(v, j.dislikes);
      return j.dislikes;
    } catch {
      return null;
    } finally {
      if (AF === c) AF = null;
    }
  } // Main update routine for the current video.
  async function U() {
    const v = V();
    if (!v || v === V0) return;
    V0 = v;
    if (!Q()) CS();
    rm();
    const d = await GD(v);
    if (d == null || V() !== v) return;
    Q() ? RH(d, v) : RW(d, v);
  } // Debounce setup work across navigation and lifecycle events.
  function q(d) {
    if (sch) return;
    sch = true;
    setTimeout(() => {
      sch = false;
      U();
    }, d || 0);
  } // Force a refresh by clearing the last seen video ID.
  function fq(d) {
    V0 = null;
    q(d || 0);
  }
  const opt = { capture: true, passive: true };
  document.addEventListener("DOMContentLoaded", () => q(0), opt);
  window.addEventListener("load", () => q(0), opt);
  window.addEventListener("pageshow", () => fq(80), opt);
  document.addEventListener("yt-navigate-start", RN, opt);
  document.addEventListener("ytm-navigate-start", RN, opt);
  document.addEventListener("yt-navigate-finish", () => fq(120), opt);
  document.addEventListener("ytm-navigate-finish", () => fq(120), opt);
  document.addEventListener("yt-page-data-updated", () => q(150), opt);
  document.addEventListener("spfdone", () => q(150), opt);
  document.addEventListener("loadedmetadata", () => q(80), opt);
  document.addEventListener("loadeddata", () => q(80), opt);
  let href = location.href;
  setInterval(() => {
    if (location.href !== href) {
      href = location.href;
      RN();
      fq(120);
    }
  }, 5000);
  q(0);
})();
