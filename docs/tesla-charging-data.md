# Tesla Charging Data

Tesla charging data is optional, but EV-only EFLs need it for accurate scoring.

## Data Sources

- Manual CSV import is the simplest path. Use monthly rows such as `month,kwh,eligible_kwh` or charging-session rows with a start date/time and kWh.
- Tesla Wall Connector history is preferred when available because it records charger-side session energy.
- Tesla vehicle data can provide current charging telemetry and is useful for collecting future sessions.
- Interval estimation is a fallback only. It looks for sustained midnight-noon load that resembles Level 2 charging and subtracts an assumed household baseline.

## Worker OAuth

Tesla OAuth runs through the Cloudflare Worker. Do not exchange Tesla authorization codes in the GitHub Pages app.

Required Worker configuration:

- `TESLA_CLIENT_ID`
- `TESLA_CLIENT_SECRET`
- `TESLA_REDIRECT_URI`
- `TESLA_COOKIE_SECRET`
- `TESLA_APP_RETURN_URL`
- `ALLOWED_ORIGIN`

Useful commands:

```sh
wrangler secret put TESLA_CLIENT_ID --config worker/wrangler.jsonc
wrangler secret put TESLA_CLIENT_SECRET --config worker/wrangler.jsonc
wrangler secret put TESLA_COOKIE_SECRET --config worker/wrangler.jsonc
npm run deploy:worker
```

The Worker stores the Tesla access and refresh tokens in an encrypted, HttpOnly, Secure cookie. Browser code calls Worker endpoints with credentials and never sees the raw Tesla tokens.

## EFL Scoring Rule

For Tesla Drive-style plans, eligible vehicle charging kWh is removed from the per-kWh energy and TDU delivery charges. The plan still charges the fixed TDU fee and the monthly home charging fee per Tesla EV.

Do not treat all midnight-noon household load as free. Only identified Tesla charging kWh counts.
