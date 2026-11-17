import test from 'node:test';
import assert from 'node:assert/strict';
import { containRect, pointFromNormalized, pointToNormalized, distanceToSegment, validDimension } from '../geometry.js';

test('portrait photo fits on wide canvas and normalized points round-trip', () => {
  const rect = containRect(900, 1200, 600, 450);
  assert.deepEqual(rect, { x: 131.25, y: 0, width: 337.5, height: 450 });
  const point = { x: .15, y: .91 };
  const restored = pointToNormalized(...Object.values(pointFromNormalized(point, rect)), rect);
  assert.ok(Math.abs(restored.x - point.x) < 1e-9 && Math.abs(restored.y - point.y) < 1e-9);
});
test('hit testing returns distance to segment, not infinite line', () => {
  assert.equal(distanceToSegment({ x: 50, y: 25 }, { x: 0, y: 0 }, { x: 100, y: 0 }), 25);
  assert.equal(distanceToSegment({ x: 120, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }), 20);
});
test('dimension must be a positive finite number', () => {
  assert.equal(validDimension('10.5'), true);
  for (const bad of ['', '0', '-2', 'abc', 'Infinity']) assert.equal(validDimension(bad), false);
});
