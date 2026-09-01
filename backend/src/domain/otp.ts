import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Codes are 6 digits because that is what people expect to be texted. */
export const CODE_LENGTH = 6;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * Codes are stored hashed and keyed to the phone, so one leaked row can't be
 * replayed against another number. HMAC rather than a plain digest because a
 * 6-digit space is trivially rainbow-tabled.
 */
export function hashCode(code: string, phoneKey: string, secret: string): string {
  return createHmac('sha256', secret).update(`${phoneKey}:${code}`).digest('hex');
}

/** Constant-time compare, so a wrong code can't be narrowed down by timing. */
export function codeMatches(expectedHash: string, actualHash: string): boolean {
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(actualHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
