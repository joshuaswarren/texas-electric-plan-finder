# Download Smart Meter Texas Interval Data

This project intentionally does not require Smart Meter Texas API access. Most users only need the CSV export from the Smart Meter Texas website.

1. Go to [Smart Meter Texas](https://www.smartmetertexas.com/CAP/public/index.html).
2. Sign in or create an account for your ESIID.
3. Open the usage or energy data section.
4. Choose interval usage, 15-minute granularity, and a date range covering the last 12 months.
5. Export/download the CSV.
6. Upload that CSV in the app.

The app expects the standard Smart Meter Texas interval columns:

```text
ESIID,USAGE_DATE,REVISION_DATE,USAGE_START_TIME,USAGE_END_TIME,USAGE_KWH,ESTIMATED_ACTUAL,CONSUMPTION_SURPLUSGENERATION
```

Do not commit your exported CSV to a public repository. It can include your ESIID and a detailed occupancy/usage pattern.
