import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import type { AvailabilitySlot, Booking, LoginChallenge, Provider, ServiceRequestRecord, Session } from '../types.js';

export interface Store {
  reset(): Promise<void>;
  createProvider(input: Omit<Provider, 'id' | 'createdAt'>): Promise<Provider>; getProvider(id: string): Promise<Provider | undefined>; listProviders(): Promise<Provider[]>; updateProvider(id: string, patch: Partial<Provider>): Promise<Provider | undefined>;
  createSlot(input: Omit<AvailabilitySlot, 'id' | 'createdAt'>): Promise<AvailabilitySlot>; getSlot(id: string): Promise<AvailabilitySlot | undefined>; listSlots(filter?: { providerId?: string; status?: AvailabilitySlot['status'] }): Promise<AvailabilitySlot[]>; updateSlot(id: string, patch: Partial<AvailabilitySlot>): Promise<AvailabilitySlot | undefined>; claimOpenSlot(id: string): Promise<AvailabilitySlot | undefined>;
  createBooking(input: Omit<Booking, 'id' | 'createdAt'>): Promise<Booking>; getBooking(id: string): Promise<Booking | undefined>; listBookings(filter?: { providerId?: string; status?: Booking['status'] }): Promise<Booking[]>; updateBooking(id: string, patch: Partial<Booking>): Promise<Booking | undefined>;
  createRequest(input: Omit<ServiceRequestRecord, 'id' | 'createdAt'>): Promise<ServiceRequestRecord>; getRequest(id: string): Promise<ServiceRequestRecord | undefined>; updateRequest(id: string, patch: Partial<ServiceRequestRecord>): Promise<ServiceRequestRecord | undefined>;
  rememberIdempotentRequest(key: string, requestId: string): Promise<void>; findIdempotentRequest(key: string): Promise<ServiceRequestRecord | undefined>;
  saveLoginChallenge(challenge: LoginChallenge): Promise<void>; getLoginChallenge(phoneKey: string): Promise<LoginChallenge | undefined>; deleteLoginChallenge(phoneKey: string): Promise<void>;
  saveSession(session: Session): Promise<void>; getSession(tokenHash: string): Promise<Session | undefined>; deleteSession(tokenHash: string): Promise<void>;
  /** Postgres has no row TTL, so expiry has to be swept rather than assumed. */
  purgeExpired(now: string): Promise<{ sessions: number; challenges: number }>;
}
const created = <T>(input: T): T & { id: string; createdAt: string } => ({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-10);
function updateMap<T extends { id: string; createdAt: string }>(map: Map<string, T>, id: string, patch: Partial<T>) { const old = map.get(id); if (!old) return; const value = { ...old, ...patch, id: old.id, createdAt: old.createdAt }; map.set(id, value); return value; }

class MemoryStore implements Store {
  private providers = new Map<string, Provider>(); private slots = new Map<string, AvailabilitySlot>(); private bookings = new Map<string, Booking>(); private requests = new Map<string, ServiceRequestRecord>(); private idempotency = new Map<string, string>(); private challenges = new Map<string, LoginChallenge>(); private sessions = new Map<string, Session>();
  async reset() { this.providers.clear(); this.slots.clear(); this.bookings.clear(); this.requests.clear(); this.idempotency.clear(); this.challenges.clear(); this.sessions.clear(); }
  async saveSession(session: Session) { this.sessions.set(session.tokenHash, session); } async getSession(tokenHash: string) { return this.sessions.get(tokenHash); } async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
  async purgeExpired(now: string) { let sessions = 0, challenges = 0; for (const [k, v] of this.sessions) if (v.expiresAt < now) { this.sessions.delete(k); sessions += 1; } for (const [k, v] of this.challenges) if (v.expiresAt < now) { this.challenges.delete(k); challenges += 1; } return { sessions, challenges }; }
  async saveLoginChallenge(challenge: LoginChallenge) { this.challenges.set(challenge.phoneKey, challenge); } async getLoginChallenge(phoneKey: string) { return this.challenges.get(phoneKey); } async deleteLoginChallenge(phoneKey: string) { this.challenges.delete(phoneKey); }
  async createProvider(input: Omit<Provider, 'id' | 'createdAt'>) { const v = created(input); this.providers.set(v.id, v); return v; } async getProvider(id: string) { return this.providers.get(id); } async listProviders() { return [...this.providers.values()]; } async updateProvider(id: string, patch: Partial<Provider>) { return updateMap(this.providers, id, patch); }
  async createSlot(input: Omit<AvailabilitySlot, 'id' | 'createdAt'>) { const v = created(input); this.slots.set(v.id, v); return v; } async getSlot(id: string) { return this.slots.get(id); } async listSlots(filter: { providerId?: string; status?: AvailabilitySlot['status'] } = {}) { return [...this.slots.values()].filter(v => (!filter.providerId || v.providerId === filter.providerId) && (!filter.status || v.status === filter.status)); } async updateSlot(id: string, patch: Partial<AvailabilitySlot>) { return updateMap(this.slots, id, patch); } async claimOpenSlot(id: string) { const v = this.slots.get(id); return v?.status === 'open' ? updateMap(this.slots, id, { status: 'booked' }) : undefined; }
  async createBooking(input: Omit<Booking, 'id' | 'createdAt'>) { const v = created(input); this.bookings.set(v.id, v); return v; } async getBooking(id: string) { return this.bookings.get(id); } async listBookings(filter: { providerId?: string; status?: Booking['status'] } = {}) { return [...this.bookings.values()].filter(v => (!filter.providerId || v.providerId === filter.providerId) && (!filter.status || v.status === filter.status)); } async updateBooking(id: string, patch: Partial<Booking>) { return updateMap(this.bookings, id, patch); }
  async createRequest(input: Omit<ServiceRequestRecord, 'id' | 'createdAt'>) { const v = created(input); this.requests.set(v.id, v); return v; } async getRequest(id: string) { return this.requests.get(id); } async updateRequest(id: string, patch: Partial<ServiceRequestRecord>) { return updateMap(this.requests, id, patch); } async rememberIdempotentRequest(key: string, requestId: string) { this.idempotency.set(key, requestId); } async findIdempotentRequest(key: string) { const id = this.idempotency.get(key); return id ? this.requests.get(id) : undefined; }
}

class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(path: string) {
    const absolutePath = resolve(path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  }

  async initialize() {
    this.db.exec(SQLITE_SCHEMA);
    const columns = this.db.prepare('PRAGMA table_info(providers)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'phone_key')) {
      this.db.exec('ALTER TABLE providers ADD COLUMN phone_key TEXT');
    }
    for (const provider of await this.list<Provider>('providers')) {
      this.db.prepare('UPDATE providers SET phone_key=? WHERE id=?').run(phoneKey(provider.phone), provider.id);
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS providers_phone_key_unique_idx ON providers(phone_key)');
  }
  async saveSession(session: Session) { this.db.prepare('INSERT OR REPLACE INTO sessions (token_hash,data) VALUES (?,?)').run(session.tokenHash, JSON.stringify(session)); } async getSession(tokenHash: string) { const row = this.db.prepare('SELECT data FROM sessions WHERE token_hash=?').get(tokenHash) as { data?: string } | undefined; return row?.data ? JSON.parse(row.data) as Session : undefined; } async deleteSession(tokenHash: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); }
  async reset() { this.db.exec('DELETE FROM sessions; DELETE FROM login_challenges; DELETE FROM idempotency_keys; DELETE FROM bookings; DELETE FROM service_requests; DELETE FROM availability_slots; DELETE FROM providers;'); }
  async purgeExpired(now: string) { const sessions = this.db.prepare("DELETE FROM sessions WHERE json_extract(data,'$.expiresAt') < ?").run(now).changes; const challenges = this.db.prepare("DELETE FROM login_challenges WHERE json_extract(data,'$.expiresAt') < ?").run(now).changes; return { sessions: Number(sessions), challenges: Number(challenges) }; }
  async saveLoginChallenge(challenge: LoginChallenge) { this.db.prepare('INSERT OR REPLACE INTO login_challenges (phone_key,data) VALUES (?,?)').run(challenge.phoneKey, JSON.stringify(challenge)); } async getLoginChallenge(phoneKey: string) { const row = this.db.prepare('SELECT data FROM login_challenges WHERE phone_key=?').get(phoneKey) as { data?: string } | undefined; return row?.data ? JSON.parse(row.data) as LoginChallenge : undefined; } async deleteLoginChallenge(phoneKey: string) { this.db.prepare('DELETE FROM login_challenges WHERE phone_key=?').run(phoneKey); }
  private async insert<T extends { id: string }>(table: string, value: T) { this.db.prepare(`INSERT INTO ${table} (id,data) VALUES (?,?)`).run(value.id, JSON.stringify(value)); return value; }
  private async get<T>(table: string, id: string) { const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) as T : undefined; }
  private async list<T>(table: string) { return (this.db.prepare(`SELECT data FROM ${table} ORDER BY created_at`).all() as { data: string }[]).map(row => JSON.parse(row.data) as T); }
  private async update<T extends { id: string; createdAt: string }>(table: string, id: string, patch: Partial<T>) { const old = await this.get<T>(table, id); if (!old) return; const value = { ...old, ...patch, id: old.id, createdAt: old.createdAt }; this.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(value), id); return value; }
  async createProvider(input: Omit<Provider, 'id' | 'createdAt'>) { const v = created(input); this.db.prepare('INSERT INTO providers (id,phone_key,data) VALUES (?,?,?)').run(v.id,phoneKey(v.phone),JSON.stringify(v)); return v; } async getProvider(id: string) { return this.get<Provider>('providers', id); } async listProviders() { return this.list<Provider>('providers'); } async updateProvider(id: string, patch: Partial<Provider>) { return this.update('providers', id, patch); }
  async createSlot(input: Omit<AvailabilitySlot, 'id' | 'createdAt'>) { const v = created(input); this.db.prepare('INSERT INTO availability_slots (id,provider_id,status,data) VALUES (?,?,?,?)').run(v.id,v.providerId,v.status,JSON.stringify(v)); return v; } async getSlot(id: string) { return this.get<AvailabilitySlot>('availability_slots', id); } async listSlots(filter: { providerId?: string; status?: AvailabilitySlot['status'] } = {}) { return (await this.list<AvailabilitySlot>('availability_slots')).filter(v => (!filter.providerId || v.providerId === filter.providerId) && (!filter.status || v.status === filter.status)); } async updateSlot(id: string, patch: Partial<AvailabilitySlot>) { const v = await this.update<AvailabilitySlot>('availability_slots', id, patch); if (v) this.db.prepare('UPDATE availability_slots SET status=? WHERE id=?').run(v.status,id); return v; } async claimOpenSlot(id: string) { const old = await this.getSlot(id); if (!old) return; const value = { ...old, status: 'booked' as const }; const result = this.db.prepare("UPDATE availability_slots SET status='booked',data=? WHERE id=? AND status='open'").run(JSON.stringify(value),id); return result.changes === 1 ? value : undefined; }
  async createBooking(input: Omit<Booking, 'id' | 'createdAt'>) { const v = created(input); this.db.prepare('INSERT INTO bookings (id,provider_id,status,data) VALUES (?,?,?,?)').run(v.id,v.providerId,v.status,JSON.stringify(v)); return v; } async getBooking(id: string) { return this.get<Booking>('bookings', id); } async listBookings(filter: { providerId?: string; status?: Booking['status'] } = {}) { return (await this.list<Booking>('bookings')).filter(v => (!filter.providerId || v.providerId === filter.providerId) && (!filter.status || v.status === filter.status)); } async updateBooking(id: string, patch: Partial<Booking>) { const v = await this.update<Booking>('bookings', id, patch); if (v) this.db.prepare('UPDATE bookings SET status=? WHERE id=?').run(v.status,id); return v; }
  async createRequest(input: Omit<ServiceRequestRecord, 'id' | 'createdAt'>) { return this.insert('service_requests', created(input)); } async getRequest(id: string) { return this.get<ServiceRequestRecord>('service_requests', id); } async updateRequest(id: string, patch: Partial<ServiceRequestRecord>) { return this.update('service_requests', id, patch); } async rememberIdempotentRequest(key: string, requestId: string) { this.db.prepare('INSERT OR IGNORE INTO idempotency_keys (key,request_id) VALUES (?,?)').run(key,requestId); } async findIdempotentRequest(key: string) { const row = this.db.prepare('SELECT request_id FROM idempotency_keys WHERE key=?').get(key) as { request_id: string } | undefined; return row ? this.getRequest(row.request_id) : undefined; }
}

class PostgresStore implements Store {
  constructor(private pool: Pool) {} async initialize() { await this.pool.query(POSTGRES_SCHEMA); } async saveSession(session: Session) { await this.pool.query('INSERT INTO sessions (token_hash,data) VALUES ($1,$2) ON CONFLICT (token_hash) DO UPDATE SET data=$2', [session.tokenHash, session]); } async getSession(tokenHash: string) { return (await this.pool.query<{ data: Session }>('SELECT data FROM sessions WHERE token_hash=$1', [tokenHash])).rows[0]?.data; } async deleteSession(tokenHash: string) { await this.pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]); }
  async reset() { await this.pool.query('TRUNCATE sessions, login_challenges, idempotency_keys, bookings, service_requests, availability_slots, providers CASCADE'); }
  async purgeExpired(now: string) { const sessions = (await this.pool.query("DELETE FROM sessions WHERE (data->>'expiresAt')::timestamptz < $1::timestamptz", [now])).rowCount ?? 0; const challenges = (await this.pool.query("DELETE FROM login_challenges WHERE (data->>'expiresAt')::timestamptz < $1::timestamptz", [now])).rowCount ?? 0; return { sessions, challenges }; }
  async saveLoginChallenge(challenge: LoginChallenge) { await this.pool.query('INSERT INTO login_challenges (phone_key,data) VALUES ($1,$2) ON CONFLICT (phone_key) DO UPDATE SET data=$2', [challenge.phoneKey, challenge]); } async getLoginChallenge(phoneKey: string) { return (await this.pool.query<{ data: LoginChallenge }>('SELECT data FROM login_challenges WHERE phone_key=$1', [phoneKey])).rows[0]?.data; } async deleteLoginChallenge(phoneKey: string) { await this.pool.query('DELETE FROM login_challenges WHERE phone_key=$1', [phoneKey]); }
  private async insert<T extends { id: string }>(table: string, value: T) { await this.pool.query(`INSERT INTO ${table} (id, data) VALUES ($1,$2)`, [value.id, value]); return value; }
  private async get<T>(table: string, id: string) { return (await this.pool.query<{ data: T }>(`SELECT data FROM ${table} WHERE id=$1`, [id])).rows[0]?.data; }
  private async list<T>(table: string) { return (await this.pool.query<{ data: T }>(`SELECT data FROM ${table} ORDER BY created_at`, [])).rows.map(r => r.data); }
  private async update<T extends { id: string; createdAt: string }>(table: string, id: string, patch: Partial<T>) { const old = await this.get<T>(table, id); if (!old) return; const value = { ...old, ...patch, id: old.id, createdAt: old.createdAt }; await this.pool.query(`UPDATE ${table} SET data=$2 WHERE id=$1`, [id, value]); return value; }
  async createProvider(input: Omit<Provider, 'id' | 'createdAt'>) { const v = created(input); await this.pool.query('INSERT INTO providers (id,phone_key,data) VALUES ($1,$2,$3)', [v.id,phoneKey(v.phone),v]); return v; } async getProvider(id: string) { return this.get<Provider>('providers', id); } async listProviders() { return this.list<Provider>('providers'); } async updateProvider(id: string, patch: Partial<Provider>) { return this.update('providers', id, patch); }
  async createSlot(input: Omit<AvailabilitySlot, 'id' | 'createdAt'>) { const v = created(input); await this.pool.query('INSERT INTO availability_slots (id,provider_id,status,data) VALUES ($1,$2,$3,$4)', [v.id,v.providerId,v.status,v]); return v; } async getSlot(id: string) { return this.get<AvailabilitySlot>('availability_slots', id); } async listSlots(filter: { providerId?: string; status?: AvailabilitySlot['status'] } = {}) { return (await this.list<AvailabilitySlot>('availability_slots')).filter(v => (!filter.providerId || v.providerId === filter.providerId) && (!filter.status || v.status === filter.status)); } async updateSlot(id: string, patch: Partial<AvailabilitySlot>) { const v = await this.update<AvailabilitySlot>('availability_slots', id, patch); if (v) await this.pool.query('UPDATE availability_slots SET status=$2 WHERE id=$1', [id,v.status]); return v; } async claimOpenSlot(id: string) { return (await this.pool.query<{ data: AvailabilitySlot }>("UPDATE availability_slots SET status='booked', data=jsonb_set(data,'{status}','\"booked\"') WHERE id=$1 AND status='open' RETURNING data", [id])).rows[0]?.data; }
  async createBooking(input: Omit<Booking, 'id' | 'createdAt'>) { const v = created(input); await this.pool.query('INSERT INTO bookings (id,provider_id,status,data) VALUES ($1,$2,$3,$4)', [v.id,v.providerId,v.status,v]); return v; } async getBooking(id: string) { return this.get<Booking>('bookings', id); } async listBookings(filter: { providerId?: string; status?: Booking['status'] } = {}) { return (await this.list<Booking>('bookings')).filter(v => (!filter.providerId || v.providerId === filter.providerId) && (!filter.status || v.status === filter.status)); } async updateBooking(id: string, patch: Partial<Booking>) { const v = await this.update<Booking>('bookings', id, patch); if (v) await this.pool.query('UPDATE bookings SET status=$2 WHERE id=$1', [id,v.status]); return v; }
  async createRequest(input: Omit<ServiceRequestRecord, 'id' | 'createdAt'>) { return this.insert('service_requests', created(input)); } async getRequest(id: string) { return this.get<ServiceRequestRecord>('service_requests', id); } async updateRequest(id: string, patch: Partial<ServiceRequestRecord>) { return this.update('service_requests', id, patch); } async rememberIdempotentRequest(key: string, requestId: string) { await this.pool.query('INSERT INTO idempotency_keys (key,request_id) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key,requestId]); } async findIdempotentRequest(key: string) { const row = (await this.pool.query<{ request_id: string }>('SELECT request_id FROM idempotency_keys WHERE key=$1', [key])).rows[0]; return row ? this.getRequest(row.request_id) : undefined; }
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_challenges (phone_key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, phone_key TEXT UNIQUE, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS availability_slots (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('open','booked','cancelled')), data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS availability_slots_provider_idx ON availability_slots(provider_id);
CREATE TABLE IF NOT EXISTS service_requests (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id), status TEXT NOT NULL CHECK(status IN ('confirmed','completed','cancelled')), data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS bookings_provider_idx ON bookings(provider_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE);`;
const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS login_challenges (phone_key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS providers (id uuid PRIMARY KEY, phone_key text UNIQUE, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE providers ADD COLUMN IF NOT EXISTS phone_key text;
UPDATE providers SET phone_key=right(regexp_replace(data->>'phone','\\D','','g'),10) WHERE phone_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS providers_phone_key_unique_idx ON providers(phone_key);
CREATE TABLE IF NOT EXISTS availability_slots (id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE, status text NOT NULL CHECK(status IN ('open','booked','cancelled')), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS availability_slots_provider_idx ON availability_slots(provider_id);
CREATE TABLE IF NOT EXISTS service_requests (id uuid PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bookings (id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES providers(id), status text NOT NULL CHECK(status IN ('confirmed','completed','cancelled')), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS bookings_provider_idx ON bookings(provider_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (key text PRIMARY KEY, request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE);`;

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const storeType = process.env.VETNET_STORE;
if (process.env.VERCEL && !databaseUrl && storeType !== 'memory') {
  throw new Error(
    'A persistent database is required on Vercel. Connect Neon and expose DATABASE_URL to this project.',
  );
}

export const databaseKind = storeType === 'memory' ? 'memory' : databaseUrl ? 'postgres' : 'sqlite';
export const store: Store = storeType === 'memory'
  ? new MemoryStore()
  : databaseUrl
    ? new PostgresStore(new Pool({
        connectionString: databaseUrl,
        // Each Vercel function instance gets its own application-side pool.
        // Keep it deliberately small and use Neon's pooled (-pooler) URL.
        max: Number(process.env.DATABASE_POOL_MAX ?? 3),
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        allowExitOnIdle: true,
      }))
    : new SqliteStore(process.env.SQLITE_PATH ?? '.data/vetnet.sqlite');
export async function initializeStore() { if (store instanceof PostgresStore || store instanceof SqliteStore) await store.initialize(); }
export async function checkStoreConnection() { await store.listProviders(); }
