# PowerToChoose Plan Data

PowerToChoose is the Public Utility Commission of Texas electricity shopping site. Its public website exposes current plan listings by ZIP code through JSON responses shaped like this:

```sh
npm run fetch:plans -- --zip 75001 --out plans-75001.json
```

The local development app proxies PowerToChoose through Vite. The hosted GitHub Pages app uses a Cloudflare Worker proxy because PowerToChoose does not send browser CORS headers for arbitrary static-site origins.

The upstream URL is:

```text
https://api.powertochoose.org/api/PowerToChoose/plans?zip_code=75001
```

The hosted app calls:

```text
https://texas-electric-plan-finder-ptc.joshua-s-warren.workers.dev/api/PowerToChoose/plans?zip_code=75001
```

PowerToChoose rows include an EFL URL. The app fetches those EFLs through the Worker and attempts to parse the real recurring charge rules. Rows are scored from the published 500, 1,000, and 2,000 kWh average prices only when the provider EFL cannot be parsed. The fallback is useful for broad discovery, but it is not a substitute for reading the Electricity Facts Label when a plan has:

- usage credits or minimum-usage rules
- free nights/free weekends or other time-of-use rates
- prepaid terms
- base charges or fees that are not visible in the three average price points

For exact scoring, model the plan as a custom EFL JSON object and import it.
