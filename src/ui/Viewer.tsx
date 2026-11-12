import { useEffect, useRef, useState } from 'react';
import { Renderer, type LutData } from '../engine/renderer';
import type { Settings } from '../engine/settings';

interface Props {
  bitmap: ImageBitmap | null;
  settings: Settings;
  lut: LutData | null;
  before: boolean;
  onHist: (bins: Uint32Array) => void;
}

export function Viewer({ bitmap, settings, lut, before, onHist }: Props) {
  const cv = useRef<HTMLCanvasElement>(null);
  const R = useRef<Renderer | null>(null);
  const view = useRef({ zoom: 1, x: 0, y: 0, fit: true });
  const latest = useRef({ settings, before, onHist });
  latest.current = { settings, before, onHist };
  const raf = useRef(0);
  const wantHist = useRef(false);
  const [zoomPct, setZoomPct] = useState(0);
  const [error, setError] = useState('');

  // 以下函式只讀寫 ref，所以在 effect 與事件中使用舊的閉包也安全。
  const draw = (hist = false) => {
    wantHist.current ||= hist;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const r = R.current;
      if (!r) return;
      const { settings: s, before: b, onHist: cb } = latest.current;
      r.render(s, view.current, b);
      setZoomPct(r.hasImage ? Math.round(view.current.zoom * 100) : 0);
      if (wantHist.current) {
        wantHist.current = false;
        cb(r.histogram(s, b));
      }
    });
  };

  const fit = () => {
    const r = R.current;
    const c = cv.current;
    if (!r?.hasImage || !c) return;
    const [ow, oh] = r.outSize(latest.current.settings);
    const z = Math.min(c.width / ow, c.height / oh) * 0.96;
    view.current = { zoom: z, x: (c.width - ow * z) / 2, y: (c.height - oh * z) / 2, fit: true };
  };

  const zoomAt = (cx: number, cy: number, z: number) => {
    const v = view.current;
    const nz = Math.min(16, Math.max(0.02, z));
    view.current = { zoom: nz, x: cx - ((cx - v.x) / v.zoom) * nz, y: cy - ((cy - v.y) / v.zoom) * nz, fit: false };
    draw();
  };

  useEffect(() => {
    const c = cv.current!;
    try {
      R.current = new Renderer(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const dpr = () => c.width / Math.max(1, c.clientWidth);
    const ro = new ResizeObserver(() => {
      const w = Math.max(1, Math.round(c.clientWidth * devicePixelRatio));
      const h = Math.max(1, Math.round(c.clientHeight * devicePixelRatio));
      if (c.width === w && c.height === h) return;
      c.width = w;
      c.height = h;
      if (view.current.fit) fit();
      draw();
    });
    ro.observe(c);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!R.current?.hasImage) return;
      const r = c.getBoundingClientRect();
      zoomAt((e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr(), view.current.zoom * Math.exp(-e.deltaY * 0.0015));
    };
    c.addEventListener('wheel', onWheel, { passive: false });

    let last: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      last = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!last) return;
      const k = dpr();
      view.current.x += (e.clientX - last.x) * k;
      view.current.y += (e.clientY - last.y) * k;
      view.current.fit = false;
      last = { x: e.clientX, y: e.clientY };
      draw();
    };
    const onUp = () => (last = null);
    const onDouble = (e: MouseEvent) => {
      if (!R.current?.hasImage) return;
      if (!view.current.fit) {
        fit();
        draw();
      } else {
        const r = c.getBoundingClientRect();
        zoomAt((e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr(), 1);
      }
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('dblclick', onDouble);

    return () => {
      ro.disconnect();
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('dblclick', onDouble);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      R.current?.dispose();
      R.current = null;
    };
  }, []);

  useEffect(() => {
    const r = R.current;
    if (!r) return;
    if (!bitmap) {
      r.clearImage();
      draw(true);
      return;
    }
    let dead = false;
    r.setImage(bitmap).then(
      () => {
        if (dead) return;
        fit();
        draw(true);
      },
      (e) => setError(String(e)),
    );
    return () => {
      dead = true;
    };
  }, [bitmap]);

  useEffect(() => {
    R.current?.setLut(lut);
    draw(true);
  }, [lut]);

  useEffect(() => {
    fit();
    draw(true);
  }, [settings.rotate]);

  useEffect(() => {
    draw(true);
  }, [settings, before]);

  return (
    <div className="viewer">
      <canvas ref={cv} />
      {error && <div className="viewer-error">{error}</div>}
      {before && zoomPct > 0 && <div className="badge left-badge">原始影像</div>}
      {zoomPct > 0 && <div className="badge">{zoomPct}%</div>}
    </div>
  );
}
