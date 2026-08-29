import { z } from 'zod';
import { ApiError } from './errors.js';
import { MILITARY_BRANCHES, SERVICE_TYPE_IDS } from '../domain/serviceCatalog.js';

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Must be an ISO-8601 date-time');

export const placeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(1).max(200).optional(),
});

const offeringSchema = z.object({
  serviceType: z.enum(SERVICE_TYPE_IDS),
  rateType: z.enum(['volunteer', 'hourly']).default('volunteer'),
  hourlyRateUsd: z.number().min(0).max(500).default(0),
});

export const providerCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  branch: z.enum(MILITARY_BRANCHES),
  yearsOfService: z.number().int().min(0).max(60),
  bio: z.string().trim().max(500).default(''),
  email: z.string().email(),
  phone: z.string().trim().min(7).max(30),
  base: placeSchema,
  serviceRadiusKm: z.number().min(1).max(200).default(25),
  offerings: z.array(offeringSchema).min(1, 'Pick at least one service you can provide'),
});

export const providerUpdateSchema = z
  .object({
    active: z.boolean(),
    bio: z.string().trim().max(500),
    serviceRadiusKm: z.number().min(1).max(200),
    offerings: z.array(offeringSchema).min(1),
  })
  .partial();

export const slotCreateSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    serviceTypes: z.array(z.enum(SERVICE_TYPE_IDS)).min(1),
    origin: placeSchema.optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((slot) => new Date(slot.endsAt) > new Date(slot.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

const requesterSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().email().optional(),
    phone: z.string().trim().min(7).max(30).optional(),
  })
  .refine((requester) => requester.email || requester.phone, {
    message: 'Provide an email or a phone number so the veteran can reach you',
    path: ['email'],
  });

/**
 * The one request body the client app has to know how to build. Everything
 * except serviceType, location and requester has a sensible default.
 */
export const serviceRequestSchema = z.object({
  serviceType: z.enum(SERVICE_TYPE_IDS),
  location: placeSchema,
  requester: requesterSchema,
  /** Defaults to "from now until 7 days out". */
  window: z
    .object({ startsAt: isoDateTime.optional(), endsAt: isoDateTime.optional() })
    .optional(),
  durationMinutes: z.number().int().min(15).max(600).optional(),
  maxDistanceKm: z.number().min(1).max(200).default(40),
  preferences: z
    .object({
      minRating: z.number().min(0).max(5).optional(),
      branch: z.enum(MILITARY_BRANCHES).optional(),
      maxHourlyRateUsd: z.number().min(0).max(500).optional(),
      volunteerOnly: z.boolean().optional(),
      providerId: z.string().uuid().optional(),
    })
    .default({}),
  /** false returns the shortlist without holding anyone's slot. */
  autoBook: z.boolean().default(true),
  notes: z.string().trim().max(500).optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

export const bookingUpdateSchema = z.object({
  status: z.enum(['completed', 'cancelled']),
});

/** Parses a body, turning zod issues into a 400 with field-level details. */
export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.badRequest(
      'The request body is invalid.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}
