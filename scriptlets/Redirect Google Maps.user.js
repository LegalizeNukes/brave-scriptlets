// ==UserScript==
// @name         Redirect Google Maps
// @match        https://*.google.com/maps*
// ==/UserScript==

(() => {
    "use strict";

    // -------------------------------------------------------------------------
    // Coordinate patterns found in Google Maps URLs.
    // Priority:
    //   1. !3dLAT!4dLON  (actual place coordinates)
    //   2. @LAT,LON      (viewport center)
    //   3. q= / ll=      (query coordinates)
    // -------------------------------------------------------------------------

    const RE_AT    = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
    const RE_Q_LL  = /[?&](?:q|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
    const RE_3D4D  = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;

    let done = false;
    let observer = null;
    let interval = null;

    // -------------------------------------------------------------------------
    // Validate parsed coordinates.
    // Reject Google's temporary 0,0 placeholder.
    // -------------------------------------------------------------------------

    const isValid = (lat, lon) =>
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        !(lat === 0 && lon === 0) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180;

    const makeCoord = (lat, lon) => {
        lat = +lat;
        lon = +lon;
        return isValid(lat, lon) ? { lat, lon } : null;
    };

    // -------------------------------------------------------------------------
    // Extract coordinates from the current Google Maps URL.
    // -------------------------------------------------------------------------

    const parseCoords = href => {
        const match =
            RE_3D4D.exec(href) ||
            RE_AT.exec(href) ||
            RE_Q_LL.exec(href);

        return match ? makeCoord(match[1], match[2]) : null;
    };

    // -------------------------------------------------------------------------
    // Extract the place name from:
    // /maps/place/PLACE_NAME,...
    //
    // Only keep the business/location name itself.
    // -------------------------------------------------------------------------

    const placeNameFrom = href => {
        const match = /\/maps\/place\/([^/@?]+)/.exec(href);
        if (!match) return null;

        const name = decodeURIComponent(
            match[1].replace(/\+/g, " ")
        ).trim();

        return name.split(",")[0].trim() || null;
    };

    // -------------------------------------------------------------------------
    // Build Apple Maps URL.
    //
    // If a place name exists:
    //   - exact coordinates determine the location
    //   - place name becomes the pin title
    //
    // Otherwise:
    //   - coordinates are used for both.
    // -------------------------------------------------------------------------

    const appleUrlFor = (lat, lon) => {
        const ll = `${lat},${lon}`;
        const name = placeNameFrom(location.href) || ll;

        return `maps://?ll=${encodeURIComponent(ll)}&q=${encodeURIComponent(name)}`;
    };

    // -------------------------------------------------------------------------
    // Save original History API methods.
    // Google Maps updates the URL without reloading the page.
    // -------------------------------------------------------------------------

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const onUrlChange = () => queueMicrotask(tryRedirect);

    // -------------------------------------------------------------------------
    // Cleanup.
    // -------------------------------------------------------------------------

    const stop = () => {
        done = true;

        try {
            window.removeEventListener("popstate", onUrlChange);
            window.removeEventListener("hashchange", onUrlChange);
        } catch {}

        try {
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
        } catch {}

        try {
            observer?.disconnect();
        } catch {}

        try {
            clearInterval(interval);
        } catch {}

        observer = null;
        interval = null;
    };

    // -------------------------------------------------------------------------
    // Attempt redirect once valid coordinates become available.
    // -------------------------------------------------------------------------

    const tryRedirect = () => {
        if (done) return;

        const coords = parseCoords(location.href);
        if (!coords) return;

        stop();
        location.replace(appleUrlFor(coords.lat, coords.lon));
    };

    // -------------------------------------------------------------------------
    // Watch History API navigation.
    // -------------------------------------------------------------------------

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        onUrlChange();
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        onUrlChange();
        return result;
    };

    window.addEventListener("popstate", onUrlChange, { passive: true });
    window.addEventListener("hashchange", onUrlChange, { passive: true });

    // Initial check.
    tryRedirect();

    // Poll periodically in case Google updates the URL asynchronously.
    interval = setInterval(tryRedirect, 500);

    // Watch for DOM changes that often accompany URL updates.
    observer = new MutationObserver(tryRedirect);

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Safety cleanup after two minutes if no redirect occurred.
    setTimeout(stop, 120000);

})();