import { useMemo, useRef, useState } from 'react';
import { makeSpline } from '../engine/curve';
import type { Curves, Pt } from '../engine/settings';
import { useEdit } from './edit';

const CHANNELS: { key: keyof Curves; label: string; color: string }[] = [
  { key: 'rgb', label: 'RGB', color: '#e8e8e8' },
  { key: 'r', label: '紅', color: '#ff5d5d' },
  { key: 'g', label: '綠', color: '#5fd068' },
  { key: 'b', label: '藍', color: '#5b9dff' },
];
const N = 256;
const HIT = 14;

export function CurveEditor() {
  const { s, set, commit, apply } = useEdit();
  const [ch, setCh] = useState<keyof Curves>('rgb');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = s.curves[ch];
  const color = CHANNELS.find((c) => c.key === ch)!.color;

  const path = useMemo(() => {
    const f = makeSpline(pts);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${(x * N).toFixed(1)},${((1 - Math.min(1, Math.max(0, f(x)))) * N).toFixed(1)}`;
    }
    return d;
  }, [pts]);

  const update = (next: Pt[]) => set({ curves: { ...s.curves, [ch]: next } });

  const pos = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    ];
  };
  const nearest = (p: Pt) => {
    const r = svg.current!.getBoundingClientRect();
    let best = -1;
    let bd = HIT;
    pts.forEach((q, i) => {
      const d = Math.hypot((q[0] - p[0]) * r.width, (q[1] - p[1]) * r.height);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pos(e);
    let i = nearest(p);
    if (i < 0) {
      i = pts.findIndex((q) => q[0] > p[0]);
      if (i < 0) i = pts.length;
      update([...pts.slice(0, i), p, ...pts.slice(i)]);
    }
    drag.current = i;
    svg.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const i = drag.current;
    if (i === null || !pts[i]) return;
    const p = pos(e);
    const lo = i > 0 ? pts[i - 1][0] + 0.01 : 0;
    const hi = i < pts.length - 1 ? pts[i + 1][0] - 0.01 : 1;
    update(pts.map((q, j) => (j === i ? [Math.min(hi, Math.max(lo, p[0])), p[1]] : q)));
  };
  const onUp = () => {
    if (drag.current === null) return;
    drag.current = null;
    commit();
  };
  const onDouble = (e: React.MouseEvent) => {
    const i = nearest(pos(e));
    if (i > 0 && i < pts.length - 1) apply({ curves: { ...s.curves, [ch]: pts.filter((_, j) => j !== i) } });
  };

  return (
    <div className="curve">
      <div className="tabs">
        {CHANNELS.map((c) => (
          <button key={c.key} className={ch === c.key ? 'on' : ''} onClick={() => setCh(c.key)}>
            {c.label}
          </button>
        ))}
        <button
          className="ghost"
          onClick={() =>
            apply({
              curves: {
                ...s.curves,
                [ch]: [
                  [0, 0],
                  [1, 1],
                ],
              },
            })
          }
        >
          重設
        </button>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${N} ${N}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDouble}
      >
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v} className="grid">
            <line x1={v * N} y1={0} x2={v * N} y2={N} />
            <line x1={0} y1={v * N} x2={N} y2={v * N} />
          </g>
        ))}
        <line className="grid" x1={0} y1={N} x2={N} y2={0} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0] * N} cy={(1 - p[1]) * N} r={4.5} fill="#1c1c1e" stroke={color} strokeWidth={1.5} />
        ))}
      </svg>
      <div className="hint">點擊新增控制點，拖曳調整，按兩下刪除</div>
    </div>
  );
}
