/**
 * CouponClipper - Safeway Bulk Coupon Clipper
 * Content script injected into Safeway pages.
 *
 * Responsibilities:
 *  1. Detect when the user is on the coupons/deals page.
 *  2. Inject a floating "Clip All Coupons" button.
 *  3. Scan, click, and track every unclipped coupon button on the page,
 *     including those loaded via infinite scroll.
 *  4. Show live progress and a completion toast.
 */

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────

  /** Milliseconds to wait between individual coupon clicks (rate-limit guard). */
  const CLICK_DELAY_MS = 300;

  /** Milliseconds to wait after scrolling before re-scanning for new coupons. */
  const SCROLL_WAIT_MS = 1000;

  /** Pixels to scroll down each time we look for more lazy-loaded coupons. */
  const SCROLL_STEP_PX = 500;

  /** How many consecutive scroll attempts with no new coupons before we stop. */
  const MAX_EMPTY_SCROLLS = 3;

  /** Duration (ms) the completion toast is visible before fading out. */
  const TOAST_DURATION_MS = 5000;

  /** IDs for injected DOM elements so we never duplicate them. */
  const FLOAT_BTN_ID = 'couponclip-float-btn';
  const PROGRESS_BADGE_ID = 'couponclip-progress-badge';
  const TOAST_ID = 'couponclip-toast';

  // ─── State ────────────────────────────────────────────────────────────────

  /** True while clipAllCoupons() is actively running. */
  let isRunning = false;

  /** Set to true from outside the loop to request a graceful cancel. */
  let cancelRequested = false;

  // ─── Utility helpers ──────────────────────────────────────────────────────

  /**
   * Returns a Promise that resolves after `ms` milliseconds.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Returns true if the current page URL looks like the Safeway coupons page.
   * @returns {boolean}
   */
  function isOnCouponsPage() {
    const url = window.location.href.toLowerCase();
    return url.includes('/foru') || url.includes('/coupon');
  }

  // ─── Coupon button detection ───────────────────────────────────────────────

  /**
   * CSS selectors that may match an unclipped coupon clip button.
   * Listed from most-specific to least-specific so that targeted matches
   * are preferred and we avoid double-counting.
   */
  const CLIP_SELECTORS = [
    'button[data-testid*="clip"]',
    'button[aria-label*="clip" i]',
    '[class*="clip-btn"]',
    '[class*="coupon-clip"]',
  ];

  /**
   * Words that indicate a coupon has already been clipped.
   * We check both the button's visible text and its aria-label.
   */
  const CLIPPED_KEYWORDS = ['clipped', 'added', 'saved'];

  /**
   * Returns true if a button element represents an unclipped coupon.
   * Excludes disabled buttons and buttons whose text/aria-label contains
   * any of the CLIPPED_KEYWORDS.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function isUnclipped(el) {
    // Skip disabled buttons — the coupon was already clipped or unavailable.
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const text = (el.textContent || '').toLowerCase().trim();

    // Skip if the label or visible text indicates it has already been clipped.
    for (const kw of CLIPPED_KEYWORDS) {
      if (label.includes(kw) || text.includes(kw)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Scans the entire document for unclipped coupon buttons using a combination
   * of CSS selectors and text-content matching.
   *
   * Uses a Set to deduplicate elements that might be matched by multiple
   * selectors.
   *
   * @returns {Element[]} Array of unique unclipped coupon button elements.
   */
  function findUnclippedCoupons() {
    const seen = new Set();
    const results = [];

    // ── Selector-based matching ──────────────────────────────────────────
    for (const selector of CLIP_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (!seen.has(el) && isUnclipped(el)) {
            seen.add(el);
            results.push(el);
          }
        });
      } catch (err) {
        // A malformed selector should not crash the whole scan.
        console.warn('[CouponClipper] Selector error for:', selector, err);
      }
    }

    // ── Text-content matching for generic <button> elements ──────────────
    // Catches buttons like <button>Clip</button> or <button>Clip Coupon</button>
    // that don't carry any of the CSS classes/attributes above.
    const CLIP_TEXT_PATTERNS = /^(clip|clip coupon)$/i;

    document.querySelectorAll('button').forEach((btn) => {
      if (seen.has(btn)) return; // already captured above
      const text = (btn.textContent || '').trim();
      if (CLIP_TEXT_PATTERNS.test(text) && isUnclipped(btn)) {
        seen.add(btn);
        results.push(btn);
      }
    });

    return results;
  }

  // ─── Floating button ──────────────────────────────────────────────────────

  /**
   * Creates and injects the floating "Clip All Coupons" button into the page.
   * If the button already exists this is a no-op.
   */
  function injectFloatingButton() {
    if (document.getElementById(FLOAT_BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = FLOAT_BTN_ID;
    btn.className = 'couponclip-float-btn';
    btn.setAttribute('title', 'Clip all available coupons');
    btn.setAttribute('aria-label', 'Clip all coupons');

    // Scissor icon + label
    btn.innerHTML = `
      <span class="couponclip-icon" aria-hidden="true">✂</span>
      <span class="couponclip-label">Clip All Coupons</span>
      <span id="${PROGRESS_BADGE_ID}" class="couponclip-badge" aria-live="polite"></span>
    `;

    btn.addEventListener('click', handleFloatButtonClick);
    document.body.appendChild(btn);

    // Initial count update
    updateBadgeCount();
  }

  /**
   * Updates the badge on the floating button with the current count of
   * unclipped coupons visible on the page.
   */
  function updateBadgeCount() {
    const badge = document.getElementById(PROGRESS_BADGE_ID);
    if (!badge) return;

    if (isRunning) return; // Don't overwrite progress text while running.

    const count = findUnclippedCoupons().length;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  /**
   * Updates the badge text to show clipping progress.
   * @param {number} current
   * @param {number} total
   */
  function showProgress(current, total) {
    const badge = document.getElementById(PROGRESS_BADGE_ID);
    if (!badge) return;
    badge.textContent = `${current}/${total}`;
    badge.style.display = 'flex';
  }

  /**
   * Handles a click on the floating button.
   * - If clipping is already running, requests a cancel.
   * - Otherwise starts the clipping process.
   */
  function handleFloatButtonClick() {
    if (isRunning) {
      cancelRequested = true;
      setButtonState('cancelling');
      return;
    }
    clipAllCoupons();
  }

  /**
   * Updates the floating button's visual state.
   * @param {'idle'|'running'|'cancelling'} state
   */
  function setButtonState(state) {
    const btn = document.getElementById(FLOAT_BTN_ID);
    if (!btn) return;

    btn.classList.remove(
      'couponclip-state-idle',
      'couponclip-state-running',
      'couponclip-state-cancelling'
    );

    switch (state) {
      case 'running':
        btn.classList.add('couponclip-state-running');
        btn.querySelector('.couponclip-label').textContent = 'Clipping… (click to cancel)';
        break;
      case 'cancelling':
        btn.classList.add('couponclip-state-cancelling');
        btn.querySelector('.couponclip-label').textContent = 'Cancelling…';
        break;
      case 'idle':
      default:
        btn.classList.add('couponclip-state-idle');
        btn.querySelector('.couponclip-label').textContent = 'Clip All Coupons';
        break;
    }
  }

  // ─── Toast notifications ──────────────────────────────────────────────────

  /**
   * Shows a temporary toast notification at the bottom of the screen.
   * @param {string} message   Text to display.
   * @param {'success'|'info'|'error'} [type='success']
   */
  function showToast(message, type = 'success') {
    // Remove any existing toast.
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = `couponclip-toast couponclip-toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;

    document.body.appendChild(toast);

    // Trigger fade-in on next tick.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('couponclip-toast-visible'));
    });

    // Auto-dismiss.
    setTimeout(() => {
      toast.classList.remove('couponclip-toast-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, TOAST_DURATION_MS);
  }

  // ─── Core clipping logic ──────────────────────────────────────────────────

  /**
   * Main coupon-clipping routine.
   *
   * Algorithm:
   *  1. Find all currently-visible unclipped buttons and click them one by one.
   *  2. After exhausting the current viewport, scroll down to trigger lazy loading.
   *  3. Repeat until MAX_EMPTY_SCROLLS consecutive scrolls yield no new buttons.
   *
   * The function is async so we can await sleep() calls between clicks/scrolls
   * without blocking the browser's rendering thread.
   */
  async function clipAllCoupons() {
    if (isRunning) return;

    isRunning = true;
    cancelRequested = false;
    setButtonState('running');

    let totalClipped = 0;
    let emptyScrollCount = 0;

    try {
      while (!cancelRequested) {
        const buttons = findUnclippedCoupons();

        if (buttons.length === 0) {
          // No buttons visible — try scrolling to load more.
          if (emptyScrollCount >= MAX_EMPTY_SCROLLS) {
            // We've scrolled multiple times without finding new coupons. Done.
            break;
          }
          emptyScrollCount++;
          window.scrollBy({ top: SCROLL_STEP_PX, behavior: 'smooth' });
          await sleep(SCROLL_WAIT_MS);
          continue;
        }

        // We found new buttons — reset the empty-scroll counter.
        emptyScrollCount = 0;

        for (let i = 0; i < buttons.length; i++) {
          if (cancelRequested) break;

          const btn = buttons[i];

          try {
            // Scroll the button into view before clicking (helps with some
            // lazy-render implementations that only activate once visible).
            btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await sleep(100); // brief pause after scroll-into-view

            btn.click();
            totalClipped++;
          } catch (clickErr) {
            // A single failed click should not abort the whole run.
            console.warn('[CouponClipper] Failed to click coupon button:', clickErr);
          }

          // Show live progress.
          showProgress(totalClipped, totalClipped + (buttons.length - i - 1));

          // Rate-limit guard: wait before the next click.
          await sleep(CLICK_DELAY_MS);
        }

        // After processing a batch, scroll to load potentially more coupons.
        window.scrollBy({ top: SCROLL_STEP_PX, behavior: 'smooth' });
        await sleep(SCROLL_WAIT_MS);
      }
    } catch (err) {
      console.error('[CouponClipper] Unexpected error during clipping:', err);
      showToast('An error occurred while clipping. Please try again.', 'error');
    } finally {
      isRunning = false;
      cancelRequested = false;
      setButtonState('idle');
      updateBadgeCount();

      if (totalClipped > 0) {
        showToast(`Done! Clipped ${totalClipped} coupon${totalClipped !== 1 ? 's' : ''}.`);
      } else {
        showToast('No unclipped coupons found on this page.', 'info');
      }
    }
  }

  // ─── MutationObserver — live badge updates ────────────────────────────────

  /**
   * Watches for DOM changes (new coupons loaded via infinite scroll / XHR)
   * and refreshes the unclipped-coupon count on the badge.
   *
   * We debounce the handler to avoid hammering findUnclippedCoupons() on every
   * tiny DOM mutation.
   */
  let mutationDebounceTimer = null;

  const domObserver = new MutationObserver(() => {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(updateBadgeCount, 400);
  });

  // ─── Initialisation ───────────────────────────────────────────────────────

  /**
   * Entry point — called once the script loads.
   * Only injects the UI if we're on a relevant Safeway coupons page.
   * Also handles Single Page App (SPA) navigation by watching for URL changes.
   */
  function init() {
    if (isOnCouponsPage()) {
      injectFloatingButton();
      domObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  /**
   * Safeway uses a React SPA, so the content script may load before the page
   * navigates to the coupons URL. We watch for URL changes via a polling loop
   * and re-initialise when the route changes to the coupons page.
   */
  let lastUrl = window.location.href;

  const urlWatcher = setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;

      // Remove the button if we navigated away from coupons.
      if (!isOnCouponsPage()) {
        const btn = document.getElementById(FLOAT_BTN_ID);
        if (btn) btn.remove();
        domObserver.disconnect();
      } else {
        // Re-inject if we navigated onto a coupons page.
        injectFloatingButton();
        domObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
  }, 1000);

  // Clean up interval if the page is ever fully unloaded.
  window.addEventListener('beforeunload', () => clearInterval(urlWatcher));

  // Kick everything off.
  init();
})();
