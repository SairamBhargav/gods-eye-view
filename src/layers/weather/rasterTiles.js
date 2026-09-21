/** Tile a global geographic field raster without network requests or scene state. */
export function createRasterTileProvider({
  cesium,
  raster,
  credit,
  createCanvas,
}) {
  const texture = createCanvas();
  texture.width = raster.width;
  texture.height = raster.height;
  const context = texture.getContext('2d');
  const pixels = context.createImageData(raster.width, raster.height);
  pixels.data.set(raster.rgba);
  context.putImageData(pixels, 0, 0);
  const tilingScheme = new cesium.GeographicTilingScheme();
  return {
    tilingScheme,
    rectangle: cesium.Rectangle.MAX_VALUE,
    tileWidth: 256,
    tileHeight: 256,
    minimumLevel: 0,
    // Cesium 1.138 draping clamps coverage to maximumLevel - 1.
    maximumLevel: 2,
    ready: true,
    tileDiscardPolicy: undefined,
    credit,
    errorEvent: new cesium.Event(),
    hasAlphaChannel: true,
    getTileCredits: () => undefined,
    pickFeatures: () => undefined,
    requestImage(x, y, level) {
      const tile = createCanvas();
      tile.width = tile.height = 256;
      const ctx = tile.getContext('2d');
      const width = raster.width / tilingScheme.getNumberOfXTilesAtLevel(level);
      const height =
        raster.height / tilingScheme.getNumberOfYTilesAtLevel(level);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        texture,
        x * width,
        y * height,
        width,
        height,
        0,
        0,
        256,
        256,
      );
      return tile;
    },
  };
}
