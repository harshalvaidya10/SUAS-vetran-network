import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { ApiError } from '../http/errors.js';
import { parse } from '../http/validation.js';
import { providerWithContact } from '../http/serialize.js';

export const authRouter: Router = Router();
const phoneSchema = z.object({ phone: z.string().trim().min(7).max(30) });
const verifySchema = phoneSchema.extend({ code: z.string().trim().length(6) });
export const normalizePhone = (phone: string) => phone.replace(/\D/g, '').slice(-10);

authRouter.post('/request-code', async (req, res) => {
  const { phone } = parse(phoneSchema, req.body);
  const provider = (await store.listProviders()).find(p => normalizePhone(p.phone) === normalizePhone(phone));
  if (provider) console.log(`[mock-sms] Login code for ${provider.phone}: ${config.mockOtpCode}`);
  // Do not reveal whether a phone number is enrolled.
  res.json({ sent: true, delivery: 'mock' });
});

authRouter.post('/verify-code', async (req, res) => {
  const { phone, code } = parse(verifySchema, req.body);
  if (code !== config.mockOtpCode) throw new ApiError(401, 'invalid_code', 'That login code is incorrect.');
  const matches = (await store.listProviders()).filter(p => normalizePhone(p.phone) === normalizePhone(phone));
  if (matches.length === 0) throw ApiError.notFound('No veteran enrollment uses that phone number.');
  if (matches.length > 1) throw ApiError.conflict('More than one enrollment uses that phone number. Contact support.');
  res.json({ provider: providerWithContact(matches[0]!) });
});
