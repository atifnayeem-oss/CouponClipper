/**
 * CouponClipper — Popup Script
 *
 * Runs in the context of src/popup.html.
 * Responsibilities:
 *  1. Query the active tab to determine whether the user is on a Safeway page.
 *  2. Update the status card in the popup UI to reflect that state.
 *  3. Wire up the "Go to Safeway Coupons" button.
 */

'use strict';

/** The canonical URL for the Safeway digital coupons page. */
const SAFEWAY_COUPONS_URL = 'https://www.safeway.com/loyalty/coupons-deals';

/** Hostname fragment that identifies any Safeway page. */
const SAFEWAY_HOST = 'safeway.com';

/** URL path fragments that indicate we're on the coupons/deals section. */
const COUPON_PATH_FRAGMENTS = ['/loyalty/coupons', '/coupon'];

// ─── DOM references ──────────────────────────────────────────────────────────

const statusCard   = document.getElementById('status-card');
const statusIcon   = document.getElementById('status-icon');
const statusTitle  = document.getElementById('status-title');
const statusDetail = document.getElementById('status-detail');
const btnGo        = document.getElementById('btn-go');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the given URL string belongs to safeway.com.
 * @param {string} url
 * @returns {boolean}
 */
function isSafewayUrl(url) {
  try {
    return new URL(url).hostname.includes(SAFEWAY_HOST);
  } catch {
    return false;
  }
}

/**
 * Returns true if the given URL string is on the coupons/deals section.
 * @param {string} url
 * @returns {boolean}
 */
function isCouponsUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return COUPON_PATH_FRAGMENTS.some((frag) => path.includes(frag));
  } catch {
    return false;
  }
}

// ─── Status card updater ──────────────────────────────────────────────────────

/**
 * Renders the status card based on the current tab's URL.
 *
 * Three possible states:
 *  - "on coupons page"  → green card, prompt to click the floating button
 *  - "on safeway.com"   → neutral card, prompt to navigate to coupons
 *  - "off safeway.com"  → neutral card, prompt to open Safeway
 *
 * @param {string|null} tabUrl  URL of the active tab, or null if unavailable.
 */
function updateStatusCard(tabUrl) {
  if (!tabUrl) {
    // Could not determine the tab URL (e.g. chrome:// pages).
    statusCard.className  = 'status-card status-inactive';
    statusIcon.textContent  = 'ℹ️';
    statusTitle.textContent = 'Not on a Safeway page';
    statusDetail.textContent =
      'Open a Safeway tab, then click "Go to Safeway Coupons" below.';
    return;
  }

  if (isCouponsUrl(tabUrl) && isSafewayUrl(tabUrl)) {
    // Best case — user is already on the coupons page.
    statusCard.className  = 'status-card status-active';
    statusIcon.textContent  = '✅';
    statusTitle.textContent = 'Ready to clip!';
    statusDetail.textContent =
      'You're on the Safeway coupons page. Click the green ✂ button in the bottom-right corner of the page.';
  } else if (isSafewayUrl(tabUrl)) {
    // On Safeway but not on the coupons page yet.
    statusCard.className  = 'status-card status-inactive';
    statusIcon.textContent  = '🛒';
    statusTitle.textContent = 'On Safeway — not on coupons page';
    statusDetail.textContent =
      'Click "Go to Safeway Coupons" below to navigate to the deals page.';
  } else {
    // Not on Safeway at all.
    statusCard.className  = 'status-card status-inactive';
    statusIcon.textContent  = 'ℹ️';
    statusTitle.textContent = 'Not on a Safeway page';
    statusDetail.textContent =
      'Click "Go to Safeway Coupons" to open the Safeway deals page in this tab.';
  }
}

// ─── "Go to Safeway Coupons" button ──────────────────────────────────────────

/**
 * Navigates the active tab to the Safeway coupons page.
 * Falls back to opening a new tab if the active tab is a protected page
 * (e.g. chrome://newtab) where navigation is not permitted.
 */
btnGo.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.id) {
      await chrome.tabs.update(tab.id, { url: SAFEWAY_COUPONS_URL });
    } else {
      await chrome.tabs.create({ url: SAFEWAY_COUPONS_URL });
    }
  } catch (err) {
    // If updating the tab fails (e.g. restricted page), open a new tab.
    console.warn('[CouponClipper popup] Could not update tab, opening new tab:', err);
    await chrome.tabs.create({ url: SAFEWAY_COUPONS_URL });
  }

  // Close the popup after navigating so it doesn't obscure the page.
  window.close();
});

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * On popup open, query the active tab URL and update the status card.
 */
(async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateStatusCard(tab?.url ?? null);
  } catch (err) {
    console.warn('[CouponClipper popup] Could not query active tab:', err);
    updateStatusCard(null);
  }
})();
