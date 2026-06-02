# PowerToChoose Plan Data

PowerToChoose is the Public Utility Commission of Texas electricity shopping site. Its public website exposes current plan listings by ZIP code through JSON responses shaped like this:

```sh
npm run fetch:plans -- --zip 75001 --out plans-75001.json
```

The app can also fetch plans directly from:

```text
https://api.powertochoose.org/api/PowerToChoose/plans?zip_code=75001
```

PowerToChoose rows are scored from the published 500, 1,000, and 2,000 kWh average prices. That is useful for broad discovery, but it is not a substitute for reading the Electricity Facts Label when a plan has:

- usage credits or minimum-usage rules
- free nights/free weekends or other time-of-use rates
- prepaid terms
- base charges or fees that are not visible in the three average price points

For exact scoring, model the plan as a custom EFL JSON object and import it.
