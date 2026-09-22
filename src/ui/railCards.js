const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};
const text = (node, value) => set(node, 'textContent', String(value ?? ''));

/** Keyed readout cards. Actions default to the footer; compact controls may use the header. */
export function createRailCards({
  container,
  document = container?.ownerDocument,
  cardClassName = '',
  badgeClassName = '',
} = {}) {
  if (!document?.createElement || !container) return null;
  const rows = new Map();
  let destroyed = false;
  const make = (tag, className, parent) => {
    const node = document.createElement(tag);
    node.className = className;
    parent.appendChild(node);
    return node;
  };
  const reconcile = (parent, nodes) => {
    nodes.forEach((node, index) => {
      if (parent.children[index] !== node)
        parent.insertBefore(node, parent.children[index] || null);
    });
  };
  const dispose = (row) => {
    for (const action of row.actions.values())
      action.node.removeEventListener('click', action.click);
    row.element.remove();
  };
  return {
    update(cards = []) {
      if (destroyed) return;
      const active = new Set();
      for (const card of cards) {
        active.add(card.id);
        let row = rows.get(card.id);
        if (!row) {
          const element = make(
            'article',
            `rail-card${cardClassName ? ` ${cardClassName}` : ''}`,
            container,
          );
          element.dataset.cardId = card.id;
          const header = make('header', 'rail-card-header', element);
          const title = make('strong', 'rail-card-title', header);
          const badge = make(
            'span',
            `rail-card-badge${badgeClassName ? ` ${badgeClassName}` : ''}`,
            header,
          );
          const body = make('div', 'rail-card-lines', element);
          const ramp = make('div', 'rail-card-ramp', element);
          const zero = make('span', 'rail-card-zero', ramp);
          zero.setAttribute('aria-hidden', 'true');
          const scale = make('div', 'rail-card-scale', element);
          const footer = make('footer', 'rail-card-actions', element);
          row = {
            element,
            header,
            title,
            badge,
            body,
            ramp,
            zero,
            scale,
            footer,
            lines: new Map(),
            actions: new Map(),
          };
          rows.set(card.id, row);
        }
        text(row.title, card.title);
        text(row.badge, card.badge);
        set(row.badge, 'hidden', !card.badge);
        const lineIds = new Set();
        for (const line of card.lines || []) {
          lineIds.add(line.id);
          let node = row.lines.get(line.id);
          if (!node) {
            node = make('div', 'rail-card-line', row.body);
            node.dataset.lineId = line.id;
            row.lines.set(line.id, node);
          }
          text(node, line.text);
          set(node, 'className', `rail-card-line${line.muted ? ' muted' : ''}`);
        }
        for (const [id, node] of row.lines)
          if (!lineIds.has(id)) {
            node.remove();
            row.lines.delete(id);
          }
        reconcile(
          row.body,
          (card.lines || []).map(({ id }) => row.lines.get(id)),
        );
        const legend = card.legend;
        const colors = (legend?.colors || []).filter((color) =>
          /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color),
        );
        const visible =
          colors.length >= 2 && colors.length === legend.colors.length;
        set(row.ramp, 'hidden', !visible);
        set(row.scale, 'hidden', !visible);
        const gradient = visible
          ? `linear-gradient(to right, ${colors.join(',')})`
          : '';
        // CSSOM normalizes colors; compare source values, not serialized style.
        if (row.gradient !== gradient) {
          row.ramp.style.background = gradient;
          row.gradient = gradient;
        }
        const zeroVisible =
          visible &&
          legend.units === '°C' &&
          Number.isInteger(legend.zeroIndex) &&
          legend.zeroIndex >= 0 &&
          legend.zeroIndex < colors.length;
        set(row.zero, 'hidden', !zeroVisible);
        if (zeroVisible) {
          const left = `${(legend.zeroIndex / (colors.length - 1)) * 100}%`;
          if (row.zeroLeft !== left) {
            row.zero.style.left = left;
            row.zeroLeft = left;
          }
        }
        text(
          row.scale,
          visible
            ? `${legend.labels[0]} — ${legend.labels.at(-1)} ${legend.units || ''}`.trim()
            : '',
        );
        const actionIds = new Set();
        for (const props of card.actions || []) {
          actionIds.add(props.id);
          let action = row.actions.get(props.id);
          const tag = props.href ? 'a' : 'button';
          if (action && action.tag !== tag) {
            action.node.removeEventListener('click', action.click);
            action.node.remove();
            row.actions.delete(props.id);
            action = null;
          }
          if (!action) {
            const node = make(tag, 'data-toggle-chip', row.footer);
            node.dataset.actionId = props.id;
            if (tag === 'button') node.type = 'button';
            else {
              node.target = '_blank';
              node.rel = 'noopener';
            }
            action = { node, tag, props };
            action.click = () => action.props.onClick?.();
            node.addEventListener('click', action.click);
            row.actions.set(props.id, action);
          }
          action.props = props;
          text(action.node, props.label);
          set(action.node, 'title', props.title || '');
          if (tag === 'a' && action.href !== props.href) {
            action.node.href = props.href;
            action.href = props.href;
          }
          for (const [key, value] of Object.entries(props.dataset || {}))
            set(action.node.dataset, key, value);
        }
        for (const [id, action] of row.actions)
          if (!actionIds.has(id)) {
            action.node.removeEventListener('click', action.click);
            action.node.remove();
            row.actions.delete(id);
          }
        const actions = card.actions || [];
        reconcile(row.header, [
          row.title,
          row.badge,
          ...actions
            .filter((a) => a.placement === 'header')
            .map((a) => row.actions.get(a.id).node),
        ]);
        reconcile(
          row.footer,
          actions
            .filter((a) => a.placement !== 'header')
            .map((a) => row.actions.get(a.id).node),
        );
        set(
          row.footer,
          'hidden',
          !actions.some((a) => a.placement !== 'header'),
        );
      }
      for (const [id, row] of rows)
        if (!active.has(id)) {
          dispose(row);
          rows.delete(id);
        }
      reconcile(
        container,
        cards.map(({ id }) => rows.get(id).element),
      );
    },
    destroy() {
      destroyed = true;
      for (const row of rows.values()) dispose(row);
      rows.clear();
    },
  };
}
