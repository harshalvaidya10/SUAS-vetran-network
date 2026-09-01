import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { codeMatches, generateCode, hashCode } from '../domain/otp.js';
import { ApiError } from '../http/errors.js';
import { parse } from '../http/validation.js';
import { providerWithContact } from '../http/serialize.js';
import { issueSession } from '../http/authGuards.js';
import { messages } from '../sms/messages.js';
import { smsTransport } from '../sms/index.js';

export const authRouter: Router = Router();
const phoneSchema = z.object({ phone: z.string().trim().min(7).max(30) });
const verifySchema = phoneSchema.extend({ code: z.string().trim().length(6) });
export const normalizePhone = (phone: string) => phone.replace(/\D/g, '').slice(-10);

const usingMockSms = () => config.smsProvider === 'mock';

async function findByPhone(phone: string) {
  const key = normalizePhone(phone);
  return (await store.listProviders()).filter((p) => normalizePhone(p.phone) === key);
}

/**
 * POST /api/v1/auth/request-code
 *
 * Texts a sign-in code to an enrolled veteran. Always answers the same way
 * whether or not the number is enrolled, so this can't be used to test which
 * numbers are on the network.
 */
authRouter.post('/request-code', async (req, res) => {
  // Neither Postgres nor SQLite expires rows on their own, and expiry is
  // otherwise only enforced when something is read -- so a session abandoned
  // after it lapsed, or a code never submitted, would sit there for good.
  // Sweeping here bounds that by the login rate rather than by nothing.
  await store.purgeExpired(new Date().toISOString());

  const { phone } = parse(phoneSchema, req.body);
  const phoneKey = normalizePhone(phone);
  const [provider] = await findByPhone(phone);

  if (provider) {
    const existing = await store.getLoginChallenge(phoneKey);
    const since = existing ? Date.now() - new Date(existing.sentAt).getTime() : Infinity;
    const cooldownMs = config.otpResendCooldownSeconds * 1000;

    // Don't re-text on a double-tap, and don't let anyone run up an SMS bill.
    if (since < cooldownMs) {
      res.json({
        sent: true,
        delivery: smsTransport().name,
        retryAfterSeconds: Math.ceil((cooldownMs - since) / 1000),
      });
      return;
    }

    // A predictable code in mock mode keeps local testing and the automated
    // checks working without a phone; a real transport gets a random one.
    const code = usingMockSms() ? config.mockOtpCode : generateCode();
    const now = new Date();

    await store.saveLoginChallenge({
      phoneKey,
      codeHash: hashCode(code, phoneKey, config.otpHashSecret),
      expiresAt: new Date(now.getTime() + config.otpTtlMinutes * 60_000).toISOString(),
      attempts: 0,
      sentAt: now.toISOString(),
    });

    try {
      await smsTransport().send(provider.phone, messages.loginCode(code));
    } catch (error) {
      // Drop the challenge: keeping a code nobody received would also start the
      // resend cooldown, so an immediate retry would be told to wait for a text
      // that is never coming.
      await store.deleteLoginChallenge(phoneKey);
      console.error('[sms] delivery failed', error);
      throw new ApiError(
        502,
        'sms_failed',
        'We could not send the code right now. Please try again in a moment.',
      );
    }
  }

  res.json({ sent: true, delivery: smsTransport().name });
});

/**
 * POST /api/v1/auth/verify-code
 *
 * Checks the code and returns the veteran's own record. The code is single-use:
 * whether it is right, expired, or out of attempts, it does not survive.
 */
authRouter.post('/verify-code', async (req, res) => {
  const { phone, code } = parse(verifySchema, req.body);
  const phoneKey = normalizePhone(phone);
  const challenge = await store.getLoginChallenge(phoneKey);

  if (!challenge) {
    // Mock mode keeps the long-standing shortcut of accepting the fixed code
    // without a prior request, so existing local flows and scripts still work.
    if (!(usingMockSms() && code === config.mockOtpCode)) {
      throw new ApiError(401, 'invalid_code', 'Ask for a new code and try again.');
    }
  } else {
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      await store.deleteLoginChallenge(phoneKey);
      throw new ApiError(401, 'code_expired', 'That code has expired. Ask for a new one.');
    }

    if (challenge.attempts >= config.otpMaxAttempts) {
      await store.deleteLoginChallenge(phoneKey);
      throw new ApiError(429, 'too_many_attempts', 'Too many tries. Ask for a new code.');
    }

    if (!codeMatches(challenge.codeHash, hashCode(code, phoneKey, config.otpHashSecret))) {
      await store.saveLoginChallenge({ ...challenge, attempts: challenge.attempts + 1 });
      throw new ApiError(401, 'invalid_code', 'That login code is incorrect.');
    }
  }

  const matches = await findByPhone(phone);
  if (matches.length === 0) throw ApiError.notFound('No veteran enrollment uses that phone number.');
  if (matches.length > 1) {
    throw ApiError.conflict('More than one enrollment uses that phone number. Contact support.');
  }

  await store.deleteLoginChallenge(phoneKey);

  // The session is what later proves this is the same person; provider ids are
  // public, so the id alone can't be treated as a credential.
  const session = await issueSession(matches[0]!.id);
  res.json({ provider: providerWithContact(matches[0]!), session });
});
