import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('panel presentation places Transit between Street Traffic and Bike Share in Movement', () => {
  const source = readFileSync(
    new URL('./layerPanel.js', import.meta.url),
    'utf8',
  );
  const declarations = source.slice(
    source.indexOf('const PANEL_GROUPS ='),
    source.indexOf('const PANEL_POSITIONS ='),
  );
  const order = JSON.parse(
    runInNewContext(`${declarations}\nJSON.stringify(PANEL_ORDER)`),
  );
  assert.deepEqual(
    order.filter(({ label }) => label === 'Movement').map(({ id }) => id),
    [
      'satellites',
      'flights',
      'military',
      'ais-live-vessels',
      'traffic',
      'transit',
      'bikeshare',
    ],
  );
  assert.equal(order.filter(({ id }) => id === 'transit').length, 1);
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState } = await import('./layerPanel.js');
  const classes = new Map();
  const attrs = new Map();
  const button = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'PARTIAL');
  assert.equal(button.dataset.feedState, 'partial');
  assert.equal(classes.get('feed-partial'), true);
  assert.equal(classes.get('feed-stale'), false);
  assert.match(attrs.get('aria-label'), /PARTIAL/);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'ON');
  assert.equal(classes.get('feed-partial'), false);
  layer.enabled = false;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'OFF');
});

test('readout rows render a status with tooltip and configuration chips; ordinary rows keep info and legends', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  try {
    let readout = true;
    const panel = new LayerPanel({
      getRowControls: () => ({
        readout,
        summary: { status: 'Loading' },
        info: 'Detailed time',
        infoTitle: 'Source coverage',
        chips: [{ id: 'config', label: 'Soft' }],
        legend: [{ label: 'Rain', color: '#abcdef' }],
      }),
    });
    panel._syncRowControls(f.container, { id: 'weather-radar', enabled: true });
    assert.equal(f.container.children.length, 2);
    assert.equal(f.container._rowControlsInfo.textContent, 'Loading');
    assert.equal(f.container._rowControlsInfo.title, 'Source coverage');
    assert.equal(
      f.container._rowControlsInfo.className,
      'data-toggle-controls-status',
    );
    assert.equal(f.container.querySelector('.data-toggle-legend-item'), null);
    assert.equal(f.container.children[0].textContent, 'Soft');
    readout = false;
    panel._syncRowControls(f.container, { id: 'other', enabled: true });
    assert.equal(f.container._rowControlsInfo.textContent, 'Detailed time');
    assert.ok(f.container.querySelector('.data-toggle-legend-item'));
    readout = true;
    panel._syncRowControls(f.container, { id: 'weather-radar', enabled: true });
    assert.equal(f.container.querySelector('.data-toggle-legend-item'), null);
  } finally {
    globalThis.document = previousDocument;
  }
});
