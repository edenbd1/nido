/**
 * TEMPORARY — for one conference's demo window only. Once the event is over
 * and `scripts/set-factory-manager.sh` has turned the gate back off, this
 * whole directory can be deleted — see infra/relayer/README.md's "Removing
 * the Conference Demo Gate" for the full checklist (config.json, Caddyfile,
 * and the frontend's invitationCode branch all come out together).
 *
 * Entry point for the Nido "manager" relayer plugin: the enforcement point
 * for "only people who went through our onboarding (a valid, unused invite
 * code) can get a Nido account."
 *
 * contracts/factory's `create_account` already supports an optional
 * `manager: Option<Address>` that, once set via `set_manager`, must
 * authorize every call (manager.require_auth()) — see contract.rs. This
 * plugin IS that manager's authorization path: it validates+claims the
 * caller's invite code against infra/invite's existing Checker (the same
 * `POST /codes/:code/check` the demo flow's early gate already uses — see
 * packages/frontend/src/lib/demo/inviteCheck.ts), and only on success signs
 * and submits the real create_account transaction.
 *
 * Soroban auth mechanics are why this is a relayer plugin rather than a
 * signature infra/invite could produce itself: the relayer's only signing
 * primitive (`relayer.signTransaction`) signs a TRANSACTION's hash, which is
 * a cryptographically distinct preimage from a Soroban authorization
 * entry's hash — one can't be substituted for the other. Rather than needing
 * a new raw-hash-signing primitive, this plugin makes the manager itself the
 * transaction's SOURCE ACCOUNT: Soroban satisfies `require_auth()` for an
 * Address that IS the tx's source account implicitly, from the ordinary
 * transaction signature alone. Same recipe ../funder/index.ts already uses
 * for `fund` (build+simulate+assemble locally, ask the relayer to sign the
 * assembled envelope via Turnkey, submit straight to Soroban RPC — bypassing
 * both the relayer's own sequence-assignment bug AND its Channels-pool
 * fee-sponsorship, same tradeoff `fund` already makes).
 *
 * The manager's own Stellar account pays this transaction's fee directly
 * (no Channels-pool sponsorship for this call) — it needs its own funded
 * balance, same as `fund` does for its transfers.
 */
import type { PluginContext } from "@openzeppelin/relayer-sdk";
import {
  Address,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const MANAGER_RELAYER_ID = "manager";
const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const INVITE_API_URL = (process.env.INVITE_API_URL ?? "").replace(/\/+$/, "");
const INVITE_API_KEY = process.env.INVITE_API_KEY;
// The factory to deploy from — never trust a client-supplied address here:
// a malicious caller pointing this at an unenforced contract would defeat
// the whole point of gating creation on an invite code.
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS ?? "";

const NETWORK_CONFIG: Record<string, { passphrase: string; rpcUrl: string }> = {
  testnet: { passphrase: Networks.TESTNET, rpcUrl: "https://soroban-testnet.stellar.org" },
  mainnet: { passphrase: Networks.PUBLIC, rpcUrl: "https://mainnet.sorobanrpc.com" },
};

type Params = {
  invitationCode: string;
  /** hex, 32 bytes — the setup key's public key (get_c_address's argument). */
  setupPk: string;
  /** hex, 65 bytes — the passkey's uncompressed public key. */
  key: string;
  /** hex, 64 bytes — the setup key's Ed25519 signature over the passkey binding. */
  setupSig: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexToScBytes(hex: string, expectedBytes: number, field: string): xdr.ScVal {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== expectedBytes * 2) {
    throw new Error(`Invalid ${field}: must be ${expectedBytes}-byte hex`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
}

export async function handler(context: PluginContext): Promise<unknown> {
  // PluginContext.params is untyped (`any`) in @openzeppelin/relayer-sdk —
  // this cast documents the actual shape this plugin expects, same role
  // funder/channels's `PluginContext<Params>` generic was reaching for
  // (that generic doesn't actually exist on this version of the type).
  const { api, params } = context as PluginContext & { params: Params };
  // Kill switch, same pattern as the funder plugin — flip MANAGER_ENABLED=false
  // and redeploy if this needs to come off without touching config.json (which
  // takes effect only on next bootstrap anyway — see README.md).
  if (process.env.MANAGER_ENABLED === "false") {
    throw new Error("manager plugin is disabled (MANAGER_ENABLED=false)");
  }
  if (!FACTORY_ADDRESS) {
    throw new Error("FACTORY_ADDRESS is not configured");
  }
  if (!INVITE_API_URL) {
    throw new Error("INVITE_API_URL is not configured");
  }

  const { invitationCode } = params;
  if (typeof invitationCode !== "string" || !invitationCode) {
    throw new Error("Missing invitationCode");
  }
  const setupPkArg = hexToScBytes(params.setupPk, 32, "setupPk");
  const keyArg = hexToScBytes(params.key, 65, "key");
  const setupSigArg = hexToScBytes(params.setupSig, 64, "setupSig");

  const networkConfig = NETWORK_CONFIG[STELLAR_NETWORK];
  if (!networkConfig) {
    throw new Error(`No network config for: ${STELLAR_NETWORK}`);
  }

  const relayer = api.useRelayer(MANAGER_RELAYER_ID);
  const relayerInfo = await relayer.getRelayer();
  const managerAddress = (relayerInfo as { address: string }).address;

  const server = new rpc.Server(networkConfig.rpcUrl);
  const sourceAccount = await server.getAccount(managerAddress);

  // Derive the address create_account will actually deploy to, server-side —
  // never trust a client-supplied address for this. get_c_address is a
  // read-only view (no state change), so simulating it against the SAME
  // account snapshot we're about to build the real transaction from is safe:
  // nothing here consumes a sequence number.
  const predictTxn = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: networkConfig.passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: FACTORY_ADDRESS,
        function: "get_c_address",
        args: [setupPkArg],
      }),
    )
    .setTimeout(0)
    .build();
  const predictSim = await server.simulateTransaction(predictTxn);
  if (rpc.Api.isSimulationError(predictSim) || rpc.Api.isSimulationRestore(predictSim)) {
    throw new Error(`Address prediction failed: ${"error" in predictSim ? predictSim.error : "restore needed"}`);
  }
  if (!predictSim.result) throw new Error("Address prediction returned no result");
  const address = Address.fromScVal(predictSim.result.retval).toString();

  // Validate+claim the invite code against the address we just derived — the
  // same hard gate the demo flow's early check already uses, reused as-is
  // rather than duplicated. Idempotent against the SAME address (checker.ts),
  // so this plays fine alongside that earlier, UX-only pre-check.
  const checkHeaders: Record<string, string> = { "content-type": "application/json" };
  if (INVITE_API_KEY) checkHeaders["x-api-key"] = INVITE_API_KEY;
  const checkRes = await fetch(`${INVITE_API_URL}/codes/${encodeURIComponent(invitationCode)}/check`, {
    method: "POST",
    headers: checkHeaders,
    body: JSON.stringify({ address }),
  });
  if (!checkRes.ok) {
    const body = await checkRes.json().catch(() => null);
    throw new Error(`Invitation check failed: ${body?.reason ?? checkRes.status}`);
  }

  // Checked — build the real create_account, with the manager as the
  // transaction's OWN source account (see module doc comment for why that
  // satisfies manager.require_auth() without a separate signed auth entry).
  const txn = new TransactionBuilder(sourceAccount, {
    fee: "1000000",
    networkPassphrase: networkConfig.passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: FACTORY_ADDRESS,
        function: "create_account",
        args: [setupPkArg, keyArg, setupSigArg],
      }),
    )
    .setTimeout(60)
    .build();

  const SIM_ATTEMPTS = 6;
  let sim = await server.simulateTransaction(txn);
  for (let simAttempt = 1; simAttempt < SIM_ATTEMPTS; simAttempt++) {
    if (!rpc.Api.isSimulationError(sim) && !rpc.Api.isSimulationRestore(sim)) break;
    await sleep(1500);
    sim = await server.simulateTransaction(txn);
  }
  if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim)) {
    throw new Error(`create_account simulation failed: ${"error" in sim ? sim.error : "restore needed"}`);
  }

  const assembled = rpc.assembleTransaction(txn, sim).build();

  // Relayer only signs (Turnkey-backed, no sequence-assignment code touched)
  // -- we submit the result ourselves, same as the funder plugin.
  const signResult = await relayer.signTransaction({ unsigned_xdr: assembled.toXDR() });
  const signedXdr = (signResult as { signedXdr: string }).signedXdr;
  const signedEnvelope = TransactionBuilder.fromXDR(signedXdr, networkConfig.passphrase);

  const send = await server.sendTransaction(signedEnvelope);
  if (send.status === "ERROR") {
    throw new Error(`create_account transaction failed: ${send.errorResult?.toString() ?? "submission error"}`);
  }

  return { hash: send.hash, status: send.status, address };
}
