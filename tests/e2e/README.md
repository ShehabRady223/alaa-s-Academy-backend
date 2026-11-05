# Browser end-to-end test

Drives the real web app (Vite) against the real API and a real database with headless Chromium.

1. Start MongoDB (or any Mongo-compatible server) on 127.0.0.1:27017.
2. `cd apps/api && npx tsx tests/e2e-server.ts`   (boots the API on :4000, seeds users, writes /tmp/e2e.json)
3. `cd apps/web && npx vite --port 5173`
4. In a scratch folder: `npm i puppeteer-core @sparticuz/chromium`, copy `browser.e2e.mjs` there and run `node browser.e2e.mjs`.

Dashboards/analytics use `$first`, `$bucket`, `$dateTrunc`: they need real MongoDB 5.0+ and are not exercised by this run.
