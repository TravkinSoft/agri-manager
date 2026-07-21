# Assistant Counterparty Resolver

STATUS: `BACKLOG_ONLY`
SOURCE_TASK: `TZ-211`
RUNTIME_IMPLEMENTATION: `NONE`

## Future Scenario

When a warehousekeeper cannot find a supplier, Travkin Assistant may search the approved global counterparty catalog and return the exact legal name, tax ID and country. If no match exists, it may collect the legal identity or read a photographed invoice, verify the organization against an official source, create a draft and submit it for confirmation.

## Safety Gate

- Never create a global counterparty automatically.
- Require an official source and explicit confirmation.
- Keep OCR, internet tools and controlled actions out of the current runtime until separately approved.
- Preserve country plus tax ID as the canonical identity.
