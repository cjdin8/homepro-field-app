# Follow-up day workflow (build once in GoHighLevel)

The app cannot create workflows; GoHighLevel only lets people do that. The app sets everything the workflow needs:

| What the app sets | Where |
|---|---|
| `Follow-Up Date` | Contact field (and the opportunity) |
| `Follow-Up Product` | Contact field, e.g. "Harmar Indigo IS350" |
| `Follow-Up Notes` | Contact field: the quoted price and your lead notes |
| Tag `follow-up-scheduled` | Contact |
| Tag `sms-consent` | Contact, only when the customer ticked "OK to text me" |
| Task "Follow up: <name> - <product>" | Contact, due 9 AM Eastern on the follow-up day |

## The workflow

1. **Trigger:** Custom Date Reminder on the contact field **Follow-Up Date**, on the day, at the time you want the message to go (for example 10:00 AM).
2. **Filter:** contact has tag `follow-up-scheduled`.
3. **If/else:** contact has tag `sms-consent`.
   - **Yes:** send the text below.
   - **No:** send the same message as an email.
4. **Remove tag** `follow-up-scheduled`, so a later date change starts clean.
5. **Optional:** turn on Conversation AI for replies, with the goal "answer questions about the quote and book the install", and give it the Follow-Up Product and Follow-Up Notes fields as context.

Pick the three custom values from the workflow's custom-values menu so the keys match your account.

## First message

> Hi {{contact.first_name}}, it's CJ with HomePro Mobility. When we met I said I'd check back today about the {{Follow-Up Product}} for your stairs. Do you have any questions I can answer, or would you like me to get your install on the schedule?

Keep it to something you would send yourself. Replies land in the GoHighLevel conversation, and the task for that morning is your reminder to call if they don't answer.

## Rules that matter

- Text only contacts tagged `sms-consent`. Everyone else gets the email.
- The number sending the text must have finished A2P registration.
- If the lead buys before the follow-up day, the deal submission closes the sales opportunity; add "opportunity status is open" to the filter so sold customers are skipped.
