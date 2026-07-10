// ==UserScript==
// @name         Redirect Google Maps
// @match        https://*.google.com/maps*
// ==/UserScript==
(() => {
    'use strict';

    const RE_AT =
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

    const RE_Q_LL =
        /[?&](?:q|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

    const RE_3D4D =
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;

    const POLL_INTERVAL = 500;
    const MAX_LIFETIME = 120000;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    let done = false;
    let checkQueued = false;
    let intervalId = 0;
    let timeoutId = 0;

    function isValidCoordinate(lat, lon) {
        return (
            Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            !(lat === 0 && lon === 0) &&
            lat >= -90 &&
            lat <= 90 &&
            lon >= -180 &&
            lon <= 180
        );
    }

    function makeCoordinate(latValue, lonValue) {
        const lat = Number(latValue);
        const lon = Number(lonValue);

        return isValidCoordinate(lat, lon)
            ? { lat, lon }
            : null;
    }

    function parseCoordinates(href) {
        const match =
            RE_3D4D.exec(href) ||
            RE_AT.exec(href) ||
            RE_Q_LL.exec(href);

        return match
            ? makeCoordinate(match[1], match[2])
            : null;
    }

    function getPlaceName(href) {
        const match =
            /\/maps\/place\/([^/@?]+)/.exec(href);

        if (!match) {
            return null;
        }

        try {
            const name = decodeURIComponent(
                match[1].replace(/\+/g, ' ')
            ).trim();

            return (
                name.split(',')[0].trim() ||
                null
            );
        } catch (_) {
            return null;
        }
    }

    function buildAppleMapsUrl(href, lat, lon) {
        const coordinates = `${lat},${lon}`;

        const label =
            getPlaceName(href) ||
            coordinates;

        return (
            `maps://?ll=${encodeURIComponent(coordinates)}` +
            `&q=${encodeURIComponent(label)}`
        );
    }

    function stop() {
        if (done) {
            return;
        }

        done = true;
        checkQueued = false;

        window.removeEventListener(
            'popstate',
            scheduleCheck
        );

        window.removeEventListener(
            'hashchange',
            scheduleCheck
        );

        // Restore History methods only if our wrappers are
        // still installed. This avoids overwriting another
        // script that may have wrapped them later.
        try {
            if (
                history.pushState ===
                wrappedPushState
            ) {
                history.pushState =
                    originalPushState;
            }

            if (
                history.replaceState ===
                wrappedReplaceState
            ) {
                history.replaceState =
                    originalReplaceState;
            }
        } catch (_) {}

        if (intervalId) {
            clearInterval(intervalId);
            intervalId = 0;
        }

        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = 0;
        }
    }

    function tryRedirect() {
        if (done) {
            return;
        }

        // Use one URL snapshot for the entire redirect attempt.
        const href = location.href;

        const coordinates =
            parseCoordinates(href);

        if (!coordinates) {
            return;
        }

        const target = buildAppleMapsUrl(
            href,
            coordinates.lat,
            coordinates.lon
        );

        stop();

        location.replace(target);
    }

    function scheduleCheck() {
        if (done || checkQueued) {
            return;
        }

        checkQueued = true;

        // Collapse rapid History API changes into one check.
        queueMicrotask(() => {
            checkQueued = false;
            tryRedirect();
        });
    }

    function wrappedPushState(...args) {
        const result =
            originalPushState.apply(this, args);

        scheduleCheck();

        return result;
    }

    function wrappedReplaceState(...args) {
        const result =
            originalReplaceState.apply(this, args);

        scheduleCheck();

        return result;
    }

    // Watch Google Maps SPA navigation.
    try {
        history.pushState = wrappedPushState;
        history.replaceState = wrappedReplaceState;
    } catch (_) {}

    window.addEventListener(
        'popstate',
        scheduleCheck,
        { passive: true }
    );

    window.addEventListener(
        'hashchange',
        scheduleCheck,
        { passive: true }
    );

    // Check immediately before allocating fallback timers.
    // If this redirects successfully, no timers are created.
    tryRedirect();

    if (!done) {
        // Lightweight fallback for URL changes not caught by
        // History API, popstate, or hashchange events.
        intervalId = setInterval(
            tryRedirect,
            POLL_INTERVAL
        );

        // Preserve the original two-minute monitoring limit.
        timeoutId = setTimeout(
            stop,
            MAX_LIFETIME
        );
    }
})();