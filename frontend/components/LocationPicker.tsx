'use client';

export interface LocationValue {
  lat: number;
  lng: number;
  address: string;
}

/**
 * The bootstrap has no geocoder, so instead of pretending, the picker offers
 * real coordinates for a handful of San Diego landmarks and lets anyone type
 * their own. Swapping in a geocoding service later only touches this file.
 */
export const PRESETS: LocationValue[] = [
  { address: 'Downtown San Diego, CA', lat: 32.7157, lng: -117.1611 },
  { address: 'VA Medical Center, La Jolla, CA', lat: 32.8756, lng: -117.228 },
  { address: 'El Cajon, CA', lat: 32.8328, lng: -116.9625 },
  { address: 'Chula Vista, CA', lat: 32.6401, lng: -117.0842 },
  { address: 'Oceanside, CA', lat: 33.1959, lng: -117.3795 },
];

export function LocationPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LocationValue;
  onChange: (next: LocationValue) => void;
}) {
  const matchedPreset = PRESETS.find((p) => p.lat === value.lat && p.lng === value.lng);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <label className="field">
        <span>{label}</span>
        <select
          value={matchedPreset?.address ?? 'custom'}
          onChange={(event) => {
            const preset = PRESETS.find((p) => p.address === event.target.value);
            if (preset) onChange({ ...preset });
          }}
        >
          {PRESETS.map((preset) => (
            <option key={preset.address} value={preset.address}>
              {preset.address}
            </option>
          ))}
          <option value="custom">Custom coordinates…</option>
        </select>
      </label>

      <div className="row" style={{ gap: 10 }}>
        <label className="field">
          <span>Latitude</span>
          <input
            type="number"
            step="0.0001"
            value={value.lat}
            onChange={(event) => onChange({ ...value, lat: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Longitude</span>
          <input
            type="number"
            step="0.0001"
            value={value.lng}
            onChange={(event) => onChange({ ...value, lng: Number(event.target.value) })}
          />
        </label>
        <label className="field" style={{ flexBasis: '100%' }}>
          <span>Address label</span>
          <input
            value={value.address}
            placeholder="Where the veteran should meet you"
            onChange={(event) => onChange({ ...value, address: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
