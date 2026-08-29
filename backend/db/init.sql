CREATE TABLE IF NOT EXISTS providers (id uuid PRIMARY KEY, phone_key text UNIQUE, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS availability_slots (id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE, status text NOT NULL CHECK (status IN ('open','booked','cancelled')), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS availability_slots_provider_idx ON availability_slots(provider_id);
CREATE TABLE IF NOT EXISTS service_requests (id uuid PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bookings (id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE RESTRICT, status text NOT NULL CHECK (status IN ('confirmed','completed','cancelled')), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS bookings_provider_idx ON bookings(provider_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (key text PRIMARY KEY, request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE);
