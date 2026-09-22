import { createRailCards } from './railCards.js';
import { createRailTimeline } from './railTimeline.js';

// Remounting controls must not reopen a panel the user already collapsed.
const appearedDocuments = new WeakSet();
const ORDER = [
  'wind',
  'weather-radar',
  'weather-satellite',
  'weather-lightning',
  'weather-cyclones',
];
const OBSERVED = new Set(ORDER.slice(1, 4));
const utc = (time) =>
  Number.isFinite(Date.parse(time))
    ? `${new Date(time).toISOString().slice(5, 16).replace('T', ' ')} UTC`
    : 'Unavailable';
const age = (time) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(time)) / 60_000),
  );
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
    : `${minutes}m ago`;
};
const historyTime = (time) =>
  `${utc(time).slice(6)} · ${Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 60_000))} min ago`;
const dated = (time) => `${utc(time)} · ${age(time)}`;
const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};

/** Map weather descriptors and the observed clock into reusable rail readouts. */
export function createWeatherPanel({
  container,
  clock,
  setLayerParams = () => {},
  onAction = () => {},
} = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement) return null;
  const root = document.createElement('section');
  root.className = 'weather-readout';
  root.hidden = true;
  root.setAttribute('aria-label', 'Active weather');
  const timelineHost = document.createElement('div');
  timelineHost.className = 'weather-timeline-block';
  timelineHost.hidden = true;
  const cardsHost = document.createElement('div');
  cardsHost.className = 'weather-cards';
  root.appendChild(timelineHost);
  root.appendChild(cardsHost);
  container.appendChild(root);
  const panel = container.closest?.('#weather-panel');
  const count = panel?.querySelector('#weather-panel-count');
  let entries = [];
  let destroyed = false;
  const timeline = createRailTimeline({
    container: timelineHost,
    document,
    sliderClassName: 'weather-timeline',
    onCommit: (tick) => clock?.setTarget(tick),
    onPreview: historyTime,
    onStep: (direction) => clock?.step(direction),
    onLatest: () => clock?.latest(),
    onPlay: () => clock?.togglePlay(),
  });
  const cards = createRailCards({
    container: cardsHost,
    document,
    cardClassName: 'weather-card',
    badgeClassName: 'weather-coverage',
    onParams: (id, params) => setLayerParams(id, params, { origin: 'user' }),
  });
  const render = () => {
    if (destroyed) return;
    const state = clock?.getState() || {
      mode: 'latest',
      timeline: [],
      products: [],
    };
    const active = entries
      .filter(({ summary }) => summary)
      .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    const showTimeline =
      active.some(({ id }) => OBSERVED.has(id)) && state.timeline.length >= 2;
    set(timelineHost, 'hidden', !showTimeline);
    const index =
      state.mode === 'latest'
        ? state.timeline.length - 1
        : Math.max(
            0,
            state.timeline.findLastIndex(
              (tick) => Date.parse(tick) <= Date.parse(state.target),
            ),
          );
    timeline.update({
      ticks: state.timeline,
      index,
      mode: state.mode,
      playing: Boolean(state.playing),
      disabled: !showTimeline,
      readout:
        state.mode === 'latest'
          ? 'LATEST · newest per product'
          : historyTime(state.target),
    });
    cards.update(
      active.map(({ id, summary, legend = [] }) => {
        let detail = summary.detail;
        const product = state.products.find((item) => item.id === id);
        if (OBSERVED.has(id)) {
          const shown = product?.shown ?? summary.shownTime;
          if (state.mode === 'history' && product?.selected === null) {
            const gap = summary.maxGapMinutes || 30;
            detail = `No frame within ${gap < 60 ? `${gap} min` : `${gap / 60} h`} of ${utc(state.target).slice(6)}`;
          } else if (shown) {
            detail = dated(shown);
            if (state.mode === 'history')
              detail +=
                Date.parse(shown) === Date.parse(state.target)
                  ? ' · synced'
                  : ' · nearest';
          }
        } else if (id === 'wind') {
          detail = `Forecast · valid ${utc(summary.validTime)} · issued ${utc(summary.issuedTime)}`;
          if (state.mode === 'history') detail += ' · Does not follow history';
        }
        const lines = [
          { id: 'time', text: detail, muted: true },
          { id: 'status', text: summary.status },
        ];
        for (const line of summary.lines || []) lines.push(line);
        const actions = [];
        if (summary.advisoryUrl)
          actions.push({
            id: 'advisory',
            label: 'Official advisory ↗',
            title: 'Open the official NHC advisory',
            href: summary.advisoryUrl,
          });
        for (const action of summary.actions || [])
          actions.push({ ...action, onClick: () => onAction(id, action.id) });
        return {
          id,
          title: summary.label,
          badge: summary.coverage,
          lines,
          legend: {
            colors: legend.map(({ color }) => color),
            labels: legend.map(({ label }) => label),
            units: id === 'weather-cyclones' ? '' : summary.units,
            zeroIndex: legend.findIndex(({ label }) => label === '0'),
          },
          sections: summary.sections,
          actions,
        };
      }),
    );
    const hidden = active.length === 0;
    set(root, 'hidden', hidden);
    if (count) set(count, 'textContent', String(active.length));
    if (panel) set(panel, 'hidden', hidden);
    if (!hidden && panel && !appearedDocuments.has(document)) {
      appearedDocuments.add(document);
      // First appearance opens the panel unless a stored or shared collapse
      // choice exists (marked by the panel chrome when it restored the state).
      const preference = panel.dataset?.collapsedPreference;
      if (
        panel.classList.contains('collapsed') &&
        (preference === undefined || preference === 'default')
      )
        panel.querySelector('[data-collapse-target="weather-panel"]')?.click();
    }
  };
  const unsubscribe = clock?.subscribe(render);
  return {
    update(nextEntries) {
      entries = nextEntries;
      render();
    },
    destroy() {
      destroyed = true;
      unsubscribe?.();
      timeline.destroy();
      cards.destroy();
      root.remove();
      if (panel) set(panel, 'hidden', true);
      if (count) set(count, 'textContent', '0');
    },
  };
}
