# HomePro Field App

Phone app for CJ's HomePro Mobility stairlift jobs. One form, two outcomes:

- **Save as lead** → asks for a **follow-up day**, then: contact + opportunity in GoHighLevel **Sales Pipeline** ("Quoted – Following Up" stage), tagged `stairlift-lead` and `follow-up-scheduled`; a GHL **task** due 9 AM Eastern that day; the follow-up date, product and notes written to contact fields for the follow-up workflow (see `docs/follow-up-workflow.md`); and, when a product is filled in, an **unsigned quote copy** of the Agreement and Order Sheet attached to the opportunity and the contact ("Quote Packet" file fields) and linked in a note.
- **Submit deal** → fills HomePro's own Agreement and Package Worksheet (order sheet), draws the stair diagram, merges them with staircase photos (+ ID when financed) into one PDF, emails it as `<JOB#>: <Last name>` from cdinsmore@homepromobility.com to the install team, marks the sales opportunity won, and opens one in the **Deal Pipeline** ("Sold – Packet Sent") with the packet attached. Tagged `stairlift-sold`.

After a signed deal, the customer is emailed **their own copy of the signed Agreement only** (no order sheet, photos or ID), in a separate email, when the form has their email address.

GHL fields and pipeline stages are matched **by name**, so no IDs are hard-coded. New fields the app needs are created automatically if the Private Integration has the custom-fields write scope; otherwise the result screen lists the ones to add by hand:

| Where | Field | Type |
|---|---|---|
| Opportunity | Follow-Up Date | Date |
| Opportunity | Quote Packet | File upload |
| Contact | Follow-Up Date | Date |
| Contact | Follow-Up Product | Text |
| Contact | Follow-Up Notes | Large text |
| Contact | Quote Packet | File upload |

GHL has no API for a contact's Documents tab, so files go into file-upload fields instead.

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
| `REP_PHONE` | optional, phone number shown in the customer's copy email |

## Editing

- Templates: replace `templates/*.pdf`, then `node tools/build-templates.mjs`.
- Field positions, products and extras: `lib/docs.mjs`.

## Tests

```
npm install
npm test
OMEGA_LOCAL=1 MAIL_TEST=1 SESSION_SECRET=dev APP_PIN=123456 GHL_TOKEN=x GHL_LOCATION_ID=LOC node test/e2e.mjs
```
