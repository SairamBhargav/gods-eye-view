/** Resolve the visible surface that can own weather imagery without scene mutation. */
export function resolveImageryHost({ viewer, tileset }) {
  if (viewer?.scene?.globe?.show === true)
    return { collection: viewer.imageryLayers, kind: 'globe' };
  if (tileset?.imageryLayers)
    return { collection: tileset.imageryLayers, kind: 'tileset' };
  return { collection: null, kind: 'none' };
}

export const NO_IMAGERY_HOST = 'Hidden by this map source · choose a globe map';

export const WEATHER_TILESET_MIN_HEIGHT_METERS = 60_000;

/** Report imagery suspension without changing or detaching the resolved host. */
export function imageryHostStatus(host, camera) {
  if (host.kind === 'none') return NO_IMAGERY_HOST;
  if (
    host.kind === 'tileset' &&
    camera?.positionCartographic?.height < WEATHER_TILESET_MIN_HEIGHT_METERS
  )
    return 'Hidden below 60 km on 3D Tiles';
  return null;
}
