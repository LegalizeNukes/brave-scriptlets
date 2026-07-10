// ==UserScript==
// @name         DeArrow Titles YouTube
// @match        https://youtube.com/*
// @match        https://*.youtube.com/*
// ==/UserScript==
(() => {
    'use strict';

    const API = 'https://sponsor.ajay.app';

    const LINK_SELECTOR =
        'a[href*="/watch?v="],' +
        'a[href^="/shorts/"],' +
        'a[href*="/embed/"]';

    const CACHE_LIMIT = 600;

    // Retain a low-frequency full scan as a safety net for unusual
    // YouTube DOM updates that do not produce useful incremental signals.
    const RECOVERY_INTERVAL = 10000;

    // Positive DeArrow title cache.
    const titleCache = new Map();

    // Deduplicates concurrent requests for the same video.
    const pendingRequests = new Map();

    // Remembers titles already applied to individual anchor elements.
    // WeakMap avoids retaining detached YouTube DOM nodes.
    const linkState = new WeakMap();

    // Reuse one encoder rather than allocating one per hash.
    const textEncoder = new TextEncoder();

    // Full-scan scheduler state.
    let fullScanTimer = 0;
    let fullScanDueAt = Infinity;

    // Current-watch-page scheduler state.
    let watchTimer = 0;
    let watchDueAt = Infinity;

    // Incremental mutation-batch scheduler state.
    let mutationTimer = 0;
    let mutationRecoveryTimer = 0;

    // Low-frequency safety-net timer.
    let recoveryTimer = 0;

    // Observers.
    let domObserver = null;

    let titleObserver = null;
    let observedTitleElement = null;

    let headingObserver = null;
    let observedHeadingElement = null;

    // Added DOM roots waiting for one batched incremental scan.
    const pendingRoots = new Set();

    function getVideoId(input) {
        try {
            const url = new URL(input, location.href);

            if (url.pathname === '/watch') {
                return url.searchParams.get('v');
            }

            if (url.pathname.startsWith('/shorts/')) {
                return url.pathname.split('/')[2] || null;
            }

            if (url.pathname.startsWith('/embed/')) {
                return url.pathname.split('/')[2] || null;
            }
        } catch (_) {
            // Ignore malformed or transient URLs.
        }

        return null;
    }

    async function sha256(value) {
        const digest = await crypto.subtle.digest(
            'SHA-256',
            textEncoder.encode(value)
        );

        let hex = '';

        for (const byte of new Uint8Array(digest)) {
            hex += byte.toString(16).padStart(2, '0');
        }

        return hex;
    }

    function cleanTitle(title) {
        return (title || '')
            .replace(/‹/g, '<')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getCachedTitle(videoId) {
        if (!titleCache.has(videoId)) {
            return undefined;
        }

        const title = titleCache.get(videoId);

        // Refresh insertion order so this behaves as an LRU cache.
        titleCache.delete(videoId);
        titleCache.set(videoId, title);

        return title;
    }

    function cacheTitle(videoId, title) {
        if (titleCache.has(videoId)) {
            titleCache.delete(videoId);
        }

        titleCache.set(videoId, title);

        if (titleCache.size > CACHE_LIMIT) {
            titleCache.delete(
                titleCache.keys().next().value
            );
        }
    }

    async function getTitle(videoId) {
        if (!videoId) {
            return null;
        }

        const cached = getCachedTitle(videoId);

        if (cached !== undefined) {
            return cached;
        }

        // Reuse an existing in-flight request for this video.
        if (pendingRequests.has(videoId)) {
            return pendingRequests.get(videoId);
        }

        const request = (async () => {
            try {
                const hashPrefix = (
                    await sha256(videoId)
                ).slice(0, 4);

                const response = await fetch(
                    `${API}/api/branding/${hashPrefix}?fetchAll=true`,
                    {
                        credentials: 'omit'
                    }
                );

                if (!response.ok) {
                    return null;
                }

                const data = await response.json();
                const entry = data && data[videoId];

                if (
                    !entry ||
                    !Array.isArray(entry.titles)
                ) {
                    return null;
                }

                // Preserve the original title-selection behavior.
                const candidate = entry.titles.find((item) =>
                    item &&
                    item.title &&
                    item.original !== true &&
                    (
                        item.locked ||
                        Number(item.votes) >= 0
                    )
                );

                const title = candidate
                    ? cleanTitle(candidate.title)
                    : null;

                if (title) {
                    cacheTitle(videoId, title);
                }

                return title;
            } catch (_) {
                return null;
            } finally {
                pendingRequests.delete(videoId);
            }
        })();

        pendingRequests.set(videoId, request);

        return request;
    }

    function isInsideThumbnail(element) {
        return Boolean(
            element.closest?.(
                'ytd-thumbnail,' +
                'ytm-thumbnail,' +
                'yt-thumbnail-view-model,' +
                'a#thumbnail,' +
                'a.ytd-thumbnail,' +
                '.thumbnail,' +
                '.yt-thumbnail-view-model,' +
                '.media-item-thumbnail-container,' +
                '.compact-media-item-image,' +
                'ytm-thumbnail-overlay-time-status-renderer'
            )
        );
    }

    function hasVisualContent(element) {
        return Boolean(
            element.querySelector?.(
                'img,' +
                'picture,' +
                'image,' +
                'svg,' +
                'ytd-thumbnail,' +
                'ytm-thumbnail,' +
                'yt-thumbnail-view-model,' +
                'video,' +
                'canvas'
            )
        );
    }

    function isVisible(element) {
        if (
            !element ||
            !(element instanceof Element)
        ) {
            return false;
        }

        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function isBadText(text) {
        const value = (text || '').trim();

        return (
            !value ||
            value.length < 3 ||
            /^\d+([:.]\d+)+$/.test(value) ||
            /^\d+[KMB]?\s+views?/i.test(value) ||
            /^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.test(value) ||
            /^(live|new|cc|hd|4k)$/i.test(value)
        );
    }

    function findTextTarget(anchor) {
        if (
            !anchor ||
            isInsideThumbnail(anchor) ||
            hasVisualContent(anchor) ||
            !isVisible(anchor)
        ) {
            return null;
        }

        let best = null;
        let bestScore = 0;

        const walker = document.createTreeWalker(
            anchor,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode(node) {
                    if (
                        !(node instanceof Element) ||
                        isInsideThumbnail(node) ||
                        hasVisualContent(node) ||
                        !isVisible(node)
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    const text =
                        (node.textContent || '').trim();

                    return isBadText(text)
                        ? NodeFilter.FILTER_SKIP
                        : NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        for (
            let node = walker.currentNode;
            node;
            node = walker.nextNode()
        ) {
            const text =
                (node.textContent || '').trim();

            if (isBadText(text)) {
                continue;
            }

            let score = text.length;

            if (/^H[1-6]$/.test(node.tagName)) {
                score += 200;
            }

            if (node.tagName === 'SPAN') {
                score += 20;
            }

            if (score > bestScore) {
                bestScore = score;
                best = node;
            }
        }

        return best;
    }

    function updateMetadata(anchor, title) {
        if (
            !anchor ||
            !title ||
            isInsideThumbnail(anchor)
        ) {
            return;
        }

        if (
            anchor.title !== undefined &&
            anchor.title !== title
        ) {
            anchor.title = title;
        }

        if (
            anchor.ariaLabel !== undefined &&
            anchor.ariaLabel !== title
        ) {
            anchor.ariaLabel = title;
        }

        if (
            anchor.getAttribute?.('aria-label') &&
            anchor.getAttribute('aria-label') !== title
        ) {
            anchor.setAttribute(
                'aria-label',
                title
            );
        }
    }

    function applyLinkTitle(
        anchor,
        videoId,
        title
    ) {
        // Recheck after async work because YouTube frequently recycles
        // existing anchors for different videos.
        if (
            !anchor.isConnected ||
            getVideoId(anchor.href) !== videoId ||
            isInsideThumbnail(anchor) ||
            hasVisualContent(anchor)
        ) {
            return;
        }

        const target = findTextTarget(anchor);

        if (!target) {
            return;
        }

        if (
            (target.textContent || '').trim() !== title
        ) {
            target.textContent = title;
        }

        updateMetadata(anchor, title);

        linkState.set(anchor, {
            videoId,
            title
        });
    }

    async function processLink(anchor) {
        if (
            !(anchor instanceof HTMLAnchorElement)
        ) {
            return;
        }

        const videoId = getVideoId(anchor.href);

        if (
            !videoId ||
            isInsideThumbnail(anchor) ||
            hasVisualContent(anchor)
        ) {
            return;
        }

        const previous = linkState.get(anchor);

        // Reapply a known title immediately if YouTube has rerendered
        // the text inside an existing anchor.
        if (
            previous &&
            previous.videoId === videoId &&
            previous.title
        ) {
            applyLinkTitle(
                anchor,
                videoId,
                previous.title
            );

            return;
        }

        const title = await getTitle(videoId);

        if (!title) {
            return;
        }

        applyLinkTitle(
            anchor,
            videoId,
            title
        );
    }

    function isLikelyWatchHeading(element) {
        if (
            !isVisible(element) ||
            isInsideThumbnail(element) ||
            hasVisualContent(element)
        ) {
            return false;
        }

        const text =
            (element.textContent || '').trim();

        if (isBadText(text)) {
            return false;
        }

        const rect =
            element.getBoundingClientRect();

        return (
            rect.top >= 0 &&
            rect.top < innerHeight * 0.75
        );
    }

    function observeWatchHeading(element) {
        if (
            !element ||
            element === observedHeadingElement
        ) {
            return;
        }

        if (headingObserver) {
            headingObserver.disconnect();
        }

        observedHeadingElement = element;

        // Narrow observer replaces the old permanent 2.5-second
        // watch-page polling loop.
        headingObserver = new MutationObserver(() => {
            scheduleWatch(0);
        });

        headingObserver.observe(element, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    async function processWatch() {
        const videoId =
            getVideoId(location.href);

        if (!videoId) {
            return;
        }

        const title = await getTitle(videoId);

        // Prevent an old async result from affecting a newly
        // navigated video.
        if (
            !title ||
            getVideoId(location.href) !== videoId
        ) {
            return;
        }

        const documentTitle =
            `${title} - YouTube`;

        if (document.title !== documentTitle) {
            document.title = documentTitle;
        }

        let best = null;
        let bestScore = 0;

        document
            .querySelectorAll('h1,h2')
            .forEach((element) => {
                if (
                    !isLikelyWatchHeading(element)
                ) {
                    return;
                }

                let score =
                    (element.textContent || '')
                        .trim()
                        .length +
                    (
                        element.tagName === 'H1'
                            ? 100
                            : 50
                    );

                const rect =
                    element.getBoundingClientRect();

                score += Math.max(
                    0,
                    300 - rect.top
                );

                if (score > bestScore) {
                    bestScore = score;
                    best = element;
                }
            });

        if (best) {
            observeWatchHeading(best);

            if (
                (best.textContent || '').trim() !== title
            ) {
                best.textContent = title;
            }
        }
    }

    function scanLinks(root = document) {
        // Handle a root that is itself a matching anchor.
        if (
            root instanceof HTMLAnchorElement &&
            root.matches(LINK_SELECTOR)
        ) {
            processLink(root);
        }

        root
            .querySelectorAll?.(LINK_SELECTOR)
            .forEach(processLink);
    }

    function scan(root = document) {
        scanLinks(root);

        // Process the current watch page once per scan rather than
        // once for every added subtree.
        scheduleWatch(0);
    }

    function scheduleFullScan(delay = 250) {
        const target =
            performance.now() + delay;

        // Keep only the earliest pending scan.
        if (
            fullScanTimer &&
            target >= fullScanDueAt
        ) {
            return;
        }

        if (fullScanTimer) {
            clearTimeout(fullScanTimer);
        }

        fullScanDueAt = target;

        fullScanTimer = setTimeout(() => {
            fullScanTimer = 0;
            fullScanDueAt = Infinity;

            scan();
        }, Math.max(
            0,
            target - performance.now()
        ));
    }

    function scheduleWatch(delay = 0) {
        const target =
            performance.now() + delay;

        if (
            watchTimer &&
            target >= watchDueAt
        ) {
            return;
        }

        if (watchTimer) {
            clearTimeout(watchTimer);
        }

        watchDueAt = target;

        watchTimer = setTimeout(() => {
            watchTimer = 0;
            watchDueAt = Infinity;

            processWatch();
        }, Math.max(
            0,
            target - performance.now()
        ));
    }

    function queueRoot(root) {
        if (!(root instanceof Element)) {
            return;
        }

        pendingRoots.add(root);

        if (mutationTimer) {
            return;
        }

        // Batch rapid YouTube DOM additions together.
        mutationTimer = setTimeout(
            flushPendingRoots,
            50
        );
    }

    function flushPendingRoots() {
        mutationTimer = 0;

        const roots =
            Array.from(pendingRoots);

        pendingRoots.clear();

        const minimalRoots = [];

        for (const root of roots) {
            if (!root.isConnected) {
                continue;
            }

            // Skip a root already covered by a queued parent.
            if (
                minimalRoots.some(
                    (parent) => parent.contains(root)
                )
            ) {
                continue;
            }

            // If this root contains previously queued children,
            // retain only the broader root.
            for (
                let i = minimalRoots.length - 1;
                i >= 0;
                i--
            ) {
                if (
                    root.contains(minimalRoots[i])
                ) {
                    minimalRoots.splice(i, 1);
                }
            }

            minimalRoots.push(root);
        }

        for (const root of minimalRoots) {
            scanLinks(root);
        }

        scheduleWatch(0);
    }

    function observeDocumentTitle() {
        const titleElement =
            document.querySelector('title');

        if (
            !titleElement ||
            titleElement === observedTitleElement
        ) {
            return;
        }

        if (titleObserver) {
            titleObserver.disconnect();
        }

        observedTitleElement = titleElement;

        // Narrow title observation replaces repeated polling when
        // YouTube rewrites the tab title.
        titleObserver = new MutationObserver(() => {
            scheduleWatch(0);
        });

        titleObserver.observe(titleElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function handleMutations(mutations) {
        let titleElementMayHaveChanged = false;

        for (const mutation of mutations) {
            // YouTube often recycles anchors and changes only href.
            if (
                mutation.type === 'attributes' &&
                mutation.target instanceof
                    HTMLAnchorElement
            ) {
                queueRoot(mutation.target);
                continue;
            }

            for (
                const node of mutation.addedNodes
            ) {
                if (!(node instanceof Element)) {
                    continue;
                }

                queueRoot(node);

                if (
                    node.tagName === 'TITLE' ||
                    node.querySelector?.('title')
                ) {
                    titleElementMayHaveChanged = true;
                }
            }
        }

        if (titleElementMayHaveChanged) {
            observeDocumentTitle();
        }

        scheduleMutationRecovery();
    }

    function scheduleMutationRecovery() {
        // Incremental scans above handle normal mutations.
        // This trailing full scan is only a safety net after
        // the mutation burst settles.
        clearTimeout(mutationRecoveryTimer);

        mutationRecoveryTimer = setTimeout(() => {
            mutationRecoveryTimer = 0;
            scheduleFullScan(0);
        }, 700);
    }

    function handleNavigation(delay = 350) {
        scheduleFullScan(delay);
        scheduleWatch(delay);
    }

    function startRecoveryLoop() {
        clearTimeout(recoveryTimer);

        recoveryTimer = setTimeout(() => {
            // Avoid broad recovery work while the page is hidden.
            if (!document.hidden) {
                scheduleFullScan(0);
            }

            startRecoveryLoop();
        }, RECOVERY_INTERVAL);
    }

    function start() {
        const root =
            document.documentElement;

        if (!root) {
            setTimeout(start, 0);
            return;
        }

        domObserver =
            new MutationObserver(
                handleMutations
            );

        domObserver.observe(root, {
            childList: true,
            subtree: true,

            // Watching href catches recycled SPA anchors without
            // observing every attribute on the page.
            attributes: true,
            attributeFilter: ['href']
        });

        observeDocumentTitle();

        const passiveCapture = {
            capture: true,
            passive: true
        };

        // Desktop YouTube navigation.
        document.addEventListener(
            'yt-navigate-start',
            () => handleNavigation(100),
            passiveCapture
        );

        document.addEventListener(
            'yt-navigate-finish',
            () => handleNavigation(350),
            passiveCapture
        );

        // Mobile YouTube navigation.
        document.addEventListener(
            'ytm-navigate-start',
            () => handleNavigation(100),
            passiveCapture
        );

        document.addEventListener(
            'ytm-navigate-finish',
            () => handleNavigation(350),
            passiveCapture
        );

        // Additional lifecycle signals used by different
        // YouTube builds.
        document.addEventListener(
            'yt-page-data-updated',
            () => handleNavigation(350),
            passiveCapture
        );

        document.addEventListener(
            'spfdone',
            () => handleNavigation(350),
            passiveCapture
        );

        window.addEventListener(
            'popstate',
            () => handleNavigation(350),
            passiveCapture
        );

        window.addEventListener(
            'pageshow',
            () => handleNavigation(80),
            passiveCapture
        );

        // Mobile YouTube may reuse its shell while changing
        // the underlying media source.
        document.addEventListener(
            'loadedmetadata',
            () => handleNavigation(80),
            true
        );

        document.addEventListener(
            'loadeddata',
            () => handleNavigation(80),
            true
        );

        // Recheck immediately when returning to a foreground tab.
        document.addEventListener(
            'visibilitychange',
            () => {
                if (!document.hidden) {
                    handleNavigation(0);
                }
            }
        );

        scan();
        startRecoveryLoop();
    }

    start();
})();