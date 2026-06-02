# Texas Electric Plan Finder

Texas Electric Plan Finder compares electricity plans from PowerToChoose.org against your actual Smart Meter Texas interval usage. It is built for Texans who want a transparent electric plan calculator for fixed-rate, time-of-use, free nights, bill-credit, minimum-usage, and Electricity Facts Label scenarios.

Keywords: Texas electricity plan calculator, PowerToChoose comparison, Smart Meter Texas usage, Electricity Facts Label calculator, Oncor, CenterPoint, AEP Texas, TNMP, electric plan finder, Texas energy shopping, free nights electricity, bill credit plans.

## What It Does

- Imports 15-minute Smart Meter Texas interval CSV data.
- Fetches current PowerToChoose plan listings by ZIP code.
- Scores plans against the last 12 months of actual usage.
- Filters by contract term, fixed-rate preference, prepaid plans, and time-of-use plans.
- Supports custom EFL JSON for exact base charge, TDU charge, usage credit, and TOU math.
- Keeps private usage data local in the browser unless you choose to save files yourself.

## Quick Start

Hosted app: [joshuaswarren.github.io/texas-electric-plan-finder](https://joshuaswarren.github.io/texas-electric-plan-finder/)

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Fetch PowerToChoose Plans

The browser can try the PowerToChoose API directly. If CORS or network policy blocks it, use the CLI fallback:

```sh
npm run fetch:plans -- --zip 75001 --out plans-75001.json
```

Then import the JSON in the app.

## Download Smart Meter Texas Usage

See [docs/smart-meter-texas-download.md](docs/smart-meter-texas-download.md). Do not publish your own Smart Meter Texas CSV because it can include your ESIID and detailed household usage patterns.

## Modeling EFL Plans

PowerToChoose publishes 500, 1,000, and 2,000 kWh average rates. Those averages are not enough to fully understand bill credits, minimum usage fees, or free-night/time-of-use plans. Use [docs/efl-modeling.md](docs/efl-modeling.md) to add exact Electricity Facts Label rules.

## Current Limits

- PowerToChoose listings are estimated with a piecewise average-price curve unless a custom EFL model is supplied.
- The app does not auto-download Smart Meter Texas data.
- The app does not yet parse arbitrary EFL PDFs automatically.
- Local taxes, non-recurring fees, and provider-specific edge cases must be checked against the EFL and Terms of Service.

## Public Data Sources

- [PowerToChoose.org](https://www.powertochoose.org/) from the Public Utility Commission of Texas.
- [Smart Meter Texas](https://www.smartmetertexas.com/CAP/public/index.html) user-exported interval data.

## Development

```sh
npm run lint
npm run build
```
