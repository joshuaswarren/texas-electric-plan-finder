#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const zipIndex = args.indexOf('--zip')
const outIndex = args.indexOf('--out')
const zip = zipIndex >= 0 ? args[zipIndex + 1] : undefined
const out = outIndex >= 0 ? args[outIndex + 1] : `powertochoose-${zip}.json`

if (!zip || !/^\d{5}$/.test(zip)) {
  console.error('Usage: npm run fetch:plans -- --zip 75001 [--out plans.json]')
  process.exit(1)
}

const url = `https://api.powertochoose.org/api/PowerToChoose/plans?zip_code=${zip}`
const response = await fetch(url)
if (!response.ok) {
  throw new Error(`PowerToChoose request failed: ${response.status} ${response.statusText}`)
}

const payload = await response.json()
if (!payload.success || !Array.isArray(payload.data)) {
  throw new Error(payload.message || 'PowerToChoose did not return plan data.')
}

await writeFile(
  out,
  JSON.stringify(
    {
      source: url,
      fetchedAt: new Date().toISOString(),
      ptc: payload.data,
    },
    null,
    2,
  ),
)

console.log(`Wrote ${payload.data.length} plans to ${out}`)
