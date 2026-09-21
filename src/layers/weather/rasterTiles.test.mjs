import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createRasterTileProvider } from './rasterTiles.js';
import { createFieldRaster } from '../wind/fields.js';

// A small canvas double exposes the uploaded raster and exact drawImage crop.
// Verify crop coordinates and source-cell selection independently of canvas smoothing.
function createCanvas() {
  const canvas = { width: 0, height: 0 };
  const context = {
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData(pixels) {
      canvas.rgba = pixels.data;
    },
    drawImage(source, ...args) {
      canvas.source = source;
      canvas.crop = args;
    },
    getImageData(x, y) {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = canvas.crop;
      const col = Math.floor(sx + ((x - dx + 0.5) * sw) / dw);
      const row = Math.floor(sy + ((y - dy + 0.5) * sh) / dh);
      const offset = (row * canvas.source.width + col) * 4;
      return { data: canvas.source.rgba.slice(offset, offset + 4) };
    },
  };
  canvas.getContext = () => context;
  return canvas;
}

test('real Cesium geographic raster provider crops level 0/1 wind tiles with preserved pixels', () => {
  const raster = createFieldRaster(
    {
      nx: 8,
      ny: 3,
      lo1: -180,
      la1: 90,
      dx: 45,
      dy: 90,
      u: Float32Array.from([
        0, 0, 10, 10, 20, 20, 30, 30, 0, 0, 10, 10, 20, 20, 30, 30, 30, 30, 20,
        20, 10, 10, 0, 0,
      ]),
      v: new Float32Array(24),
    },
    'speed',
    720,
    362,
  );
  const credit = new Cesium.Credit('NOAA GFS');
  const provider = createRasterTileProvider({
    cesium: Cesium,
    raster,
    credit,
    createCanvas,
  });
  assert.ok(provider.tilingScheme instanceof Cesium.GeographicTilingScheme);
  assert.equal(provider.rectangle, Cesium.Rectangle.MAX_VALUE);
  assert.equal(provider.minimumLevel, 0);
  assert.equal(provider.maximumLevel, 2);
  assert.equal(provider.tileWidth, 256);
  assert.equal(provider.tileHeight, 256);
  assert.equal(provider.ready, true);
  assert.equal(provider.hasAlphaChannel, true);
  assert.equal(provider.credit, credit);
  assert.ok(provider.errorEvent instanceof Cesium.Event);
  assert.equal(provider.tileDiscardPolicy, undefined);
  assert.equal(provider.getTileCredits(0, 0, 0), undefined);
  assert.equal(provider.pickFeatures(0, 0, 0, 0, 0), undefined);
  for (const [x, y, level, crop, cell] of [
    [0, 0, 0, [0, 0, 360, 362, 0, 0, 256, 256], [90, 91]],
    [1, 0, 0, [360, 0, 360, 362, 0, 0, 256, 256], [450, 91]],
    [0, 0, 1, [0, 0, 180, 181, 0, 0, 256, 256], [45, 45]],
    [3, 1, 1, [540, 181, 180, 181, 0, 0, 256, 256], [585, 226]],
  ]) {
    const tile = provider.requestImage(x, y, level);
    assert.equal(tile.width, 256);
    assert.equal(tile.height, 256);
    assert.equal(tile.getContext('2d').imageSmoothingEnabled, true);
    assert.deepEqual(tile.crop, crop);
    const offset = (cell[1] * 720 + cell[0]) * 4;
    assert.deepEqual(
      tile.getContext('2d').getImageData(64, 64).data,
      raster.rgba.slice(offset, offset + 4),
    );
  }
});
