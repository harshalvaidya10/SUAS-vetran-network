import type { MilitaryBranch, ServiceTypeId } from './domain/serviceCatalog.js';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Place extends GeoPoint {
  address?: string;
}

/** What a veteran is willing to do, and on what terms. */
export interface ServiceOffering {
  serviceType: ServiceTypeId;
  /** 'volunteer' providers charge nothing; 'hourly' providers charge hourlyRateUsd. */
  rateType: 'volunteer' | 'hourly';
  hourlyRateUsd: number;
}

/** A veteran providing services on the network. */
export interface Provider {
  id: string;
  name: string;
  branch: MilitaryBranch;
  yearsOfService: number;
  bio: string;
  email: string;
  phone: string;
  /** Where they start from; used for distance to the requester. */
  base: Place;
  /** How far they are willing to travel from `base`. */
  serviceRadiusKm: number;
  offerings: ServiceOffering[];
  /** 0-5. New providers start unrated and are treated as 4.5 by the matcher. */
  rating: number | null;
  completedJobs: number;
  /** Manual ID/DD-214 check. Unverified providers are never matched. */
  verified: boolean;
  active: boolean;
  createdAt: string;
}

export type SlotStatus = 'open' | 'booked' | 'cancelled';

/**
 * A block of time a veteran has committed to. Slots are the unit of supply:
 * one slot produces at most one booking, so committing to a slot is a real
 * promise rather than a soft "maybe I'm around".
 */
export interface AvailabilitySlot {
  id: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
  /** Subset of the provider's offerings they'll cover during this slot. */
  serviceTypes: ServiceTypeId[];
  status: SlotStatus;
  /** Optional override — e.g. "I'm downtown that afternoon, match me from there". */
  origin?: Place;
  note?: string;
  createdAt: string;
}

export type BookingStatus = 'confirmed' | 'completed' | 'cancelled';

export interface Requester {
  name: string;
  email?: string;
  phone?: string;
}

export interface Booking {
  id: string;
  requestId: string;
  slotId: string;
  providerId: string;
  serviceType: ServiceTypeId;
  requester: Requester;
  location: Place;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  estimatedCostUsd: number;
  matchScore: number;
  notes?: string;
  createdAt: string;
}

/** Audit trail of every match attempt, matched or not. */
export interface ServiceRequestRecord {
  id: string;
  serviceType: ServiceTypeId;
  requester: Requester;
  location: Place;
  windowStartsAt: string;
  windowEndsAt: string;
  durationMinutes: number;
  status: 'matched' | 'no_match';
  bookingId?: string;
  candidatesConsidered: number;
  createdAt: string;
}
