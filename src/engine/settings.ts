// 所有調整參數皆採用 Lightroom 的刻度（多數為 -100..100，曝光為 EV），
// 這樣匯入的預設不需換算即可直接套用。

export type Pt = [number, number]; // 0..1
export interface Curves {
  rgb: Pt[];
  r: Pt[];
  g: Pt[];
  b: Pt[];
}
export interface Wheel {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // -100..100
}

export const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export const BAND_LABELS = ['紅', '橙', '黃', '綠', '水綠', '藍', '紫', '洋紅'];
export const BAND_COLORS = ['#e5484d', '#f08c2e', '#e6c229', '#46a758', '#2bb5a8', '#3b82f6', '#8e4ec6', '#d6409f'];

export interface Settings {
  temp: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;

  curves: Curves;
  paramHighlights: number;
  paramLights: number;
  paramDarks: number;
  paramShadows: number;

  hslHue: number[];
  hslSat: number[];
  hslLum: number[];
  bw: boolean;
  bwMix: number[];

  gradeShadows: Wheel;
  gradeMidtones: Wheel;
  gradeHighlights: Wheel;
  gradeGlobal: Wheel;
  gradeBlending: number;
  gradeBalance: number;

  sharpen: number;
  vignette: number;
  vignetteMidpoint: number;
  vignetteFeather: number;
  grain: number;
  grainSize: number;

  calRedHue: number;
  calRedSat: number;
  calGreenHue: number;
  calGreenSat: number;
  calBlueHue: number;
  calBlueSat: number;

  lutId: string | null;
  lutAmount: number;

  rotate: number; // 0..3，順時針 90° 的次數
  flipH: boolean;
  flipV: boolean;
}

export type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
export type BandKey = 'hslHue' | 'hslSat' | 'hslLum' | 'bwMix';
export type WheelKey = 'gradeShadows' | 'gradeMidtones' | 'gradeHighlights' | 'gradeGlobal';

const zeros = () => [0, 0, 0, 0, 0, 0, 0, 0];
const linear = (): Pt[] => [
  [0, 0],
  [1, 1],
];
const wheel = (): Wheel => ({ h: 0, s: 0, l: 0 });

export function defaults(): Settings {
  return {
    temp: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vibrance: 0,
    saturation: 0,
    curves: { rgb: linear(), r: linear(), g: linear(), b: linear() },
    paramHighlights: 0,
    paramLights: 0,
    paramDarks: 0,
    paramShadows: 0,
    hslHue: zeros(),
    hslSat: zeros(),
    hslLum: zeros(),
    bw: false,
    bwMix: zeros(),
    gradeShadows: wheel(),
    gradeMidtones: wheel(),
    gradeHighlights: wheel(),
    gradeGlobal: wheel(),
    gradeBlending: 50,
    gradeBalance: 0,
    sharpen: 0,
    vignette: 0,
    vignetteMidpoint: 50,
    vignetteFeather: 50,
    grain: 0,
    grainSize: 25,
    calRedHue: 0,
    calRedSat: 0,
    calGreenHue: 0,
    calGreenSat: 0,
    calBlueHue: 0,
    calBlueSat: 0,
    lutId: null,
    lutAmount: 100,
    rotate: 0,
    flipH: false,
    flipV: false,
  };
}

export const DEFAULTS: Readonly<Settings> = defaults();

// 幾何屬於單張照片，不隨預設、複製貼上或重設而改變。
export const GEOMETRY_KEYS: (keyof Settings)[] = ['rotate', 'flipH', 'flipV'];

export function pick(src: Readonly<Settings>, keys: (keyof Settings)[]): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = structuredClone(src[k]);
  return out as Partial<Settings>;
}

/** 與預設值不同的調整（不含幾何），用於儲存預設與複製設定。 */
export function diffFromDefaults(s: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (GEOMETRY_KEYS.includes(k)) continue;
    if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULTS[k])) out[k] = structuredClone(s[k]);
  }
  return out as Partial<Settings>;
}

/** 所有調色參數（不含幾何）的完整副本。 */
export function lookOf(s: Settings): Partial<Settings> {
  const out = structuredClone(s) as Partial<Settings>;
  for (const k of GEOMETRY_KEYS) delete out[k];
  return out;
}
