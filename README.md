# HomePro Field App

Phone app for CJ's HomePro Mobility stairlift jobs. One form, two outcomes:

- **Save as lead** → contact + opportunity in GoHighLevel **Sales Pipeline** ("Quoted – Following Up" stage), tagged `stairlift-lead`.
- **Submit deal** → fills HomePro's own Agreement and Package Worksheet (order sheet), draws the stair diagram, merges them with staircase photos (+ ID when financed) into one PDF, emails it as `<JOB#>: <Last name>` from cdinsmore@homepromobility.com to the install team, marks the sales opportunity won, and opens one in the **Deal Pipeline** ("Sold – Packet Sent") with the packet attached. Tagged `stairlift-sold`.

GHL fields and pipeline stages are matched **by name**, so no IDs are hard-coded.

## Netlify environment variables (scope: Functions)

| Key | Value |
|---|---|
| `GHL_TOKEN` | HomePro Private Integration token |
| `GHL_LOCATION_ID` | HomePro location ID |
| `SESSION_SECRET` | long random string |
| `APP_PIN` | 6-digit login PIN |
| `SMTP_PASS` | Google app password for cdinsmore@homepromobility.com |
| `SMTP_USER` | optional, defaults to cdinsmore@homepromobility.com |
| `JOB_EMAIL_TO` | optional, `;`-separated list to override the default recipients |

## Editing

- Templates: replace `templates/*.pdf`, then `node tools/build-templates.mjs`.
- Field positions, products and extras: `lib/docs.mjs`.

## Tests

```
npm install
npm test
OMEGA_LOCAL=1 MAIL_TEST=1 SESSION_SECRET=dev APP_PIN=123456 GHL_TOKEN=x GHL_LOCATION_ID=LOC node test/e2e.mjs
```
