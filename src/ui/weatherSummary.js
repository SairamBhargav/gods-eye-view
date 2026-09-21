// Remounting layer controls must not reopen a panel the user already collapsed.
const appearedDocuments = new WeakSet();

/** Event-driven active weather rows inside the managed rail panel body. */
export function createWeatherSummary({ container, onOpen = () => {} } = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement) return null;
  const root = document.createElement('section');
  root.className = 'weather-summary';
  root.setAttribute('aria-label', 'Active weather');
  root.hidden = true;
  const panel = container.closest?.('#weather-panel');
  const count = panel?.querySelector('#weather-panel-count');
  const rows = new Map();
  const text = (element, value) => {
    const next = String(value || '');
    if (element.textContent !== next) element.textContent = next;
  };
  const click = (event) => {
    const button = event.target?.closest?.('[data-weather-open]');
    if (button) onOpen(button.dataset.weatherOpen);
  };
  root.addEventListener('click', click);
  container.appendChild(root);
  return {
    update(entries) {
      const active = new Set();
      for (const { id, summary, legend = [] } of entries) {
        if (!summary) continue;
        active.add(id);
        let row = rows.get(id);
        if (!row) {
          const element = document.createElement('button');
          element.type = 'button';
          element.title = 'Open weather controls';
          element.className = 'weather-summary-product';
          element.dataset.weatherOpen = id;
          const label = document.createElement('strong');
          const detail = document.createElement('span');
          const status = document.createElement('span');
          status.className = 'weather-summary-status';
          const ramp = document.createElement('span');
          ramp.className = 'weather-summary-ramp';
          const zero = document.createElement('span');
          zero.className = 'weather-summary-zero';
          zero.setAttribute('aria-hidden', 'true');
          ramp.appendChild(zero);
          const scale = document.createElement('span');
          scale.className = 'weather-summary-scale';
          for (const node of [label, detail, status, ramp, scale])
            element.appendChild(node);
          root.appendChild(element);
          row = {
            element,
            label,
            detail,
            status,
            ramp,
            scale,
            zero,
            gradient: '',
          };
          rows.set(id, row);
        }
        text(row.label, summary.label);
        text(row.detail, summary.detail);
        text(row.status, summary.status);
        const colors = legend
          .map(({ color }) => color)
          .filter((color) => /^#[0-9a-f]{6}$/i.test(color));
        const hideScale = colors.length < 2;
        if (row.ramp.hidden !== hideScale) row.ramp.hidden = hideScale;
        if (row.scale.hidden !== hideScale) row.scale.hidden = hideScale;
        const zeroIndex = legend.findIndex(({ label }) => label === '0');
        const hideZero =
          summary.units !== '°C' ||
          zeroIndex < 0 ||
          colors.length < 2 ||
          colors.length !== legend.length;
        if (row.zero.hidden !== hideZero) row.zero.hidden = hideZero;
        if (!hideZero) {
          const left = `${(zeroIndex / (legend.length - 1)) * 100}%`;
          if (row.zeroLeft !== left) {
            row.zero.style.left = left;
            row.zeroLeft = left;
          }
        }
        const gradient =
          colors.length > 1
            ? `linear-gradient(to right, ${colors.join(',')})`
            : '';
        if (row.gradient !== gradient) {
          row.ramp.style.background = gradient;
          row.gradient = gradient;
        }
        text(
          row.scale,
          colors.length > 1
            ? `${legend[0].label} — ${legend.at(-1).label} ${summary.units || ''}`
            : '',
        );
      }
      for (const [id, row] of rows)
        if (!active.has(id)) {
          row.element.remove();
          rows.delete(id);
        }
      const hidden = rows.size === 0;
      if (root.hidden !== hidden) root.hidden = hidden;
      if (count) text(count, String(rows.size));
      if (panel && panel.hidden !== hidden) panel.hidden = hidden;
      if (!hidden && panel && !appearedDocuments.has(document)) {
        appearedDocuments.add(document);
        if (panel.classList.contains('collapsed'))
          panel
            .querySelector('[data-collapse-target="weather-panel"]')
            ?.click();
      }
    },
    destroy() {
      root.removeEventListener('click', click);
      root.remove();
      rows.clear();
      if (panel && !panel.hidden) panel.hidden = true;
      if (count) text(count, '0');
    },
  };
}
