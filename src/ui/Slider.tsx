import { useEffect, useRef } from 'react';
import { BAND_COLORS, BAND_LABELS, DEFAULTS, type BandKey, type NumKey } from '../engine/settings';
import { useEdit } from './edit';

interface Props {
  label: React.ReactNode;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  def?: number;
  track?: string; // 軌道的 CSS 漸層
  onChange: (v: number) => void;
}

export function Slider({ label, value, min = -100, max = 100, step = 1, def = 0, track, onChange }: Props) {
  const { commit } = useEdit();
  const ref = useRef<HTMLInputElement>(null);

  // 原生 change 事件只在放開滑桿時觸發，正好當作復原步驟的邊界。
  useEffect(() => {
    const el = ref.current!;
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [commit]);

  const text = (min < 0 && value > 0 ? '+' : '') + (step < 1 ? value.toFixed(2) : String(Math.round(value)));
  const reset = () => {
    onChange(def);
    commit();
  };

  return (
    <div className={'slider' + (value !== def ? ' changed' : '')} onDoubleClick={reset} title="按兩下重設">
      <span className="slider-label">{label}</span>
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={track ? { background: track } : undefined}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        onChange={() => {}}
      />
      <span className="slider-value">{text}</span>
    </div>
  );
}

/** 直接綁定某個數值設定的滑桿。 */
export function S(props: { k: NumKey; label: string; min?: number; max?: number; step?: number; track?: string }) {
  const { s, set } = useEdit();
  const { k, ...rest } = props;
  return <Slider {...rest} value={s[k]} def={DEFAULTS[k]} onChange={(v) => set({ [k]: v })} />;
}

/** 八個色相帶各一條滑桿。 */
export function BandSliders({ field }: { field: BandKey }) {
  const { s, set } = useEdit();
  return (
    <>
      {BAND_LABELS.map((label, i) => (
        <Slider
          key={i}
          label={
            <>
              <i className="dot" style={{ background: BAND_COLORS[i] }} />
              {label}
            </>
          }
          value={s[field][i]}
          onChange={(v) => set({ [field]: s[field].map((x, j) => (j === i ? v : x)) })}
        />
      ))}
    </>
  );
}
