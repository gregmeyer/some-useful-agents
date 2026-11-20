// What a drawn A2UI surface needs to become a new copy of itself (ADR-0086):
// only the components that changed or appeared (A2UI 1.0's updateComponents
// upserts by id; one that went is simply no longer anyone's child), and only
// the data that changed, path by path (updateDataModel; null deletes). So a
// notebook page or a board takes what's new in place: nothing redraws,
// nothing jumps, an open panel stays open. Pure, imported by a2ui-sua.js.

const DEPTH = 2;

/** The surface id a list of messages draws. */
export function surfaceIdOf(messages) {
  const m = (Array.isArray(messages) ? messages : []).find((x) => x && x.createSurface);
  return m ? m.createSurface.surfaceId : undefined;
}

/** The components a list of messages draws (createSurface's own and every updateComponents'). */
export function componentsOf(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m && m.createSurface && Array.isArray(m.createSurface.components)) out.push(...m.createSurface.components);
    if (m && m.updateComponents && Array.isArray(m.updateComponents.components)) out.push(...m.updateComponents.components);
  }
  return out;
}

/** The data model a list of messages sets at the root (the last one wins); undefined when none does. */
export function dataOf(messages) {
  let data;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m && m.createSurface && m.createSurface.dataModel !== undefined) data = m.createSurface.dataModel;
    if (m && m.updateDataModel && (m.updateDataModel.path === undefined || m.updateDataModel.path === '/' || m.updateDataModel.path === '')) data = m.updateDataModel.value;
  }
  return data;
}

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The paths where `next` differs from `prev`, as [path, value] (value null where it went), down to `depth` levels of objects. */
export function dataChanges(prev, next, depth = DEPTH, at = '') {
  if (same(prev, next)) return [];
  if (depth <= 0 || !plain(prev) || !plain(next)) return [[at || '/', next === undefined ? null : next]];
  const out = [];
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const path = `${at}/${pointer(k)}`;
    if (!(k in next)) out.push([path, null]);
    else if (!(k in prev)) out.push([path, next[k]]);
    else out.push(...dataChanges(prev[k], next[k], depth - 1, path));
  }
  return out;
}

/**
 * The messages that take a drawn surface (`kept`: its id, its components by id
 * as JSON, its data) to a new copy (`messages`), and what it is after. Null
 * when they can't be applied in place (another surface, or no root).
 */
export function surfaceDelta(kept, messages, version = '1.0') {
  const surfaceId = surfaceIdOf(messages);
  if (!kept || !surfaceId || surfaceId !== kept.surfaceId) return null;
  const comps = componentsOf(messages);
  if (!comps.some((c) => c && c.id === 'root')) return null;
  const byId = new Map(comps.map((c) => [c.id, JSON.stringify(c)]));
  const changed = comps.filter((c) => kept.byId.get(c.id) !== byId.get(c.id));
  const out = [];
  if (changed.length) out.push({ version, updateComponents: { surfaceId, components: changed } });
  const data = dataOf(messages);
  const paths = data === undefined ? [] : dataChanges(kept.data, data);
  for (const [path, value] of paths) out.push({ version, updateDataModel: { surfaceId, path, value } });
  return { messages: out, changed: changed.length, paths: paths.length, next: { surfaceId, byId, data: data === undefined ? kept.data : data } };
}
