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
- `evCharging`
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

## EV-Only Charging Discounts

Some plans, including Tesla Drive-style EFLs, exclude eligible vehicle charging from the per-kWh energy and TDU delivery charges while adding a monthly vehicle fee. Model those plans with `evCharging`.

```json
{
  "custom": [
    {
      "id": "tesla-drive-oncor-example",
      "provider": "Tesla",
      "planName": "Tesla Electric Drive Plan (12 Month) - Oncor",
      "tdu": "Oncor",
      "rateType": "Fixed",
      "termMonths": 12,
      "energyChargeCentsPerKwh": 9.5,
      "deliveryFixedDollars": 4.23,
      "deliveryChargeCentsPerKwh": 5.6183,
      "evCharging": {
        "monthlyFeeDollarsPerVehicle": 15,
        "eligiblePeriods": [
          {
            "label": "Eligible Tesla vehicle charging",
            "start": "00:00",
            "end": "12:00",
            "days": "all"
          }
        ],
        "assumedMonthlyKwh": 300,
        "requiredDevice": "Tesla EV"
      }
    }
  ]
}
```

The scorer subtracts only `eligibleKwh` from the separate EV charging profile. It does not discount unrelated household usage inside the same clock window.
