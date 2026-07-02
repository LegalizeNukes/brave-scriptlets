// ==UserScript==
// @name         Redirect Google Maps
// @match        https://*.google.com/maps*
// ==/UserScript==
(() => {
  "use strict";
  const MAX_WAIT_MS = 30_000;
  const RE_AT = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
  const RE_Q_LL = /[?&](?:q|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
  const RE_3D4D = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;
  let done = false;
  let mo = null;
  const isValid = (lat, lon) =>
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
  const parseCoords = (href) => {
    let m = RE_AT.exec(href) || RE_Q_LL.exec(href) || RE_3D4D.exec(href);
    if (!m) return null;
    const lat = +m[1],
      lon = +m[2];
    return isValid(lat, lon) ? { lat, lon } : null;
  };
  const appleUrlFor = (lat, lon) => {
    const ll = `${lat},${lon}`;
    return `maps://?ll=${encodeURIComponent(ll)}&q=${encodeURIComponent(ll)}`;
  };
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  const onUrlChange = () => queueMicrotask(tryRedirect);
  const stop = () => {
    done = true;
    try {
      window.removeEventListener("popstate", onUrlChange);
    } catch {}
    try {
      window.removeEventListener("hashchange", onUrlChange);
    } catch {}
    try {
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
    } catch {}
    try {
      mo && mo.disconnect();
    } catch {}
    mo = null;
  };
  const tryRedirect = () => {
    if (done) return;
    const c = parseCoords(location.href);
    if (!c) return;
    stop();
    location.replace(appleUrlFor(c.lat, c.lon));
  };
  history.pushState = function (...args) {
    const ret = origPushState.apply(this, args);
    onUrlChange();
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = origReplaceState.apply(this, args);
    onUrlChange();
    return ret;
  };
  window.addEventListener("popstate", onUrlChange, { passive: true });
  window.addEventListener("hashchange", onUrlChange, { passive: true });
  tryRedirect();
  const start = Date.now();
  mo = new MutationObserver(() => {
    if (done) return;
    if (Date.now() - start > MAX_WAIT_MS) return stop();
    tryRedirect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(stop, MAX_WAIT_MS);
})();
