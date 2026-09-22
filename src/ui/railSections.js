import { syncChipGroup } from './chipGroup.js';
import { syncRowList } from './rowList.js';

const disclosures = new WeakMap();
let nextId = 0;
const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};
const attribute = (node, key, value) => {
  if (node.getAttribute(key) !== value) node.setAttribute(key, value);
};
const order = (parent, nodes) =>
  nodes.forEach((node, i) => {
    if (parent.children[i] !== node)
      parent.insertBefore(node, parent.children[i] || null);
  });

/** Collapsible, keyed card sections; disclosure preferences last for this page. */
export function createRailSections({ container, cardId, stateKey, onParams }) {
  const document = container.ownerDocument;
  if (!disclosures.has(document)) disclosures.set(document, new Map());
  const preferences = disclosures.get(document);
  const sections = new Map();
  const make = (tag, className, parent) => {
    const node = document.createElement(tag);
    node.className = className;
    parent.appendChild(node);
    return node;
  };
  const dispose = (section) => {
    for (const remove of section.removers) remove();
    for (const action of section.actions.values()) action.dispose();
    section.root.remove();
  };
  const dispatch = (props) => {
    if (!props || props.disabled) return;
    if (props.params) onParams(cardId, props.params);
    else props.onClick?.();
  };
  return {
    update(descriptors = []) {
      const ids = new Set();
      for (const props of descriptors) {
        ids.add(props.id);
        let section = sections.get(props.id);
        if (!section) {
          const root = make('section', 'rail-card-section', container);
          root.dataset.sectionId = props.id;
          const toggle = make(
            'button',
            'rail-card-disclosure panel-title',
            root,
          );
          toggle.type = 'button';
          const body = make('div', 'rail-card-section-body', root);
          body.id = `rail-card-section-${++nextId}`;
          toggle.setAttribute('aria-controls', body.id);
          const lines = make('div', 'rail-card-lines', body);
          const chips = make('div', 'rail-card-chips', body);
          const list = make('ol', 'data-row-list', body);
          const actionsHost = make('div', 'rail-card-actions', body);
          const key = `${stateKey}:${cardId}:${props.id}`;
          section = {
            root,
            toggle,
            body,
            lines,
            chips,
            list,
            actionsHost,
            props,
            lineNodes: new Map(),
            actions: new Map(),
            removers: [],
            open: preferences.get(key) ?? props.id === 'reading',
          };
          const bind = (node, fn) => {
            node.addEventListener('click', fn);
            section.removers.push(() => node.removeEventListener('click', fn));
          };
          section.show = () => {
            set(body, 'hidden', !section.open);
            attribute(toggle, 'aria-expanded', String(section.open));
            set(
              toggle,
              'textContent',
              `${section.open ? '▾' : '▸'} ${section.props.label}`,
            );
          };
          bind(toggle, () => {
            section.open = !section.open;
            preferences.set(key, section.open);
            section.show();
          });
          bind(chips, (event) => {
            const button = event.target?.closest?.('[data-chip-id]');
            if (button)
              dispatch(
                section.props.chips?.find(
                  ({ id }) => id === button.dataset.chipId,
                ),
              );
          });
          bind(list, (event) => {
            const button = event.target?.closest?.('.data-row-list-item');
            if (button)
              dispatch(
                section.props.list?.items?.find(
                  ({ id }) => id === button.dataset.listItemId,
                ),
              );
          });
          sections.set(props.id, section);
        }
        section.props = props;
        section.show();
        const lines = props.lines || [];
        const lineIds = new Set(lines.map(({ id }) => id));
        for (const line of lines) {
          let node = section.lineNodes.get(line.id);
          if (!node) {
            node = make('div', 'rail-card-line', section.lines);
            node.dataset.lineId = line.id;
            section.lineNodes.set(line.id, node);
          }
          set(node, 'textContent', String(line.text ?? ''));
        }
        for (const [id, node] of section.lineNodes)
          if (!lineIds.has(id)) {
            node.remove();
            section.lineNodes.delete(id);
          }
        order(
          section.lines,
          lines.map(({ id }) => section.lineNodes.get(id)),
        );
        set(section.lines, 'hidden', !lines.length);
        syncChipGroup(section.chips, props.chips || []);
        set(section.chips, 'hidden', !props.chips?.length);
        syncRowList(section.list, props.list);
        const actionIds = new Set();
        for (const actionProps of props.actions || []) {
          actionIds.add(actionProps.id);
          let action = section.actions.get(actionProps.id);
          if (!action) {
            const node = make(
              'button',
              'data-toggle-chip',
              section.actionsHost,
            );
            node.type = 'button';
            node.dataset.actionId = actionProps.id;
            action = { node, props: actionProps };
            const click = () => dispatch(action.props);
            node.addEventListener('click', click);
            action.dispose = () => {
              node.removeEventListener('click', click);
              node.remove();
            };
            section.actions.set(actionProps.id, action);
          }
          action.props = actionProps;
          set(action.node, 'textContent', actionProps.label);
          set(action.node, 'title', actionProps.title || '');
          set(action.node, 'disabled', Boolean(actionProps.disabled));
        }
        for (const [id, action] of section.actions)
          if (!actionIds.has(id)) {
            action.dispose();
            section.actions.delete(id);
          }
        order(
          section.actionsHost,
          (props.actions || []).map(({ id }) => section.actions.get(id).node),
        );
        set(section.actionsHost, 'hidden', !actionIds.size);
      }
      for (const [id, section] of sections)
        if (!ids.has(id)) {
          dispose(section);
          sections.delete(id);
        }
      order(
        container,
        descriptors.map(({ id }) => sections.get(id).root),
      );
    },
    destroy() {
      for (const section of sections.values()) dispose(section);
      sections.clear();
    },
  };
}
