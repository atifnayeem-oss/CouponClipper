/**
 * clipper.js
 *
 * Puppeteer automation that logs in to Safeway and clips every available
 * digital coupon. Progress is reported via an onProgress callback so callers
 * can stream updates to connected clients without blocking.
 *
 * Exported:
 *   clipCoupons(email, password, onProgress) -> Promise<void>
 */

const puppeteer = require('puppeteer-core');

// Path to the Chromium executable. Falls back to a common Playwright-managed
// location so the app works without downloading a separate Chrome binary.
// Override by setting the CHROMIUM_PATH environment variable.
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGN_IN_URL  = 'https://www.safeway.com/account/sign-in.html';
const COUPONS_URL  = 'https://www.safeway.com/loyalty/coupons-deals';

// CSS selectors that identify "Clip" buttons that have NOT yet been clicked.
// Listed from most specific to most generic so the most reliable match wins.
const CLIP_SELECTORS = [
  'button[data-testid*="clip"]:not([disabled])',
  'button[aria-label*="clip" i]:not([disabled])',
  '[class*="coupon-clip"]:not([disabled])',
];

// After this many consecutive scroll iterations with no new buttons we stop.
const MAX_IDLE_SCROLLS = 4;

// Pixels to scroll down each iteration to trigger lazy-loading.
const SCROLL_STEP = 600;

// Time (ms) to wait between scroll iterations.
const SCROLL_WAIT_MS = 1500;

// Time (ms) to wait between individual coupon clicks.
const CLICK_WAIT_MS = 400;

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Logs in to Safeway and clips all available digital coupons.
 *
 * @param {string}   email      - Safeway account email address
 * @param {string}   password   - Safeway account password
 * @param {Function} onProgress - Callback: ({ type, message, clipped, total })
 *                                  type  : 'progress' | 'done' | 'error'
 */
async function clipCoupons(email, password, onProgress) {
  let browser;

  // Helper to emit progress events without repeating the shape everywhere.
  let clippedCount = 0;
  const progress = (message, total = 0) =>
    onProgress({ type: 'progress', message, clipped: clippedCount, total });

  try {
    // ------------------------------------------------------------------
    // 1. Launch headless browser
    // ------------------------------------------------------------------
    progress('Launching browser…');
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Realistic viewport so the site renders its desktop layout.
    await page.setViewport({ width: 1280, height: 800 });

    // Surface any unhandled page-level errors to the progress stream.
    page.on('pageerror', (err) => {
      console.warn('[clipper] page error:', err.message);
    });

    // ------------------------------------------------------------------
    // 2. Navigate to the sign-in page
    // ------------------------------------------------------------------
    progress('Navigating to Safeway sign-in page…');
    await page.goto(SIGN_IN_URL, { waitUntil: 'networkidle2', timeout: 60_000 });

    // ------------------------------------------------------------------
    // 3. Enter credentials and submit
    // ------------------------------------------------------------------
    progress('Entering credentials…');

    // The sign-in form is sometimes inside an iframe; try top-level first.
    await waitAndType(page, 'input[type="email"], input[name="email"], #label-email', email);
    await waitAndType(page, 'input[type="password"], input[name="password"], #label-password', password);

    // Click the sign-in / submit button.
    await clickSignIn(page);

    // ------------------------------------------------------------------
    // 4. Wait for successful login
    // ------------------------------------------------------------------
    progress('Waiting for login to complete…');
    const loginOk = await waitForLogin(page);
    if (!loginOk) {
      throw new Error(
        'Login failed. Please check your email and password and try again.'
      );
    }

    progress('Logged in successfully!');

    // ------------------------------------------------------------------
    // 5. Navigate to the coupons page
    // ------------------------------------------------------------------
    progress('Navigating to coupons page…');
    await page.goto(COUPONS_URL, { waitUntil: 'networkidle2', timeout: 60_000 });

    // Give React / lazy-loaded components a moment to render.
    await delay(2000);

    // ------------------------------------------------------------------
    // 6. Clip loop
    // ------------------------------------------------------------------
    progress('Scanning for coupons…');

    let idleScrolls   = 0;    // consecutive scrolls with no new buttons
    let totalSeen     = 0;    // cumulative unique clip buttons encountered
    const clickedSet  = new Set(); // track buttons we have already clicked

    while (idleScrolls < MAX_IDLE_SCROLLS) {
      // Gather all unclipped clip buttons currently in the DOM.
      const buttons = await findClipButtons(page);

      // Identify buttons we have not yet clicked (by their position key).
      const newButtons = [];
      for (const btn of buttons) {
        const key = await getButtonKey(page, btn);
        if (!clickedSet.has(key)) {
          newButtons.push({ btn, key });
        }
      }

      if (newButtons.length === 0) {
        // No new buttons in this scroll position — keep scrolling.
        idleScrolls++;
        progress(
          `Scrolling to find more coupons… (${idleScrolls}/${MAX_IDLE_SCROLLS})`,
          totalSeen
        );
      } else {
        idleScrolls = 0; // reset idle counter whenever we find new buttons
        totalSeen += newButtons.length;

        // Click each new button.
        for (const { btn, key } of newButtons) {
          try {
            // Scroll the button into view and give the browser a moment.
            await page.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), btn);
            await delay(200);

            // Double-check it is still enabled before clicking.
            const stillEnabled = await page.evaluate(
              (el) => !el.disabled && !el.closest('[disabled]'),
              btn
            );
            if (!stillEnabled) continue;

            await btn.click();
            clickedSet.add(key);
            clippedCount++;

            progress(`Clipped coupon ${clippedCount}`, totalSeen);
            await delay(CLICK_WAIT_MS);
          } catch (clickErr) {
            // The DOM may have refreshed between finding and clicking the button;
            // that is harmless — just continue to the next one.
            console.warn('[clipper] click error (non-fatal):', clickErr.message);
          }
        }
      }

      // Scroll down to trigger lazy loading of additional coupons.
      await page.evaluate((step) => window.scrollBy(0, step), SCROLL_STEP);
      await delay(SCROLL_WAIT_MS);
    }

    // ------------------------------------------------------------------
    // 7. Finished
    // ------------------------------------------------------------------
    onProgress({
      type: 'done',
      message: `All done! Clipped ${clippedCount} coupon${clippedCount !== 1 ? 's' : ''}.`,
      clipped: clippedCount,
      total: totalSeen,
    });

  } catch (err) {
    console.error('[clipper] fatal error:', err);
    onProgress({
      type: 'error',
      message: err.message || 'An unexpected error occurred.',
      clipped: clippedCount,
      total: 0,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for a selector to appear then types text into it.
 * Clears any existing value first.
 */
async function waitAndType(page, selector, text) {
  await page.waitForSelector(selector, { visible: true, timeout: 15_000 });
  await page.click(selector, { clickCount: 3 }); // select-all to clear
  await page.type(selector, text, { delay: 40 });
}

/**
 * Finds and clicks the sign-in submit button.
 * Tries several common selector patterns used by Safeway.
 */
async function clickSignIn(page) {
  const candidates = [
    'button[type="submit"]',
    'button[data-testid*="sign-in" i]',
    'button[data-testid*="signin" i]',
    'input[type="submit"]',
    // Generic: a button whose visible text includes "sign in"
  ];

  for (const sel of candidates) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        return;
      }
    } catch (_) { /* try next */ }
  }

  // Last resort: find a button whose text content mentions "sign in"
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find(
      (b) => /sign.?in|log.?in/i.test(b.textContent)
    );
    if (target) target.click();
    else throw new Error('Could not find the sign-in button');
  });
}

/**
 * Waits up to 30 seconds for the URL to change away from the sign-in page,
 * or for a user-specific element to appear, indicating a successful login.
 */
async function waitForLogin(page) {
  try {
    await page.waitForFunction(
      (signInUrl) => !window.location.href.includes('sign-in'),
      { timeout: 30_000 },
      SIGN_IN_URL
    );
    return true;
  } catch (_) {
    // Also check for a known error message on the page.
    const hasError = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return /incorrect|invalid|wrong|failed|error/i.test(text);
    });
    if (hasError) return false;

    // Maybe it redirected but the URL check was too strict — optimistically
    // continue if we are no longer on the sign-in URL.
    const currentUrl = page.url();
    return !currentUrl.includes('sign-in');
  }
}

/**
 * Returns an array of ElementHandles for every unclipped "Clip" button
 * currently visible in the DOM.
 */
async function findClipButtons(page) {
  const handles = [];

  // Try each targeted selector first.
  for (const sel of CLIP_SELECTORS) {
    try {
      const els = await page.$$(sel);
      handles.push(...els);
    } catch (_) { /* selector not supported — skip */ }
  }

  // Also scan every non-disabled button whose text is literally "Clip" or
  // "Clip Coupon" (case-insensitive).
  const textMatches = await page.$$eval('button:not([disabled])', (btns) =>
    btns
      .filter((b) => {
        const txt = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        // Exclude buttons whose text/label says they are already clipped.
        const alreadyDone = /clipped|added|saved/i.test(txt + aria);
        const isClip = /^clip(\s+coupon)?$/i.test(txt) || /clip/i.test(aria);
        return isClip && !alreadyDone && !b.disabled;
      })
      .map((b) => {
        // We cannot return DOM handles from $$eval, so return a unique
        // attribute we can use to re-query the element.
        if (!b.dataset._ccId) {
          b.dataset._ccId = Math.random().toString(36).slice(2);
        }
        return b.dataset._ccId;
      })
  );

  // Re-acquire handles by the injected data attribute.
  for (const id of textMatches) {
    try {
      const el = await page.$(`[data-_cc-id="${id}"]`);
      if (el) handles.push(el);
    } catch (_) { /* element may have been removed */ }
  }

  // Deduplicate using the injected data attribute.
  const seen = new Set();
  const unique = [];
  for (const h of handles) {
    try {
      const id = await page.evaluate((el) => {
        if (!el.dataset._ccId) {
          el.dataset._ccId = Math.random().toString(36).slice(2);
        }
        return el.dataset._ccId;
      }, h);
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(h);
      }
    } catch (_) { /* stale handle — skip */ }
  }

  return unique;
}

/**
 * Returns a stable string key for a button element so we can track
 * which buttons have already been clicked across scroll iterations.
 */
async function getButtonKey(page, handle) {
  return page.evaluate((el) => {
    if (!el.dataset._ccId) {
      el.dataset._ccId = Math.random().toString(36).slice(2);
    }
    return el.dataset._ccId;
  }, handle);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { clipCoupons };
