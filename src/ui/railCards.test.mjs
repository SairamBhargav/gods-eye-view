import test from 'node:test';
import assert from 'node:assert/strict';
import { createRailCards } from './railCards.js';
import { railFixture } from './railTestFixture.mjs';

const card = {
  id: 'a',
  title: 'Temperature',
  badge: 'Global',
  lines: [{ id: 'status', text: '' }],
  legend: {
    colors: ['#112233', '#ffffff', '#abcdef'],
    labels: ['-10', '0', '10'],
    units: '°C',
    zeroIndex: 1,
  },
  actions: [{ id: 'open', label: 'Controls' }],
};
test('cards reconcile ordered articles, lines and actions without redundant DOM writes', () => {
  let writes = 0;
  const f = railFixture(() => writes++);
  const view = createRailCards(f);
  view.update([card]);
  const article = f.container.children[0];
  assert.equal(article.tagName, 'ARTICLE');
  const button = f.find((n) => n.dataset.actionId === 'open');
  const status = f.find((n) => n.dataset.lineId === 'status');
  for (const cards of [
    [card],
    [{ ...card, lines: [{ id: 'status', text: '<img onerror=alert(1)>' }] }],
    [card, { ...card, id: 'b' }],
    [{ ...card, id: 'b' }, card],
    [],
  ]) {
    view.update(cards);
    writes = 0;
    view.update(cards);
    assert.equal(writes, 0);
  }
  view.update([card]);
  view.update([{ ...card, title: 'Changed' }]);
  const current = f.container.children[0];
  view.update([{ ...card, title: 'Changed again' }]);
  assert.equal(f.container.children[0], current);
  assert.equal(status.children.length, 0);
  assert.equal(button.tagName, 'BUTTON');
  view.destroy();
  assert.equal(f.container.children.length, 0);
});
test('actions retain focus targets and dispatch current callbacks; links are safe new-tab anchors', () => {
  const f = railFixture();
  const view = createRailCards(f);
  const calls = [];
  view.update([
    {
      ...card,
      actions: [{ id: 'open', label: 'First', onClick: () => calls.push(1) }],
    },
  ]);
  const button = f.find((n) => n.dataset.actionId === 'open');
  view.update([
    {
      ...card,
      actions: [
        { id: 'open', label: 'Second', onClick: () => calls.push(2) },
        { id: 'link', label: 'Source', href: 'https://example.org/advisory' },
      ],
    },
  ]);
  assert.equal(
    f.find((n) => n.dataset.actionId === 'open'),
    button,
  );
  button.click();
  assert.deepEqual(calls, [2]);
  const link = f.find((n) => n.dataset.actionId === 'link');
  assert.equal(link.tagName, 'A');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener');
  view.destroy();
  button.click();
  assert.deepEqual(calls, [2]);
});
test('legend validates colors and locates the freezing anchor by physical stops', () => {
  const f = railFixture();
  const view = createRailCards(f);
  view.update([card]);
  const zero = f.find((n) => n.className === 'rail-card-zero');
  assert.equal(zero.hidden, false);
  assert.equal(zero.style.left, '50%');
  view.update([
    {
      ...card,
      legend: {
        colors: Array(10).fill('#abcdef'),
        labels: Array.from({ length: 10 }, (_, i) => String(i * 10 - 40)),
        units: '°C',
        zeroIndex: 4,
      },
    },
  ]);
  assert.ok(Math.abs(parseFloat(zero.style.left) - 44.444444) < 0.001);
  view.update([{ ...card, legend: { ...card.legend, units: 'km/h' } }]);
  assert.equal(zero.hidden, true);
  view.update([
    {
      ...card,
      legend: {
        ...card.legend,
        colors: ['url(https://example.org)', '#ffffff'],
      },
    },
  ]);
  const ramp = f.find((n) => n.className === 'rail-card-ramp');
  assert.equal(ramp.hidden, true);
  assert.equal(ramp.style.background, '');
  view.destroy();
  assert.equal(createRailCards(), null);
});

test('CSSOM color and percentage normalization does not trigger repeated legend writes', () => {
  let writes = 0;
  const f = railFixture(() => writes++);
  const view = createRailCards(f);
  view.update([card]);
  const ramp = f.find((node) => node.className === 'rail-card-ramp');
  const zero = f.find((node) => node.className === 'rail-card-zero');
  Object.defineProperty(ramp.style, 'background', {
    get: () =>
      'linear-gradient(to right, rgb(17, 34, 51), rgb(255, 255, 255), rgb(171, 205, 239))',
    set() {
      writes++;
    },
    configurable: true,
  });
  Object.defineProperty(zero.style, 'left', {
    get: () => '50.0%',
    set() {
      writes++;
    },
    configurable: true,
  });
  writes = 0;
  view.update([card]);
  assert.equal(writes, 0);
  view.destroy();
});

test('sections retain focused chips, dispatch current params and reconcile active storm items', () => {
  let writes = 0;
  const f = railFixture(() => writes++);
  const calls = [];
  const view = createRailCards({
    ...f,
    onParams: (...args) => calls.push(args),
  });
  const settings = {
    id: 'settings',
    label: 'Settings',
    chips: [{ id: 'motion', label: 'Pause', params: { paused: true } }],
  };
  const storms = {
    id: 'storms',
    label: 'Storms',
    list: {
      ariaLabel: 'Storms',
      items: [
        {
          id: 'a',
          lead: 'AL',
          text: 'Storm A',
          active: true,
          params: { stormId: 'a', focus: true },
        },
        { id: 'b', text: 'Storm B', params: { stormId: 'b', focus: true } },
      ],
    },
  };
  const reading = {
    id: 'reading',
    label: 'Reading',
    lines: [{ id: 'coordinates', text: '<b>41°N</b>' }],
    actions: [
      { id: 'clear', label: 'Clear reading', params: { inspect: false } },
    ],
  };
  let model = { ...card, sections: [settings, storms, reading] };
  view.update([model]);
  const section = (id) => f.find((n) => n.dataset.sectionId === id);
  assert.equal(section('settings').children[1].hidden, true);
  assert.equal(section('storms').children[1].hidden, true);
  assert.equal(section('reading').children[1].hidden, false);
  section('settings').children[0].click();
  const chip = f.find((n) => n.dataset.chipId === 'motion');
  chip.focus();
  model = {
    ...model,
    sections: [
      {
        ...settings,
        chips: [
          {
            id: 'motion',
            label: 'Resume',
            params: { paused: false },
            active: true,
          },
        ],
      },
      {
        ...storms,
        list: {
          ...storms.list,
          items: storms.list.items.map((item) => ({
            ...item,
            active: item.id === 'b',
          })),
        },
      },
      reading,
    ],
  };
  view.update([model]);
  assert.equal(f.document.activeElement, chip);
  chip.click();
  assert.deepEqual(calls.at(-1), ['a', { paused: false }]);
  const stormB = f.find(
    (n) => n.tagName === 'BUTTON' && n.dataset.listItemId === 'b',
  );
  assert.equal(stormB.getAttribute('aria-pressed'), 'true');
  stormB.click();
  assert.deepEqual(calls.at(-1), ['a', { stormId: 'b', focus: true }]);
  const clear = f.find((n) => n.dataset.actionId === 'clear');
  clear.click();
  assert.deepEqual(calls.at(-1), ['a', { inspect: false }]);
  assert.equal(
    f.find((n) => n.dataset.lineId === 'coordinates').children.length,
    0,
  );
  writes = 0;
  view.update([model]);
  assert.equal(writes, 0);
  view.destroy();
  const before = calls.length;
  chip.click();
  clear.click();
  stormB.click();
  assert.equal(calls.length, before);
});

test('disclosure choices persist across removal, re-enable and remount for the page', () => {
  const f = railFixture();
  const model = {
    ...card,
    sections: [
      { id: 'settings', label: 'Settings', chips: [] },
      { id: 'reading', label: 'Reading', lines: [] },
    ],
  };
  let view = createRailCards(f);
  const toggle = (id) => f.find((n) => n.dataset.sectionId === id).children[0];
  view.update([model]);
  toggle('settings').click();
  toggle('reading').click();
  view.update([]);
  view.update([model]);
  assert.equal(toggle('settings').getAttribute('aria-expanded'), 'true');
  assert.equal(toggle('reading').getAttribute('aria-expanded'), 'false');
  assert.ok(toggle('reading').getAttribute('aria-controls'));
  view.destroy();
  view = createRailCards(f);
  view.update([model]);
  assert.equal(toggle('settings').getAttribute('aria-expanded'), 'true');
  assert.equal(toggle('reading').getAttribute('aria-expanded'), 'false');
  view.destroy();
});
