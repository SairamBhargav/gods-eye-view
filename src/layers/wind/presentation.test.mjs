import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWindReading, windReadingSection } from './presentation.js';

const sample = { speed: 5, from: 'SW', coordinates: '41.9°N · 87.6°W', model: 'NOAA GFS', validTime: '2026-09-21 12:00 UTC', scalarLabel: 'Air temperature · 2 m', scalarValue: '12 °C', explanation: 'Interpolated model forecast.' };
test('captured reading reformats without changing its sample and produces portable sections', () => {
  const reading = formatWindReading(sample, 'mph');
  assert.equal(reading.wind, '11.2 mph from SW');
  assert.equal(reading.speed, sample.speed);
  assert.equal(reading.coordinates, sample.coordinates);
  assert.equal(sample.units, undefined);
  const section = windReadingSection(reading);
  assert.equal(section.id, 'reading');
  assert.equal(section.lines.find(({ id }) => id === 'scalar').text, 'Air temperature · 2 m · 12 °C');
  assert.equal(section.lines.find(({ id }) => id === 'valid').text, `Valid ${sample.validTime}`);
  assert.deepEqual(section.chips.find(({ active }) => active).params, { units: 'mph' });
  assert.deepEqual(section.actions[0].params, { inspect: false });
  assert.equal(formatWindReading({ ...sample, from: 'Calm' }, 'm/s').wind, '5.0 m/s · calm');
  assert.equal(formatWindReading(null, 'km/h'), null);
  assert.equal(windReadingSection({ wind: 'Unavailable' }).lines.some(({ id }) => id === 'scalar'), false);
});
