// ==UserScript==
// @name         Return Dislikes YouTube
// @match        https://*.youtube.com/*
// ==/UserScript==
// -----------------------------------------------------------------------------
// Return Dislikes YouTube
// -----------------------------------------------------------------------------
// Fetches dislike counts from the Return YouTube Dislike API and injects them
// into YouTube watch pages and Shorts.
//
// Comment/formatting pass only: the userscript metadata above is preserved
// exactly as provided.

(function () {
  "use strict";
  const A = "https://returnyoutubedislikeapi.com/votes?videoId=",
    nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }),
    F = (n) => nf.format(n);
  let S = null,
    L = "",
    V0 = null,
    AF = null,
    sch = false,
    so = null,
    fo = null;
  const cache = new Map(),
    CL = 100,
    HS = [
      "dislike-button-view-model.ytDislikeButtonViewModelHost",
      "dislike-button-view-model",
      "#segmented-dislike-button",
    ],
    BS = [
      "toggle-button-view-model button-view-model>button",
      "toggle-button-view-model button",
      "button-view-model>button",
      ".ytSpecButtonViewModelHost button",
      ".yt-spec-button-shape-next",
      'button[aria-label^="Dislike"]',
      "button",
    ],
    RS = [
      "dislike-button-view-model button",
      "dislike-button-view-model toggle-button-view-model button-view-model>button",
      "dislike-button-view-model toggle-button-view-model button",
      "dislike-button-view-model button-view-model>button",
      "dislike-button-view-model .ytSpecButtonViewModelHost button",
      "dislike-button-view-model .yt-spec-button-shape-next",
      "#segmented-dislike-button button",
      'button[aria-label^="Dislike"]',
    ]; // Extract the current YouTube video ID from URL or page metadata.
  function V() {
    const u = new URL(location.href);
    if (u.pathname.startsWith("/shorts/")) return u.pathname.slice(8).split("/")[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = document.querySelector('meta[itemprop="videoId"],meta[itemprop="identifier"]');
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
  } // Create or return the style element used for injected CSS.
  function ES() {
    if (!S) {
      S = document.createElement("style");
      S.id = "return-ytd-style";
      (document.head || document.documentElement).appendChild(S);
    }
    return S;
  } // Clear injected CSS content.
  function CW() {
    L = "";
    if (S) S.textContent = "";
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
  } // Reset injected UI state and observers.
  function RR() {
    CW();
    CS();
  } // Fully reset UI state and pending network work.
  function RN() {
    RR();
    AB();
  } // Store API data in the bounded cache.
  function PC(v, d) {
    if (cache.has(v)) cache.delete(v);
    cache.set(v, d);
    if (cache.size > CL) cache.delete(cache.keys().next().value);
  } // Find the dislike button within the supplied YouTube root element.
  function FB(r) {
    let h = null;
    for (const s of HS) {
      h = r.querySelector(s);
      if (h) break;
    }
    if (h)
      for (const s of BS) {
        const b = h.querySelector(s);
        if (b) return b;
      }
    for (const s of RS) {
      const b = r.querySelector(s);
      if (b) return b;
    }
    return null;
  } // Write or inject dislike-count UI on regular watch pages.
  function RW(d, v) {
    const fx =
      document.querySelector("ytd-watch-flexy[video-id]") ||
      document.querySelector("ytd-watch-flexy");
    if (!fx) return false;
    const b = FB(fx);
    if (!b) return false;
    setTimeout(() => {
      if (!document.contains(b) || V() !== v) return;
      const fid = fx.getAttribute("video-id") || v,
        t = F(d).replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
        css = `ytd-watch-flexy[video-id="${fid}"] dislike-button-view-model button::after,ytd-watch-flexy[video-id="${fid}"] dislike-button-view-model button-view-model>button::after,ytd-watch-flexy[video-id="${fid}"] dislike-button-view-model .yt-spec-button-shape-next::after,ytd-watch-flexy[video-id="${fid}"] #segmented-dislike-button button::after{content:" ${t}";margin-left:8px;font-weight:500;color:var(--yt-spec-text-primary,currentColor);}`;
      if (css !== L) {
        ES().textContent = css;
        L = css;
      }
    }, 300);
    return true;
  } // Wait for the watch-page dislike area and then write the count.
  function WW(d, v) {
    const st = performance.now();
    let mo = null,
      tm = null,
      rt = null,
      done = false; // Helper routine: K.
    function K() {
      if (mo) mo.disconnect();
      if (tm) clearTimeout(tm);
      if (rt) clearTimeout(rt);
      mo = tm = rt = null;
    } // Helper routine: I.
    function I() {
      if (done) return;
      if (V() !== v) {
        K();
        return;
      }
      const fx =
        document.querySelector("ytd-watch-flexy[video-id]") ||
        document.querySelector("ytd-watch-flexy");
      if (!fx) {
        if (performance.now() - st < 6e3) rt = setTimeout(I, 80);
        return;
      }
      if (RW(d, v)) {
        done = true;
        K();
        return;
      }
      K();
      mo = new MutationObserver(() => {
        if (V() !== v) {
          K();
          return;
        }
        if (RW(d, v)) {
          done = true;
          K();
        }
      });
      mo.observe(fx, { childList: true, subtree: true });
      tm = setTimeout(K, 6e3);
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
        'ytd-reel-video-renderer[is-active-reel="true"],ytd-reel-video-renderer[tab-identifier="shorts"],ytd-reel-video-renderer,ytm-reel-player-overlay-renderer',
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
    RR();
    const d = await GD(v);
    if (d == null || V() !== v) return;
    if (Q()) {
      CW();
      RH(d, v);
    } else {
      CS();
      WW(d, v);
    }
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
  let href = location.href;
  setInterval(() => {
    if (location.href !== href) {
      href = location.href;
      RN();
      fq(120);
    }
  }, 5000); // Helper routine: WF.
  function WF() {
    const fx = document.querySelector("ytd-watch-flexy");
    if (!fx) return;
    if (fo) fo.disconnect();
    fo = new MutationObserver((m) => {
      for (const x of m)
        if (x.type === "attributes" && x.attributeName === "video-id") {
          RN();
          fq(80);
          break;
        }
    });
    fo.observe(fx, { attributes: true, attributeFilter: ["video-id"] });
  }
  window.addEventListener("load", WF, opt);
  document.addEventListener("yt-navigate-finish", WF, opt);
  WF();
  q(0);
})();
