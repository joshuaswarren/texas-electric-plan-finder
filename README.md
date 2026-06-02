# Texas Electric Plan Finder

Texas Electric Plan Finder compares electricity plans from PowerToChoose.org against your actual Smart Meter Texas interval usage. It is built for Texans who want a transparent electric plan calculator for fixed-rate, time-of-use, free nights, bill-credit, minimum-usage, and Electricity Facts Label scenarios.

Keywords: Texas electricity plan calculator, PowerToChoose comparison, Smart Meter Texas usage, Electricity Facts Label calculator, Oncor, CenterPoint, AEP Texas, TNMP, electric plan finder, Texas energy shopping, free nights electricity, bill credit plans.

## What It Does

- Imports 15-minute Smart Meter Texas interval CSV data.
- Fetches current PowerToChoose plan listings by ZIP code.
- Scores plans against the latest complete calendar months of actual usage, up to 12 months.
- Filters by contract term, fixed-rate preference, prepaid plans, and time-of-use plans.
- Pulls EFL links from PowerToChoose and applies parsed EFL charges when the provider document is machine-readable.
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

## Download Smart Meter Texas Usage

See [docs/smart-meter-texas-download.md](docs/smart-meter-texas-download.md). Do not publish your own Smart Meter Texas CSV because it can include your ESIID and detailed household usage patterns.

## Modeling EFL Plans

PowerToChoose publishes 500, 1,000, and 2,000 kWh average rates. The app also fetches each plan's EFL URL and tries to parse the actual charge rules. Provider EFL formats vary, so plans that cannot be parsed are marked as PowerToChoose curve estimates. Use [docs/efl-modeling.md](docs/efl-modeling.md) to add exact Electricity Facts Label rules manually when needed.

## Current Limits

- Provider EFL PDFs and HTML pages are not standardized; unparseable EFLs fall back to a piecewise PowerToChoose average-price curve and are flagged.
- The app does not auto-download Smart Meter Texas data.
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
