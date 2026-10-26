# Integrator gotchas & error-code reference

Notes from integrating Nido into a real dapp on Stellar (HackMeridian). This
complements [`ADD-NIDO-TO-DAPP.md`](./ADD-NIDO-TO-DAPP.md) with the sharp edges we hit, the exact error
codes, and the fixes — so the next integrator doesn't rediscover them.

## Two models — pick one deliberately

1. **Per-transaction passkey (recommended default).** Every `signTransaction` opens the passkey ceremony:
   one Touch ID per transaction, nothing signable kept on the client. This is the kit's basic flow and the
   model to reach for first — it's the safest and, with platform authenticators, barely slower than a tap.

2. **Session keys (a bounded exception).** The owner approves a Perch rule once that lets an app-held key
   call a contract's listed functions until an expiry, optionally under a rolling cap; the app then signs
   those calls without a prompt. Convenient, but it trades away per-transaction confirmation for the
   grant's lifetime, and the app key is a secret the app must hold. Reserve it for flows where a per-tx tap
   is genuinely impractical, label the trade-off clearly to the user, and keep expiries short.

> If you use session keys, **do not keep the app key in plaintext** (e.g. `localStorage`). Wrap it with the
> platform authenticator and re-prompt per use (Apple-Pay-style), so an XSS or disk read can't sign.

## Error-code cheat sheet

| Symptom | Code | Cause → fix |
| --- | --- | --- |
| A popup-signed call *into another contract* is refused | `#3002` UnvalidatedContext / `#3014` ContextRuleIdsLengthMismatch | The sign popup signs under the account's **admin rule**, scoped to the account itself — it can't authorize a call into a protocol contract. Use a **session-key rule** targeting that contract. |
| A grant with a spending cap is rejected | `#3223` | A cap can only be carried by a token **`transfer`**. Put the cap on the token rule; other functions get an uncapped rule. |
| A grant without a cap "allows no token functions" | — (on-screen) | An uncapped rule can't move tokens. If your call must move USDC/tokens, add a **capped token rule** alongside the contract rule. |
| A new grant is refused with "12 rules; at most 11" | — (on-screen) | A Perch account holds **at most 11 rules**. One-rule-per-contract plus one-policy-per-vault hits this fast. Prune expired rules, or scope one rule to a factory/wildcard if available. |
| Classic (non-Soroban) tx fails to sign | — | A passkey account is a C-address contract: it can't source/sign a classic Stellar operation. Build a Soroban transaction or auth entry. |
| `signAuthEntry` rejects a valid-looking entry | — | The auth preimage's `signatureExpirationLedger` must be **≤ ~720 ledgers (~1h)** ahead and not past. Build auth entries with a short expiry. |

## Session-key integration notes

- **One rule per contract.** A call that touches several contracts (e.g. a vault `buy` + a USDC `transfer`)
  needs one rule per contract in the call's authorization tree. Build the tree with the app key named as a
  CAP-0071 `Delegated` signer (`authorizeEntry` / delegate entries).
- **Rules are named by label (≤ 20 bytes) and replace in place.** Asking again for the same label renews or
  changes that rule — handy for renewal, easy to clobber by accident. Validate the 20-byte limit up front.
- **The app key pays its own fees today.** The hosted relayer doesn't yet decode `Delegated` auth entries,
  so the session key (a classic G-address) needs funding (Friendbot on testnet). Keep it funded on mainnet.
- **The grant ceremony navigates away — and returns to the app origin, not the page you left.** Persist any
  in-flight action, and capture the full return URL and scroll position yourself: the redirect lands the user
  back at the origin (e.g. `https://app.example.com`), not the exact page (e.g. `.../?b=DXSTK`) they were on.
- **Grants always expire** (no "never"). Plan for re-granting; prefer the longest safe expiry.

## One-click multi-call actions

A single UI action that fans out into N sub-calls (e.g. minting N tokens, or a batch faucet) becomes **N+1
confirmations** for a passkey account. Where possible, move the fan-out into a single contract call your own
code authorizes, so the user approves once.
