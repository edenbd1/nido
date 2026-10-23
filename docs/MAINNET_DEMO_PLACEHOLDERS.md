# Mainnet demo switchover: placeholders to replace

Every value below is a deliberate stand-in, already flagged in its own file,
left in place because the real value didn't exist yet (no mainnet Perch/
factory deployment, no mainnet Turnkey accounts). This doc just collects them
in one place so none gets missed during the mainnet cutover for the
conference demo. Each entry names the file and what replaces the placeholder.

Found by `grep -rn "placeholder\|PLACEHOLDER"` across `infra/`, `docs/`,
`scripts/`, `.github/` (excluding `node_modules`) — re-run that before the
cutover in case new ones were added since.

## Relayer

- **`infra/relayer/fly.mainnet.toml`** (`FEE_LIMIT`, `FUNDER_TOPUP_STROOPS`) —
  both carried over from testnet verbatim. Testnet's `FEE_LIMIT` (1000 XLM/
  24h) is sized for "a recoverable drain of free faucet money"; that
  reasoning doesn't carry over to real money. Pick real values before the
  first mainnet deploy. Already tracked in `docs/RUNBOOKS.md`'s mainnet
  relayer deploy checklist, step 4.
- **`infra/relayer-redis/fly.mainnet.toml`** — not a value placeholder, but an
  open decision flagged in-file: the no-password Redis choice was justified
  for testnet specifically ("testnet dev relayer"); re-examine whether that
  reasoning still holds once this backs a mainnet relayer moving real money,
  before deploying it.
- **The `manager` Turnkey signer** (from #315, once merged) —
  `infra/relayer/config/config.json`'s `manager-signer` entry and
  `infra/relayer/README.md`'s accounts table both carry a locally-generated,
  never-funded placeholder keypair, not a real Turnkey wallet account. Create
  the real `manager` wallet account in the Turnkey console (README.md's
  Turnkey Setup section) and replace both — needed on **testnet first** (to
  actually test #315) and again on mainnet.
- **`infra/demo-service/src/relayerKeys.ts`** (mainnet section) — four
  freshly-generated, never-funded placeholder keypairs standing in for the
  real mainnet Fund/Channels-Fee-Payer/Channel-001/Channel-002 addresses.
  Swap once those are provisioned in Turnkey. Doesn't yet have a `manager`
  row at all (added by #315, testnet-only so far) — add one here too once a
  real mainnet manager account exists, so the demo-service's balance page can
  catch it running low on its own fee balance during the event.

## Frontend

- **`.github/workflows/deploy-production.yml`**'s "Build frontend
  (production)" step — still builds with `PUBLIC_STELLAR_NETWORK: testnet`
  and the testnet relayer URL/sim-source. The file's own comment: "flip to
  `PUBLIC_STELLAR_NETWORK: mainnet`, a mainnet `PUBLIC_RELAYER_URL`/
  `PUBLIC_RELAYER_SIM_SOURCE`, and a real `PUBLIC_PERCH_DEPLOYMENT` manifest
  once that infra exists." This is the actual cutover switch for `nido.fyi`
  — until it flips, `nido.fyi` keeps serving a testnet-configured build
  (account creation there is separately gated "coming soon" by
  `allowAccountCreation.ts` regardless).

## Factory / manager gate (from #315)

Not a "placeholder" in the grep sense, but the same category of "known
stand-in, fill in before relying on it": the live factory's `manager` is
`null` until `scripts/set-factory-manager.sh` is deliberately run (see that
script's header, and `infra/relayer/README.md`'s "Removing the Conference
Demo Gate" for the full lifecycle — this gate is meant to come back off
after the event too, not just go on once).

## Re-check before the cutover

```bash
grep -rniI "placeholder" --include="*.ts" --include="*.json" --include="*.astro" \
  --include="*.md" --include="*.sh" --include="*.toml" --include="*.yml" \
  infra/ docs/RUNBOOKS.md scripts/ .github/ | grep -v node_modules
```
