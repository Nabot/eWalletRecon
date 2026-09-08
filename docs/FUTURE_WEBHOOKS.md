# Future: Provider merchant / webhook APIs

SMS capture is a pragmatic first source. Many Namibian e-wallet providers may offer merchant dashboards or push webhooks that are more reliable than SMS.

## Integration seam (already in code)

`backend/src/services/ingestion/ingest.ts`:

- `ingestDeposit()` — normalized path into matching
- `ingestFromSms()` — SMS adapter
- `ingestFromWebhook()` — **stub** for future providers

Matching engine (`services/matching/`) must not be changed when adding a webhook source.

## Suggested next steps

1. Confirm each provider (PayPulse, EasyWallet, Pay2Cell, EWallet) offers merchant callbacks / statement APIs.
2. Add `POST /api/webhooks/:provider` with signature verification.
3. Map payload → `NormalizedDepositInput` with `source: WEBHOOK` and `externalId`.
4. Keep SMS as fallback for wallets without API access.
