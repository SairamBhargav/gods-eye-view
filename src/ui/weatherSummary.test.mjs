import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherSummary } from './weatherSummary.js';
import { bindPanelDisclosure } from './panelDisclosure.js';

function fixture(onWrite = () => {}) {
  const tracked = (target) =>
    new Proxy(target, {
      set(object, key, value) {
        onWrite(key);
        return Reflect.set(object, key, value);
      },
    });
  const document = {
    createElement: () => {
      const element = new EventTarget();
      Object.assign(element, {
        ownerDocument: document,
        children: [],
        dataset: {},
        hidden: false,
        textContent: '',
        style: tracked({ background: '', left: '' }),
        setAttribute() {
          onWrite('attribute');
        },
        appendChild(child) {
          this.children.push(child);
          child.parent = this;
        },
        remove() {
          this.parent.children = this.parent.children.filter(
            (child) => child !== this,
          );
        },
      });
      return tracked(element);
    },
  };
  const panel = document.createElement('div');
  panel.hidden = true;
  const classes = new Set(['collapsed']);
  panel.classList = {
    contains: (name) => classes.has(name),
    toggle: (name, value) => (value ? classes.add(name) : classes.delete(name)),
  };
  const count = document.createElement('span');
  count.textContent = '0';
  const collapse = document.createElement('button');
  collapse.clicks = 0;
  collapse.click = () => {
    collapse.clicks++;
    collapse.dispatchEvent(new Event('click'));
  };
  bindPanelDisclosure({
    panel,
    buttons: [collapse],
    onChange: (collapsed) => panel.classList.toggle('collapsed', collapsed),
    onEscape() {},
  });
  panel.querySelector = (selector) =>
    selector === '#weather-panel-count' ? count : collapse;
  const container = document.createElement('div');
  container.id = 'weather-panel-body';
  container.closest = () => panel;
  container.panel = panel;
  container.count = count;
  container.collapse = collapse;
  panel.appendChild(container);
  return container;
}

test('weather summary preserves buttons during refresh and removes inactive products and owner', () => {
  const container = fixture();
  const view = createWeatherSummary({ container });
  const root = container.children[0];
  assert.equal(root.hidden, true);
  const entry = {
    id: 'wind',
    summary: {
      label: 'Temperature',
      detail: 'Forecast · 20:00 UTC',
      units: '°C',
    },
    legend: [
      { label: '-40', color: '#0000ff' },
      { label: '50+', color: '#ff0000' },
    ],
  };
  view.update([entry]);
  assert.equal(root.hidden, false);
  const button = root.children[0];
  assert.equal(button.children[0].textContent, 'Temperature');
  assert.equal(
    button.children[3].style.background,
    'linear-gradient(to right, #0000ff,#ff0000)',
  );
  view.update([
    {
      ...entry,
      summary: { ...entry.summary, status: '<img onerror=alert(1)>' },
    },
  ]);
  assert.equal(root.children[0], button, 'keyboard focus target is stable');
  assert.equal(button.children[2].textContent, '<img onerror=alert(1)>');
  assert.equal(
    button.children[2].children.length,
    0,
    'source status remains plain text',
  );
  view.update([]);
  assert.equal(root.hidden, true);
  assert.equal(root.children.length, 0);
  view.destroy();
  assert.equal(container.children.length, 0);
});

test('weather summary excludes arbitrary CSS from legend and supports missing DOM', () => {
  assert.equal(createWeatherSummary(), null);
  const container = fixture();
  const view = createWeatherSummary({ container });
  view.update([
    {
      id: 'wind',
      summary: { label: 'Wind', detail: 'Forecast' },
      legend: [{ color: 'url(https://invalid.example)' }, { color: '#ffffff' }],
    },
  ]);
  const ramp = container.children[0].children[0].children[3];
  assert.equal(ramp.style.background, '');
  assert.equal(ramp.hidden, true);
  view.destroy();
});

test('temperature freezing anchor follows its physical legend position, not its midpoint', () => {
  const container = fixture();
  const view = createWeatherSummary({ container });
  const legend = Array.from({ length: 10 }, (_, index) => ({
    label: String(-40 + index * 10),
    color: '#abcdef',
  }));
  view.update([
    { id: 'wind', summary: { label: 'Temperature', units: '°C' }, legend },
  ]);
  const zero = container.children[0].children[0].children[3].children[0];
  assert.equal(zero.hidden, false);
  assert.ok(Math.abs(parseFloat(zero.style.left) - 44.444444) < 0.001);
  view.update([
    { id: 'wind', summary: { label: 'Speed', units: 'km/h' }, legend },
  ]);
  assert.equal(zero.hidden, true);
  view.destroy();
});

test('status always occupies the same child and remains visible with or without text', () => {
  const container = fixture();
  const view = createWeatherSummary({ container });
  const entry = { id: 'radar', summary: { label: 'Radar' } };
  view.update([entry]);
  const row = container.children[0].children[0];
  const status = row.children[2];
  for (const value of ['Loading next frame…', '', undefined]) {
    view.update([{ ...entry, summary: { ...entry.summary, status: value } }]);
    assert.equal(row.children[2], status);
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, value || '');
  }
  view.destroy();
});

test('identical summary updates perform no DOM writes, including visible temperature anchors', () => {
  let writes = 0;
  const container = fixture(() => writes++);
  const view = createWeatherSummary({ container });
  const entry = {
    id: 'wind',
    summary: { label: 'Temperature', detail: 'Forecast', units: '°C' },
    legend: [
      { label: '-10', color: '#0000ff' },
      { label: '0', color: '#ffffff' },
      { label: '10', color: '#ff0000' },
    ],
  };
  for (const entries of [
    [entry],
    [{ ...entry, summary: { ...entry.summary, status: 'Loading' } }],
    [{ id: 'radar', summary: { label: 'Radar' } }],
    [],
  ]) {
    view.update(entries);
    writes = 0;
    view.update(entries);
    assert.equal(writes, 0);
  }
  view.destroy();
});

test('rail count and visibility follow active products and expand only on first appearance', () => {
  const container = fixture();
  let view = createWeatherSummary({ container });
  const { panel, count, collapse } = container;
  const wind = { id: 'wind', summary: { label: 'Wind' } };
  const radar = { id: 'radar', summary: { label: 'Radar' } };
  view.update([]);
  assert.equal(panel.hidden, true);
  assert.equal(count.textContent, '0');
  assert.equal(collapse.clicks, 0);
  view.update([wind, radar, { id: 'missing' }]);
  assert.equal(panel.hidden, false);
  assert.equal(count.textContent, '2');
  assert.equal(panel.classList.contains('collapsed'), false);
  assert.equal(collapse.clicks, 1);
  collapse.click();
  view.update([wind]);
  assert.equal(count.textContent, '1');
  assert.equal(panel.classList.contains('collapsed'), true);
  view.update([]);
  assert.equal(panel.hidden, true);
  assert.equal(count.textContent, '0');
  view.update([wind]);
  assert.equal(panel.classList.contains('collapsed'), true);
  assert.equal(collapse.clicks, 2);
  view.destroy();
  assert.equal(panel.hidden, true);
  assert.equal(count.textContent, '0');
  view = createWeatherSummary({ container });
  view.update([radar]);
  assert.equal(panel.hidden, false);
  assert.equal(panel.classList.contains('collapsed'), true);
  assert.equal(collapse.clicks, 2, 'remount preserves the page-session guard');
  view.destroy();
});

test('an already expanded first appearance is not toggled, and row clicks still open controls', () => {
  const container = fixture();
  container.panel.classList.toggle('collapsed', false);
  const opened = [];
  const view = createWeatherSummary({
    container,
    onOpen: (id) => opened.push(id),
  });
  const entries = [{ id: 'wind', summary: { label: 'Wind' } }];
  view.update(entries);
  assert.equal(container.collapse.clicks, 0);
  const root = container.children[0];
  assert.equal(
    root.children.length,
    1,
    'the panel owns the only WEATHER title',
  );
  const button = root.children[0];
  const event = new Event('click');
  Object.defineProperty(event, 'target', { value: { closest: () => button } });
  root.dispatchEvent(event);
  assert.deepEqual(opened, ['wind']);
  container.collapse.click();
  view.update([]);
  view.update(entries);
  assert.equal(container.panel.classList.contains('collapsed'), true);
  assert.equal(container.collapse.clicks, 1);
  view.destroy();
  root.dispatchEvent(event);
  assert.deepEqual(opened, ['wind'], 'destroy removes click delegation');
});
