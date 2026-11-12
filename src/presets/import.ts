import { BANDS, DEFAULTS, defaults, type Pt, type Settings, type Wheel } from '../engine/settings';
import type { LutData } from '../engine/renderer';

export interface Preset {
  id: string;
  name: string;
  group: string;
  settings: Partial<Settings>;
  builtin?: boolean;
}

export interface ImportResult {
  presets: Preset[];
  luts: LutData[];
  errors: string[];
}

type Raw = Map<string, string | string[]>;

const newId = () => crypto.randomUUID();
const baseName = (file: string) => file.replace(/\.[^.]+$/, '');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** 把 Camera Raw 的鍵值（XMP 與 lrtemplate 共用）轉成本程式的設定。 */
function mapCameraRaw(raw: Raw): Partial<Settings> {
  const out: Partial<Settings> = {};
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = raw.get(k);
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    }
    return undefined;
  };
  const put = (key: keyof Settings, ...src: string[]) => {
    const v = num(...src);
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  };

  // 絕對色溫（Kelvin）只對 RAW 有意義，這裡只採用相對偏移。
  put('temp', 'IncrementalTemperature');
  put('tint', 'IncrementalTint');
  put('exposure', 'Exposure2012', 'Exposure');
  put('contrast', 'Contrast2012');
  put('highlights', 'Highlights2012');
  put('shadows', 'Shadows2012');
  put('whites', 'Whites2012');
  put('blacks', 'Blacks2012');
  put('texture', 'Texture');
  put('clarity', 'Clarity2012', 'Clarity');
  put('dehaze', 'Dehaze');
  put('vibrance', 'Vibrance');
  put('saturation', 'Saturation');
  put('paramShadows', 'ParametricShadows');
  put('paramDarks', 'ParametricDarks');
  put('paramLights', 'ParametricLights');
  put('paramHighlights', 'ParametricHighlights');
  put('sharpen', 'Sharpness');
  put('grain', 'GrainAmount');
  put('grainSize', 'GrainSize');
  put('vignette', 'PostCropVignetteAmount');
  put('vignetteMidpoint', 'PostCropVignetteMidpoint');
  put('vignetteFeather', 'PostCropVignetteFeather');
  put('calRedHue', 'RedHue');
  put('calRedSat', 'RedSaturation');
  put('calGreenHue', 'GreenHue');
  put('calGreenSat', 'GreenSaturation');
  put('calBlueHue', 'BlueHue');
  put('calBlueSat', 'BlueSaturation');
  put('gradeBlending', 'ColorGradeBlending');
  put('gradeBalance', 'SplitToningBalance');

  // 色調曲線
  const curve = (...keys: string[]): Pt[] | undefined => {
    for (const k of keys) {
      const v = raw.get(k);
      if (!Array.isArray(v)) continue;
      const nums = v.flatMap((li) => li.split(',').map((x) => Number(x.trim()))).filter((x) => isFinite(x));
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] / 255, nums[i + 1] / 255]);
      if (pts.length >= 2) return pts;
    }
    return undefined;
  };
  const rgb = curve('ToneCurvePV2012', 'ToneCurve');
  const r = curve('ToneCurvePV2012Red', 'ToneCurveRed');
  const g = curve('ToneCurvePV2012Green', 'ToneCurveGreen');
  const b = curve('ToneCurvePV2012Blue', 'ToneCurveBlue');
  if (rgb || r || g || b) {
    const d = defaults().curves;
    out.curves = { rgb: rgb ?? d.rgb, r: r ?? d.r, g: g ?? d.g, b: b ?? d.b };
  }

  // 混色器
  const bands = (prefix: string): number[] | undefined => {
    const vals = BANDS.map((n) => num(prefix + cap(n)));
    return vals.some((v) => v !== undefined) ? vals.map((v) => v ?? 0) : undefined;
  };
  const hue = bands('HueAdjustment');
  const sat = bands('SaturationAdjustment');
  const lum = bands('LuminanceAdjustment');
  const mix = bands('GrayMixer');
  if (hue) out.hslHue = hue;
  if (sat) out.hslSat = sat;
  if (lum) out.hslLum = lum;
  if (mix) out.bwMix = mix;

  const gray = raw.get('ConvertToGrayscale');
  const treatment = raw.get('Treatment');
  if (typeof gray === 'string') out.bw = /^true$/i.test(gray);
  if (typeof treatment === 'string' && /black/i.test(treatment)) out.bw = true;

  // 顏色分級（陰影/亮部的色相與飽和度沿用舊的 SplitToning 鍵）
  const wheel = (h?: number, s?: number, l?: number): Wheel | undefined =>
    h === undefined && s === undefined && l === undefined ? undefined : { h: h ?? 0, s: s ?? 0, l: l ?? 0 };
  const ws = wheel(num('SplitToningShadowHue'), num('SplitToningShadowSaturation'), num('ColorGradeShadowLum'));
  const wm = wheel(num('ColorGradeMidtoneHue'), num('ColorGradeMidtoneSat'), num('ColorGradeMidtoneLum'));
  const wh = wheel(num('SplitToningHighlightHue'), num('SplitToningHighlightSaturation'), num('ColorGradeHighlightLum'));
  const wg = wheel(num('ColorGradeGlobalHue'), num('ColorGradeGlobalSat'), num('ColorGradeGlobalLum'));
  if (ws) out.gradeShadows = ws;
  if (wm) out.gradeMidtones = wm;
  if (wh) out.gradeHighlights = wh;
  if (wg) out.gradeGlobal = wg;

  return out;
}

function altText(el: Element): string {
  const li = el.getElementsByTagName('rdf:li')[0];
  return (li?.textContent ?? el.textContent ?? '').trim();
}

export function parseXmp(text: string, file: string): Preset {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XMP 格式錯誤');
  const raw: Raw = new Map();
  let name = '';
  let group = '';
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.nodeName === 'rdf:Description') {
      for (const a of Array.from(el.attributes)) {
        if (a.name.startsWith('crs:')) raw.set(a.name.slice(4), a.value);
      }
    } else if (el.nodeName.startsWith('crs:')) {
      const key = el.nodeName.slice(4);
      if (key === 'Name') name = altText(el);
      else if (key === 'Group') group = altText(el);
      else {
        const lis = Array.from(el.getElementsByTagName('rdf:li'));
        if (lis.length) raw.set(key, lis.map((li) => li.textContent ?? ''));
        else if (!el.children.length) raw.set(key, (el.textContent ?? '').trim());
      }
    }
  }
  if (!raw.size) throw new Error('找不到 Camera Raw 設定');
  return { id: newId(), name: name || baseName(file), group: group || '匯入的預設', settings: mapCameraRaw(raw) };
}

/** Lightroom Classic 舊版的 .lrtemplate（Lua 表格文字）。 */
export function parseLrTemplate(text: string, file: string): Preset {
  const raw: Raw = new Map();
  for (const m of text.matchAll(/(\w+)\s*=\s*\{([^{}]*)\}/g)) {
    const nums = m[2].split(',').map((x) => x.trim()).filter((x) => x !== '' && isFinite(Number(x)));
    if (nums.length >= 4) raw.set(m[1], nums);
  }
  for (const m of text.matchAll(/(\w+)\s*=\s*(-?\d+(?:\.\d+)?|true|false|"[^"]*")\s*,/g)) {
    raw.set(m[1], m[2].replace(/^"|"$/g, ''));
  }
  const title = raw.get('title') ?? raw.get('internalName');
  const settings = mapCameraRaw(raw);
  if (!Object.keys(settings).length) throw new Error('找不到可用的設定');
  return {
    id: newId(),
    name: typeof title === 'string' && title ? title : baseName(file),
    group: '匯入的預設',
    settings,
  };
}

export function parseCube(text: string): { size: number; data: Float32Array } {
  let size = 0;
  const vals: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line[0] === '#') continue;
    if (/^[A-Za-z_]/.test(line)) {
      const [k, v] = line.split(/\s+/);
      if (k === 'LUT_3D_SIZE') size = parseInt(v, 10);
      else if (k === 'LUT_1D_SIZE') throw new Error('不支援 1D LUT');
      continue;
    }
    const p = line.split(/\s+/);
    if (p.length >= 3) vals.push(Number(p[0]), Number(p[1]), Number(p[2]));
  }
  if (size < 2 || size > 256 || vals.length !== size ** 3 * 3 || vals.some((v) => !isFinite(v))) {
    throw new Error('LUT 資料不完整');
  }
  return { size, data: new Float32Array(vals) };
}

function parseJson(text: string, file: string): Preset[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [data];
  return list.map((p) => {
    if (!p || typeof p.settings !== 'object' || p.settings === null) throw new Error('不是預設檔');
    const settings: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULTS)) if (k in p.settings && k !== 'lutId') settings[k] = p.settings[k];
    return {
      id: newId(),
      name: String(p.name || baseName(file)),
      group: String(p.group || '匯入的預設'),
      settings: settings as Partial<Settings>,
    };
  });
}

export async function importPresetFiles(files: File[]): Promise<ImportResult> {
  const res: ImportResult = { presets: [], luts: [], errors: [] };
  for (const f of files) {
    try {
      const text = await f.text();
      const ext = f.name.split('.').pop()!.toLowerCase();
      if (ext === 'xmp') res.presets.push(parseXmp(text, f.name));
      else if (ext === 'lrtemplate') res.presets.push(parseLrTemplate(text, f.name));
      else if (ext === 'json') res.presets.push(...parseJson(text, f.name));
      else if (ext === 'cube') {
        const lut: LutData = { id: newId(), ...parseCube(text) };
        res.luts.push(lut);
        res.presets.push({
          id: newId(),
          name: baseName(f.name),
          group: 'LUT',
          settings: { lutId: lut.id, lutAmount: 100 },
        });
      }
    } catch (e) {
      res.errors.push(`${f.name}：${e instanceof Error ? e.message : '無法解析'}`);
    }
  }
  return res;
}
