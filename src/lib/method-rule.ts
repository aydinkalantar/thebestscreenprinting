/**
 * The print method follows the quantity, the standard way (Custom Ink style), one rule for the
 * product designer:
 *   - under the screen-print minimum (facts.shop.screenMinimum, set in the studio's Settings ›
 *     Print prices & areas), a screen-printed spot moves to DTF (else DTG) so the real price shows at
 *     once, with a short line saying why;
 *   - from the minimum up it moves back to screen printing when that's the cheaper of the two
 *     (otherwise it stays on DTF and says so);
 *   - a method the customer picked themselves is never changed (they get a nudge instead);
 *   - embroidery stays (it has the same minimum, there's nothing to switch it to);
 *   - full-color art (photos, gradients) is on DTF at any quantity (the art check, unchanged).
 * The studio's Finish-your-order page and Max follow the same rule (lib/finish-order-core.ts pickMethod,
 * lib/agent/prompt.ts).
 */
export const isScreen = (m: string) => /screen|silk/i.test(m);
export const isEmbroidery = (m: string) => /embroid/i.test(m);

/** The method a small run prints with: DTF, else DTG, from the methods this spot offers. */
export const smallRunMethod = (offered: string[]) =>
  offered.find((m) => /dtf|transfer/i.test(m)) ?? offered.find((m) => /dtg|direct/i.test(m));

/** "DTF transfer" → "DTF" for customer copy. */
export const shortName = (m: string) => (/dtf|transfer/i.test(m) ? 'DTF' : /dtg|direct/i.test(m) ? 'DTG' : m);

export const smallRunWhy = (screenMin: number, to: string) => `screen printing starts at ${screenMin}, so we'll print these with ${shortName(to)}`;
export const cheaperWhy = (n: number) => `costs less than screen printing for ${n} pieces`;
export const screenNote = (screenMin: number) => `starts at ${screenMin} pieces`;
