// ==UserScript==
// @name         Return Dislikes YouTube
// @match        https://youtube.com/*
// @match        https://*.youtube.com/*
// ==/UserScript==
(function () {
    'use strict';

    const API_URL = 'https://returnyoutubedislikeapi.com/votes?videoId=';
    const CACHE_LIMIT = 100;
    const UI_WAIT_LIMIT = 6000;

    const formatter = new Intl.NumberFormat('en', {
        notation: 'compact',
        maximumFractionDigits: 1
    });

    const DESKTOP_BUTTON_SELECTORS = [
        'dislike-button-view-model button',
        'dislike-button-view-model button-view-model > button',
        'dislike-button-view-model .ytSpecButtonViewModelHost button',
        'dislike-button-view-model .yt-spec-button-shape-next',
        '#segmented-dislike-button button',
        'button[aria-label*="Dislike" i]'
    ];

    const MOBILE_BUTTON_SELECTORS = [
        'ytm-segmented-like-dislike-button-renderer dislike-button-view-model button',
        'ytm-slim-video-action-bar-renderer dislike-button-view-model button',
        'ytm-segmented-like-dislike-button-renderer button[aria-label*="Dislike" i]',
        'ytm-slim-video-action-bar-renderer button[aria-label*="Dislike" i]',
        'ytm-like-button-renderer button[aria-label*="Dislike" i]',
        'dislike-button-view-model button',
        '#segmented-dislike-button button',
        'button[aria-label*="Dislike" i]'
    ];

    const LIKE_TEXT_SELECTORS = [
        'like-button-view-model button span[role="text"]',
        'like-button-view-model button span',
        '#segmented-like-button button span',
        'ytm-like-button-renderer #text',
        'ytm-segmented-like-dislike-button-renderer button[aria-label*="Like" i] span'
    ];

    const SHORTS_ROOT_SELECTORS = [
        'ytd-reel-video-renderer[is-active-reel="true"]',
        'ytd-reel-video-renderer[tab-identifier="shorts"]',
        'ytm-reel-player-overlay-renderer',
        'ytd-reel-video-renderer'
    ];

    const SHORTS_COUNT_SELECTORS = [
        '#button-bar > reel-action-bar-view-model > dislike-button-view-model > toggle-button-view-model > button-view-model > label > div > span',
        'reel-action-bar-view-model dislike-button-view-model label div span[role="text"]',
        'dislike-button-view-model label span[role="text"]'
    ];

    const BASE_STYLE = `
.return-youtube-dislike-button {
    display: inline-flex !important;
    align-items: center !important;
    overflow: visible !important;
    width: auto !important;
    min-width: auto !important;
}

.return-youtube-dislike-count {
    flex: 0 0 auto;
    margin-left: 8px;
    white-space: nowrap;
}
`;

    // Current page and dislike-count state.
    let currentVideoId = '';
    let currentDislikes = null;

    // Active API request state.
    let requestController = null;
    let requestVideoId = '';

    // Coalesced update scheduler state.
    let updateTimer = 0;
    let updateDueAt = Infinity;

    // A single observer is reused for:
    // - temporarily waiting for YouTube controls,
    // - mobile UI rerenders,
    // - Shorts UI rerenders,
    // - desktop video-id changes.
    let observer = null;
    let observerScope = null;
    let observerMode = '';
    let observerExpiry = 0;

    // Presentation state.
    let styleElement = null;
    let desktopCss = '';
    let desktopRoot = null;

    // Small LRU cache for recently visited videos.
    const cache = new Map();

    function formatCount(value) {
        return formatter.format(value);
    }

    function isShortsPage() {
        return location.pathname.startsWith('/shorts/');
    }

    function getVideoId() {
        const url = new URL(location.href);

        // Shorts store the video ID in the URL path.
        if (url.pathname.startsWith('/shorts/')) {
            return url.pathname.slice(8).split('/')[0] || '';
        }

        // Standard watch URLs store the ID in the "v" query parameter.
        const queryId = url.searchParams.get('v');
        if (queryId) {
            return queryId;
        }

        // DOM fallbacks help during some YouTube SPA transition timing windows.
        const metadata = document.querySelector(
            'meta[itemprop="videoId"], meta[itemprop="identifier"]'
        );

        if (metadata && metadata.content) {
            return metadata.content;
        }

        const openGraph = document.querySelector(
            'meta[property="og:video:url"]'
        );

        if (openGraph && openGraph.content) {
            try {
                return (
                    new URL(openGraph.content).searchParams.get('v') || ''
                );
            } catch (_) {
                // Ignore malformed or temporarily incomplete metadata.
            }
        }

        return '';
    }

    function findFirst(root, selectors) {
        for (const selector of selectors) {
            const element = root.querySelector(selector);

            if (element) {
                return element;
            }
        }

        return null;
    }

    function getCached(videoId) {
        if (!cache.has(videoId)) {
            return undefined;
        }

        const value = cache.get(videoId);

        // Refresh insertion order so the Map behaves as an LRU cache.
        cache.delete(videoId);
        cache.set(videoId, value);

        return value;
    }

    function putCached(videoId, dislikes) {
        if (cache.has(videoId)) {
            cache.delete(videoId);
        }

        cache.set(videoId, dislikes);

        if (cache.size > CACHE_LIMIT) {
            cache.delete(cache.keys().next().value);
        }
    }

    function ensureStyleElement() {
        if (styleElement && document.contains(styleElement)) {
            return;
        }

        styleElement = document.createElement('style');
        styleElement.id = 'return-youtube-dislike-style';

        (document.head || document.documentElement).appendChild(
            styleElement
        );

        refreshStyles();
    }

    function refreshStyles() {
        if (styleElement) {
            styleElement.textContent =
                `${BASE_STYLE}\n${desktopCss}`;
        }
    }

    function clearDesktop() {
        desktopCss = '';

        if (desktopRoot) {
            desktopRoot.removeAttribute(
                'data-return-youtube-dislike'
            );

            desktopRoot = null;
        }

        refreshStyles();
    }

    function clearInjectedCounts() {
        document
            .querySelectorAll('.return-youtube-dislike-count')
            .forEach((element) => {
                element.remove();
            });

        document
            .querySelectorAll('.return-youtube-dislike-button')
            .forEach((element) => {
                element.classList.remove(
                    'return-youtube-dislike-button'
                );
            });
    }

    function clearPresentation() {
        clearDesktop();
        clearInjectedCounts();
    }

    function abortRequest() {
        if (requestController) {
            requestController.abort();
            requestController = null;
        }

        requestVideoId = '';
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
        observerMode = '';
    }

    function cancelScheduledUpdate() {
        if (!updateTimer) {
            return;
        }

        clearTimeout(updateTimer);

        updateTimer = 0;
        updateDueAt = Infinity;
    }

    function resetForNavigation() {
        cancelScheduledUpdate();
        abortRequest();
        stopObserver();
        clearPresentation();

        currentVideoId = '';
        currentDislikes = null;
    }

    function scheduleUpdate(delay = 0) {
        const target = performance.now() + delay;

        // Keep only the earliest pending update.
        //
        // YouTube can emit several lifecycle events for one navigation.
        // Coalescing them prevents duplicate work while still allowing a
        // more urgent event to replace a slower pending update.
        if (updateTimer && target >= updateDueAt) {
            return;
        }

        if (updateTimer) {
            clearTimeout(updateTimer);
        }

        updateDueAt = target;

        updateTimer = setTimeout(() => {
            updateTimer = 0;
            updateDueAt = Infinity;

            updatePage();
        }, Math.max(0, target - performance.now()));
    }

    async function fetchDislikes(videoId) {
        const cached = getCached(videoId);

        if (cached !== undefined) {
            return cached;
        }

        abortRequest();

        const controller = new AbortController();

        requestController = controller;
        requestVideoId = videoId;

        try {
            const response = await fetch(
                `${API_URL}${encodeURIComponent(videoId)}`,
                {
                    signal: controller.signal,
                    credentials: 'omit'
                }
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const dislikes = Number(data && data.dislikes);

            if (
                !Number.isFinite(dislikes) ||
                dislikes < 0
            ) {
                return null;
            }

            putCached(videoId, dislikes);

            return dislikes;
        } catch (_) {
            // Abort, offline state, and API failures remain silent.
            return null;
        } finally {
            if (requestController === controller) {
                requestController = null;
                requestVideoId = '';
            }
        }
    }

    function findDesktopRoot(videoId) {
        const roots = document.querySelectorAll(
            'ytd-watch-flexy'
        );

        let firstRoot = null;
        let rootWithoutId = null;

        for (const root of roots) {
            if (!firstRoot) {
                firstRoot = root;
            }

            const rootVideoId = root.getAttribute('video-id');

            if (rootVideoId === videoId) {
                return root;
            }

            if (!rootWithoutId && !rootVideoId) {
                rootWithoutId = root;
            }
        }

        // Any ytd-watch-flexy presence indicates the desktop watch layout.
        //
        // Returning a fallback desktop root prevents the mobile injection
        // strategy from being accidentally used during a desktop SPA
        // transition while YouTube is changing the video-id attribute.
        return rootWithoutId || firstRoot;
    }

    function renderDesktop(dislikes, root) {
        const button = findFirst(
            root,
            DESKTOP_BUTTON_SELECTORS
        );

        if (!button) {
            return null;
        }

        clearInjectedCounts();

        if (desktopRoot && desktopRoot !== root) {
            desktopRoot.removeAttribute(
                'data-return-youtube-dislike'
            );
        }

        desktopRoot = root;

        desktopRoot.setAttribute(
            'data-return-youtube-dislike',
            'active'
        );

        const text = ` ${formatCount(dislikes)}`;

        // Desktop keeps the original script's pseudo-element strategy.
        //
        // This is preferable on desktop because it avoids inserting custom
        // nodes into YouTube's frequently replaced button-view-model DOM.
        desktopCss = `
ytd-watch-flexy[data-return-youtube-dislike="active"] dislike-button-view-model button::after,
ytd-watch-flexy[data-return-youtube-dislike="active"] dislike-button-view-model button-view-model > button::after,
ytd-watch-flexy[data-return-youtube-dislike="active"] dislike-button-view-model .yt-spec-button-shape-next::after,
ytd-watch-flexy[data-return-youtube-dislike="active"] #segmented-dislike-button button::after {
    content: ${JSON.stringify(text)};
    margin-left: 8px;
    font-weight: 500;
    color: var(--yt-spec-text-primary, currentColor);
    white-space: nowrap;
}
`;

        ensureStyleElement();
        refreshStyles();

        return {
            mode: 'desktop',
            scope: root
        };
    }

    function renderMobile(dislikes, videoId) {
        // Prefer the active mobile watch page so a hidden Shorts or stale
        // off-screen control is less likely to be selected.
        const pageRoot =
            document.querySelector('ytm-watch') ||
            document;

        const button = findFirst(
            pageRoot,
            MOBILE_BUTTON_SELECTORS
        );

        if (!button) {
            return null;
        }

        clearDesktop();
        ensureStyleElement();

        let count = button.querySelector(
            '.return-youtube-dislike-count'
        );

        if (!count) {
            count = document.createElement('span');
            count.className =
                'return-youtube-dislike-count';

            // Copy typography from the visible like count where possible.
            //
            // This lets the dislike count follow YouTube's current mobile
            // styling instead of hard-coding every visual property.
            const likeText = findFirst(
                pageRoot,
                LIKE_TEXT_SELECTORS
            );

            if (likeText) {
                likeText.classList.forEach((className) => {
                    count.classList.add(className);
                });

                const style = getComputedStyle(likeText);

                count.style.fontSize = style.fontSize;
                count.style.fontWeight = style.fontWeight;
                count.style.lineHeight = style.lineHeight;
                count.style.color = style.color;

                if (
                    style.marginLeft &&
                    style.marginLeft !== '0px'
                ) {
                    count.style.marginLeft =
                        style.marginLeft;
                }
            } else {
                // Conservative fallback for mobile layouts where the like
                // count is temporarily unavailable.
                count.style.fontSize = '14px';
                count.style.fontWeight = '500';
                count.style.lineHeight = '36px';
                count.style.color = 'currentColor';
            }

            button.classList.add(
                'return-youtube-dislike-button'
            );

            // Insert after the first child/icon where possible.
            // This matches the mobile layout behavior of the original script.
            button.insertBefore(
                count,
                button.children[1] || null
            );
        }

        count.textContent = formatCount(dislikes);
        count.dataset.videoId = videoId;

        // Prefer a stable watch/action-bar ancestor.
        //
        // If YouTube replaces the actual dislike button, mutations inside
        // this broader scope can trigger reinsertion of the count.
        const scope =
            button.closest('ytm-watch') ||
            button.closest(
                'ytm-slim-video-action-bar-renderer'
            ) ||
            button.closest(
                'ytm-segmented-like-dislike-button-renderer'
            ) ||
            button.parentElement ||
            document.body;

        return {
            mode: 'mobile',
            scope
        };
    }

    function renderShorts(dislikes) {
        clearDesktop();
        clearInjectedCounts();

        const root = findFirst(
            document,
            SHORTS_ROOT_SELECTORS
        );

        const count = findFirst(
            root || document,
            SHORTS_COUNT_SELECTORS
        );

        if (!count) {
            return null;
        }

        const text = formatCount(dislikes);

        if (count.textContent.trim() !== text) {
            count.textContent = text;
        }

        return {
            mode: 'shorts',
            scope:
                root ||
                count.closest(
                    'reel-action-bar-view-model'
                ) ||
                document.body
        };
    }

    function watchRenderedUi(result) {
        const { mode, scope } = result;

        if (!scope) {
            return;
        }

        // Do not rebuild an identical observer on harmless repeated events.
        if (
            observer &&
            observerScope === scope &&
            observerMode === mode
        ) {
            return;
        }

        stopObserver();

        observer = new MutationObserver(() => {
            // A different video ID means the page changed before one of the
            // regular navigation handlers caught up.
            if (getVideoId() !== currentVideoId) {
                scheduleUpdate(0);
                return;
            }

            // Desktop only observes video-id changes.
            // Mobile and Shorts use a slightly faster rerender check.
            scheduleUpdate(
                mode === 'desktop' ? 80 : 50
            );
        });

        observerScope = scope;
        observerMode = mode;

        if (mode === 'desktop') {
            // Desktop CSS survives button subtree replacement, so the
            // watch root's video-id attribute is the important signal.
            observer.observe(scope, {
                attributes: true,
                attributeFilter: ['video-id']
            });
        } else {
            observer.observe(scope, {
                childList: true,
                subtree: true,

                // Shorts may overwrite the text node without replacing the
                // surrounding element, so character data is watched there.
                characterData: mode === 'shorts'
            });
        }
    }

    function waitForUi() {
        if (
            observer &&
            observerMode === 'wait'
        ) {
            return;
        }

        stopObserver();

        const root = document.documentElement;

        if (!root) {
            scheduleUpdate(50);
            return;
        }

        observer = new MutationObserver(() => {
            scheduleUpdate(80);
        });

        observerScope = root;
        observerMode = 'wait';

        // This is the only broad observer in the script.
        //
        // It is used solely while YouTube is creating the relevant action
        // controls and automatically disconnects after six seconds.
        observer.observe(root, {
            childList: true,
            subtree: true
        });

        observerExpiry = setTimeout(() => {
            if (observerMode === 'wait') {
                stopObserver();
            }
        }, UI_WAIT_LIMIT);
    }

    function renderCurrent() {
        if (
            !currentVideoId ||
            currentDislikes === null ||
            getVideoId() !== currentVideoId
        ) {
            return;
        }

        let result;

        if (isShortsPage()) {
            result = renderShorts(
                currentDislikes
            );
        } else {
            // Detect the actual DOM layout rather than sniffing the device,
            // browser, platform, or user agent.
            //
            // This is the central desktop/mobile unification mechanism.
            const root = findDesktopRoot(
                currentVideoId
            );

            result = root
                ? renderDesktop(
                    currentDislikes,
                    root
                )
                : renderMobile(
                    currentDislikes,
                    currentVideoId
                );
        }

        if (result) {
            watchRenderedUi(result);
        } else {
            waitForUi();
        }
    }

    async function updatePage() {
        const videoId = getVideoId();

        if (!videoId) {
            if (currentVideoId) {
                resetForNavigation();
            }

            return;
        }

        if (videoId !== currentVideoId) {
            abortRequest();
            stopObserver();
            clearPresentation();

            currentVideoId = videoId;
            currentDislikes = null;
        }

        // Once data is available, repeated YouTube lifecycle events become
        // cheap UI-rerender checks instead of duplicate API calls.
        if (currentDislikes !== null) {
            renderCurrent();
            return;
        }

        // Prevent duplicate requests for the same video.
        if (
            requestController &&
            requestVideoId === videoId
        ) {
            return;
        }

        const dislikes = await fetchDislikes(
            videoId
        );

        // Ignore stale responses after navigation.
        if (
            dislikes === null ||
            currentVideoId !== videoId ||
            getVideoId() !== videoId
        ) {
            return;
        }

        currentDislikes = dislikes;

        renderCurrent();
    }

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

    const passiveCapture = {
        capture: true,
        passive: true
    };

    // Initial page lifecycle.
    document.addEventListener(
        'DOMContentLoaded',
        () => scheduleUpdate(0),
        passiveCapture
    );

    window.addEventListener(
        'load',
        () => scheduleUpdate(0),
        passiveCapture
    );

    window.addEventListener(
        'pageshow',
        () => scheduleUpdate(50),
        passiveCapture
    );

    window.addEventListener(
        'pagehide',
        resetForNavigation,
        passiveCapture
    );

    // Desktop YouTube SPA navigation.
    document.addEventListener(
        'yt-navigate-start',
        onNavigationStart,
        passiveCapture
    );

    document.addEventListener(
        'yt-navigate-finish',
        onNavigationFinish,
        passiveCapture
    );

    // Mobile YouTube SPA navigation.
    document.addEventListener(
        'ytm-navigate-start',
        onNavigationStart,
        passiveCapture
    );

    document.addEventListener(
        'ytm-navigate-finish',
        onNavigationFinish,
        passiveCapture
    );

    // Additional lifecycle signals used by different YouTube builds.
    document.addEventListener(
        'yt-page-data-updated',
        () => scheduleUpdate(100),
        passiveCapture
    );

    document.addEventListener(
        'spfdone',
        () => scheduleUpdate(100),
        passiveCapture
    );

    // Mobile YouTube often reuses the same page shell while loading a
    // different media source. These capture-phase listeners handle that
    // without requiring URL polling.
    document.addEventListener(
        'loadedmetadata',
        () => scheduleUpdate(20),
        true
    );

    document.addEventListener(
        'loadeddata',
        () => scheduleUpdate(20),
        true
    );

    document.addEventListener(
        'play',
        () => scheduleUpdate(0),
        true
    );

    // Browser-history fallback.
    //
    // This avoids both:
    // - a permanent setInterval URL poll,
    // - monkey-patching history.pushState / history.replaceState.
    window.addEventListener(
        'popstate',
        onHistoryNavigation,
        passiveCapture
    );

    // Recheck after returning to a backgrounded mobile tab or app.
    document.addEventListener(
        'visibilitychange',
        () => {
            if (!document.hidden) {
                scheduleUpdate(0);
            }
        }
    );

    // Handle userscript managers that inject after the initial lifecycle
    // event has already happened.
    scheduleUpdate(0);
})();