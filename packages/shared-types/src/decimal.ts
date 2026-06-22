/**
 * Fixed-point decimal arithmetic for AXIOM.
 *
 * Money and quantities are NEVER represented as JavaScript `number` (IEEE-754
 * floating point), because float rounding is exactly the class of silent error
 * a settlement ledger must not have. Instead, every price/quantity is parsed
 * into a `bigint` scaled by 10^8 — matching the database column type
 * NUMERIC(18,8) — and all arithmetic (compare, min, subtract) is performed in
 * exact integer math. Values are converted back to a canonical decimal string
 * only when crossing the SQL boundary.
 *
 * Scale 8 and the 18-digit precision cap are derived directly from the schema:
 * NUMERIC(18,8) allows 10 integer digits + 8 fractional digits.
 */

/** Number of fractional digits, matching NUMERIC(18,8). */
export const DECIMAL_SCALE = 8;

/** 10^8 — the scaling factor that turns a decimal into an exact integer. */
const SCALE_FACTOR = 100_000_000n;

/** NUMERIC(18,8) permits at most 18 significant digits → |scaled value| < 10^18. */
const MAX_SCALED = 10n ** 18n;

/**
 * A quantity or price represented as an exact integer scaled by 10^8.
 * Branded so a raw `bigint` cannot be passed where a `Scaled` is expected.
 */
export type Scaled = bigint & { readonly __brand: 'Scaled' };

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Parse a decimal string (e.g. "100.5", "0.00000001") into a `Scaled` integer.
 * @throws if the input is not a valid decimal, has more than 8 fractional
 *         digits, or overflows NUMERIC(18,8).
 */
export function parseScaled(input: string): Scaled {
  const value = input.trim();
  if (!DECIMAL_PATTERN.test(value)) {
    throw new RangeError(`Invalid decimal string: "${input}"`);
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  // DECIMAL_PATTERN guarantees at least one integer digit, so intPart is always
  // present; the '0' default exists only to satisfy noUncheckedIndexedAccess.
  const [intPart = '0', fracPartRaw = ''] = unsigned.split('.');

  if (fracPartRaw.length > DECIMAL_SCALE) {
    throw new RangeError(
      `Too many fractional digits in "${input}" (max ${DECIMAL_SCALE}).`,
    );
  }

  const fracPart = fracPartRaw.padEnd(DECIMAL_SCALE, '0');
  const magnitude = BigInt(intPart) * SCALE_FACTOR + BigInt(fracPart);

  if (magnitude >= MAX_SCALED) {
    throw new RangeError(`Value "${input}" exceeds NUMERIC(18,8) precision.`);
  }

  return (negative ? -magnitude : magnitude) as Scaled;
}

/** Format a `Scaled` integer back into a canonical decimal string with 8 dp. */
export function formatScaled(value: Scaled): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const intPart = magnitude / SCALE_FACTOR;
  const fracPart = (magnitude % SCALE_FACTOR).toString().padStart(DECIMAL_SCALE, '0');
  return `${negative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/** The smaller of two scaled values. */
export function minScaled(a: Scaled, b: Scaled): Scaled {
  return (a < b ? a : b) as Scaled;
}

/** Exact subtraction, preserving the brand. */
export function subScaled(a: Scaled, b: Scaled): Scaled {
  return (a - b) as Scaled;
}

/** True when the value is strictly greater than zero. */
export function isPositive(value: Scaled): boolean {
  return value > 0n;
}

/** True when the value is exactly zero. */
export function isZero(value: Scaled): boolean {
  return value === 0n;
}

/** Zero, as a branded `Scaled`. */
export const ZERO_SCALED = 0n as Scaled;
