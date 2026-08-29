export const BRANCH_LABELS: Record<string, string> = {
  army: 'Army',
  navy: 'Navy',
  air_force: 'Air Force',
  marines: 'Marine Corps',
  coast_guard: 'Coast Guard',
  space_force: 'Space Force',
};

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRange(startIso: string, endIso: string): string {
  const end = new Date(endIso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${formatWhen(startIso)} – ${end}`;
}

export function formatCost(usd: number, rateType?: string): string {
  if (rateType === 'volunteer' || usd === 0) return 'Volunteer';
  return `~$${usd.toFixed(0)}`;
}

/** ISO string for a <input type="datetime-local"> value, in the browser's zone. */
export function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export const kmToMiles = (km: number) => km / 1.609344;

export const formatMiles = (km: number) => `${Math.round(kmToMiles(km))} miles`;
