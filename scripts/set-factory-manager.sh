#!/usr/bin/env bash
#
# Activate (or deactivate) the invite-code gate on an ALREADY-DEPLOYED
# factory: calls `set_manager` on it, which from then on requires `manager`'s
# authorization on every `create_account` (contracts/factory's
# `manager.require_auth()`). infra/relayer/plugins/manager is the piece that
# actually provides that authorization — see infra/relayer/README.md's
# "Direct-RPC plugins (funder, manager)".
#
# DO NOT RUN THIS until that plugin's manager signer is a real Turnkey
# wallet account (not the placeholder in infra/relayer/config/config.json)
# and the whole flow (demo/start -> new-account -> relayer /create-account)
# has been tested end to end. The moment this lands, EVERY create_account
# call needs the manager's authorization — if the plugin isn't working yet,
# this blocks all account creation until it is (or until this script is run
# again with an empty manager to turn the gate back off).
#
# This whole gate is TEMPORARY, for one conference's demo window — once it's
# run with an empty manager afterward, see infra/relayer/README.md's
# "Removing the Conference Demo Gate" for everything else that comes out.
#
# Unlike scripts/deploy-factory.sh (which only ever deploys a FRESH factory —
# redeploying would change the factory's address, breaking every account
# whose passkey binding commits to the current one), this is an in-place
# admin call on the EXISTING factory. It then updates that factory's own
# record (packages/passkey-sdk/src/perch/factory.<network>.json) so the
# record keeps matching what the live contract reports — the exact invariant
# deployment.test.ts and scripts/check-factory.sh both check.
#
# Usage:
#   scripts/set-factory-manager.sh <admin-identity> <manager-address> [network]
#   scripts/set-factory-manager.sh <admin-identity> "" [network]   # turn the gate back off
#
#   <admin-identity>   A `stellar keys` identity for the factory's CURRENT
#                       admin (packages/passkey-sdk/src/perch/factory.<network>.json's
#                       "admin" field says who that is today).
#   <manager-address>  The address set_manager should require from now on, or
#                       "" to clear it (anyone may create an account again).
#   [network]          Default "testnet".
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
note() { echo "→ $*" >&2; }

IDENTITY="${1:-}"
MANAGER="${2-}"
NETWORK="${3:-testnet}"
[ -n "$IDENTITY" ] || die "usage: $0 <admin-identity> <manager-address-or-empty> [network]"
[ -z "$MANAGER" ] || [[ "$MANAGER" =~ ^[GC][A-Z2-7]{55}$ ]] || die "manager '$MANAGER' is not an address"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
RECORD="packages/passkey-sdk/src/perch/factory.$NETWORK.json"
[ -f "$RECORD" ] || die "no factory record at $RECORD"

command -v stellar >/dev/null || die "stellar CLI not found"
command -v jq >/dev/null || die "jq not found"

FACTORY="$(jq -r .factory "$RECORD")"
CURRENT_ADMIN="$(jq -r .admin "$RECORD")"
NETWORK_PASSPHRASE="$(jq -r .network_passphrase "$RECORD")"
[[ "$FACTORY" =~ ^C[A-Z2-7]{55}$ ]] || die "$RECORD has no factory address"
DEFAULT_RPC_URL="https://soroban-testnet.stellar.org"
[ "$NETWORK" = "mainnet" ] && DEFAULT_RPC_URL="https://mainnet.sorobanrpc.com"

# shellcheck source=scripts/stellar-rpc.sh
. scripts/stellar-rpc.sh
rpc_select "${RPC_URL:-$DEFAULT_RPC_URL}" "$NETWORK_PASSPHRASE" || die "no usable RPC endpoint for $NETWORK"
RPC="$(rpc_url)"
NET=(--source-account "$IDENTITY" --rpc-url "$RPC" --network-passphrase "$NETWORK_PASSPHRASE")

CALLER="$(stellar keys address "$IDENTITY")"
[ "$CALLER" = "$CURRENT_ADMIN" ] ||
    die "identity '$IDENTITY' ($CALLER) is not the factory's current admin ($CURRENT_ADMIN)"

note "factory $FACTORY: set_manager ${MANAGER:-<none>} (admin $CURRENT_ADMIN)"
MANAGER_ARG=()
[ -z "$MANAGER" ] || MANAGER_ARG=(--manager "\"$MANAGER\"")
stellar contract invoke --id "$FACTORY" "${NET[@]}" -- set_manager ${MANAGER_ARG[@]+"${MANAGER_ARG[@]}"} >/dev/null

readback="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- manager | tr -d '"')"
[ "$readback" = "${MANAGER:-null}" ] || die "manager reads back as '$readback', expected '${MANAGER:-null}'"
note "confirmed: manager is now ${MANAGER:-none}"

note "updating $RECORD"
tmp="$(mktemp)"
jq --arg manager "$MANAGER" '.manager = (if $manager == "" then null else $manager end)' "$RECORD" > "$tmp"
mv "$tmp" "$RECORD"

echo "$readback"
