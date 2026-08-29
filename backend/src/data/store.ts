import { randomUUID } from 'node:crypto';
import type {
  AvailabilitySlot,
  Booking,
  Provider,
  ServiceRequestRecord,
} from '../types.js';

/**
 * In-memory store for the bootstrap. Every read/write the rest of the app does
 * goes through this object, so swapping in Postgres later means reimplementing
 * this file (and making the methods async) rather than touching the routes.
 */
class MemoryStore {
  private providers = new Map<string, Provider>();
  private slots = new Map<string, AvailabilitySlot>();
  private bookings = new Map<string, Booking>();
  private requests = new Map<string, ServiceRequestRecord>();
  /** Idempotency-Key -> requestId, so a double-submit can't double-book. */
  private idempotency = new Map<string, string>();

  reset(): void {
    this.providers.clear();
    this.slots.clear();
    this.bookings.clear();
    this.requests.clear();
    this.idempotency.clear();
  }

  // --- providers ---------------------------------------------------------

  createProvider(input: Omit<Provider, 'id' | 'createdAt'>): Provider {
    const provider: Provider = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.providers.set(provider.id, provider);
    return provider;
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  listProviders(): Provider[] {
    return [...this.providers.values()];
  }

  updateProvider(id: string, patch: Partial<Provider>): Provider | undefined {
    const existing = this.providers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    this.providers.set(id, updated);
    return updated;
  }

  // --- slots -------------------------------------------------------------

  createSlot(input: Omit<AvailabilitySlot, 'id' | 'createdAt'>): AvailabilitySlot {
    const slot: AvailabilitySlot = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.slots.set(slot.id, slot);
    return slot;
  }

  getSlot(id: string): AvailabilitySlot | undefined {
    return this.slots.get(id);
  }

  listSlots(filter: { providerId?: string; status?: AvailabilitySlot['status'] } = {}): AvailabilitySlot[] {
    return [...this.slots.values()].filter((slot) => {
      if (filter.providerId && slot.providerId !== filter.providerId) return false;
      if (filter.status && slot.status !== filter.status) return false;
      return true;
    });
  }

  updateSlot(id: string, patch: Partial<AvailabilitySlot>): AvailabilitySlot | undefined {
    const existing = this.slots.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    this.slots.set(id, updated);
    return updated;
  }

  /** Atomic enough for this single-process store: check and claim happen in one synchronous call. */
  claimOpenSlot(id: string): AvailabilitySlot | undefined {
    const slot = this.slots.get(id);
    if (!slot || slot.status !== 'open') return undefined;
    const claimed = { ...slot, status: 'booked' as const };
    this.slots.set(id, claimed);
    return claimed;
  }

  // --- bookings ----------------------------------------------------------

  createBooking(input: Omit<Booking, 'id' | 'createdAt'>): Booking {
    const booking: Booking = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  getBooking(id: string): Booking | undefined {
    return this.bookings.get(id);
  }

  listBookings(filter: { providerId?: string; status?: Booking['status'] } = {}): Booking[] {
    return [...this.bookings.values()].filter((booking) => {
      if (filter.providerId && booking.providerId !== filter.providerId) return false;
      if (filter.status && booking.status !== filter.status) return false;
      return true;
    });
  }

  updateBooking(id: string, patch: Partial<Booking>): Booking | undefined {
    const existing = this.bookings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    this.bookings.set(id, updated);
    return updated;
  }

  // --- service requests --------------------------------------------------

  createRequest(input: Omit<ServiceRequestRecord, 'id' | 'createdAt'>): ServiceRequestRecord {
    const record: ServiceRequestRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.requests.set(record.id, record);
    return record;
  }

  getRequest(id: string): ServiceRequestRecord | undefined {
    return this.requests.get(id);
  }

  updateRequest(id: string, patch: Partial<ServiceRequestRecord>): ServiceRequestRecord | undefined {
    const existing = this.requests.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    this.requests.set(id, updated);
    return updated;
  }

  rememberIdempotentRequest(key: string, requestId: string): void {
    this.idempotency.set(key, requestId);
  }

  findIdempotentRequest(key: string): ServiceRequestRecord | undefined {
    const requestId = this.idempotency.get(key);
    return requestId ? this.requests.get(requestId) : undefined;
  }
}

export const store = new MemoryStore();
