import { readResponseBytesCapped } from '../../sources/httpBody.js';
import { weatherImageUrl } from './source.js';
import { infraredAlpha } from './infraredAlpha.js';

export const MAX_MOSAIC_BYTES = 4 * 1024 * 1024;

/** Apply the display transfer once to a decoded image. */
export function processInfraredImage(image, mode, createCanvas) {
  const canvas = createCanvas();
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(infraredAlpha(pixels.data, mode));
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** Decode locally, releasing the object URL on success, failure or cancellation. */
export function decodeInfraredImage(blob, signal) {
  signal.throwIfAborted();
  if (typeof globalThis.createImageBitmap === 'function')
    return globalThis.createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      URL.revokeObjectURL(url);
    };
    const abort = () => {
      cleanup();
      image.src = '';
      reject(signal.reason);
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Infrared decode failed'));
    };
    signal.addEventListener('abort', abort, { once: true });
    image.src = url;
  });
}

/** Acquire one capped global mosaic before adding any imagery layer. */
export async function acquireInfraredMosaic(
  time,
  {
    signal,
    mode,
    createCanvas,
    fetchImpl,
    decodeImage = decodeInfraredImage,
    now = () => performance.now(),
    onFetched = () => {},
  },
) {
  const response = await fetchImpl(weatherImageUrl(time), { signal });
  if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
  const bytes = await readResponseBytesCapped(response, MAX_MOSAIC_BYTES);
  signal.throwIfAborted();
  onFetched();
  const started = now();
  const image = await decodeImage(
    new Blob([bytes], { type: 'image/png' }),
    signal,
  );
  try {
    signal.throwIfAborted();
    if (image.width !== 2048 || image.height !== 1024)
      throw new Error('Invalid infrared mosaic dimensions');
    const texture = processInfraredImage(image, mode, createCanvas);
    return { texture, decodeMs: now() - started };
  } finally {
    image.close?.();
  }
}
