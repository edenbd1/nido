/**
 * The `/demo/start` event-token gate and the demo service's visit
 * registration call. See
 * `docs/superpowers/specs/2026-10-12-meridian-onboarding-flow-design.md`
 * ("Access control") for why the token exists: the QR is a static,
 * public-ish link, so a shared, revocable token is the thing that actually
 * makes this "only through our QR code" rather than "any URL anyone finds."
 */

/**
 * Checks the token carried on the QR's link against the one configured for
 * this event. Disabled (always passes) when no token is configured, same
 * convention as `RELAYER_URL` in `lib/network.ts` — empty means "off."
 */
export function eventTokenMatches(expected: string, provided: string | null): boolean {
  if (!expected) return true;
  return provided === expected;
}

export interface DemoVisitRegistration {
  visit: string;
}

/**
 * Registers a visit with the demo service against the predicted address, so
 * the service can notice that address get funded on-chain and tell the kiosk
 * to print a receipt. Best-effort: disabled (no-op, returns null) when no
 * service URL is configured, and the caller is expected to treat a thrown
 * error as non-fatal too — losing the receipt correlation should never block
 * the attendee from getting their account.
 */
export async function registerDemoVisit(
  serviceUrl: string,
  address: string,
): Promise<DemoVisitRegistration | null> {
  if (!serviceUrl) return null;

  const resp = await fetch(`${serviceUrl.replace(/\/+$/, "")}/visits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!resp.ok) {
    throw new Error(`Demo service rejected visit registration: ${resp.status}`);
  }
  return (await resp.json()) as DemoVisitRegistration;
}
