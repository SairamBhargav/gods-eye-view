import { weatherTileUrl } from './source.js';
import { orderWeatherImagery } from './imageryOrder.js';
import { imageryHostStatus } from './imageryHost.js';
import { createRasterTileProvider } from './rasterTiles.js';
import {
  acquireInfraredMosaic,
  processInfraredImage,
} from './infraredImage.js';
// Bounded display detail for the hourly, approximately 3 km global product.
const GLOBAL_TILE_MAXIMUM_LEVEL = 3;

/** Own at most a displayed and a staging frame. Use native Cesium tile scheduling,
 * projection and texture disposal; the application clock is never touched. */
export function createWeatherRendering({
  viewer,
  cesium,
  getHost = () => ({ collection: viewer.imageryLayers, kind: 'globe' }),
  onChange = () => {},
  timeoutMs = 25_000,
  now = () => performance.now(),
  fetchImpl = (...args) => globalThis.fetch(...args),
  decodeImage,
  createCanvas = () => document.createElement('canvas'),
}) {
  let current = null;
  let incoming = null;
  const retiring = new Set();
  let alpha = 0.7;
  let frameHidden = false;
  let lastError = null;

  function remove(frame) {
    if (!frame) return;
    frame.closed = true;
    frame.controller.abort();
    frame.offRetire?.();
    frame.offInstall?.();
    retiring.delete(frame);
    frame.offError?.();
    frame.offAbort?.();
    frame.offRender?.();
    frame.offCamera?.();
    clearTimeout(frame.timeout);
    for (const request of frame.requests) request.cancel?.();
    frame.requests.clear();
    frame.retries.clear();
    if (!frame.layer) return;
    const collection = frame.collection;
    if (
      collection &&
      !collection.isDestroyed?.() &&
      collection.contains(frame.layer)
    )
      collection.remove(frame.layer, true);
    else if (!frame.layer.isDestroyed?.()) frame.layer.destroy?.();
  }
  function cancelIncoming() {
    if (!incoming) return;
    const previous = incoming;
    incoming = null;
    remove(previous);
    previous.resolve(false);
  }
  function rehome() {
    const host = getHost();
    const { collection, kind } = host;
    const hidden =
      frameHidden || imageryHostStatus(host, viewer.camera) !== null;
    const changed =
      (current && current.collection !== collection) ||
      (incoming && incoming.collection !== collection);
    const visibilityChanged = current && current.layer.show === hidden;
    if (changed || imageryHostStatus(host, viewer.camera) !== null) {
      cancelIncoming();
      for (const frame of retiring) remove(frame);
    }
    if (current) {
      if (!hidden && current.layer.alpha !== alpha) current.layer.alpha = alpha;
      if (visibilityChanged) current.layer.show = !hidden;
    }
    if (current && current.collection !== collection) {
      current.collection?.remove(current.layer, false);
      current.collection = collection;
      if (collection) {
        collection.add(current.layer);
        orderWeatherImagery(collection, current.layer, current.priority);
      }
    }
    if (current && !hidden) current.kind = kind;
    if (changed || visibilityChanged) viewer.scene.requestRender();
    return Boolean(changed || visibilityChanged);
  }
  const api = {
    rehome,
    async setFrame(snapshot, time, { signal, infrared = 'filtered' } = {}) {
      signal?.throwIfAborted();
      rehome();
      cancelIncoming();
      const host = getHost();
      const { collection, kind } = host;
      if (imageryHostStatus(host, viewer.camera)) return false;
      if (
        current?.time === time &&
        current.product === snapshot.product &&
        current.kind === kind &&
        current.infrared === infrared
      )
        return true;
      lastError = null;
      const { west, south, east, north } = snapshot.bounds;
      const rectangle = cesium.Rectangle.fromDegrees(west, south, east, north);
      const global = snapshot.product === 'clouds';
      const frame = {
        snapshot,
        time,
        infrared,
        mosaic: global ? { fetched: false, decodeMs: null } : undefined,
        controller: new AbortController(),
        collection,
        kind,
        priority:
          snapshot.product === 'lightning'
            ? 3
            : snapshot.product === 'radar'
              ? 2
              : 1,
        product: snapshot.product,
        requests: new Set(),
        retries: new Map(),
        deferred: new Set(),
        pending: 0,
        loaded: 0,
        lastActivity: now(),
        startedAt: now(),
        closed: false,
        failed: false,
        resolve: null,
      };
      incoming = frame;
      const result = new Promise((resolve) => {
        frame.resolve = resolve;
      });
      const finish = (ok) => {
        if (incoming !== frame) return;
        incoming = null;
        frame.offRender?.();
        frame.offRender = null;
        frame.offCamera?.();
        frame.offCamera = null;
        clearTimeout(frame.timeout);
        frame.offAbort?.();
        if (ok) {
          lastError = null;
          const previous = current;
          current = frame;
          frame.loadMs = now() - frame.startedAt;
          frame.layer.alpha = alpha;
          frame.layer.show = !frameHidden;
          viewer.scene.requestRender();
          if (previous) {
            retiring.add(previous);
            previous.offRetire = viewer.scene.postRender.addEventListener(
              () => {
                remove(previous);
                viewer.scene.requestRender();
              },
            );
          }
        } else {
          lastError = 'Weather tiles unavailable · previous frame retained';
          remove(frame);
        }
        frame.resolve(ok);
        viewer.scene.requestRender();
        onChange();
      };
      const abort = () => {
        if (incoming === frame) cancelIncoming();
        viewer.scene.requestRender();
      };
      signal?.addEventListener('abort', abort, { once: true });
      frame.offAbort = () => signal?.removeEventListener('abort', abort);
      frame.timeout = setTimeout(() => finish(false), timeoutMs);
      const install = (texture) => {
        if (frame.closed) return;
        // Keep at most two installed layers during rapid successive selections.
        if (retiring.size) {
          frame.offInstall = viewer.scene.postRender.addEventListener(() => {
            frame.offInstall();
            frame.offInstall = null;
            try {
              install(texture);
            } catch {
              finish(false);
            }
          });
          viewer.scene.requestRender();
          return;
        }
        const tilingScheme = new cesium.GeographicTilingScheme(
          global
            ? {
                rectangle,
                numberOfLevelZeroTilesX: 2,
                numberOfLevelZeroTilesY: 1,
              }
            : undefined,
        );
        const credit = new cesium.Credit(
          snapshot.product === 'lightning'
            ? 'NOAA/NWS lightning density · derived from Vaisala NLDN/GLD360'
            : snapshot.product === 'radar'
              ? 'NOAA nowCOAST · NWS/OAR MRMS'
              : 'NOAA nowCOAST · NESDIS GOES / global satellite partners',
          false,
        );
        const provider = global
          ? createRasterTileProvider({
              cesium,
              texture,
              rectangle,
              tilingScheme,
              maximumLevel: GLOBAL_TILE_MAXIMUM_LEVEL,
              credit,
              createCanvas,
            })
          : new cesium.UrlTemplateImageryProvider({
              url: weatherTileUrl(snapshot.product, time),
              tilingScheme,
              rectangle,
              tileWidth: 256,
              tileHeight: 256,
              maximumLevel: 6,
              enablePickFeatures: false,
              credit,
            });
        const requestImage = provider.requestImage.bind(provider);
        provider.requestImage = (x, y, level, request) => {
          if (frame.closed) return undefined;
          const result = requestImage(x, y, level, request);
          const tileKey = `${level}/${x}/${y}`;
          if (!result) {
            // Scheduler admission is part of readiness, not a successful tile.
            frame.deferred.add(tileKey);
            frame.lastActivity = now();
            return result;
          }
          frame.deferred.delete(tileKey);
          frame.pending++;
          frame.lastActivity = now();
          if (request) frame.requests.add(request);
          return Promise.resolve(result)
            .then((image) => {
              if (!frame.closed && snapshot.product === 'clouds-regional')
                image = processInfraredImage(image, infrared, createCanvas);
              frame.retries.delete(tileKey);
              frame.loaded++;
              return image;
            })
            .finally(() => {
              frame.pending--;
              frame.lastActivity = now();
              frame.requests.delete(request);
              if (!frame.closed) viewer.scene.requestRender();
            });
        };
        frame.offError = provider.errorEvent.addEventListener((error) => {
          if (frame.closed) return;
          const status = error?.error?.statusCode;
          // Cesium retries synchronously after this event; no delay hook is exposed.
          const tileKey = `${error.level}/${error.x}/${error.y}`;
          const retries = frame.retries.get(tileKey) ?? 0;
          error.retry = false;
          if ((status === 429 || status === 503) && retries < 3) {
            frame.retries.set(tileKey, retries + 1);
            error.retry = true;
            return;
          }
          frame.failed = true;
          lastError = 'Some weather tiles unavailable';
          onChange();
        });
        // A shown, transparent layer lets Cesium request staging tiles while the last
        // complete observation stays visible underneath it.
        frame.layer = collection.addImageryProvider(provider);
        frame.layer.alpha = 0;
        orderWeatherImagery(collection, frame.layer, frame.priority);
        let settled = 0;
        frame.offCamera = viewer.camera?.moveEnd?.addEventListener(() => {
          // Tiles abandoned by a previous viewport are no longer admission work.
          frame.deferred.clear();
          frame.lastActivity = now();
          settled = 0;
          viewer.scene.requestRender();
        });
        frame.offRender = viewer.scene.postRender.addEventListener(() => {
          if (frame.failed) return finish(false);
          // Unrelated terrain/basemap work must not indefinitely hold a ready
          // observation. Require successful own tiles and a quiet scheduling
          // interval before admitting a frame when the rest of the globe is busy.
          const ownReady =
            frame.loaded > 0 &&
            frame.deferred.size === 0 &&
            now() - frame.lastActivity >= 200;
          if (
            ((frame.kind === 'globe' && viewer.scene.globe.tilesLoaded) ||
              ownReady) &&
            frame.pending === 0
          ) {
            if (++settled >= 2) finish(true);
            else viewer.scene.requestRender();
          } else settled = 0;
          if (incoming === frame && frame.pending === 0 && frame.loaded > 0)
            viewer.scene.requestRender();
        });
        viewer.scene.requestRender();
        onChange();
      };
      if (global) {
        void acquireInfraredMosaic(time, {
          signal: frame.controller.signal,
          mode: infrared,
          createCanvas,
          fetchImpl,
          decodeImage,
          now,
          onFetched: () => {
            frame.mosaic.fetched = true;
          },
        })
          .then(({ texture, decodeMs }) => {
            frame.mosaic.decodeMs = decodeMs;
            install(texture);
          })
          .catch(() => finish(false));
      } else {
        try {
          install();
        } catch {
          finish(false);
        }
      }
      viewer.scene.requestRender();
      onChange();
      return result;
    },
    setHidden(value) {
      frameHidden = Boolean(value);
      if (frameHidden) {
        cancelIncoming();
        for (const frame of retiring) remove(frame);
      }
      rehome();
      viewer.scene.requestRender();
    },
    setAlpha(value) {
      alpha = value;
      if (current && current.layer.show) current.layer.alpha = alpha;
      viewer.scene.requestRender();
    },
    clear() {
      cancelIncoming();
      remove(current);
      for (const frame of retiring) remove(frame);
      current = null;
      frameHidden = false;
      lastError = null;
      viewer.scene.requestRender();
    },
    getDiagnostics() {
      return {
        imageryCount:
          Number(!!current) + Number(!!incoming?.layer) + retiring.size,
        mosaic: (incoming || current)?.mosaic,
        infrared: (incoming || current)?.infrared ?? 'filtered',
        loading: !!incoming,
        time: frameHidden ? null : (current?.time ?? null),
        hidden: frameHidden,
        product: current?.product ?? null,
        pendingTiles: incoming?.pending ?? 0,
        deferredTiles: incoming?.deferred.size ?? 0,
        loadedTiles: (incoming || current)?.loaded ?? 0,
        frameLoadMs: current?.loadMs ?? null,
        error: imageryHostStatus(getHost(), viewer.camera) || lastError,
      };
    },
  };
  return api;
}
