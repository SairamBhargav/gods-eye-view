import { formatWindSpeed, WIND_UNITS } from './inspection.js';

/** Reformat a captured sample; changing units never samples the map again. */
export function formatWindReading(reading, units) {
  if (!reading) return null;
  return {
    ...reading,
    units,
    wind: Number.isFinite(reading.speed)
      ? `${formatWindSpeed(reading.speed, units)}${reading.from === 'Calm' ? ' · calm' : ` from ${reading.from}`}`
      : reading.wind,
  };
}

export function windUnitChips(units) {
  return Object.keys(WIND_UNITS).map((value) => ({
    id: `units-${value}`,
    label: value,
    active: units === value,
    params: { units: value },
    title: 'Wind speed units',
  }));
}

/** Portable reading section consumed by the WEATHER card. */
export function windReadingSection(reading) {
  return {
    id: 'reading',
    label: 'Reading',
    lines: [
      { id: 'coordinates', text: reading.coordinates },
      { id: 'wind', text: reading.wind },
      ...(reading.scalarValue
        ? [
            {
              id: 'scalar',
              text: `${reading.scalarLabel} · ${reading.scalarValue}`,
            },
          ]
        : []),
      { id: 'model', text: reading.model },
      {
        id: 'valid',
        text: reading.validTime ? `Valid ${reading.validTime}` : '',
      },
      { id: 'status', text: reading.status },
      { id: 'explanation', text: reading.explanation },
    ],
    chips: windUnitChips(reading.units),
    actions: [
      { id: 'clear', label: 'Clear reading', params: { inspect: false } },
    ],
  };
}
