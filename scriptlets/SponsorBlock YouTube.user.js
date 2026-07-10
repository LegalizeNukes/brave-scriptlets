// ==UserScript==
// @name         SponsorBlock YouTube
// @match        https://youtube.com/*
// @match        https://*.youtube.com/*
// ==/UserScript==
(function () {
    'use strict';

    const API = 'https://sponsor.ajay.app';

    const CATEGORIES = [
        'sponsor',
        'selfpromo',
        'interaction',
        'intro',
        'outro',
        'preview',
        'music_offtopic',
        'exclusive_access'
    ];

    const FILTERS =
        `&categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}` +
        `&actionTypes=${encodeURIComponent('["skip"]')}`;

    const EARLY = 0.2;
    const TRACK_VIEWS = true;

    const VIDEO_SELECTOR =
        '#movie_player video.html5-main-video,' +
        'video.html5-main-video,' +
        '#movie_player video,' +
        'video';

    let video = null;
    let videoId = '';
    let boundHref = '';
    let segments = [];
    let request = null;
    let observer = null;
    let timer = 0;
    let dueAt = Infinity;

    function getVideoId() {
        if (location.pathname.startsWith('/shorts/')) return '';

        return new URLSearchParams(location.search).get('v') || '';
    }

    function cancelRequest() {
        if (!request) return;

        request.abort();
        request = null;
    }

    function disconnectObserver() {
        if (!observer) return;

        observer.disconnect();
        observer = null;
    }

    function clearBinding() {
        if (video) {
            video.removeEventListener('timeupdate', onTimeUpdate);
        }

        video = null;
        videoId = '';
        boundHref = '';
        segments = [];

        cancelRequest();
        disconnectObserver();
    }

    function cancelScheduledSetup() {
        if (!timer) return;

        clearTimeout(timer);
        timer = 0;
        dueAt = Infinity;
    }

    function stop() {
        cancelScheduledSetup();
        clearBinding();
    }

    function scheduleSetup(delay = 0) {
        const target = performance.now() + delay;

        // Keep only the earliest pending setup.
        if (timer && target >= dueAt) return;

        if (timer) {
            clearTimeout(timer);
        }

        dueAt = target;

        timer = setTimeout(() => {
            timer = 0;
            dueAt = Infinity;
            setup();
        }, Math.max(0, target - performance.now()));
    }

    function reportViewed(uuids) {
        if (!TRACK_VIEWS) return;

        for (const uuid of uuids) {
            if (!uuid) continue;

            const url =
                `${API}/api/viewedVideoSponsorTime?UUID=` +
                encodeURIComponent(uuid);

            try {
                if (
                    typeof navigator.sendBeacon === 'function' &&
                    navigator.sendBeacon(url)
                ) {
                    continue;
                }

                fetch(url, {
                    method: 'POST',
                    keepalive: true,
                    credentials: 'omit'
                }).catch(() => {});
            } catch (_) {}
        }
    }

    function normalizeSegments(data) {
        const list = [];

        for (const item of data) {
            if (
                !item ||
                item.actionType !== 'skip' ||
                !Array.isArray(item.segment)
            ) {
                continue;
            }

            const start = Number(item.segment[0]);
            const end = Number(item.segment[1]);

            if (
                !Number.isFinite(start) ||
                !Number.isFinite(end) ||
                end <= start
            ) {
                continue;
            }

            list.push({
                start,
                end,
                uuids: item.UUID ? [item.UUID] : []
            });
        }

        list.sort((a, b) => a.start - b.start);

        // Merge only overlapping segments.
        // Nearby but separate segments remain separate.
        const merged = [];

        for (const segment of list) {
            const previous = merged[merged.length - 1];

            if (previous && segment.start <= previous.end) {
                if (segment.end > previous.end) {
                    previous.end = segment.end;
                }

                if (segment.uuids.length) {
                    previous.uuids.push(...segment.uuids);
                }
            } else {
                merged.push(segment);
            }
        }

        return merged;
    }

    async function loadSegments(id) {
        cancelRequest();

        const controller = new AbortController();
        request = controller;

        try {
            const response = await fetch(
                `${API}/api/skipSegments?videoID=` +
                    `${encodeURIComponent(id)}${FILTERS}`,
                {
                    signal: controller.signal,
                    credentials: 'omit'
                }
            );

            if (!response.ok || videoId !== id) return;

            const data = await response.json();

            if (!Array.isArray(data) || videoId !== id) return;

            segments = normalizeSegments(data);

            onTimeUpdate();
        } catch (_) {
            // Abort, offline state, and API failures stay silent.
        } finally {
            if (request === controller) {
                request = null;
            }
        }
    }

    function onTimeUpdate() {
        if (!video || !segments.length) return;

        // Cheap SPA-navigation fallback.
        // No permanent polling interval is needed.
        if (location.href !== boundHref) {
            scheduleSetup(0);
            return;
        }

        const time = video.currentTime;

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];

            if (segment.start > time + EARLY) {
                break;
            }

            if (
                time >= segment.start - EARLY &&
                time < segment.end
            ) {
                video.currentTime = segment.end;

                reportViewed(segment.uuids);

                segments.splice(i, 1);

                return;
            }
        }
    }

    function bind(nextVideo, id) {
        clearBinding();

        video = nextVideo;
        videoId = id;
        boundHref = location.href;

        video.addEventListener(
            'timeupdate',
            onTimeUpdate,
            { passive: true }
        );

        loadSegments(id);
    }

    function watchForVideo() {
        if (observer) return;

        const root = document.documentElement;

        if (!root) {
            scheduleSetup(20);
            return;
        }

        observer = new MutationObserver(() => {
            if (
                !getVideoId() ||
                !document.querySelector(VIDEO_SELECTOR)
            ) {
                return;
            }

            disconnectObserver();
            scheduleSetup(0);
        });

        observer.observe(root, {
            childList: true,
            subtree: true
        });
    }

    function setup() {
        const id = getVideoId();

        if (!id) {
            clearBinding();
            return;
        }

        const nextVideo =
            document.querySelector(VIDEO_SELECTOR);

        if (!nextVideo) {
            if (video || videoId !== id) {
                clearBinding();
            }

            watchForVideo();
            return;
        }

        if (video === nextVideo && videoId === id) {
            // Synchronize URL state without rebinding.
            boundHref = location.href;

            disconnectObserver();

            return;
        }

        bind(nextVideo, id);
    }

    function onFallbackNavigation() {
        stop();
        scheduleSetup(120);
    }

    const passiveCapture = {
        capture: true,
        passive: true
    };

    document.addEventListener(
        'DOMContentLoaded',
        () => scheduleSetup(0),
        passiveCapture
    );

    window.addEventListener(
        'load',
        () => scheduleSetup(0),
        passiveCapture
    );

    window.addEventListener(
        'pageshow',
        () => scheduleSetup(50),
        passiveCapture
    );

    window.addEventListener(
        'pagehide',
        stop,
        passiveCapture
    );

    document.addEventListener(
        'yt-navigate-start',
        stop,
        passiveCapture
    );

    document.addEventListener(
        'yt-navigate-finish',
        () => scheduleSetup(80),
        passiveCapture
    );

    document.addEventListener(
        'yt-page-data-updated',
        () => scheduleSetup(100),
        passiveCapture
    );

    // Important for mobile YouTube and Safari:
    // the same video element may be reused across navigations.
    document.addEventListener(
        'loadedmetadata',
        () => scheduleSetup(0),
        true
    );

    document.addEventListener(
        'play',
        () => scheduleSetup(0),
        true
    );

    window.addEventListener(
        'popstate',
        onFallbackNavigation,
        passiveCapture
    );

    scheduleSetup(0);
})();