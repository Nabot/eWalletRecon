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
- Channel: **WALLET**
- PayPulse often sends a **second** SMS (PIN / “Dear customer…”) from the same sender — that is **not** a deposit and must be ignored

### BlueVoucher PIN follow-up (ignore)

```
Dear Customer,
Your BlueVoucher PIN is 4065.
This PIN is valid for 72 hrs, if PIN expired, dial *140*6626#. Use this PIN to withdraw cash at any Standard Bank ATM.
Queries 92860.
```

## EasyWallet → Bank WHK (e-wallet product)

```
Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an EasyWallet of NAD5000.00 OTP:529998 valid for 24h. If expired, dial *140*295# for a new OTP. REF:20260820-71391772
```

- Amount: `NAD5000.00`
- No MSISDN in body (name/business only)
- **Reference = `REF:` value** (e.g. `20260820-71391772`) — EasyWallet txn id, **not** a cellphone
- Must contain the word **EasyWallet**
- Phone sender ID: **140295**
- Channel: **WALLET** / provider: `EASYWALLET`

## Bank WHK → bank transfer (cellphone REF)

Same SMS line as EasyWallet (`140295`), but **no** EasyWallet keyword; `REF:` is the customer’s cellphone (PstBet lookup key).

```
Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an of NAD5000.00 O. REF:0813544045
```

- Amount: `NAD5000.00`
- **Reference / sender MSISDN = cellphone** from `REF:` (normalized to `264…`)
- Phone sender ID: **140295**
- Channel: **BANK** / provider: `BANK_WHK`
- PstBet assisted credit looks up by this mobile

### EasyWallet vs bank transfer

| Cue | EasyWallet | Bank transfer |
|-----|------------|---------------|
| Body | contains `EasyWallet` | `Bank WHK` without `EasyWallet` |
| `REF:` | txn id e.g. `20260820-71391772` | cellphone e.g. `0813544045` |
| Channel | WALLET | BANK |

## EWallet → FNB

```
FNB :) N T NABOT sent you N¤4500.00. Get cash at Cash Plus partner or Press PROCEED at FNB ATM. PIN 37262, is valid for 16hrs. If PIN expired, dial *140*392#
```

- Amount: `N¤4500.00` (FNB uses ¤)
- No MSISDN — person name only
- PIN is cash-out, not a match key
- Phone sender ID: **362626**
- Channel: **WALLET**

## Confirmed sender IDs (handset)

| Provider | SMS From / sender ID |
|----------|----------------------|
| PayPulse / BlueVoucher | `PAYPULSE` |
| FNB eWallet | `362626` |
| EasyWallet + Bank WHK transfer | `140295` |
| Pay2Cell | _not yet provided_ |

## Matching implications

| Provider     | Auto MSISDN+amount? | Reference used for match                         |
|--------------|---------------------|--------------------------------------------------|
| BlueVoucher  | Yes (Reference#)    | `Reference#` MSISDN or optional `BET####`        |
| EasyWallet   | No                  | SMS **`REF:`** txn id                            |
| Bank WHK     | Yes (REF cellphone) | `REF:` cellphone → PstBet `/account` mobile      |
| FNB eWallet  | No                  | `BET####` if present, else manual                |
