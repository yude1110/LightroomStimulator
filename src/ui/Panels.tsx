import { useState } from 'react';
import { DEFAULTS, pick, type BandKey, type Settings, type WheelKey } from '../engine/settings';
import { ColorWheel } from './ColorWheel';
import { CurveEditor } from './CurveEditor';
import { BandSliders, S, Slider } from './Slider';
import { useEdit } from './edit';

function Section(props: { title: string; keys: (keyof Settings)[]; open?: boolean; children: React.ReactNode }) {
  const { s, apply } = useEdit();
  const [open, setOpen] = useState(props.open ?? true);
  const changed = props.keys.some((k) => JSON.stringify(s[k]) !== JSON.stringify(DEFAULTS[k]));
  return (
    <section className="section">
      <header onClick={() => setOpen(!open)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="section-title">{props.title}</span>
        {changed && (
          <button
            className="ghost"
            onClick={(e) => {
              e.stopPropagation();
              apply(pick(DEFAULTS, props.keys));
            }}
          >
            重設
          </button>
        )}
      </header>
      {open && <div className="section-body">{props.children}</div>}
    </section>
  );
}

const TEMP_TRACK = 'linear-gradient(90deg,#3d7fd6,#8a8a8a,#e0b23a)';
const TINT_TRACK = 'linear-gradient(90deg,#4caf50,#8a8a8a,#c94fc0)';

function Basic() {
  const { s, apply } = useEdit();
  return (
    <Section
      title="基本"
      keys={[
        'temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
        'texture', 'clarity', 'dehaze', 'vibrance', 'saturation', 'bw',
      ]}
    >
      <div className="tabs">
        <button className={!s.bw ? 'on' : ''} onClick={() => s.bw && apply({ bw: false })}>
          彩色
        </button>
        <button className={s.bw ? 'on' : ''} onClick={() => !s.bw && apply({ bw: true })}>
          黑白
        </button>
      </div>
      <h4>白平衡</h4>
      <S k="temp" label="色溫" track={TEMP_TRACK} />
      <S k="tint" label="色調" track={TINT_TRACK} />
      <h4>光影</h4>
      <S k="exposure" label="曝光度" min={-5} max={5} step={0.01} />
      <S k="contrast" label="對比" />
      <S k="highlights" label="亮部" />
      <S k="shadows" label="陰影" />
      <S k="whites" label="白色" />
      <S k="blacks" label="黑色" />
      <h4>外觀</h4>
      <S k="texture" label="紋理" />
      <S k="clarity" label="清晰度" />
      <S k="dehaze" label="去朦朧" />
      <S k="vibrance" label="鮮豔度" />
      <S k="saturation" label="飽和度" />
    </Section>
  );
}

function ToneCurve() {
  return (
    <Section
      title="色調曲線"
      keys={['curves', 'paramHighlights', 'paramLights', 'paramDarks', 'paramShadows']}
      open={false}
    >
      <CurveEditor />
      <h4>區域</h4>
      <S k="paramHighlights" label="亮部" />
      <S k="paramLights" label="亮色調" />
      <S k="paramDarks" label="暗色調" />
      <S k="paramShadows" label="陰影" />
    </Section>
  );
}

function Mixer() {
  const { s } = useEdit();
  const [tab, setTab] = useState<BandKey>('hslHue');
  const tabs: [BandKey, string][] = [
    ['hslHue', '色相'],
    ['hslSat', '飽和度'],
    ['hslLum', '明度'],
  ];
  return (
    <Section title={s.bw ? '黑白混合' : '混色器'} keys={['hslHue', 'hslSat', 'hslLum', 'bwMix']} open={false}>
      {s.bw ? (
        <BandSliders field="bwMix" />
      ) : (
        <>
          <div className="tabs">
            {tabs.map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <BandSliders field={tab === 'bwMix' ? 'hslHue' : tab} />
        </>
      )}
    </Section>
  );
}

const HUE_TRACK = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';

function Grading() {
  const { s, set, commit } = useEdit();
  const [tab, setTab] = useState<WheelKey>('gradeShadows');
  const tabs: [WheelKey, string][] = [
    ['gradeShadows', '陰影'],
    ['gradeMidtones', '中間調'],
    ['gradeHighlights', '亮部'],
    ['gradeGlobal', '整體'],
  ];
  const w = s[tab];
  const active = (k: WheelKey) => s[k].s !== 0 || s[k].l !== 0;
  return (
    <Section
      title="顏色分級"
      keys={['gradeShadows', 'gradeMidtones', 'gradeHighlights', 'gradeGlobal', 'gradeBlending', 'gradeBalance']}
      open={false}
    >
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {active(k) && <i className="dot mark" />}
          </button>
        ))}
      </div>
      <ColorWheel value={w} onChange={(v) => set({ [tab]: v })} onCommit={commit} />
      <Slider label="色相" min={0} max={360} value={w.h} track={HUE_TRACK} onChange={(h) => set({ [tab]: { ...w, h } })} />
      <Slider label="飽和度" min={0} max={100} value={w.s} onChange={(v) => set({ [tab]: { ...w, s: v } })} />
      <Slider label="明度" value={w.l} onChange={(l) => set({ [tab]: { ...w, l } })} />
      <h4>範圍</h4>
      <S k="gradeBlending" label="混合" min={0} max={100} />
      <S k="gradeBalance" label="平衡" />
    </Section>
  );
}

export function Panels({ lutName }: { lutName?: string }) {
  const { s, apply } = useEdit();
  return (
    <>
      <Basic />
      <ToneCurve />
      <Mixer />
      <Grading />
      <Section title="細節" keys={['sharpen']} open={false}>
        <S k="sharpen" label="銳利化" min={0} max={150} />
      </Section>
      <Section
        title="效果"
        keys={['vignette', 'vignetteMidpoint', 'vignetteFeather', 'grain', 'grainSize']}
        open={false}
      >
        <h4>暈影</h4>
        <S k="vignette" label="數量" />
        <S k="vignetteMidpoint" label="中點" min={0} max={100} />
        <S k="vignetteFeather" label="羽化" min={0} max={100} />
        <h4>顆粒</h4>
        <S k="grain" label="數量" min={0} max={100} />
        <S k="grainSize" label="大小" min={0} max={100} />
      </Section>
      <Section
        title="校準"
        keys={['calRedHue', 'calRedSat', 'calGreenHue', 'calGreenSat', 'calBlueHue', 'calBlueSat']}
        open={false}
      >
        <h4>紅色原色</h4>
        <S k="calRedHue" label="色相" />
        <S k="calRedSat" label="飽和度" />
        <h4>綠色原色</h4>
        <S k="calGreenHue" label="色相" />
        <S k="calGreenSat" label="飽和度" />
        <h4>藍色原色</h4>
        <S k="calBlueHue" label="色相" />
        <S k="calBlueSat" label="飽和度" />
      </Section>
      {s.lutId && (
        <Section title="LUT" keys={['lutId', 'lutAmount']}>
          <div className="lut-row">
            <span>{lutName ?? '（找不到 LUT 資料）'}</span>
            <button className="ghost" onClick={() => apply({ lutId: null, lutAmount: 100 })}>
              移除
            </button>
          </div>
          <S k="lutAmount" label="強度" min={0} max={100} />
        </Section>
      )}
    </>
  );
}
