# Real SMS formats (captured Aug/Sep 2026)

## PayPulse → BlueVoucher

```
Your BlueVoucher a/c 264813544045 
is credited with 
NAD 1,750.00 on
21/08/2026 16:32:12.
Bal is NAD 1,750.00
Reference#: 264813887790
```

- Amount: `NAD 1,750.00` (credit line, not balance)
- Sender MSISDN: `Reference#` when it looks like a phone number
- Timestamp: `dd/MM/yyyy HH:mm:ss` (CAT)
- Phone sender ID: **PAYPULSE**

## EasyWallet → Bank WHK

```
Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an EasyWallet of NAD5000.00 OTP:529998 valid for 24h. If expired, dial *140*295# for a new OTP. REF:20260820-71391772
```

- Amount: `NAD5000.00`
- No MSISDN in body (name/business only)
- **Reference = `REF:` value** (e.g. `20260820-71391772`) — this is what we store and match on
- Phone sender ID: **140295**

## EWallet → FNB

```
FNB :) N T NABOT sent you N¤4500.00. Get cash at Cash Plus partner or Press PROCEED at FNB ATM. PIN 37262, is valid for 16hrs. If PIN expired, dial *140*392#
```

- Amount: `N¤4500.00` (FNB uses ¤)
- No MSISDN — person name only
- PIN is cash-out, not a match key
- Phone sender ID: **362626**

## Confirmed sender IDs (handset)

| Provider | SMS From / sender ID |
|----------|----------------------|
| PayPulse / BlueVoucher | `PAYPULSE` |
| FNB eWallet | `362626` |
| EasyWallet | `140295` |
| Pay2Cell | _not yet provided_ |

## Matching implications

| Provider     | Auto MSISDN+amount? | Reference used for match                         |
|--------------|---------------------|--------------------------------------------------|
| BlueVoucher  | Yes (Reference#)    | `Reference#` MSISDN or optional `BET####`        |
| EasyWallet   | No                  | SMS **`REF:`** value (e.g. `20260820-71391772`)  |
| FNB eWallet  | No                  | `BET####` if present, else manual                |
