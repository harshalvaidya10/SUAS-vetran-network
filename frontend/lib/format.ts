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

const sameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * A block that ends the next day has to say so. Showing "Mon, Sep 1, 9:00 PM –
 * 1:00 AM" reads as a block that ends before it starts, so the end keeps its
 * date whenever it falls on a different day.
 */
export function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (sameCalendarDay(start, end)) {
    const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${formatWhen(startIso)} – ${endTime}`;
  }

  return `${formatWhen(startIso)} – ${formatWhen(endIso)}`;
}

export const hasEnded = (endIso: string) => new Date(endIso).getTime() < Date.now();

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
