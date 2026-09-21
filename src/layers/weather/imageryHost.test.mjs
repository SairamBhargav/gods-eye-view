import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveImageryHost,
  imageryHostStatus,
  NO_IMAGERY_HOST,
  WEATHER_TILESET_MIN_HEIGHT_METERS,
} from './imageryHost.js';

test('height suspension applies strictly below 60 km to tilesets, with no-host precedence', () => {
  assert.equal(WEATHER_TILESET_MIN_HEIGHT_METERS, 60_000);
  for (const height of [1200, 59_999, 60_000, 60_001]) {
    const camera = { positionCartographic: { height } };
    assert.equal(
      imageryHostStatus({ kind: 'tileset' }, camera),
      height < WEATHER_TILESET_MIN_HEIGHT_METERS
        ? 'Hidden below 60 km on 3D Tiles'
        : null,
    );
    assert.equal(imageryHostStatus({ kind: 'globe' }, camera), null);
    assert.equal(imageryHostStatus({ kind: 'none' }, camera), NO_IMAGERY_HOST);
  }
});

test('visible globe takes precedence over a tileset', () => {
  const viewer = { imageryLayers: {}, scene: { globe: { show: true } } };
  assert.deepEqual(
    resolveImageryHost({ viewer, tileset: { imageryLayers: {} } }),
    { collection: viewer.imageryLayers, kind: 'globe' },
  );
});
test('hidden globe uses the supplied tileset imagery collection', () => {
  const tileset = { imageryLayers: {} };
  const viewer = { scene: { globe: { show: false } } };
  assert.deepEqual(resolveImageryHost({ viewer, tileset }), {
    collection: tileset.imageryLayers,
    kind: 'tileset',
  });
});
test('hidden globe without an imagery-capable tileset has no host', () => {
  for (const tileset of [null, {}])
    assert.deepEqual(
      resolveImageryHost({
        viewer: { scene: { globe: { show: false } } },
        tileset,
      }),
      { collection: null, kind: 'none' },
    );
});
