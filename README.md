# CouponClipper — Safeway Bulk Coupon Clipper

A Chrome browser extension that clips every available digital coupon on the Safeway website with a single click. It handles infinite scroll automatically, so even pages with hundreds of coupons are fully processed without any manual effort.

---

## What it does

- Injects a floating **✂ Clip All Coupons** button in the bottom-right corner of the Safeway coupons page.
- Scans the page for every unclipped coupon button using multiple CSS selectors and text-content matching — robust against minor changes to Safeway's HTML structure.
- Clicks each coupon button with a 300 ms delay between clicks to avoid triggering rate limits.
- Automatically scrolls down the page to load lazily-rendered coupons and repeats until no new coupons are found after three consecutive scroll attempts.
- Shows live progress ("Clipping 12 of 47…") on the button badge while running.
- Displays a completion toast ("Done! Clipped 47 coupons.") when finished.
- Clicking the button while it is running **cancels** the operation gracefully.
- Updates the unclipped-coupon count in real time as coupons load (via a `MutationObserver`).

---

## Installation (Chrome — Developer Mode)

Because this extension is not published to the Chrome Web Store, you load it manually as an unpacked extension.

1. **Download / clone this repository** to a folder on your computer (e.g. `~/CouponClipper`).
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner of the page.
4. Click **Load unpacked**.
5. Select the root folder of this repository (the folder that contains `manifest.json`).
6. The **CouponClipper** extension will appear in your extensions list with a green scissors icon.

> **Tip:** Pin the extension to your toolbar by clicking the puzzle-piece icon in Chrome's toolbar and clicking the pin next to CouponClipper.

---

## How to use

1. Click the CouponClipper toolbar icon to open the popup.
2. Click **"Go to Safeway Coupons"** — this opens `safeway.com/foru/coupons-deals.html` in the current tab.
3. Sign in to your Safeway account if prompted, then wait for the coupons page to finish loading.
4. Click the green **✂ Clip All Coupons** button that appears in the bottom-right corner of the page.
   - The badge on the button shows how many unclipped coupons are currently visible.
5. The extension will scroll through the entire page and clip every available coupon automatically.
6. A toast notification confirms completion: **"Done! Clipped X coupons."**
7. To stop early, click the button again while it is running — it will cancel after the current coupon finishes.

---

## Project structure

```
CouponClipper/
├── manifest.json          # Chrome Manifest V3 extension config
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── content.js         # Content script — floating button, clipping logic
    ├── popup.html         # Extension popup UI
    ├── popup.js           # Popup logic — tab detection, navigation
    └── styles.css         # Styles for the floating button and toast notifications
```

---

## Permissions

| Permission    | Why it is needed |
|---------------|-----------------|
| `activeTab`   | Read the current tab's URL to show the correct status in the popup. |
| `scripting`   | Reserved for potential future use (programmatic script injection). |
| `storage`     | Reserved for persisting user preferences in future versions. |

The extension only runs its content script on `*://*.safeway.com/*` — it has no access to any other website.

---

## Troubleshooting

**The ✂ button does not appear.**
Make sure you are on a URL that contains `/foru` or `/coupon` (e.g. `safeway.com/foru/coupons-deals.html`). The button is intentionally hidden on all other pages.

**No coupons are being found.**
Safeway may have updated their HTML structure. Check the browser console for `[CouponClipper]` log messages. The selectors used are listed in `src/content.js` under `CLIP_SELECTORS`.

**The extension shows an error in `chrome://extensions`.**
Make sure you selected the folder containing `manifest.json` (not a subfolder) when loading the unpacked extension.

---

## License

MIT — use freely, modify as needed.
