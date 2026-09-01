import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { ApiError } from './errors.js';
import type { Provider } from '../types.js';

/**
 * The signed-in veteran, once a session has been resolved. Params are pinned to
 * the string dictionary Express uses; extending the bare `Request` falls back to
 * its generic defaults and loses route-param typing.
 */
export interface AuthedRequest extends Request<Record<string, string>> {
  veteran?: Provider;
}

function bearer(req: Request): string | null {
  const header = req.header('Authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

const equals = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Layer 1: which application is calling.
 *
 * Guards the demand side, where an unauthenticated caller could book real
 * veterans' committed hours. Off entirely when no tokens are configured, so
 * local development and the tests need no credential.
 *
 * This cannot guard the veteran site: that runs in a browser, where any token
 * shipped to the client is public. Browser-driven writes are guarded by the
 * veteran's own session instead.
 */
export function requireServiceToken(req: Request, _res: Response, next: NextFunction): void {
  if (config.serviceTokens.length === 0) {
    next();
    return;
  }

  const token = bearer(req);
  if (!token || !config.serviceTokens.some((candidate) => equals(candidate, token))) {
    throw new ApiError(
      401,
      'service_token_required',
      'This endpoint needs a service token. Send it as `Authorization: Bearer <token>`.',
    );
  }
  next();
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Issues a session for a veteran who has proved they hold the phone. */
export async function issueSession(providerId: string) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000).toISOString();
  await store.saveSession({
    tokenHash: hashToken(token),
    providerId,
    expiresAt,
    createdAt: new Date().toISOString(),
  });
  return { token, expiresAt };
}

/**
 * Layer 2: which person is acting.
 *
 * Provider ids are listable, so without this anyone could edit another
 * veteran's profile, withdraw their blocks, or cancel their rides. Always on —
 * there is no environment where that should be allowed.
 *
 * When VA verification lands, only how a session is created changes; everything
 * downstream keeps asking whose session this is.
 */
export async function requireVeteranSession(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    throw new ApiError(401, 'sign_in_required', 'Sign in with your phone number to do that.');
  }

  const session = await store.getSession(hashToken(token));
  if (!session) {
    throw new ApiError(401, 'sign_in_required', 'That session is no longer valid. Sign in again.');
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await store.deleteSession(session.tokenHash);
    throw new ApiError(401, 'session_expired', 'Your session has expired. Sign in again.');
  }

  const veteran = await store.getProvider(session.providerId);
  if (!veteran) {
    await store.deleteSession(session.tokenHash);
    throw new ApiError(401, 'sign_in_required', 'That enrolment no longer exists.');
  }

  req.veteran = veteran;
  next();
}

/** Refuses a signed-in veteran acting on somebody else's record. */
export function requireOwnership(req: AuthedRequest, providerId: string): Provider {
  const veteran = req.veteran;
  if (!veteran) {
    throw new ApiError(401, 'sign_in_required', 'Sign in with your phone number to do that.');
  }
  if (veteran.id !== providerId) {
    throw new ApiError(403, 'not_your_enrolment', 'That belongs to a different veteran.');
  }
  return veteran;
}
