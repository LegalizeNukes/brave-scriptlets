// ==UserScript==
// @name         SponsorBlock YouTube
// @match        https://*.youtube.com/*
// ==/UserScript==
(function () {
  "use strict";
  const C = [
      "sponsor",
      "selfpromo",
      "interaction",
      "intro",
      "outro",
      "preview",
      "music_offtopic",
      "exclusive_access",
    ],
    A = ["skip"],
    T = 0.2,
    E = "https://sponsor.ajay.app",
    TRACK = true;
  let v = null,
    id = null,
    segs = [],
    ctrl = null,
    mo = null,
    armed = false; // Get the active YouTube watch video ID; Shorts are intentionally skipped here.
  function VID() {
    const u = new URL(location.href);
    if (u.pathname.startsWith("/shorts/")) return null;
    return u.searchParams.get("v");
  } // Clean up listeners, pending requests, observers, and script state.
  function stop() {
    if (v) v.removeEventListener("timeupdate", tick);
    v = null;
    id = null;
    segs = [];
    armed = false;
    if (ctrl) {
      ctrl.abort();
      ctrl = null;
    }
    if (mo) {
      mo.disconnect();
      mo = null;
    }
  } // Report a skipped SponsorBlock segment as viewed when tracking is enabled.
  function track(uuid) {
    if (!TRACK || !uuid) return;
    try {
      navigator.sendBeacon
        ? navigator.sendBeacon(`${E}/api/viewedVideoSponsorTime?UUID=${encodeURIComponent(uuid)}`)
        : fetch(`${E}/api/viewedVideoSponsorTime?UUID=${encodeURIComponent(uuid)}`, {
            method: "POST",
            keepalive: true,
          }).catch(() => {});
    } catch {}
  } // Sort and combine overlapping or near-adjacent skip segments.
  function merge(a) {
    a.sort((x, y) => x.start - y.start);
    const out = [];
    for (const s of a) {
      const p = out[out.length - 1];
      if (p && s.start <= p.end + 0.25) {
        if (s.end > p.end) {
          p.end = s.end;
          p.uuid = s.uuid || p.uuid;
        }
      } else out.push(s);
    }
    return out;
  } // Fetch SponsorBlock skip segments for the current video ID.
  async function load(x) {
    if (ctrl) ctrl.abort();
    const c = new AbortController();
    ctrl = c;
    try {
      const r = await fetch(
        `${E}/api/skipSegments?videoID=${encodeURIComponent(x)}&categories=${encodeURIComponent(JSON.stringify(C))}&actionTypes=${encodeURIComponent(JSON.stringify(A))}`,
        { signal: c.signal },
      );
      if (!r.ok || id !== x) return;
      const j = await r.json();
      if (!Array.isArray(j) || id !== x) return;
      segs = merge(
        j
          .filter((s) => s && s.actionType === "skip" && s.segment)
          .map((s) => ({ start: +s.segment[0], end: +s.segment[1], uuid: s.UUID }))
          .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start),
      );
      tick();
    } catch {
    } finally {
      if (ctrl === c) ctrl = null;
    }
  } // Check playback time and skip when it enters a matching segment.
  function tick() {
    if (!v || !segs.length || VID() !== id) return;
    const t = v.currentTime;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (t >= s.start - T && t < s.end + 0.5) {
        v.currentTime = s.end;
        track(s.uuid);
        segs.splice(i, 1);
        return;
      }
      if (s.start > t + T) break;
    }
  } // Attach playback tracking to the current video element.
  function bind(nv, x) {
    if (v && v !== nv) v.removeEventListener("timeupdate", tick);
    v = nv;
    id = x;
    segs = [];
    v.addEventListener("timeupdate", tick, { passive: true });
    load(x);
  } // Find the current video and initialize segment loading.
  function setup() {
    const x = VID();
    if (!x) {
      stop();
      return;
    }
    const nv = document.querySelector("video");
    if (!nv) {
      watch();
      return;
    }
    if (id === x && v === nv) return;
    bind(nv, x);
  } // Wait for YouTube to add a video element to the page.
  function watch() {
    if (mo) return;
    mo = new MutationObserver(() => {
      const x = VID(),
        nv = document.querySelector("video");
      if (x && nv) {
        mo.disconnect();
        mo = null;
        setup();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } // Debounce setup work across navigation and lifecycle events.
  function q(d) {
    if (armed) return;
    armed = true;
    setTimeout(() => {
      armed = false;
      setup();
    }, d || 0);
  }
  const opt = { capture: true, passive: true };
  document.addEventListener("DOMContentLoaded", () => q(0), opt);
  window.addEventListener("load", () => q(0), opt);
  window.addEventListener("pageshow", () => q(80), opt);
  document.addEventListener("yt-navigate-start", stop, opt);
  document.addEventListener("yt-navigate-finish", () => q(120), opt);
  document.addEventListener("yt-page-data-updated", () => q(150), opt);
  let href = location.href;
  setInterval(() => {
    if (location.href !== href) {
      href = location.href;
      stop();
      q(120);
    }
  }, 5000);
  q(0);
})();
