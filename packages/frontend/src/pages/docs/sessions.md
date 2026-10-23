---
layout: ../../layouts/DocsLayout.astro
title: Request a session
description: Ask a Nido account for the grants your app needs, with limits, explain them to the owner, and turn every refusal into a sentence a person can act on.
---

## The call site

Everything below comes from the template's `@stellar-scaffold/app-lib`
(`app-lib/` in your app), except `SessionGate`, which is a React component in
`app/src/components/`, and your contract's generated client.

```tsx
import {
  describe,
  isOverCap,
  submitCall,
  xlmTokenId,
  type Grant,
} from "@stellar-scaffold/app-lib"
import { myContract } from "@stellar-scaffold/app-lib/clients"
import { useState } from "react"
import { useWallet } from "../hooks/useWallet"
import { SessionGate } from "./SessionGate"

// Your contract's error codes as words (or your generated client's `Errors`)
const errors = { 1: "Sold out", 2: "Already bought" }
const dailyCap = 2
// One grant per contract the call authorizes for the user
const grants: Grant[] = [
  {
    target: myContract.options.contractId,
    functions: ["buy"],
    duration: "24h",
    label: "my-app",
  },
  {
    target: xlmTokenId,
    functions: ["transfer"],
    duration: "24h",
    limit: { amount: String(dailyCap), period: "day" },
    label: "my-app-xlm",
  },
]

export const Buy = () => {
  const { address } = useWallet()
  const [message, setMessage] = useState<string>()
  const onClick = async () => {
    if (!address) return
    try {
      // No await before submitCall: Nido's popup needs the click's gesture
      const { result, hash } = await submitCall(address, (publicKey) =>
        myContract.buy({ user: address }, { publicKey }),
      )
      setMessage(`Done: ${String(result)} in ${hash}`)
    } catch (error) {
      setMessage(
        isOverCap(error)
          ? `That's the ${dailyCap} XLM a day you allowed. Nothing was sent.`
          : describe(error, errors),
      )
    }
  }
  return (
    <SessionGate
      grants={grants}
      explain={
        <p>
          Approve this app once and it can buy for you for 24 hours,
          spending at most {dailyCap} XLM a day. Nido asks you to confirm
          two rules: the first allows only <code>buy</code>, without a cap;
          the second caps the XLM.
        </p>
      }
    >
      <button onClick={() => void onClick()}>Buy</button>
      {message && <p>{message}</p>}
    </SessionGate>
  )
}
```

`submitCall(address, build)` builds the call with a transaction source a
C-address can use, then submits it the right way for the connected wallet:

- a classic G-address wallet signs and sends it;
- a Nido account with an approved session: your app's session key signs it (`submitWithSession`), with no prompt;
- a Nido account without one: Nido's sign popup, which only covers calls on the
  account itself, so a call into your contract is refused (`#3002` or `#3014`).

It resolves `{ result, hash }` once the transaction is confirmed. The parts are
exported too (`reserveSigningPopup`, `transactionSource`, `submitContract`) if
you need your own flow.

## What SessionGate shows

`SessionGate` compares the `grants` you pass with what the account has approved
for this app's key: target, functions, cap and expiry. It shows its children to
classic wallets right away, and to a Nido account once its approvals cover
`grants`. Until then it shows one of:

| State | What the owner sees |
| --- | --- |
| Nothing approved yet | Your `explain` text and **Approve with Nido (N confirmations)** |
| A grant changed (new target, function or cap) | "This needs more than you approved for this app so far." and **Approve** |
| A grant expired | "This app's approval expired." and **Renew with Nido** |
| Making the key | "Preparing a key for this app…" while Friendbot funds it |
| Sent to Nido, no answer recorded | **Check again**, **Ask Nido again**, **Start over** |

N is the number of grants still missing: one passkey confirmation each. With
`actionsOnly`, the children stay visible and only their buttons and inputs
wait for approval.

Several gates in one app share one key. Each asks only for the grants it lacks.
A redeployed contract gets a new ID, so a gate whose grant targets it asks
again.

## Write the explanation

The owner reads your `explain` text before Nido's pages, and Nido's pages show
the rule's terms, not your app's reasons. Say:

- what the app will do (the functions, in plain words);
- for how long (the `duration`);
- the most it can spend, and what one action costs;
- why one rule has no cap, if one doesn't. Nido asks the owner to tick "Let this
  key spend without any cap" for every grant without a `limit`, even one on a
  contract that moves no money, so tell them before they get there.

## What the owner sees on Nido

For each grant, the app sends the owner to
`https://<account>.test.nido.fyi/security/delegate-doc/`. That page shows:

- the contract and the app's key;
- the functions the key may call;
- the expiry, which the owner can change;
- the spending cap, prefilled from your `limit`, or the "no cap" checkbox;
- what changes in the account's policy document, and the document itself.

**Review & continue** opens Nido's signing page, the owner confirms with their
passkey, and Nido's relayer applies the change. Then Nido sends the owner back
to your app with `?delegation=ok`, and the template moves straight on to the
next grant if there is one. **Cancel** returns `?delegation=cancelled`: the
template keeps the key and anything already approved, and the gate asks again
next time.

The grant page takes one contract per request, so a two-grant session is two
pages and two passkey confirmations. One confirmation for several grants is
<span class="docs-tag">Not available yet</span>.

## When the account says no

The account checks every session call against its rules while the call is
simulated, before your app sends anything. A refused call costs nothing.
`describe(error, contractErrors)` turns each refusal into a sentence:

| Code | Cause | `describe` says |
| --- | --- | --- |
| `#3221` | The call would go over a grant's cap | "Your account refused: this would go over the spending cap you gave this app." |
| `#3002`, `#3016` | No rule covers the call, or it expired | "…no approved rule covers this call for this app (it may have expired)." |
| `#3014` | The call touches a contract the app has no rule for | "…the call touches a contract the app has no rule for." |
| `FEE_LIMIT_EXCEEDED` | Nido's relayer budget is used up | "Nido's free transaction budget is used up for now, so nothing was sent." |
| `POOL_CAPACITY` | Nido's relayer is busy | "Nido's relayer is busy, so nothing was sent. Try again in a minute." |
| `Error(Contract, #n)` | Your contract's own error | "The contract refused: " plus the text from `contractErrors` |

Pass a table of your contract's error codes as `contractErrors` (your
generated client's `Errors` table, or your own) so they read as words. Use `isOverCap(error)` when you want to name the cap and
say when it resets, as in the example above; it recognises `#3221` before and
after `describe` has turned it into a sentence.

`#3014` on a call that should be covered usually means a missing grant: a
sub-call, such as the token `transfer`, needs a grant of its own. The template
also stops before sending when no rule for this key covers a contract in the
call, and names the contract.

## When an approval doesn't land

Applying a grant goes through Nido's relayer, which can refuse or time out (see
[Troubleshooting](/docs/troubleshooting/#nido-says-it-couldnt-confirm-what-happened)).
The account's installed rules are the truth, so the template recovers from the
app:

1. The owner goes back to the app. The gate says Nido hasn't confirmed the
   grant yet.
2. **Check again** reads the account's `installed_rules` and records any grant
   that landed, with its real expiry.
3. If nothing landed, **Ask Nido again** reuses the same key, so there is no
   second Friendbot wait, and it can't pay twice for a grant that isn't there.

The template can also read `?delegation=error&code=…` and
`?delegation=signed&payload=…`, where Nido would hand back the passkey-signed
approval for your session key to submit and pay for. Nido's grant page sends
only `ok` and `cancelled` today; those two answers are
<span class="docs-tag">Not available yet</span>.

## Nido's grant page parameters

If you build the session flow yourself instead of using the template, this is
the request Nido's grant page takes. Open
`https://<account>.test.nido.fyi/security/delegate-doc/` with the account's
C-address in lower case as the subdomain, and these query parameters:

| Parameter | Required | Value |
| --- | --- | --- |
| `origin` | Yes | Your app's origin (`https://…` or `http://localhost:…`) |
| `target` | Yes | The one contract (`C…`) the key may call |
| `signer` | Yes | The session key's address (`G…` or `C…`); your app holds its secret |
| `return` | Yes | Where to send the owner back; must be on `origin` |
| `functions` | No | Comma-separated function names; every function when absent |
| `duration` | No | `24h`, `7d`, `30d` or `none`; `30d` when absent |
| `limit` | No | A cap on `transfer` amounts, in decimal XLM |
| `limit_period` | No | `day`, `week` or `30d`, only with `limit`; `day` when absent |
| `label` | No | The rule's name; `session` when absent. The same name replaces that rule |

A present but malformed `duration`, `limit` or `limit_period` rejects the whole
request, so a bad cap can't turn into an uncapped grant. Avoid `none`: revoking
is not available yet, so such a rule would never end.

Nido replaces the return URL's query with `?delegation=ok` or
`?delegation=cancelled`. Treat `ok` as "the page finished", and read the
account's `installed_rules` to see what landed.

To sign later calls, build a CAP-0071 `AddressWithDelegates` authorization
entry for the account that names the approved rule for each contract in the
call, and sign it with the session key. `@stellar/stellar-sdk` 16.4 or newer
has `buildWithDelegatesEntry` for this. A simulation can return the account's
credentials as `sorobanCredentialsAddressV2` as well as
`sorobanCredentialsAddress`; handle both, or the account's entry stays unsigned.
The template's `submitWithSession` in `app-lib/session.ts` is a complete,
tested example.
