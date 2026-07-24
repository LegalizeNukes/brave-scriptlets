// ==UserScript==
// @name         Location Blocking X
// @match        *://x.com/*
// @match        *://twitter.com/*
// ==/UserScript==
(() => {
    'use strict';

    // Brave may execute a custom scriptlet more than once on the same SPA page.
    // Keep exactly one observer/request queue active at a time.
    const INSTANCE_KEY = '__X_ACCOUNT_LOCATION_FLAGS_ACTIVE__';
    if (globalThis[INSTANCE_KEY]) return;

    /*
     * X Account Location Flags
     *
     * Displays the country or region reported by X's internal AboutAccountQuery
     * next to usernames. The script can also hide or highlight tweets from
     * configured countries or regions.
     *
     * Design goals:
     * - Work as a normal userscript and as a Brave desktop custom scriptlet.
     * - Avoid Tampermonkey-specific APIs.
     * - Minimize X API usage through persistent caching and request deduplication.
     * - Prefetch nearby/off-screen accounts so flags are usually ready before
     *   their posts enter the viewport.
     * - Avoid modifying X's global fetch/XMLHttpRequest implementations.
     *
     * The script uses the currently logged-in X session and its ct0 CSRF cookie
     * to call X's own internal GraphQL endpoint. No account data or session
     * credentials are sent to a third-party service.
     */

    /**
     * USER CONFIGURATION
     *
     * Add country or region names exactly as they appear in COUNTRY_FLAGS or
     * REGION_MARKERS below. Matching is case-insensitive. Country aliases that
     * use the same flag are treated as the same country, while regions remain
     * distinct even when they share the same globe emoji.
     */
    const USER_CONFIG = {
        // Add country/region names here, e.g. ['chad', 'cuba', 'southeast asia'].
        BLOCKED_COUNTRIES: [],

        // 'hide' = remove matching posts
        // 'highlight' = keep them visible with a red border
        // 'dim' = darken matching posts until hovered
        // 'collapse' = replace them with a compact location notice that can be expanded
        BLOCKED_POST_ACTION: 'hide',
    };

    const CONFIG = {
        VERSION: '2.6.1',
        CACHE_KEY: 'x_location_cache_v4',
        LEGACY_CACHE_KEYS: ['x_location_cache_v3'],
        // Location data rarely changes. A longer persistent cache greatly reduces API usage.
        CACHE_EXPIRY: 30 * 24 * 60 * 60 * 1000,
        EMPTY_CACHE_EXPIRY: 15 * 60 * 1000,
        CACHE_MAX_ENTRIES: 3000,
        CACHE_SAVE_DELAY: 750,
        API: {
            QUERY_ID: 'XRqGa7EeokUU5kppkh13EA', // AboutAccountQuery
            MIN_INTERVAL: 2000,
            REQUEST_TIMEOUT: 12000,
            MAX_RETRIES: 1,
            RETRY_DELAY: 4000,
        },
        SELECTOR: '[data-testid="UserName"], [data-testid="User-Name"]',
        STYLE_ID: 'x-account-location-flags-style-v261',
        FLAG_CLASS: 'x-location-flag-v2',
        TOOLTIP_CLASS: 'x-location-touch-tooltip',
        COLLAPSE_CLASS: 'x-location-collapse-notice',
        FILTER_ATTR: 'data-x-location-country-filter',
        // Start uncached lookups several screens before content enters the viewport.
        VIEWPORT_MARGIN: '1600px 0px 5000px 0px',
    };

    /** Country name -> flag lookup. */
    const COUNTRY_FLAGS = {
        "afghanistan": "🇦🇫", "albania": "🇦🇱", "algeria": "🇩🇿", "andorra": "🇦🇩", "angola": "🇦🇴",
        "antigua and barbuda": "🇦🇬", "argentina": "🇦🇷", "armenia": "🇦🇲", "australia": "🇦🇺", "austria": "🇦🇹",
        "azerbaijan": "🇦🇿", "bahamas": "🇧🇸", "bahrain": "🇧🇭", "bangladesh": "🇧🇩", "barbados": "🇧🇧",
        "belarus": "🇧🇾", "belgium": "🇧🇪", "belize": "🇧🇿", "benin": "🇧🇯", "bhutan": "🇧🇹",
        "bolivia": "🇧🇴", "bosnia and herzegovina": "🇧🇦", "bosnia": "🇧🇦", "botswana": "🇧🇼", "brazil": "🇧🇷",
        "brunei": "🇧🇳", "bulgaria": "🇧🇬", "burkina faso": "🇧🇫", "burundi": "🇧🇮", "cambodia": "🇰🇭",
        "cameroon": "🇨🇲", "canada": "🇨🇦", "cape verde": "🇨🇻", "cabo verde": "🇨🇻", "central african republic": "🇨🇫", "chad": "🇹🇩",
        "chile": "🇨🇱", "china": "🇨🇳", "colombia": "🇨🇴", "comoros": "🇰🇲", "congo": "🇨🇬",
        "costa rica": "🇨🇷", "croatia": "🇭🇷", "cuba": "🇨🇺", "cyprus": "🇨🇾", "czech republic": "🇨🇿",
        "czechia": "🇨🇿", "democratic republic of the congo": "🇨🇩", "denmark": "🇩🇰", "djibouti": "🇩🇯", "dominica": "🇩🇲",
        "dominican republic": "🇩🇴", "east timor": "🇹🇱", "ecuador": "🇪🇨", "egypt": "🇪🇬", "el salvador": "🇸🇻",
        "england": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "equatorial guinea": "🇬🇶", "eritrea": "🇪🇷", "estonia": "🇪🇪", "eswatini": "🇸🇿",
        "ethiopia": "🇪🇹", "european union": "🇪🇺", "fiji": "🇫🇯", "finland": "🇫🇮",
        "france": "🇫🇷", "gabon": "🇬🇦", "gambia": "🇬🇲", "georgia": "🇬🇪", "germany": "🇩🇪",
        "ghana": "🇬🇭", "greece": "🇬🇷", "grenada": "🇬🇩", "guatemala": "🇬🇹", "guinea": "🇬🇳",
        "guinea-bissau": "🇬🇼", "guyana": "🇬🇾", "haiti": "🇭🇹", "honduras": "🇭🇳", "hong kong": "🇭🇰",
        "hungary": "🇭🇺", "iceland": "🇮🇸", "india": "🇮🇳", "indonesia": "🇮🇩", "iran": "🇮🇷",
        "iraq": "🇮🇶", "ireland": "🇮🇪", "israel": "🇮🇱", "italy": "🇮🇹", "ivory coast": "🇨🇮", "côte d’ivoire": "🇨🇮", "côte d'ivoire": "🇨🇮", "cote d'ivoire": "🇨🇮",
        "jamaica": "🇯🇲", "japan": "🇯🇵", "jordan": "🇯🇴", "kazakhstan": "🇰🇿", "kenya": "🇰🇪",
        "kiribati": "🇰🇮", "korea": "🇰🇷", "kosovo": "🇽🇰", "kuwait": "🇰🇼", "kyrgyzstan": "🇰🇬",
        "laos": "🇱🇦", "latvia": "🇱🇻", "lebanon": "🇱🇧", "lesotho": "🇱🇸", "liberia": "🇱🇷",
        "libya": "🇱🇾", "liechtenstein": "🇱🇮", "lithuania": "🇱🇹", "luxembourg": "🇱🇺", "macao": "🇲🇴",
        "macau": "🇲🇴", "madagascar": "🇲🇬", "malawi": "🇲🇼", "malaysia": "🇲🇾", "maldives": "🇲🇻",
        "mali": "🇲🇱", "malta": "🇲🇹", "marshall islands": "🇲🇭", "mauritania": "🇲🇷", "mauritius": "🇲🇺",
        "mexico": "🇲🇽", "micronesia": "🇫🇲", "moldova": "🇲🇩", "monaco": "🇲🇨", "mongolia": "🇲🇳",
        "montenegro": "🇲🇪", "morocco": "🇲🇦", "mozambique": "🇲🇿", "myanmar": "🇲🇲", "burma": "🇲🇲",
        "namibia": "🇳🇦", "nauru": "🇳🇷", "nepal": "🇳🇵", "netherlands": "🇳🇱", "new zealand": "🇳🇿",
        "nicaragua": "🇳🇮", "niger": "🇳🇪", "nigeria": "🇳🇬", "north korea": "🇰🇵", "north macedonia": "🇲🇰",
        "macedonia": "🇲🇰", "norway": "🇳🇴", "oman": "🇴🇲", "pakistan": "🇵🇰", "palau": "🇵🇼",
        "palestine": "🇵🇸", "panama": "🇵🇦", "papua new guinea": "🇵🇬", "paraguay": "🇵🇾", "peru": "🇵🇪",
        "philippines": "🇵🇭", "poland": "🇵🇱", "portugal": "🇵🇹", "puerto rico": "🇵🇷", "qatar": "🇶🇦",
        "romania": "🇷🇴", "russia": "🇷🇺", "russian federation": "🇷🇺", "rwanda": "🇷🇼", "saint kitts and nevis": "🇰🇳",
        "saint lucia": "🇱🇨", "saint vincent and the grenadines": "🇻🇨", "samoa": "🇼🇸", "san marino": "🇸🇲", "sao tome and principe": "🇸🇹",
        "saudi arabia": "🇸🇦", "scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "senegal": "🇸🇳", "serbia": "🇷🇸", "seychelles": "🇸🇨",
        "sierra leone": "🇸🇱", "singapore": "🇸🇬", "slovakia": "🇸🇰", "slovenia": "🇸🇮", "solomon islands": "🇸🇧",
        "somalia": "🇸🇴", "south africa": "🇿🇦", "south korea": "🇰🇷", "south sudan": "🇸🇸", "spain": "🇪🇸",
        "sri lanka": "🇱🇰", "sudan": "🇸🇩", "suriname": "🇸🇷", "sweden": "🇸🇪", "switzerland": "🇨🇭",
        "syria": "🇸🇾", "taiwan": "🇹🇼", "tajikistan": "🇹🇯", "tanzania": "🇹🇿", "thailand": "🇹🇭",
        "timor-leste": "🇹🇱", "togo": "🇹🇬", "tonga": "🇹🇴", "trinidad and tobago": "🇹🇹", "tunisia": "🇹🇳",
        "turkey": "🇹🇷", "türkiye": "🇹🇷", "turkmenistan": "🇹🇲", "tuvalu": "🇹🇻", "uganda": "🇺🇬",
        "ukraine": "🇺🇦", "united arab emirates": "🇦🇪", "uae": "🇦🇪", "united kingdom": "🇬🇧", "uk": "🇬🇧",
        "great britain": "🇬🇧", "britain": "🇬🇧", "united states": "🇺🇸", "usa": "🇺🇸", "us": "🇺🇸",
        "uruguay": "🇺🇾", "uzbekistan": "🇺🇿", "vanuatu": "🇻🇺", "vatican city": "🇻🇦", "venezuela": "🇻🇪",
        "vietnam": "🇻🇳", "viet nam": "🇻🇳", "wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "yemen": "🇾🇪", "zambia": "🇿🇲", "zimbabwe": "🇿🇼"
    };

    /**
     * X may return a broader region instead of a specific country.
     * Regions have no Unicode flags, so the matching geographic globe variant is used instead.
     * The blocker key is separate from the emoji because several regions share
     * the same globe marker and must still be independently configurable.
     */
    const REGION_MARKERS = {
        // Asia / Pacific
        "asia": ["🌏", "asia"],
        "east asia": ["🌏", "east asia"],
        "east asia & pacific": ["🌏", "east asia & pacific"],
        "southeast asia": ["🌏", "southeast asia"],
        "south east asia": ["🌏", "southeast asia"],
        "south asia": ["🌏", "south asia"],
        "west asia": ["🌏", "west asia"],
        "western asia": ["🌏", "west asia"],
        "central asia": ["🌏", "central asia"],
        "north asia": ["🌏", "north asia"],
        "oceania": ["🌏", "oceania"],
        "pacific": ["🌏", "pacific"],

        // Europe / Africa
        "europe": ["🌍", "europe"],
        "europe & central asia": ["🌍", "europe & central asia"],
        "africa": ["🌍", "africa"],
        "north africa": ["🌍", "north africa"],
        "west africa": ["🌍", "west africa"],
        "east africa": ["🌍", "east africa"],
        "central africa": ["🌍", "central africa"],
        "southern africa": ["🌍", "southern africa"],
        "sub-saharan africa": ["🌍", "sub-saharan africa"],
        "middle east & north africa": ["🌍", "middle east & north africa"],

        // Americas
        "americas": ["🌎", "americas"],
        "north america": ["🌎", "north america"],
        "central america": ["🌎", "central america"],
        "south america": ["🌎", "south america"],
        "latin america": ["🌎", "latin america"],
        "latin america & caribbean": ["🌎", "latin america & caribbean"],
        "caribbean": ["🌎", "caribbean"],

        // Non-geographic
        "global": ["🌐", "global"],
        "worldwide": ["🌐", "global"]
    };

    // Explicit markers for resolved responses that do not map to a known place.
    const NO_LOCATION_MARKER = "❓";
    const UNKNOWN_LOCATION_MARKER = "📍";

    // X application routes that can otherwise look like usernames.
    const RESERVED_PATHS = new Set([
        'home', 'explore', 'notifications', 'messages', 'search', 'settings',
        'compose', 'i', 'tos', 'privacy', 'login', 'logout', 'signup'
    ]);

    // Normalize identifiers so cache and matching behavior stay consistent.
    const normalizeCountry = value => String(value || '').trim().toLowerCase();
    const normalizeScreenName = value => String(value || '').trim().toLowerCase();
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Main controller for DOM discovery, API scheduling, rendering, filtering,
     * and persistent caching.
     */
    class XLocationFlags {
        constructor() {
            this.cache = new Map();
            this.inFlight = new Map();
            this.queue = [];
            this.queueRunning = false;
            this.lastRequestTime = 0;
            this.rateLimitReset = 0;
            this.elementState = new WeakMap();
            this.cacheDirty = false;
            this.cacheSaveTimer = 0;
            this.touchTooltip = null;
            this.touchTooltipTimer = 0;
            this.blockedLocationKeys = this.buildBlockedLocationSet();
            this.mutationObserver = null;
            this.intersectionObserver = null;

            this.loadCache();
            this.initWhenReady();
        }

        /**
         * Convert configured locations to canonical blocker keys.
         *
         * Country aliases sharing a flag share one blocker key, while region
         * keys stay distinct even when their visible emoji is identical.
         */
        buildBlockedLocationSet() {
            const blocked = new Set();
            for (const rawName of USER_CONFIG.BLOCKED_COUNTRIES) {
                const marker = this.getLocationMarker(rawName);
                if (marker) blocked.add(marker.blockKey);
            }
            return blocked;
        }

        getLocationMarker(location) {
            const key = normalizeCountry(location);
            if (!key) return null;

            const flag = COUNTRY_FLAGS[key];
            if (flag) return { emoji: flag, blockKey: `country:${flag}` };

            const region = REGION_MARKERS[key];
            if (region) return { emoji: region[0], blockKey: `region:${region[1]}` };

            return null;
        }

        /**
         * Start observers once X has a usable document body.
         */
        initWhenReady() {
            const start = () => {
                if (!document.body) return;
                this.injectStyles();
                this.createIntersectionObserver();
                this.startMutationObserver();
                this.scan(document.body);

                // Cache writes are already debounced after successful requests. These
                // lifecycle hooks make persistence robust across navigation/browser exits.
                addEventListener('pagehide', () => {
                    this.hideTouchTooltip();
                    this.saveCache();
                });
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') {
                        this.hideTouchTooltip();
                        this.saveCache();
                    }
                });
                document.addEventListener('click', event => {
                    if (this.touchTooltip && !event.target.closest?.(`.${CONFIG.FLAG_CLASS}`)) {
                        this.hideTouchTooltip();
                    }
                }, true);
                addEventListener('scroll', () => this.hideTouchTooltip(), { passive: true, capture: true });
                addEventListener('resize', () => this.hideTouchTooltip(), { passive: true });
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', start, { once: true });
            } else {
                start();
            }
        }

        /**
         * Inject the small stylesheet used for flags and post filtering.
         */
        injectStyles() {
            if (document.getElementById(CONFIG.STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = CONFIG.STYLE_ID;
            style.textContent = `
                .${CONFIG.FLAG_CLASS} {
                    display: inline-flex;
                    align-items: center;
                    flex: 0 0 auto;
                    margin-left: 4px;
                    vertical-align: middle;
                    line-height: 1;
                    font-size: 14px;
                    cursor: help;
                }
                .${CONFIG.FLAG_CLASS} img {
                    width: 1.2em;
                    height: 1.2em;
                    display: block;
                }
                .${CONFIG.FLAG_CLASS}[data-state="pending"] {
                    opacity: 0.58;
                    cursor: wait;
                    font-size: 13px;
                }
                .${CONFIG.TOOLTIP_CLASS} {
                    position: fixed;
                    z-index: 2147483647;
                    max-width: min(260px, calc(100vw - 24px));
                    padding: 7px 10px;
                    border-radius: 8px;
                    background: rgba(15, 20, 25, 0.96);
                    color: rgb(239, 243, 244);
                    font: 600 13px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
                    pointer-events: none;
                    white-space: normal;
                    text-align: center;
                }
                [${CONFIG.FILTER_ATTR}="hide"] {
                    display: none !important;
                }
                article[${CONFIG.FILTER_ATTR}="highlight"] {
                    box-shadow: inset 0 0 0 3px rgba(244, 33, 46, 0.92) !important;
                    border-radius: 0 !important;
                }
                article[${CONFIG.FILTER_ATTR}="dim"] {
                    opacity: 0.42 !important;
                    filter: brightness(0.62) saturate(0.72) !important;
                    transition: opacity 120ms ease, filter 120ms ease !important;
                }
                article[${CONFIG.FILTER_ATTR}="dim"]:hover {
                    opacity: 1 !important;
                    filter: none !important;
                }
                article[${CONFIG.FILTER_ATTR}="collapse"] {
                    display: none !important;
                }
                .${CONFIG.COLLAPSE_CLASS} {
                    width: 100%;
                    box-sizing: border-box;
                    padding: 10px 16px;
                    border: 0;
                    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
                    background: rgba(127, 127, 127, 0.055);
                    color: inherit;
                    opacity: 0.7;
                    font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    text-align: left;
                    cursor: pointer;
                }
                .${CONFIG.COLLAPSE_CLASS}:hover,
                .${CONFIG.COLLAPSE_CLASS}:focus-visible {
                    opacity: 1;
                    background: rgba(127, 127, 127, 0.1);
                    outline: none;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        }

        /**
         * Prefetch uncached users before they enter the viewport. Cached users
         * are rendered immediately and never wait for this observer.
         */
        createIntersectionObserver() {
            if (!('IntersectionObserver' in globalThis)) return;
            this.intersectionObserver = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    this.intersectionObserver.unobserve(entry.target);
                    this.processElement(entry.target);
                }
            }, { rootMargin: CONFIG.VIEWPORT_MARGIN });
        }

        /**
         * Discover usernames added by X's React single-page application.
         */
        startMutationObserver() {
            this.mutationObserver = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        // Ignore our own badge insertion so it does not trigger a redundant
                        // reconciliation pass through the same username container.
                        if (node.classList?.contains(CONFIG.FLAG_CLASS)) continue;
                        this.scan(node);

                        // React may update a descendant while reusing the username container.
                        const owner = node.closest?.(CONFIG.SELECTOR);
                        if (owner) this.registerElement(owner);
                    }
                }
            });
            this.mutationObserver.observe(document.body, { childList: true, subtree: true });
        }

        scan(root) {
            if (root.nodeType !== Node.ELEMENT_NODE) return;
            if (root.matches?.(CONFIG.SELECTOR)) this.registerElement(root);
            root.querySelectorAll?.(CONFIG.SELECTOR).forEach(el => this.registerElement(el));
        }

        /**
         * Register or reconcile one username container. This is intentionally
         * idempotent because X frequently reuses/re-renders DOM nodes.
         */
        registerElement(element) {
            const screenName = this.extractUsername(element);
            if (!screenName) return;

            const key = normalizeScreenName(screenName);
            const previous = this.elementState.get(element);

            if (previous?.screenName === key && previous.status !== 'stale') {
                // X frequently re-renders tweet internals. Reconcile cached/pending state
                // so the badge and filtering survive those renders without another API call.
                const cached = this.getCached(key);
                if (cached && previous.status === 'done') {
                    this.applyResult(element, key, cached);
                } else if (!cached && (previous.status === 'waiting' || previous.status === 'processing')) {
                    this.renderPending(element, key);
                }
                return;
            }

            if (previous && previous.screenName !== key) this.resetElement(element);
            this.elementState.set(element, { screenName: key, status: 'waiting' });

            const cached = this.getCached(key);
            if (cached) {
                this.applyResult(element, key, cached);
                return;
            }

            // Show immediately that this account is waiting for an X location lookup.
            this.renderPending(element, key);

            if (this.intersectionObserver) this.intersectionObserver.observe(element);
            else this.processElement(element);
        }

        resetElement(element) {
            this.intersectionObserver?.unobserve(element);
            element.querySelector(`.${CONFIG.FLAG_CLASS}`)?.remove();

            const tweet = element.closest('article[data-testid="tweet"]');
            if (tweet && this.isPrimaryTweetAuthor(element, tweet)) this.clearTweetFilter(tweet);
        }

        /**
         * Resolve one uncached username after it enters the prefetch region.
         */
        async processElement(element) {
            const state = this.elementState.get(element);
            if (!state || state.status === 'processing' || state.status === 'done') return;
            if (!element.isConnected) return;

            const current = normalizeScreenName(this.extractUsername(element));
            if (!current || current !== state.screenName) {
                state.status = 'stale';
                this.registerElement(element);
                return;
            }

            state.status = 'processing';
            this.renderPending(element, state.screenName);
            try {
                const info = await this.fetchUserInfo(state.screenName, this.getViewportPriority(element));
                if (!element.isConnected) return;

                const latest = normalizeScreenName(this.extractUsername(element));
                if (latest !== state.screenName) {
                    state.status = 'stale';
                    this.registerElement(element);
                    return;
                }

                this.applyResult(element, state.screenName, info);
            } catch {
                state.status = 'error';
                element.querySelector(`.${CONFIG.FLAG_CLASS}[data-state="pending"]`)?.remove();
            }
        }

        applyResult(element, screenName, info) {
            const state = this.elementState.get(element);
            if (state?.screenName !== screenName) return;

            const location = info?.location || null;
            const blocked = this.isBlockedLocation(location);
            const tweet = element.closest('article[data-testid="tweet"]');
            const primaryAuthor = tweet && this.isPrimaryTweetAuthor(element, tweet);

            if (primaryAuthor) this.applyTweetFilter(tweet, blocked, location);

            // A completely hidden primary-author tweet does not need a badge rendered.
            const action = this.getBlockedPostAction();
            if (!(primaryAuthor && blocked && (action === 'hide' || action === 'collapse'))) {
                this.renderFlag(element, screenName, location);
            } else {
                element.querySelector(`.${CONFIG.FLAG_CLASS}`)?.remove();
            }

            if (state) state.status = 'done';
        }

        isPrimaryTweetAuthor(element, tweet) {
            return tweet.querySelector(CONFIG.SELECTOR) === element;
        }

        getTweetCell(tweet) {
            return tweet.closest('[data-testid="cellInnerDiv"]') || tweet;
        }

        clearTweetFilter(tweet) {
            if (tweet.hasAttribute(CONFIG.FILTER_ATTR)) tweet.removeAttribute(CONFIG.FILTER_ATTR);
            const cell = this.getTweetCell(tweet);
            if (cell !== tweet && cell.hasAttribute(CONFIG.FILTER_ATTR)) cell.removeAttribute(CONFIG.FILTER_ATTR);
            cell.querySelector(`.${CONFIG.COLLAPSE_CLASS}`)?.remove();
        }

        getBlockedPostAction() {
            const action = String(USER_CONFIG.BLOCKED_POST_ACTION || 'hide').toLowerCase();
            return action === 'highlight' || action === 'dim' || action === 'collapse'
                ? action
                : 'hide';
        }

        getCollapseLabel(location, expanded = false) {
            const marker = this.getLocationMarker(location);
            const emoji = marker?.emoji ? `${marker.emoji} ` : '';
            const name = typeof location === 'string' && location.trim()
                ? location.trim()
                : 'blocked location';
            return expanded
                ? `${emoji}Post from blocked location: ${name} — click to collapse`
                : `${emoji}Post from blocked location: ${name} — click to show`;
        }

        applyCollapsedPost(tweet, location) {
            const cell = this.getTweetCell(tweet);
            let notice = cell.querySelector(`.${CONFIG.COLLAPSE_CLASS}`);
            const currentState = tweet.getAttribute(CONFIG.FILTER_ATTR);
            const expanded = currentState === 'collapse-open';

            if (!notice) {
                notice = document.createElement('button');
                notice.type = 'button';
                notice.className = CONFIG.COLLAPSE_CLASS;
                cell.insertBefore(notice, cell.firstChild);

                notice.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const isOpen = tweet.getAttribute(CONFIG.FILTER_ATTR) === 'collapse-open';
                    tweet.setAttribute(CONFIG.FILTER_ATTR, isOpen ? 'collapse' : 'collapse-open');
                    notice.textContent = this.getCollapseLabel(location, !isOpen);
                    notice.setAttribute('aria-expanded', String(!isOpen));
                });
            }

            tweet.setAttribute(CONFIG.FILTER_ATTR, expanded ? 'collapse-open' : 'collapse');
            notice.textContent = this.getCollapseLabel(location, expanded);
            notice.setAttribute('aria-expanded', String(expanded));
        }

        /**
         * Apply filtering only to the tweet's primary author.
         *
         * Hidden posts remove the complete timeline cell so X's separator does
         * not remain behind. Highlighted, dimmed, and collapsed posts remain
         * represented in the feed.
         */
        applyTweetFilter(tweet, blocked, location) {
            const cell = this.getTweetCell(tweet);

            if (!blocked) {
                this.clearTweetFilter(tweet);
                return;
            }

            const action = this.getBlockedPostAction();

            if (action === 'highlight') {
                if (tweet.getAttribute(CONFIG.FILTER_ATTR) === 'highlight' &&
                    (cell === tweet || !cell.hasAttribute(CONFIG.FILTER_ATTR))) return;
                this.clearTweetFilter(tweet);
                tweet.setAttribute(CONFIG.FILTER_ATTR, 'highlight');
                return;
            }

            if (action === 'dim') {
                if (tweet.getAttribute(CONFIG.FILTER_ATTR) === 'dim' &&
                    (cell === tweet || !cell.hasAttribute(CONFIG.FILTER_ATTR))) return;
                this.clearTweetFilter(tweet);
                tweet.setAttribute(CONFIG.FILTER_ATTR, 'dim');
                return;
            }

            if (action === 'collapse') {
                if (cell !== tweet && cell.hasAttribute(CONFIG.FILTER_ATTR)) {
                    cell.removeAttribute(CONFIG.FILTER_ATTR);
                }
                this.applyCollapsedPost(tweet, location);
                return;
            }

            if (cell.getAttribute(CONFIG.FILTER_ATTR) === 'hide' &&
                (cell === tweet || !tweet.hasAttribute(CONFIG.FILTER_ATTR))) return;
            this.clearTweetFilter(tweet);
            cell.setAttribute(CONFIG.FILTER_ATTR, 'hide');
        }

        isBlockedLocation(location) {
            if (!location || this.blockedLocationKeys.size === 0) return false;
            const marker = this.getLocationMarker(location);
            return Boolean(marker && this.blockedLocationKeys.has(marker.blockKey));
        }

        /**
         * Show an hourglass while an uncached location lookup is pending; a resolved response with no location becomes ❓.
         */
        renderPending(element, screenName) {
            const existing = element.querySelector(`.${CONFIG.FLAG_CLASS}`);
            if (existing?.dataset.state === 'pending') return;
            // Never replace an already resolved flag with a pending marker.
            if (existing) return;

            const insertion = this.findInsertionPoint(element, screenName);
            if (!insertion) return;

            const badge = document.createElement('span');
            badge.className = CONFIG.FLAG_CLASS;
            badge.dataset.state = 'pending';
            badge.title = 'Waiting for X account location…';
            badge.textContent = '⏳';
            insertion.target.insertBefore(badge, insertion.ref);
        }

        /**
         * Show a touch-friendly tooltip. Desktop hover behavior still comes
         * from the native title attribute.
         */
        showTouchTooltip(badge, label) {
            this.hideTouchTooltip();

            const tooltip = document.createElement('div');
            tooltip.className = CONFIG.TOOLTIP_CLASS;
            tooltip.textContent = label;
            document.body.appendChild(tooltip);

            const badgeRect = badge.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const gap = 8;

            let left = badgeRect.left + (badgeRect.width - tooltipRect.width) / 2;
            left = Math.max(12, Math.min(left, innerWidth - tooltipRect.width - 12));

            let top = badgeRect.top - tooltipRect.height - gap;
            if (top < 8) top = badgeRect.bottom + gap;
            top = Math.max(8, Math.min(top, innerHeight - tooltipRect.height - 8));

            tooltip.style.left = `${Math.round(left)}px`;
            tooltip.style.top = `${Math.round(top)}px`;

            this.touchTooltip = tooltip;
            this.touchTooltipTimer = setTimeout(() => this.hideTouchTooltip(), 2200);
        }

        hideTouchTooltip() {
            if (this.touchTooltipTimer) {
                clearTimeout(this.touchTooltipTimer);
                this.touchTooltipTimer = 0;
            }
            this.touchTooltip?.remove();
            this.touchTooltip = null;
        }

        attachTooltipInteraction(badge, label) {
            badge.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.showTouchTooltip(badge, label);
            });
        }

        /**
         * Replace the pending marker with the resolved country flag, region
         * symbol, or an explicit marker when X has no usable location.
         */
        renderFlag(element, screenName, location) {
            const existing = element.querySelector(`.${CONFIG.FLAG_CLASS}`);
            const marker = this.getLocationMarker(location);
            const hasLocation = typeof location === 'string' && location.trim().length > 0;
            const locationKey = hasLocation ? normalizeCountry(location) : '__no_location__';

            if (existing?.dataset.state === 'resolved' &&
                existing.dataset.locationKey === locationKey) return;
            existing?.remove();

            const insertion = this.findInsertionPoint(element, screenName);
            if (!insertion) return;

            const badge = document.createElement('span');
            badge.className = CONFIG.FLAG_CLASS;
            badge.dataset.state = 'resolved';
            badge.dataset.locationKey = locationKey;

            let emoji;
            let label;

            if (!hasLocation) {
                emoji = NO_LOCATION_MARKER;
                label = 'No location available';
            } else if (marker) {
                emoji = marker.emoji;
                label = location;
            } else {
                // Preserve visibility if X introduces a new region/string before
                // the lookup table is updated.
                emoji = UNKNOWN_LOCATION_MARKER;
                label = location;
            }

            badge.title = label;
            badge.setAttribute('aria-label', label);
            this.attachTooltipInteraction(badge, label);

            if (this.isWindows() && this.isFlagEmoji(emoji)) {
                const img = document.createElement('img');
                img.src = `https://abs-0.twimg.com/emoji/v2/svg/${this.emojiCodePoints(emoji)}.svg`;
                img.alt = emoji;
                img.referrerPolicy = 'no-referrer';
                badge.appendChild(img);
            } else {
                badge.textContent = emoji;
            }

            insertion.target.insertBefore(badge, insertion.ref);
        }

        isWindows() {
            return /Windows/i.test(navigator.userAgent || navigator.platform || '');
        }

        isFlagEmoji(emoji) {
            const points = Array.from(emoji, char => char.codePointAt(0));
            const regionalFlag = points.length === 2 &&
                points.every(point => point >= 0x1F1E6 && point <= 0x1F1FF);
            const subdivisionFlag = points.includes(0xE007F);
            return regionalFlag || subdivisionFlag;
        }

        emojiCodePoints(emoji) {
            return Array.from(emoji, char => char.codePointAt(0).toString(16)).join('-');
        }

        extractUsername(element) {
            const links = element.querySelectorAll('a[href^="/"]');
            let fallback = null;

            for (const link of links) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
                if (!match) continue;

                const username = match[1];
                if (RESERVED_PATHS.has(username.toLowerCase())) continue;
                if (link.textContent.trim().toLowerCase() === `@${username.toLowerCase()}`) return username;
                fallback ||= username;
            }

            if (fallback) return fallback;

            for (const node of element.querySelectorAll('span, div[dir="ltr"]')) {
                const text = node.textContent.trim();
                const match = text.match(/^@([A-Za-z0-9_]{1,15})$/);
                if (match) return match[1];
            }

            return null;
        }

        findInsertionPoint(container, screenName) {
            const escaped = CSS.escape(screenName);
            const isProfileHeader =
                (!container.querySelector('time') && container.querySelector('[data-testid="userFollowIndicator"]')) ||
                (container.getAttribute('data-testid') === 'UserName' && String(container.className).includes('r-14gqq1x'));

            if (isProfileHeader) {
                const nameContainer = container.querySelector('div[dir="ltr"]');
                if (nameContainer) return { target: nameContainer, ref: null };
            }

            for (const link of container.querySelectorAll('a')) {
                if (link.textContent.trim().toLowerCase() !== `@${screenName.toLowerCase()}`) continue;
                const wrapper = link.parentNode;
                if (wrapper?.parentNode) return { target: wrapper.parentNode, ref: wrapper.nextSibling };
            }

            const nameLink = container.querySelector(`a[href="/${escaped}" i]`);
            if (nameLink?.parentNode) return { target: nameLink.parentNode, ref: nameLink.nextSibling };

            return null;
        }

        getViewportPriority(element) {
            const rect = element.getBoundingClientRect();
            const viewportHeight = innerHeight || document.documentElement.clientHeight || 0;
            if (rect.bottom >= 0 && rect.top <= viewportHeight) return 0;
            if (rect.top > viewportHeight) return rect.top - viewportHeight;
            return viewportHeight + Math.abs(rect.bottom);
        }

        getCookie(name) {
            const prefix = `${name}=`;
            for (const part of document.cookie.split(';')) {
                const cookie = part.trim();
                if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length));
            }
            return null;
        }

        getApiHeaders() {
            const csrf = this.getCookie('ct0');
            if (!csrf) return null;

            return {
                'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                'x-csrf-token': csrf,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuthSession',
                'x-twitter-client-language': 'en',
                'accept-language': 'en-US,en;q=0.9',
                'accept': '*/*',
                'content-type': 'application/json',
            };
        }

        /**
         * Return cached data, share an existing in-flight request, or enqueue
         * exactly one new lookup for this username.
         */
        fetchUserInfo(screenName, priority = Number.POSITIVE_INFINITY) {
            const key = normalizeScreenName(screenName);
            const cached = this.getCached(key);
            if (cached) return Promise.resolve(cached);

            const existing = this.inFlight.get(key);
            if (existing) return existing;

            let resolveTask;
            let rejectTask;
            const promise = new Promise((resolve, reject) => {
                resolveTask = resolve;
                rejectTask = reject;
            });

            this.inFlight.set(key, promise);
            this.queue.push({ screenName: key, resolve: resolveTask, reject: rejectTask, attempts: 0, priority });
            // Nearer/visible posts are queried first when several off-screen posts enter
            // the prefetch margin at once.
            this.queue.sort((a, b) => a.priority - b.priority);
            promise.then(
                () => this.inFlight.delete(key),
                () => this.inFlight.delete(key)
            );
            this.runQueue();
            return promise;
        }

        /**
         * Process queued requests conservatively to reduce rate-limit pressure; failures are handled silently.
         */
        async runQueue() {
            if (this.queueRunning) return;
            this.queueRunning = true;

            try {
                while (this.queue.length) {
                    const now = Date.now();
                    if (this.rateLimitReset > now) await wait(this.rateLimitReset - now);

                    const sinceLast = Date.now() - this.lastRequestTime;
                    if (sinceLast < CONFIG.API.MIN_INTERVAL) await wait(CONFIG.API.MIN_INTERVAL - sinceLast);

                    const task = this.queue.shift();
                    try {
                        this.lastRequestTime = Date.now();
                        const result = await this.executeApiCall(task.screenName);
                        this.setCached(task.screenName, result);
                        task.resolve(result);
                    } catch (error) {
                        const retryable = error?.retryable === true;
                        if (retryable && task.attempts < CONFIG.API.MAX_RETRIES) {
                            task.attempts++;
                            if (error.retryAt) this.rateLimitReset = Math.max(this.rateLimitReset, error.retryAt);
                            else await wait(CONFIG.API.RETRY_DELAY);
                            this.queue.unshift(task);
                        } else {
                            task.reject(error);
                        }
                    }
                }
            } finally {
                this.queueRunning = false;
                if (this.queue.length) this.runQueue();
            }
        }

        /**
         * Query X's internal AboutAccountQuery using the logged-in X session.
         */
        async executeApiCall(screenName) {
            const headers = this.getApiHeaders();
            if (!headers) throw new Error('No X CSRF token (ct0) is available; make sure you are logged in to X.');

            const variables = encodeURIComponent(JSON.stringify({ screenName }));
            const url = `https://x.com/i/api/graphql/${CONFIG.API.QUERY_ID}/AboutAccountQuery?variables=${variables}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.API.REQUEST_TIMEOUT);

            let response;
            try {
                response = await fetch(url, {
                    method: 'GET',
                    headers,
                    credentials: 'include',
                    mode: 'cors',
                    signal: controller.signal,
                });
            } catch (error) {
                if (error?.name === 'AbortError') {
                    const timeoutError = new Error('X API request timed out');
                    timeoutError.retryable = true;
                    throw timeoutError;
                }
                const networkError = new Error(error?.message || 'X API network error');
                networkError.retryable = true;
                throw networkError;
            } finally {
                clearTimeout(timeout);
            }

            if (!response.ok) {
                const error = new Error(`X API returned HTTP ${response.status}`);
                if (response.status === 429) {
                    const reset = Number(response.headers.get('x-rate-limit-reset')) * 1000;
                    error.retryable = true;
                    error.retryAt = Number.isFinite(reset) && reset > Date.now()
                        ? reset
                        : Date.now() + 60_000;
                } else if (response.status >= 500) {
                    error.retryable = true;
                }
                throw error;
            }

            const data = await response.json();
            const profile = data?.data?.user_result_by_screen_name?.result?.about_profile;

            return {
                location: typeof profile?.account_based_in === 'string' ? profile.account_based_in : null,
            };
        }

        /**
         * Load the persistent cache and migrate still-valid entries from the
         * original userscript's older cache format.
         */
        loadCache() {
            let migratedLegacy = false;
            try {
                const now = Date.now();
                const raw = localStorage.getItem(CONFIG.CACHE_KEY);

                if (raw) {
                    const parsed = JSON.parse(raw);
                    for (const [screenName, entry] of Object.entries(parsed)) {
                        if (!entry?.value) continue;

                        const location = entry.value.location || null;
                        const fetchedAt = Number(entry.fetchedAt) || now;
                        const lifetime = location ? CONFIG.CACHE_EXPIRY : CONFIG.EMPTY_CACHE_EXPIRY;
                        const expiresAt = fetchedAt + lifetime;

                        if (expiresAt <= now) continue;

                        this.cache.set(normalizeScreenName(screenName), {
                            value: { location },
                            fetchedAt,
                            expiresAt,
                        });
                    }
                }

                // Import still-valid entries from the original userscript cache once.
                // This avoids throwing away useful location lookups when upgrading.
                for (const legacyKey of CONFIG.LEGACY_CACHE_KEYS) {
                    const legacyRaw = localStorage.getItem(legacyKey);
                    if (!legacyRaw) continue;

                    let legacy;
                    try { legacy = JSON.parse(legacyRaw); } catch { continue; }
                    for (const [screenName, entry] of Object.entries(legacy)) {
                        const key = normalizeScreenName(screenName);
                        const location = entry?.value?.location || null;

                        // Do not migrate old empty results; re-query them so a temporary
                        // missing response cannot become a long-lived false "no location".
                        if (this.cache.has(key) || !location || Number(entry.expiry) <= now) continue;

                        this.cache.set(key, {
                            value: { location },
                            fetchedAt: now,
                            expiresAt: now + CONFIG.CACHE_EXPIRY,
                        });
                        migratedLegacy = true;
                    }
                }

                this.pruneCache();
                if (migratedLegacy) {
                    this.cacheDirty = true;
                    this.saveCache(true);
                }
            } catch {
                try { localStorage.removeItem(CONFIG.CACHE_KEY); } catch {}
            }
        }

        getCached(screenName) {
            const key = normalizeScreenName(screenName);
            const entry = this.cache.get(key);
            if (!entry) return null;
            if (entry.expiresAt <= Date.now()) {
                this.cache.delete(key);
                this.markCacheDirty();
                return null;
            }
            return entry.value;
        }

        setCached(screenName, value) {
            const now = Date.now();
            const location = value?.location || null;
            this.cache.set(normalizeScreenName(screenName), {
                value: { location },
                fetchedAt: now,
                expiresAt: now + (location ? CONFIG.CACHE_EXPIRY : CONFIG.EMPTY_CACHE_EXPIRY),
            });
            this.pruneCache();
            this.markCacheDirty();
        }

        /**
         * Remove expired entries and evict the oldest entries above the cap.
         */
        pruneCache() {
            const now = Date.now();
            for (const [key, entry] of this.cache) {
                if (entry.expiresAt <= now) this.cache.delete(key);
            }

            const excess = this.cache.size - CONFIG.CACHE_MAX_ENTRIES;
            if (excess <= 0) return;

            const oldest = [...this.cache.entries()]
                .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
                .slice(0, excess);
            for (const [key] of oldest) this.cache.delete(key);
        }

        markCacheDirty() {
            this.cacheDirty = true;
            clearTimeout(this.cacheSaveTimer);
            this.cacheSaveTimer = setTimeout(() => this.saveCache(), CONFIG.CACHE_SAVE_DELAY);
        }

        /**
         * Persist cached account locations to localStorage.
         */
        saveCache(force = false) {
            if (!this.cacheDirty && !force) return;
            clearTimeout(this.cacheSaveTimer);
            this.cacheSaveTimer = 0;
            this.pruneCache();

            try {
                const data = Object.fromEntries(this.cache);
                localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(data));
                this.cacheDirty = false;
            } catch {}
        }
    }

    const instance = new XLocationFlags();
    globalThis[INSTANCE_KEY] = instance;
})();