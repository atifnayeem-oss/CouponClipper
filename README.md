# CouponClipper — Safeway Bulk Coupon Clipper

A Node.js web app that logs in to your Safeway account and automatically clips every available digital coupon. Open the page in any browser, enter your credentials once, and watch the counter climb.

---

## What it does

- Presents a clean login form in your browser at `http://localhost:3000`.
- Accepts your Safeway email and password, then launches a headless Chrome browser (via Puppeteer) in the background.
- Logs in to Safeway on your behalf, navigates to the coupons page, and clips every available coupon — scrolling through lazy-loaded content automatically.
- Streams live progress back to your browser over a Server-Sent Events connection so you can watch the coupon count rise in real time.
- Displays a final "Done! Clipped X coupons." message when finished.

---

## Requirements

- **Node.js 18 or newer** — [download here](https://nodejs.org/)
- A Safeway account with a registered email and password
- An internet connection (Puppeteer drives the real Safeway website)

---

## Installation

```bash
git clone <this-repo-url>
cd CouponClipper
npm install
```

`npm install` downloads Express, Puppeteer, and the bundled version of Chromium that Puppeteer manages automatically. The first install may take a minute or two.

---

## Running the app

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

---

## How to use

1. Run `npm start` and open `http://localhost:3000`.
2. Enter your Safeway account email and password.
3. Click **✂ Clip All Coupons**.
4. Watch the progress — the counter updates as each coupon is clipped.
5. When the checkmark appears, all available coupons have been added to your account.

---

## Security

**Your credentials are never stored.**

- They are sent over `localhost` (never to any third-party server).
- The server uses them only to start a Puppeteer session and discards them immediately after — they are never written to disk, logged, or held in memory beyond the duration of the request.
- Sessions expire automatically after 10 minutes.
- Everything runs locally on your own machine.

---

## Sharing with friends

Because everything runs locally, sharing is as simple as sharing the code:

1. Your friend clones or downloads this repository.
2. They run `npm install` once.
3. They run `npm start` and open `http://localhost:3000` in their browser.

No accounts, no servers, no subscriptions — it runs entirely on their machine.

---

## Project structure

```
CouponClipper/
├── server.js          # Express server — routes, SSE, session management
├── clipper.js         # Puppeteer automation — login, coupon clipping logic
├── public/
│   └── index.html     # Single-page UI — login form, live progress, done/error states
└── package.json
```

---

## Troubleshooting

**Puppeteer fails to launch Chrome.**
On some Linux systems you may need additional dependencies. Run:
```bash
npx puppeteer browsers install chrome
```

**Login fails even with correct credentials.**
Safeway may have added a CAPTCHA or SMS verification step. Try logging in manually in a normal browser first to dismiss any security challenges, then run CouponClipper again.

**No coupons are found.**
Safeway occasionally updates their HTML structure. The selectors used are in `clipper.js` under `CLIP_SELECTORS`. Open an issue or update the selectors to match the new markup.

---

## License

MIT — use freely, modify as needed.
