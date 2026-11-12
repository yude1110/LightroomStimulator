import { useRef } from 'react';
import type { Wheel } from '../engine/settings';

interface Props {
  value: Wheel;
  onChange: (w: Wheel) => void;
  onCommit: () => void;
}

/** 色相為角度（紅在右、逆時針遞增）、飽和度為半徑的色輪。 */
export function ColorWheel({ value, onChange, onCommit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const h = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(100, (Math.hypot(dx, dy) / (r.width / 2)) * 100);
    onChange({ ...value, h: Math.round(h), s: Math.round(s) });
  };

  const a = (value.h * Math.PI) / 180;
  const k = value.s / 100;
  return (
    <div
      ref={ref}
      className="wheel"
      onPointerDown={(e) => {
        dragging.current = true;
        ref.current!.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => dragging.current && update(e)}
      onPointerUp={() => {
        dragging.current = false;
        onCommit();
      }}
      onDoubleClick={() => {
        onChange({ ...value, h: 0, s: 0 });
        onCommit();
      }}
    >
      <div
        className="wheel-knob"
        style={{ left: `${50 + Math.cos(a) * k * 50}%`, top: `${50 - Math.sin(a) * k * 50}%` }}
      />
    </div>
  );
}
