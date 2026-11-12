import { buildCurveLut } from './curve';
import { BLUR_FRAG, MAIN_FRAG, VERT } from './shader';
import type { Settings, Wheel } from './settings';

export interface LutData {
  id: string;
  size: number;
  data: Float32Array; // size³ × RGB，紅色變化最快
}

export interface View {
  zoom: number; // 影像像素 → 畫布像素
  x: number; // 影像原點在畫布上的位置
  y: number;
}

export interface ExportOptions {
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  quality: number;
  longEdge: number | null;
}

const BG: [number, number, number] = [0.085, 0.085, 0.09];
const LW = [0.2126, 0.7152, 0.0722];

function hueToRgb(h: number): number[] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function gradeOffset(w: Wheel): number[] {
  const c = hueToRgb(w.h);
  const l = c[0] * LW[0] + c[1] * LW[1] + c[2] * LW[2];
  return c.map((v) => (v - l) * (w.s / 100) * 0.35 + (w.l / 100) * 0.25);
}

function wbGains(s: Settings): number[] {
  const t = s.temp / 100;
  const n = s.tint / 100;
  const g = [Math.exp(0.3 * t + 0.08 * n), Math.exp(-0.22 * n), Math.exp(-0.3 * t + 0.08 * n)];
  const l = g[0] * LW[0] + g[1] * LW[1] + g[2] * LW[2];
  return g.map((v) => v / l);
}

// 近似 Camera Calibration：移動三原色的色相與飽和度，並保持白點不變。
function calibMatrix(s: Settings): Float32Array {
  const prim = (idx: number, hue: number, sat: number) => {
    const c = [0, 0, 0];
    c[idx] = 1;
    const h = (hue / 100) * 0.3;
    if (h > 0) c[(idx + 1) % 3] += h;
    else c[(idx + 2) % 3] -= h;
    const l = (c[0] + c[1] + c[2]) / 3;
    const k = 1 + (sat / 100) * 0.5;
    return c.map((v) => l + (v - l) * k);
  };
  const cols = [
    prim(0, s.calRedHue, s.calRedSat),
    prim(1, s.calGreenHue, s.calGreenSat),
    prim(2, s.calBlueHue, s.calBlueSat),
  ];
  const m = new Float32Array(9); // column-major
  for (let r = 0; r < 3; r++) {
    const sum = cols[0][r] + cols[1][r] + cols[2][r];
    for (let c = 0; c < 3; c++) m[c * 3 + r] = cols[c][r] / sum;
  }
  return m;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private main: WebGLProgram;
  private blur: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  private srcTex: WebGLTexture | null = null;
  private blurMid: WebGLTexture | null = null;
  private blurLarge: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutId: string | null = null;
  private lutSize = 2;
  private curveKey = '';
  private fbo: WebGLFramebuffer;
  private scratch: { tex: WebGLTexture; w: number; h: number } | null = null;
  srcW = 0;
  srcH = 0;

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
    this.gl = gl;
    this.main = this.program(VERT, MAIN_FRAG);
    this.blur = this.program(VERT, BLUR_FRAG);
    this.fbo = gl.createFramebuffer()!;
    gl.bindVertexArray(gl.createVertexArray());

    this.curveTex = this.tex2d();
    this.lutTex = gl.createTexture()!;
    this.setLut(null);
  }

  get hasImage() {
    return this.srcTex !== null;
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
    return p;
  }

  private tex2d(filter?: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter ?? gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private loc(prog: WebGLProgram, name: string) {
    const key = (prog === this.main ? 'm:' : 'b:') + name;
    let l = this.locs.get(key);
    if (l === undefined) {
      l = this.gl.getUniformLocation(prog, name);
      this.locs.set(key, l);
    }
    return l;
  }

  clearImage() {
    const gl = this.gl;
    for (const t of [this.srcTex, this.blurMid, this.blurLarge]) if (t) gl.deleteTexture(t);
    this.srcTex = this.blurMid = this.blurLarge = null;
    this.srcW = this.srcH = 0;
  }

  async setImage(bitmap: ImageBitmap) {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let bmp = bitmap;
    if (Math.max(bmp.width, bmp.height) > max) {
      const k = max / Math.max(bmp.width, bmp.height);
      bmp = await createImageBitmap(bitmap, {
        resizeWidth: Math.floor(bmp.width * k),
        resizeHeight: Math.floor(bmp.height * k),
        resizeQuality: 'high',
      });
    }
    this.clearImage();
    this.srcW = bmp.width;
    this.srcH = bmp.height;
    this.srcTex = this.tex2d(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (bmp !== bitmap) bmp.close();

    const long = Math.max(this.srcW, this.srcH);
    this.blurMid = this.buildBlur(Math.min(long, 1280), 2.5);
    this.blurLarge = this.buildBlur(Math.min(long, 320), 9);
  }

  private buildBlur(longEdge: number, sigma: number): WebGLTexture {
    const gl = this.gl;
    const k = longEdge / Math.max(this.srcW, this.srcH);
    const w = Math.max(1, Math.round(this.srcW * k));
    const h = Math.max(1, Math.round(this.srcH * k));
    const mk = () => {
      const t = this.tex2d();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    };
    const a = mk();
    const b = mk();
    gl.useProgram(this.blur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.uniform1f(this.loc(this.blur, 'uYFlip'), 1);
    gl.uniform1i(this.loc(this.blur, 'uTex'), 0);
    gl.uniform1f(this.loc(this.blur, 'uSigma'), sigma);
    gl.activeTexture(gl.TEXTURE0);
    const pass = (src: WebGLTexture, dst: WebGLTexture, mode: number, dx: number, dy: number) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(this.loc(this.blur, 'uMode'), mode);
      gl.uniform2f(this.loc(this.blur, 'uDir'), dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    pass(this.srcTex!, a, 0, 0, 0);
    pass(a, b, 1, 1 / w, 0);
    pass(b, a, 1, 0, 1 / h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(b);
    return a;
  }

  setLut(lut: LutData | null) {
    const gl = this.gl;
    let size = 2;
    let data: Float32Array;
    if (lut) {
      size = lut.size;
      data = lut.data;
    } else {
      data = new Float32Array(24);
      for (let i = 0; i < 8; i++) data.set([i & 1, (i >> 1) & 1, (i >> 2) & 1], i * 3);
    }
    this.lutId = lut ? lut.id : null;
    this.lutSize = size;
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  /** 套用旋轉後的輸出尺寸。 */
  outSize(s: Settings): [number, number] {
    return s.rotate % 2 ? [this.srcH, this.srcW] : [this.srcW, this.srcH];
  }

  private draw(s: Settings, scale: number[], offset: number[], yflip: boolean, bypass: boolean) {
    const gl = this.gl;
    const P = this.main;
    const f1 = (n: string, v: number) => gl.uniform1f(this.loc(P, n), v);
    const f2 = (n: string, a: number, b: number) => gl.uniform2f(this.loc(P, n), a, b);
    const f3 = (n: string, v: number[]) => gl.uniform3f(this.loc(P, n), v[0], v[1], v[2]);

    const key = JSON.stringify([s.curves, s.paramShadows, s.paramDarks, s.paramLights, s.paramHighlights]);
    if (key !== this.curveKey) {
      this.curveKey = key;
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, buildCurveLut(s));
    }

    gl.useProgram(P);
    const texs: [string, number, WebGLTexture | null][] = [
      ['uSrc', gl.TEXTURE_2D, this.srcTex],
      ['uBlurMid', gl.TEXTURE_2D, this.blurMid],
      ['uBlurLarge', gl.TEXTURE_2D, this.blurLarge],
      ['uCurve', gl.TEXTURE_2D, this.curveTex],
      ['uLut', gl.TEXTURE_3D, this.lutTex],
    ];
    texs.forEach(([name, target, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(target, tex);
      gl.uniform1i(this.loc(P, name), i);
    });
    gl.activeTexture(gl.TEXTURE0);

    const [ow, oh] = this.outSize(s);
    f1('uYFlip', yflip ? 1 : 0);
    f2('uViewScale', scale[0], scale[1]);
    f2('uViewOffset', offset[0], offset[1]);
    f2('uFlip', s.flipH ? 1 : 0, s.flipV ? 1 : 0);
    f2('uSrcTexel', 1 / this.srcW, 1 / this.srcH);
    f2('uOutSize', ow, oh);
    f3('uBg', BG);
    gl.uniform1i(this.loc(P, 'uRot'), ((s.rotate % 4) + 4) % 4);
    f1('uBypass', bypass ? 1 : 0);

    gl.uniformMatrix3fv(this.loc(P, 'uCalib'), false, calibMatrix(s));
    f3('uWb', wbGains(s));
    f1('uGain', Math.pow(2, s.exposure));
    f1('uDehaze', s.dehaze / 100);
    f1('uSharpen', (s.sharpen / 100) * 1.2);
    f1('uTexture', (s.texture / 100) * 0.8);
    f1('uClarity', (s.clarity / 100) * 0.9);
    f1('uContrastK', Math.exp((s.contrast / 100) * 0.7));
    f1('uHighlights', s.highlights / 100);
    f1('uShadows', s.shadows / 100);
    f1('uWhites', s.whites / 100);
    f1('uBlacks', s.blacks / 100);

    const band = new Float32Array(32);
    let bandOn = false;
    for (let i = 0; i < 8; i++) {
      band[i * 4] = ((s.hslHue[i] / 100) * 30) / 360;
      band[i * 4 + 1] = s.hslSat[i] / 100;
      band[i * 4 + 2] = s.hslLum[i] / 100;
      band[i * 4 + 3] = s.bwMix[i] / 100;
      if (s.hslHue[i] || s.hslSat[i] || s.hslLum[i]) bandOn = true;
    }
    gl.uniform4fv(this.loc(P, 'uBand'), band);
    f1('uBandOn', bandOn ? 1 : 0);
    f1('uBw', s.bw ? 1 : 0);
    f1('uVibrance', s.vibrance / 100);
    f1('uSaturation', s.saturation / 100);

    f3('uGradeS', gradeOffset(s.gradeShadows));
    f3('uGradeM', gradeOffset(s.gradeMidtones));
    f3('uGradeH', gradeOffset(s.gradeHighlights));
    f3('uGradeG', gradeOffset(s.gradeGlobal));
    f1('uGradeBlend', s.gradeBlending / 100);
    f1('uGradeBalance', s.gradeBalance / 100);

    // LUT 尚未載入（或已換成別的）時不套用，避免閃現錯誤的色彩
    f1('uLutAmount', s.lutId && s.lutId === this.lutId ? s.lutAmount / 100 : 0);
    f1('uLutSize', this.lutSize);

    f3('uVignette', [s.vignette / 100, s.vignetteMidpoint / 100, s.vignetteFeather / 100]);
    const cell = Math.max(0.5, (0.6 + (s.grainSize / 100) * 2.4) * (Math.max(ow, oh) / 3000));
    f2('uGrain', (s.grain / 100) * 0.22, cell);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 畫到螢幕畫布。 */
  render(s: Settings, view: View, bypass = false) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    if (!this.srcTex) {
      gl.clearColor(BG[0], BG[1], BG[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const [ow, oh] = this.outSize(s);
    this.draw(
      s,
      [cw / (view.zoom * ow), ch / (view.zoom * oh)],
      [-view.x / (view.zoom * ow), -view.y / (view.zoom * oh)],
      false,
      bypass,
    );
  }

  private target(w: number, h: number) {
    const gl = this.gl;
    if (!this.scratch || this.scratch.w !== w || this.scratch.h !== h) {
      if (this.scratch) gl.deleteTexture(this.scratch.tex);
      const tex = this.tex2d();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.scratch = { tex, w, h };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scratch.tex, 0);
  }

  /** 以縮圖渲染整張影像後統計 RGB 色階分佈（3 × 256）。 */
  histogram(s: Settings, bypass = false): Uint32Array {
    const bins = new Uint32Array(768);
    if (!this.srcTex) return bins;
    const gl = this.gl;
    const [ow, oh] = this.outSize(s);
    const k = 256 / Math.max(ow, oh);
    const w = Math.max(1, Math.round(ow * k));
    const h = Math.max(1, Math.round(oh * k));
    this.target(256, 256);
    gl.viewport(0, 0, w, h);
    this.draw(s, [1, 1], [0, 0], true, bypass);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = 0; i < px.length; i += 4) {
      bins[px[i]]++;
      bins[256 + px[i + 1]]++;
      bins[512 + px[i + 2]]++;
    }
    return bins;
  }

  /** 以原始解析度分塊渲染後編碼成檔案。 */
  async exportBlob(s: Settings, opts: ExportOptions): Promise<Blob> {
    if (!this.srcTex) throw new Error('沒有影像');
    const gl = this.gl;
    const [ow, oh] = this.outSize(s);
    const k = opts.longEdge ? Math.min(1, opts.longEdge / Math.max(ow, oh)) : 1;
    const W = Math.max(1, Math.round(ow * k));
    const H = Math.max(1, Math.round(oh * k));
    const out = new OffscreenCanvas(W, H);
    const ctx = out.getContext('2d')!;
    const T = 2048;
    for (let y = 0; y < H; y += T) {
      for (let x = 0; x < W; x += T) {
        const tw = Math.min(T, W - x);
        const th = Math.min(T, H - y);
        this.target(T, T);
        gl.viewport(0, 0, tw, th);
        this.draw(s, [tw / W, th / H], [x / W, y / H], true, false);
        const px = new Uint8ClampedArray(tw * th * 4);
        gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ctx.putImageData(new ImageData(px, tw, th), x, y);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out.convertToBlob({ type: opts.type, quality: opts.quality });
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
