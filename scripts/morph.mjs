import { assert, sample } from './core.mjs';

function solve(A, b) {
  A = A.map((r, i) => [...r, b[i]]); const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[p], A[c]] = [A[c], A[p]]; const d = A[c][c];
    assert(Math.abs(d) > 1e-12, 'Degenerate landmarks: remove duplicate/collapsed control points');
    for (let k = c; k <= n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map(r => r[n]);
}
const U = (x, y) => { const r = x * x + y * y; return r > 1e-12 ? r * Math.log(r) : 0; };

export function tps(dst, src) {
  const n = dst.length, N = n + 3, M = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = U(dst[i][0] - dst[j][0], dst[i][1] - dst[j][1]) + (i === j ? 1e-7 : 0);
    M[i][n] = M[n][i] = 1; M[i][n + 1] = M[n + 1][i] = dst[i][0]; M[i][n + 2] = M[n + 2][i] = dst[i][1];
  }
  const cx = solve(M, [...src.map(p => p[0]), 0, 0, 0]), cy = solve(M, [...src.map(p => p[1]), 0, 0, 0]);
  return (x, y, out) => {
    out[0] = cx[n] + cx[n + 1] * x + cx[n + 2] * y; out[1] = cy[n] + cy[n + 1] * x + cy[n + 2] * y;
    for (let k = 0; k < n; k++) { const u = U(x - dst[k][0], y - dst[k][1]); out[0] += cx[k] * u; out[1] += cy[k] * u; }
  };
}

function distance(data, size, inside) {
  const d = new Float32Array(size * size), rt = Math.SQRT2;
  // Material opacity is not a silhouette mask: translucent fabric is still inside.
  for (let p = 0; p < d.length; p++) d[p] = ((data[p * 4 + 3] > 0) === inside) ? 0 : size * 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * size + x; let v = d[p];
    if (x) v = Math.min(v, d[p - 1] + 1); if (y) v = Math.min(v, d[p - size] + 1);
    if (x && y) v = Math.min(v, d[p - size - 1] + rt); if (x < size - 1 && y) v = Math.min(v, d[p - size + 1] + rt); d[p] = v;
  }
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
    const p = y * size + x; let v = d[p];
    if (x < size - 1) v = Math.min(v, d[p + 1] + 1); if (y < size - 1) v = Math.min(v, d[p + size] + 1);
    if (x < size - 1 && y < size - 1) v = Math.min(v, d[p + size + 1] + rt); if (x && y < size - 1) v = Math.min(v, d[p + size - 1] + rt); d[p] = v;
  }
  return d;
}
export function signedDistance(data, size) {
  const outside = distance(data, size, true), inside = distance(data, size, false);
  for (let i = 0; i < outside.length; i++) outside[i] = inside[i] - outside[i]; return outside;
}
function scalar(d, size, x, y) {
  if (x < 0 || y < 0 || x >= size - 1 || y >= size - 1) return -size;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  return (d[y0 * size + x0] * (1 - tx) + d[y0 * size + x0 + 1] * tx) * (1 - ty) + (d[(y0 + 1) * size + x0] * (1 - tx) + d[(y0 + 1) * size + x0 + 1] * tx) * ty;
}

export function validatePoints(a, b) {
  assert(Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.length >= 3 && a.length <= 64, 'A transition needs 3..64 corresponding point pairs');
  for (const list of [a, b]) {
    assert(list.every(p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && v > 0 && v < 1)), 'Landmarks use normalized canonical coordinates strictly inside (0,1)');
    assert(new Set(list.map(p => p.join(','))).size === list.length, 'Duplicate landmarks');
  }
}

export function morph(A, B, size, pa, pb, t, sa, sb) {
  if (t <= 1e-10) return Buffer.from(A); if (t >= 1 - 1e-10) return Buffer.from(B);
  validatePoints(pa, pb);
  const boundary = [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]];
  pa = [...boundary, ...pa]; pb = [...boundary, ...pb];
  const dst = pa.map((p, i) => [p[0] * (1 - t) + pb[i][0] * t, p[1] * (1 - t) + pb[i][1] * t]);
  const fa = tps(dst, pa), fb = tps(dst, pb), out = Buffer.alloc(size * size * 4);
  const aa = new Float64Array(2), bb = new Float64Array(2), ca = new Float64Array(4), cb = new Float64Array(4);
  sa ??= signedDistance(A, size); sb ??= signedDistance(B, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fa((x + .5) / size, (y + .5) / size, aa); fb((x + .5) / size, (y + .5) / size, bb);
    aa[0] = aa[0] * size - .5; aa[1] = aa[1] * size - .5; bb[0] = bb[0] * size - .5; bb[1] = bb[1] * size - .5;
    sample(A, size, size, ...aa, ca); sample(B, size, size, ...bb, cb);
    const w = ca[3] * (1 - t) + cb[3] * t;
    const sd = scalar(sa, size, ...aa) * (1 - t) + scalar(sb, size, ...bb) * t;
    // The contour may suppress outlying coverage, never increase material opacity.
    const contour = Math.max(0, Math.min(1, .5 + sd / 2));
    const alpha = Math.min(contour, w), p = (y * size + x) * 4;
    out[p + 3] = Math.round(alpha * 255);
    if (w > 1e-6) for (let c = 0; c < 3; c++) out[p + c] = Math.round(Math.min(255, Math.max(0, (ca[c] * (1 - t) + cb[c] * t) / w)));
  }
  return out;
}
