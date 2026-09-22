import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherPanel } from './weatherPanel.js';
import { railFixture } from './railTestFixture.mjs';
const ticks = ['2026-09-22T01:00:00Z', '2026-09-22T01:05:00Z'];
const wind = {
  id: 'wind',
  summary: {
    label: 'Wind motion',
    coverage: 'Global · 1° grid',
    validTime: ticks[0],
    issuedTime: ticks[0],
  },
};
const radar = {
  id: 'weather-radar',
  summary: { label: 'Rain radar', coverage: 'CONUS' },
};
function fixture(onWrite) {
  const f = railFixture(onWrite);
  const panel = f.document.createElement('div');
  const count = f.document.createElement('span');
  let collapsed = true;
  let clicks = 0;
  panel.hidden = true;
  panel.classList = { contains: () => collapsed };
  const collapse = {
    click() {
      collapsed = !collapsed;
      clicks++;
    },
  };
  panel.querySelector = (selector) =>
    selector === '#weather-panel-count' ? count : collapse;
  f.container.closest = () => panel;
  const listeners = new Set();
  const calls = [];
  let state = {
    mode: 'latest',
    timeline: ticks,
    products: [{ id: radar.id, shown: ticks[1], selected: ticks[1] }],
  };
  const clock = {
    getState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setTarget: (tick) => calls.push(['target', tick]),
    latest: () => calls.push(['latest']),
    togglePlay: () => calls.push(['play']),
    step: (n) => calls.push(['step', n]),
  };
  return {
    ...f,
    panel,
    count,
    collapse,
    clicks: () => clicks,
    calls,
    listeners,
    clock,
    state: (next) => {
      state = { ...state, ...next };
      for (const fn of listeners) fn(state);
    },
  };
}
const timelineHost = (f) =>
  f.find((n) => n.className === 'weather-timeline-block');
const card = (f, id) => f.find((n) => n.dataset.cardId === id);
const line = (f, id, name) =>
  f.find((n) => n.dataset.lineId === name, card(f, id));
test('timeline needs an observed product and two union times; native preview and transport use the clock', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const view = createWeatherPanel(f);
  view.update([wind]);
  assert.equal(timelineHost(f).hidden, true);
  view.update([wind, radar]);
  assert.equal(timelineHost(f).hidden, false);
  f.state({ timeline: [ticks[0]] });
  assert.equal(timelineHost(f).hidden, true);
  f.state({ timeline: ticks });
  assert.equal(timelineHost(f).hidden, false);
  const slider = f.find((n) => n.tagName === 'INPUT');
  slider.value = '0';
  slider.dispatchEvent(new Event('input'));
  assert.deepEqual(f.calls, []);
  slider.dispatchEvent(new Event('change'));
  assert.deepEqual(f.calls, [['target', ticks[0]]]);
  f.find((n) => n.textContent === 'Latest' && n.tagName === 'BUTTON').click();
  f.find((n) => n.textContent === 'Play').click();
  assert.deepEqual(f.calls.slice(1), [['latest'], ['play']]);
  slider.dispatchEvent(new Event('input'));
  view.update([wind]);
  t.mock.timers.tick(150);
  assert.equal(f.calls.length, 3, 'hiding cancels pending drag');
  view.destroy();
  assert.equal(f.listeners.size, 0);
});
test('ordered articles contain Controls and displayed-frame history labels, forecast dates and missing-frame readouts', () => {
  const f = fixture();
  const opened = [];
  const view = createWeatherPanel({ ...f, onOpen: (id) => opened.push(id) });
  view.update([radar, wind]);
  const windCard = card(f, 'wind');
  assert.equal(windCard.tagName, 'ARTICLE');
  assert.equal(windCard.parent.children[0], windCard);
  const controls = f.find((n) => n.dataset.weatherOpen === 'wind');
  assert.equal(controls.tagName, 'BUTTON');
  assert.equal(controls.parent.tagName, 'HEADER');
  controls.click();
  assert.deepEqual(opened, ['wind']);
  assert.match(
    line(f, 'wind', 'time').textContent,
    /Forecast · valid .*UTC · issued .*UTC/,
  );
  f.state({ mode: 'history', target: ticks[1] });
  assert.match(line(f, radar.id, 'time').textContent, /01:05 UTC.*synced/);
  assert.match(line(f, 'wind', 'time').textContent, /Does not follow history/);
  f.state({
    products: [{ id: radar.id, shown: ticks[0], selected: ticks[0] }],
  });
  assert.match(line(f, radar.id, 'time').textContent, /01:00 UTC.*nearest/);
  f.state({ products: [{ id: radar.id, shown: null, selected: null }] });
  assert.equal(
    line(f, radar.id, 'time').textContent,
    'No frame within 30 min of 01:05 UTC',
  );
  const global = {
    id: 'weather-satellite',
    summary: { label: 'Satellite clouds', maxGapMinutes: 180 },
  };
  view.update([global]);
  f.state({ products: [{ id: global.id, shown: null, selected: null }] });
  assert.equal(
    line(f, global.id, 'time').textContent,
    'No frame within 3 h of 01:05 UTC',
  );
  view.destroy();
  controls.click();
  assert.deepEqual(opened, ['wind']);
});
test('cyclone readout retains advisory, position, intensity, geometry, coverage, legend and source link', () => {
  const f = fixture();
  const view = createWeatherPanel(f);
  const cyclone = {
    id: 'weather-cyclones',
    summary: {
      label: 'Cyclones',
      coverage: 'Atlantic + E/C Pacific',
      detail: 'JULIO · Hurricane · Advisory 10 · 09-22 01:00 UTC',
      status: 'Loading advisories…',
      lines: [
        { id: 'position', text: 'Position as of 09-22 00:00 UTC' },
        { id: 'intensity', text: '80 kt · 970 hPa' },
        { id: 'geometry', text: 'Track/cone awaiting advisory 10' },
      ],
      advisoryUrl: 'https://www.nhc.noaa.gov/advisory',
    },
    legend: [
      { label: 'Advisory center / forecast track', color: '#7fe6ed' },
      { label: 'Center-track uncertainty cone', color: '#7fe6ed44' },
    ],
  };
  view.update([cyclone]);
  assert.equal(timelineHost(f).hidden, true);
  assert.match(
    line(f, cyclone.id, 'time').textContent,
    /JULIO.*Hurricane.*Advisory 10.*UTC/,
  );
  assert.match(line(f, cyclone.id, 'position').textContent, /00:00 UTC/);
  assert.match(line(f, cyclone.id, 'intensity').textContent, /80 kt · 970 hPa/);
  assert.match(
    line(f, cyclone.id, 'geometry').textContent,
    /awaiting advisory 10/,
  );
  const link = f.find((n) => n.textContent === 'Official advisory ↗');
  assert.equal(link.href, cyclone.summary.advisoryUrl);
  assert.equal(link.tagName, 'A');
  assert.equal(link.rel, 'noopener');
  assert.match(
    f.find((n) => n.className === 'rail-card-scale').textContent,
    /forecast track.*uncertainty cone/,
  );
  view.destroy();
});
test('identical updates write nothing and status keeps its line through loading and empty text', () => {
  let writes = 0;
  const f = fixture(() => writes++);
  const view = createWeatherPanel(f);
  for (const entries of [
    [wind, radar],
    [{ ...wind, summary: { ...wind.summary, status: 'Loading' } }],
    [wind],
    [],
  ]) {
    view.update(entries);
    const status = entries.length ? line(f, 'wind', 'status') : null;
    writes = 0;
    view.update(entries);
    assert.equal(writes, 0);
    if (status) {
      assert.equal(status.hidden, false);
      assert.equal(line(f, 'wind', 'status'), status);
    }
  }
  view.destroy();
  assert.equal(f.container.children.length, 0);
  assert.equal(createWeatherPanel(), null);
});
test('count, hidden-empty and first-appearance expansion survive remount and owner collapse', () => {
  const f = fixture();
  let view = createWeatherPanel(f);
  view.update([]);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.clicks(), 0);
  view.update([wind, radar, { id: 'missing' }]);
  assert.equal(f.count.textContent, '2');
  assert.equal(f.panel.hidden, false);
  assert.equal(f.clicks(), 1);
  f.collapse.click();
  view.update([]);
  view.update([wind]);
  assert.equal(f.panel.classList.contains('collapsed'), true);
  assert.equal(f.clicks(), 2);
  assert.equal(f.count.textContent, '1');
  view.destroy();
  assert.equal(f.count.textContent, '0');
  assert.equal(f.panel.hidden, true);
  view = createWeatherPanel(f);
  view.update([radar]);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.clicks(), 2);
  view.destroy();
  const expanded = fixture();
  expanded.collapse.click();
  const other = createWeatherPanel(expanded);
  other.update([wind]);
  assert.equal(expanded.clicks(), 1);
  other.destroy();
});
