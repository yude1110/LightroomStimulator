import type { Pt, Settings } from './settings';

/** 單調三次樣條（Fritsch–Carlson），不會在控制點之間過衝。 */
export function makeSpline(pts: Pt[]): (x: number) => number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => p[0][1];
  const dx: number[] = [];
  const m: number[] = [];
  const t = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(p[i + 1][0] - p[i][0], 1e-6);
    m[i] = (p[i + 1][1] - p[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      t[i] = (3 * a * m[i]) / h;
      t[i + 1] = (3 * b * m[i]) / h;
    }
  }
  return (x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > p[i + 1][0]) i++;
    const h = dx[i];
    const s = (x - p[i][0]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * p[i][1] +
      (s3 - 2 * s2 + s) * h * t[i] +
      (-2 * s3 + 3 * s2) * p[i + 1][1] +
      (s3 - s2) * h * t[i + 1]
    );
  };
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
// 在 a 與 b 歸零、於 p 達到峰值的平滑視窗
const bump = (x: number, a: number, p: number, b: number) =>
  x < p ? smooth((x - a) / (p - a)) : smooth((b - x) / (b - p));

/** 參數曲線：四個區域各自推拉，端點固定。 */
export function parametric(s: Settings): (x: number) => number {
  const sh = s.paramShadows / 100;
  const dk = s.paramDarks / 100;
  const lt = s.paramLights / 100;
  const hl = s.paramHighlights / 100;
  if (!sh && !dk && !lt && !hl) return (x) => x;
  return (x) =>
    x +
    0.12 *
      (sh * bump(x, 0, 0.2, 0.5) +
        dk * bump(x, 0, 0.375, 0.75) +
        lt * bump(x, 0.25, 0.625, 1) +
        hl * bump(x, 0.5, 0.8, 1));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 256×1 RGBA 查表：每個通道 = 通道曲線(主曲線(參數曲線(x)))。 */
export function buildCurveLut(s: Settings): Float32Array {
  const par = parametric(s);
  const master = makeSpline(s.curves.rgb);
  const ch = [makeSpline(s.curves.r), makeSpline(s.curves.g), makeSpline(s.curves.b)];
  const out = new Float32Array(256 * 4);
  let prev = 0;
  for (let i = 0; i < 256; i++) {
    // 多個區域疊加時仍保證單調
    prev = Math.max(prev, clamp01(par(i / 255)));
    const m = clamp01(master(prev));
    for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp01(ch[c](m));
    out[i * 4 + 3] = 1;
  }
  return out;
}
