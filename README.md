# Texas Electric Plan Finder

Texas Electric Plan Finder compares electricity plans from PowerToChoose.org against your actual Smart Meter Texas interval usage. It is built for Texans who want a transparent electric plan calculator for fixed-rate, time-of-use, free nights, bill-credit, minimum-usage, and Electricity Facts Label scenarios.

Keywords: Texas electricity plan calculator, PowerToChoose comparison, Smart Meter Texas usage, Electricity Facts Label calculator, Oncor, CenterPoint, AEP Texas, TNMP, electric plan finder, Texas energy shopping, free nights electricity, bill credit plans.

## What It Does

- Imports 15-minute Smart Meter Texas interval CSV data.
- Fetches current PowerToChoose plan listings by ZIP code.
- Scores plans against the latest complete calendar months of actual usage, up to 12 months.
- Filters by contract term, fixed-rate preference, prepaid plans, and time-of-use plans.
- Pulls EFL links from PowerToChoose and applies parsed EFL charges when the provider document is machine-readable.
- Supports Tesla EV charging plans by modeling vehicle charging kWh separately from whole-home interval usage.
- Imports manual EV charging CSVs, can estimate likely EV load from interval shape, and includes a Cloudflare Worker path for Tesla Fleet API OAuth.
- Supports optional custom EFL JSON for current plans or provider documents that cannot be parsed automatically.
- Keeps private usage data local in the browser unless you choose to save files yourself.

## Quick Start

Hosted app: [joshuaswarren.github.io/texas-electric-plan-finder](https://joshuaswarren.github.io/texas-electric-plan-finder/)

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Fetch PowerToChoose Plans

The hosted app uses a small Cloudflare Worker proxy because PowerToChoose does not allow direct browser CORS requests from GitHub Pages. Local development uses Vite's `/ptc-api` proxy.

If network policy blocks either browser path, use the CLI fallback:

```sh
npm run fetch:plans -- --zip 75001 --out plans-75001.json
```

Then import the JSON in the app.

Deploy the public proxy after changes with:

```sh
npm run deploy:worker
```

## Tesla EV Charging Data

Tesla Drive-style EFLs are not ordinary time-of-use plans. The calculator only discounts identified eligible vehicle charging kWh, not all household usage during the eligible hours.

Supported EV data paths:

- Enter an annual Tesla charging assumption and apply it across the scored complete months.
- Import a manual EV CSV with either `month,kwh,eligible_kwh` rows or session rows containing a charging start time and kWh.
- Pull Tesla Wall Connector charge history through the Cloudflare Worker after Tesla OAuth is configured.
- Use the interval estimator as a fallback when charger data is unavailable; estimated rows are flagged as less certain.

Configure Tesla OAuth on the Worker with:

```sh
wrangler secret put TESLA_CLIENT_ID --config worker/wrangler.jsonc
wrangler secret put TESLA_CLIENT_SECRET --config worker/wrangler.jsonc
wrangler secret put TESLA_COOKIE_SECRET --config worker/wrangler.jsonc
```

Set `TESLA_REDIRECT_URI`, `TESLA_APP_RETURN_URL`, and `ALLOWED_ORIGIN` as Worker vars or secrets for the deployed domain. The browser never exchanges Tesla auth codes directly.

## Download Smart Meter Texas Usage

See [docs/smart-meter-texas-download.md](docs/smart-meter-texas-download.md). Do not publish your own Smart Meter Texas CSV because it can include your ESIID and detailed household usage patterns.

## Modeling EFL Plans

PowerToChoose publishes 500, 1,000, and 2,000 kWh average rates. The app also fetches each plan's EFL URL and tries to parse the actual charge rules. Provider EFL formats vary, so plans that cannot be parsed are marked as PowerToChoose curve estimates. Use [docs/efl-modeling.md](docs/efl-modeling.md) to add exact Electricity Facts Label rules manually when needed.

## Current Limits

- Provider EFL PDFs and HTML pages are not standardized; unparseable EFLs fall back to a piecewise PowerToChoose average-price curve and are flagged.
- The app does not auto-download Smart Meter Texas data.
- Tesla account and Wall Connector history require the owner to connect Tesla OAuth; the app also supports manual imports for people who do not want to connect Tesla.
- EFL parsing is conservative and format-dependent; always verify the linked EFL before enrolling.
- Local taxes, non-recurring fees, and provider-specific edge cases must be checked against the EFL and Terms of Service.

## Public Data Sources

- [PowerToChoose.org](https://www.powertochoose.org/) from the Public Utility Commission of Texas.
- [Smart Meter Texas](https://www.smartmetertexas.com/CAP/public/index.html) user-exported interval data.

## Development

```sh
npm run lint
npm run build
```
