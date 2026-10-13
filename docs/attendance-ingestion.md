# Sending attendance from a scanner or turnstile

Any fingerprint scanner, face reader or turnstile can report visits to dunamis, as long as
something can make an HTTPS request. The scanner brand doesn't matter: a small connector (a
script on the gym PC, the vendor's push/webhook feature, or a cheap Raspberry Pi) reads the
punches and posts them here.

## 1. Set it up in the app

1. **Settings → Devices → Add device.** Give it a name ("Front door"). The **API key is shown
   once**; copy it into the connector. Lost it? Use *New key*; the old one stops working at once.
2. Give each member the **device number** the scanner knows them by (the user ID you enrolled
   their fingerprint under). It's on the member's edit form, and it must be unique in your gym.

## 2. Post punches

```
POST https://<your-api-host>/api/attendance/punches
X-Device-Key: dev_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "punches": [
    { "user_id": "42", "at": "2026-10-13T06:31:05+05:30", "ref": "scanner-1-000981" },
    { "user_id": "17", "at": "2026-10-13T06:44:50+05:30", "ref": "scanner-1-000982" }
  ]
}
```

| Field     | Meaning |
|-----------|---------|
| `user_id` | The member's device number (as text). |
| `at`      | When they punched, **with a UTC offset** (`+05:30` or `Z`). Times without an offset are rejected. |
| `ref`     | The device's own unique id for this punch (its log row number is perfect). |

Up to **500 punches per request**. The reply:

```json
{ "created": 2, "duplicates": 0, "unknown_user_ids": [] }
```

- `created`: new visits recorded.
- `duplicates`: punches that were already reported (same `ref`), or a second punch by a member
  on a day they already visited. A member has **one visit per day**, so a turnstile that
  records every turn doesn't inflate the numbers.
- `unknown_user_ids`: device numbers no member has yet. Fix them in the app; the punch is not
  stored, so send it again after assigning the number.

**It is safe to resend.** If a request times out or the connector restarts, send the same
batch again; nothing is counted twice.

## 3. Details worth knowing

- **Which day a visit counts for** follows your gym's time zone (Settings → General), not the
  device clock's zone: a punch at 00:30 local time belongs to the new day.
- Errors: `401` bad, missing or disabled key; `422` malformed body; `429` too many requests
  (the limit is 120 per minute per address, which batching stays well under).
- A key can only report punches. It can't read any member data.
- Expired or frozen memberships still record a visit; the front desk sees a warning at
  check-in, and the dashboards show who has gone quiet.

## 4. Try it

```bash
curl -X POST "$API/api/attendance/punches" \
  -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"punches":[{"user_id":"42","at":"2026-10-13T06:31:05+05:30","ref":"test-1"}]}'
```

## Not built yet

- Importing a scanner's CSV export (formats vary by brand; once you know which device you
  have, a connector that posts the log is a few lines and keeps data flowing live).
- Letting members check themselves in from their phone (deliberately left out, as it's easy to
  fake from outside the gym).
