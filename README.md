# CouponClipper — Safeway Bulk Coupon Clipper

CouponClipper is a browser bookmarklet that automatically clips every available digital coupon on safeway.com for you. Visit the page, drag the green button into your bookmarks bar, log into your Safeway account, navigate to Coupons & Deals, and click the bookmarklet — it scrolls the page, finds every unclipped coupon, and clicks them all while a live counter tracks your progress. No install, no login to this site, no server involved.

---

## How to use

1. **Visit the page** (locally or via GitHub Pages) and drag the green "✂ Clip All Coupons" button into your browser's bookmarks bar.
2. **Go to [safeway.com](https://www.safeway.com)** and sign into your account.
3. **Navigate to Coupons & Deals**, then click **"Clip All Coupons"** in your bookmarks bar.
4. Watch the counter climb — click Cancel anytime to stop early.

---

## Run locally

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

No `npm install` needed — the start script uses `npx serve` which is bundled with Node.js.

---

## Share with others

Just share the URL. If you deploy to GitHub Pages, share that link directly — no setup required on their end.

---

## Security

The bookmarklet runs entirely inside your browser on safeway.com. This website never receives your Safeway credentials or any personal data — it only serves the static HTML page you're reading right now.
