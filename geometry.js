export function containRect(naturalWidth, naturalHeight, viewportWidth, viewportHeight) {
  if (![naturalWidth, naturalHeight, viewportWidth, viewportHeight].every(x => x > 0)) return null;
  const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height };
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function pointToNormalized(x, y, rect) {
  return { x: clamp((x - rect.x) / rect.width, 0, 1), y: clamp((y - rect.y) / rect.height, 0, 1) };
}

export function pointFromNormalized(point, rect) {
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}

export function distanceToSegment(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function validDimension(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
}

export const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000 };

export function segmentPixels(a, b, imageWidth, imageHeight) {
  if (![a?.x, a?.y, b?.x, b?.y, imageWidth, imageHeight].every(Number.isFinite)) return NaN;
  return Math.hypot((b.x-a.x)*imageWidth,(b.y-a.y)*imageHeight);
}

// Only valid for distances on the same fronto-parallel plane as the reference.
export function estimateByReference(reference, target, imageWidth, imageHeight) {
  if (!reference || !target || reference.value == null || !validDimension(String(reference.value)) || !UNIT_TO_MM[reference.unit]) return null;
  const basePixels = segmentPixels(reference.a, reference.b, imageWidth, imageHeight);
  const targetPixels = segmentPixels(target.a, target.b, imageWidth, imageHeight);
  if (!(basePixels > 1) || !(targetPixels > 1)) return null;
  const millimetres = Number(reference.value)*UNIT_TO_MM[reference.unit]*targetPixels/basePixels;
  if (!Number.isFinite(millimetres) || millimetres <= 0) return null;
  const unit = target.unit && UNIT_TO_MM[target.unit] ? target.unit : reference.unit;
  const value = millimetres/UNIT_TO_MM[unit];
  return { value: Number(value.toPrecision(4)), unit };
}
