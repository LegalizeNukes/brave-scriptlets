// ==UserScript==
// @name         DeArrow Titles YouTube
// @match        https://*.youtube.com/*
// ==/UserScript==
(() => {
  "use strict";
  const API = "https://sponsor.ajay.app",
    SEL = 'a[href*="/watch?v="],a[href^="/shorts/"],a[href*="/embed/"]',
    MAX = 600,
    RI = 1e4,
    C = new Map(),
    P = new Map(),
    S = new WeakMap(),
    E = new TextEncoder(),
    R = new Set();
  let ft = 0,
    fd = Infinity,
    wt = 0,
    wd = Infinity,
    mt = 0,
    mrt = 0,
    rt = 0,
    ng = 0,
    mo = null,
    to = null,
    te = null,
    ho = null,
    he = null;
  function V(x) {
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
  async function H(s) {
    const b = await crypto.subtle.digest("SHA-256", E.encode(s));
    let h = "";
    for (const x of new Uint8Array(b)) h += x.toString(16).padStart(2, "0");
    return h;
  }
  function K(t) {
    return (t || "").replace(/‹/g, "<").replace(/\s+/g, " ").trim();
  }
  function GC(v) {
    if (!C.has(v)) return;
    const t = C.get(v);
    C.delete(v);
    C.set(v, t);
    return t;
  }
  function PC(v, t) {
    C.has(v) && C.delete(v);
    C.set(v, t);
    C.size > MAX && C.delete(C.keys().next().value);
  }
  async function G(v) {
    if (!v) return null;
    const c = GC(v);
    if (c !== undefined) return c;
    if (P.has(v)) return P.get(v);
    const p = (async () => {
      try {
        const h = (await H(v)).slice(0, 4),
          r = await fetch(`${API}/api/branding/${h}?fetchAll=true`, {
            credentials: "omit",
          });
        if (!r.ok) return null;
        const j = await r.json(),
          x = j && j[v];
        if (!x || !Array.isArray(x.titles)) return null;
        const b = x.titles.find(
            (t) =>
              t &&
              t.title &&
              t.original !== true &&
              (t.locked || Number(t.votes) >= 0),
          ),
          o = b ? K(b.title) : null;
        return (o && PC(v, o), o);
      } catch {
        return null;
      } finally {
        P.delete(v);
      }
    })();
    P.set(v, p);
    return p;
  }
  function IT(e) {
    return !!e.closest?.(
      "ytd-thumbnail,ytm-thumbnail,yt-thumbnail-view-model,a#thumbnail,a.ytd-thumbnail,.thumbnail,.yt-thumbnail-view-model,.media-item-thumbnail-container,.compact-media-item-image,ytm-thumbnail-overlay-time-status-renderer",
    );
  }
  function HV(e) {
    return !!e.querySelector?.(
      "img,picture,image,svg,ytd-thumbnail,ytm-thumbnail,yt-thumbnail-view-model,video,canvas",
    );
  }
  function VI(e) {
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
  function BT(t) {
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
  function TT(a) {
    if (!a || IT(a) || HV(a) || !VI(a)) return null;
    let b = null,
      s = 0;
    const w = document.createTreeWalker(a, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (!(n instanceof Element) || IT(n) || HV(n) || !VI(n))
          return NodeFilter.FILTER_REJECT;
        return BT((n.textContent || "").trim())
          ? NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = w.currentNode; n; n = w.nextNode()) {
      const t = (n.textContent || "").trim();
      if (BT(t)) continue;
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
  function M(a, t) {
    if (!a || !t || IT(a)) return;
    a.title !== undefined && a.title !== t && (a.title = t);
    a.ariaLabel !== undefined && a.ariaLabel !== t && (a.ariaLabel = t);
    a.getAttribute?.("aria-label") &&
      a.getAttribute("aria-label") !== t &&
      a.setAttribute("aria-label", t);
  }
  function AL(a, v, t) {
    if (!a.isConnected || V(a.href) !== v || IT(a) || HV(a)) return;
    const g = TT(a);
    if (!g) return;
    (g.textContent || "").trim() !== t && (g.textContent = t);
    M(a, t);
    S.set(a, { videoId: v, title: t });
  }
  async function PL(a) {
    if (!(a instanceof HTMLAnchorElement)) return;
    const v = V(a.href);
    if (!v || IT(a) || HV(a)) return;
    const p = S.get(a);
    if (p && p.videoId === v && p.title) {
      AL(a, v, p.title);
      return;
    }
    const t = await G(v);
    t && AL(a, v, t);
  }
  function LH(e) {
    if (!VI(e) || IT(e) || HV(e)) return false;
    const t = (e.textContent || "").trim();
    if (BT(t)) return false;
    const r = e.getBoundingClientRect();
    return r.top >= 0 && r.top < innerHeight * 0.75;
  }
  function TL(e) {
    return (
      e.querySelector?.("yt-formatted-string,.yt-core-attributed-string") || e
    );
  }
  function OH(e) {
    if (!e || e === he) return;
    ho && ho.disconnect();
    he = e;
    ho = new MutationObserver(() => SW(0));
    ho.observe(e, { childList: true, subtree: true, characterData: true });
  }
  async function PW() {
    const g = ng,
      v = V(location.href);
    if (!v) return;
    const t = await G(v);
    if (!t || g !== ng || V(location.href) !== v) return;
    const d = `${t} - YouTube`;
    document.title !== d && (document.title = d);
    let b = null,
      s = 0;
    document.querySelectorAll("h1,h2").forEach((e) => {
      if (!LH(e)) return;
      let q =
          (e.textContent || "").trim().length + (e.tagName === "H1" ? 100 : 50),
        r = e.getBoundingClientRect();
      q += Math.max(0, 300 - r.top);
      if (q > s) {
        s = q;
        b = e;
      }
    });
    if (b) {
      const e = TL(b);
      if (!e?.isConnected || g !== ng || V(location.href) !== v) return;
      OH(b);
      (e.textContent || "").trim() !== t && (e.textContent = t);
    }
  }
  function SL(r = document) {
    r instanceof HTMLAnchorElement && r.matches(SEL) && PL(r);
    r.querySelectorAll?.(SEL).forEach(PL);
  }
  function SC(r = document) {
    SL(r);
    SW(0);
  }
  function SF(d = 250) {
    const n = performance.now() + d;
    if (ft && n >= fd) return;
    ft && clearTimeout(ft);
    fd = n;
    ft = setTimeout(
      () => {
        ft = 0;
        fd = Infinity;
        SC();
      },
      Math.max(0, n - performance.now()),
    );
  }
  function SW(d = 0) {
    const n = performance.now() + d;
    if (wt && n >= wd) return;
    wt && clearTimeout(wt);
    wd = n;
    wt = setTimeout(
      () => {
        wt = 0;
        wd = Infinity;
        PW();
      },
      Math.max(0, n - performance.now()),
    );
  }
  function QR(r) {
    if (!(r instanceof Element)) return;
    R.add(r);
    if (!mt) mt = setTimeout(FR, 50);
  }
  function FR() {
    mt = 0;
    const a = [...R];
    R.clear();
    const m = [];
    for (const r of a) {
      if (!r.isConnected) continue;
      if (m.some((p) => p.contains(r))) continue;
      for (let i = m.length - 1; i >= 0; i--)
        r.contains(m[i]) && m.splice(i, 1);
      m.push(r);
    }
    for (const r of m) SL(r);
    SW(0);
  }
  function OT() {
    const e = document.querySelector("title");
    if (!e || e === te) return;
    to && to.disconnect();
    te = e;
    to = new MutationObserver(() => SW(0));
    to.observe(e, { childList: true, subtree: true, characterData: true });
  }
  function SR() {
    clearTimeout(mrt);
    mrt = setTimeout(() => {
      mrt = 0;
      SF(0);
    }, 700);
  }
  function HM(ms) {
    let tc = false;
    for (const m of ms) {
      if (m.type === "attributes" && m.target instanceof HTMLAnchorElement) {
        QR(m.target);
        continue;
      }
      for (const n of m.addedNodes)
        if (n instanceof Element) {
          QR(n);
          (n.tagName === "TITLE" || n.querySelector?.("title")) && (tc = true);
        }
    }
    tc && OT();
    SR();
  }
  function NAV(d = 350) {
    SF(d);
    SW(d);
  }
  function NS() {
    ng++;
    ho && ho.disconnect();
    ho = null;
    he = null;
  }
  function RL() {
    clearTimeout(rt);
    rt = setTimeout(() => {
      document.hidden || SF(0);
      RL();
    }, RI);
  }
  function START() {
    const r = document.documentElement;
    if (!r) {
      setTimeout(START, 0);
      return;
    }
    mo = new MutationObserver(HM);
    mo.observe(r, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    OT();
    const o = { capture: true, passive: true };
    document.addEventListener(
      "yt-navigate-start",
      () => {
        NS();
        NAV(100);
      },
      o,
    );
    document.addEventListener("yt-navigate-finish", () => NAV(350), o);
    document.addEventListener(
      "ytm-navigate-start",
      () => {
        NS();
        NAV(100);
      },
      o,
    );
    document.addEventListener("ytm-navigate-finish", () => NAV(350), o);
    document.addEventListener("yt-page-data-updated", () => NAV(350), o);
    document.addEventListener("spfdone", () => NAV(350), o);
    window.addEventListener(
      "popstate",
      () => {
        NS();
        NAV(350);
      },
      o,
    );
    window.addEventListener(
      "pageshow",
      () => {
        NS();
        NAV(80);
      },
      o,
    );
    document.addEventListener("loadedmetadata", () => NAV(80), true);
    document.addEventListener("loadeddata", () => NAV(80), true);
    document.addEventListener("visibilitychange", () => {
      document.hidden || NAV(0);
    });
    SC();
    RL();
  }
  START();
})();
