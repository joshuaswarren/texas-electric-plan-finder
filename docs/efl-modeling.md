# Electricity Facts Label Modeling

Custom EFL plans let the calculator apply plan math directly to each billing month, and to intervals when a time-of-use schedule is provided.

```json
{
  "custom": [
    {
      "id": "example-fixed-plan",
      "provider": "Example REP",
      "planName": "Simple Fixed 12",
      "tdu": "Oncor",
      "rateType": "Fixed",
      "termMonths": 12,
      "energyChargeCentsPerKwh": 7.5,
      "deliveryFixedDollars": 4.06,
      "deliveryChargeCentsPerKwh": 6.1196,
      "usageCredits": [
        { "thresholdKwh": 2000, "amountDollars": 125 }
      ],
      "isBaseline": true
    }
  ]
}
```

Supported fields:

- `baseChargeDollars`
- `energyChargeCentsPerKwh`
- `deliveryFixedDollars`
- `deliveryChargeCentsPerKwh`
- `usageCredits`
- `touPeriods`
- `termMonths`
- `cancellationFee`
- `renewable`

For a time-of-use plan, use `touPeriods`:

```json
{
  "touPeriods": [
    {
      "label": "Free nights",
      "energyChargeCentsPerKwh": 0,
      "start": "21:00",
      "end": "07:00",
      "days": "all"
    },
    {
      "label": "Day",
      "energyChargeCentsPerKwh": 18.5,
      "start": "07:00",
      "end": "21:00",
      "days": "all"
    }
  ]
}
```
