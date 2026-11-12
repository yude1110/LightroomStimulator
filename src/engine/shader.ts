// 全螢幕三角形；vUv 的 y 由上往下（與影像列順序一致）。
// 繪製到 FBO 時設 uYFlip=1，讓 readPixels 讀出的第一列就是影像頂端。
export const VERT = `#version 300 es
uniform float uYFlip;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, mix(1.0 - p.y, p.y, uYFlip));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SRGB = `
vec3 toLin(vec3 c) {
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toGam(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}`;

// uMode 0：把原圖縮小並轉成 gamma 編碼；uMode 1：沿 uDir 做高斯模糊。
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform int uMode;
uniform vec2 uDir;
uniform float uSigma;
${SRGB}
void main() {
  if (uMode == 0) {
    o = vec4(toGam(texture(uTex, vUv).rgb), 1.0);
    return;
  }
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = -30; i <= 30; i++) {
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    acc += texture(uTex, vUv + uDir * float(i)).rgb * w;
    ws += w;
  }
  o = vec4(acc / ws, 1.0);
}`;

// 處理順序：
//   細節（銳利化/紋理/清晰度）→ 校準 → 白平衡 → 曝光 → 去朦朧
//   → 亮部/陰影/白色/黑色 → 對比 → 色調曲線
//   → 混色器/黑白 → 鮮豔度/飽和度 → 顏色分級 → LUT → 暈影 → 顆粒
export const MAIN_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;       // sRGB 紋理，取樣即為線性值
uniform sampler2D uBlurMid;   // gamma 編碼的模糊原圖（中半徑）
uniform sampler2D uBlurLarge; // gamma 編碼的模糊原圖（大半徑）
uniform sampler2D uCurve;
uniform sampler3D uLut;

uniform vec2 uViewScale;
uniform vec2 uViewOffset;
uniform vec2 uFlip;
uniform vec2 uSrcTexel;
uniform vec2 uOutSize;
uniform vec3 uBg;
uniform int uRot;
uniform float uBypass;

uniform mat3 uCalib;
uniform vec3 uWb;
uniform float uGain;
uniform float uDehaze;
uniform float uSharpen;
uniform float uTexture;
uniform float uClarity;
uniform float uContrastK;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform vec4 uBand[8]; // 每個色相帶：色相偏移、飽和度、明度、黑白混合
uniform float uBandOn;
uniform float uBw;
uniform float uVibrance;
uniform float uSaturation;
uniform vec3 uGradeS;
uniform vec3 uGradeM;
uniform vec3 uGradeH;
uniform vec3 uGradeG;
uniform float uGradeBlend;
uniform float uGradeBalance;
uniform float uLutAmount;
uniform float uLutSize;
uniform vec3 uVignette; // 數量、中點、羽化
uniform vec2 uGrain;    // 數量、顆粒大小（影像像素）

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c) { return dot(c, LW); }
${SRGB}

// 提高曝光時讓亮部平滑收斂到白，而不是直接截斷；uGain<=1 時為恆等。
vec3 shoulder(vec3 y) {
  if (uGain <= 1.0) return y;
  const float k = 0.5;
  float m = (uGain - k) / (1.0 - k);
  vec3 t = max(y - k, 0.0) / (1.0 - k);
  vec3 h = t / (1.0 + t * (1.0 - 1.0 / m));
  return mix(y, k + (1.0 - k) * h, step(k, y));
}

vec3 base(vec3 lin) {
  return shoulder(max(uCalib * lin, 0.0) * uWb * uGain);
}

vec3 contrastCurve(vec3 x) {
  x = clamp(x, 0.0, 1.0);
  vec3 lo = 0.5 * pow(2.0 * x, vec3(uContrastK));
  vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - x), vec3(uContrastK));
  return mix(lo, hi, step(0.5, x));
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0;
  float s = 0.0;
  if (d > 1e-5) {
    s = d / (1.0 - abs(2.0 * l - 1.0) + 1e-5);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, clamp(s, 0.0, 1.0), l);
}

vec3 hsl2rgb(vec3 hsl) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + hsl.x * 12.0, 12.0);
  float a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return hsl.z - a * max(min(min(k - 3.0, 9.0 - k), 1.0), -1.0);
}

const float HC[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);
vec4 bandAdj(float hdeg) {
  vec4 r = uBand[0];
  for (int i = 0; i < 8; i++) {
    if (hdeg >= HC[i] && hdeg < HC[i + 1]) {
      float t = (hdeg - HC[i]) / (HC[i + 1] - HC[i]);
      r = mix(uBand[i], uBand[(i + 1) % 8], t);
    }
  }
  return r;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 p = vUv * uViewScale + uViewOffset;
  vec2 q = mix(p, 1.0 - p, uFlip);
  vec2 uv = q;
  if (uRot == 1) uv = vec2(q.y, 1.0 - q.x);
  else if (uRot == 2) uv = 1.0 - q;
  else if (uRot == 3) uv = vec2(1.0 - q.y, q.x);

  vec3 src = texture(uSrc, uv).rgb;
  vec3 bm = texture(uBlurMid, uv).rgb;
  vec3 bl = texture(uBlurLarge, uv).rgb;

  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) {
    outColor = vec4(uBg, 1.0);
    return;
  }
  if (uBypass > 0.5) {
    outColor = vec4(toGam(src), 1.0);
    return;
  }

  // ---- 細節：在 gamma 空間對亮度做局部對比 ----
  vec3 g = toGam(src);
  float L0 = luma(g);
  float d = 0.0;
  if (uSharpen != 0.0) {
    float n = sqrt(luma(texture(uSrc, uv + vec2(uSrcTexel.x, 0.0)).rgb))
            + sqrt(luma(texture(uSrc, uv - vec2(uSrcTexel.x, 0.0)).rgb))
            + sqrt(luma(texture(uSrc, uv + vec2(0.0, uSrcTexel.y)).rgb))
            + sqrt(luma(texture(uSrc, uv - vec2(0.0, uSrcTexel.y)).rgb));
    d += uSharpen * (sqrt(luma(src)) - n * 0.25);
  }
  d += uTexture * (L0 - luma(bm));
  d += uClarity * (L0 - luma(bl)) * (1.0 - pow(abs(2.0 * L0 - 1.0), 2.0));
  g = max(g + d, 0.0);

  // ---- 線性空間：校準、白平衡、曝光、去朦朧 ----
  vec3 c = base(toLin(g));
  vec3 blBase = base(toLin(bl));
  if (uDehaze > 0.0) {
    float haze = min(blBase.r, min(blBase.g, blBase.b)) * uDehaze * 0.7;
    c = max(c - haze, 0.0) / (1.0 - haze);
  } else if (uDehaze < 0.0) {
    c = mix(c, vec3(0.75), -uDehaze * 0.4);
  }

  // ---- 色調：以模糊亮度當遮罩，保留局部對比 ----
  g = toGam(c);
  float Lp = luma(g);
  float Lc = clamp(Lp, 0.0, 1.0);
  float Lm = clamp(mix(Lp, luma(toGam(blBase)), 0.6), 0.0, 1.0);
  float par = Lc * (1.0 - Lc);
  float Ln = Lp;
  Ln += uShadows * (uShadows > 0.0 ? 1.2 : 0.8) * (1.0 - smoothstep(0.0, 0.55, Lm)) * par;
  Ln += uHighlights * (uHighlights < 0.0 ? 1.2 : 0.8) * smoothstep(0.45, 1.0, Lm) * par;
  Ln += uWhites * 0.2 * Lc * Lc;
  Ln += uBlacks * 0.15 * (1.0 - Lc) * (1.0 - Lc);
  Ln = max(Ln, 0.0);
  // 一般以比例縮放保留色彩；接近全黑時改用加法，才能把黑提亮
  g = mix(g + (Ln - Lp), g * (Ln / max(Lp, 1e-4)), smoothstep(0.0, 0.1, Lp));

  g = contrastCurve(g);
  const float CS = 255.0 / 256.0;
  const float CO = 0.5 / 256.0;
  g = vec3(texture(uCurve, vec2(g.r * CS + CO, 0.5)).r,
           texture(uCurve, vec2(g.g * CS + CO, 0.5)).g,
           texture(uCurve, vec2(g.b * CS + CO, 0.5)).b);

  // ---- 色彩 ----
  if (uBandOn > 0.5 || uBw > 0.5) {
    vec3 hsl = rgb2hsl(g);
    vec4 adj = bandAdj(hsl.x * 360.0);
    if (uBw > 0.5) {
      g = vec3(clamp(luma(g) * (1.0 + adj.w * 0.6 * hsl.y), 0.0, 1.0));
    } else {
      float w = smoothstep(0.05, 0.4, hsl.y);
      hsl.x = fract(hsl.x + adj.x);
      hsl.y = clamp(hsl.y * (1.0 + adj.y), 0.0, 1.0);
      hsl.z = pow(clamp(hsl.z, 0.0, 1.0), exp(-adj.z * 0.6 * w));
      g = hsl2rgb(hsl);
    }
  }
  if (uBw < 0.5) {
    float l = luma(g);
    float mx = max(g.r, max(g.g, g.b));
    float mn = min(g.r, min(g.g, g.b));
    float sat = (mx - mn) / (mx + 1e-4);
    g = mix(vec3(l), g, max(1.0 + uVibrance * (1.0 - sat), 0.0));
    g = mix(vec3(luma(g)), g, 1.0 + uSaturation);
  }

  // ---- 顏色分級 ----
  {
    float Lg = pow(clamp(luma(g), 0.0, 1.0), exp2(-uGradeBalance));
    float hw = 0.1 + 0.4 * uGradeBlend;
    float t = smoothstep(0.5 - hw, 0.5 + hw, Lg);
    float ws = (1.0 - t) * (1.0 - t);
    float wh = t * t;
    g += uGradeS * ws + uGradeM * (1.0 - ws - wh) + uGradeH * wh + uGradeG;
  }
  g = clamp(g, 0.0, 1.0);

  if (uLutAmount > 0.0) {
    vec3 lc = g * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    g = mix(g, texture(uLut, lc).rgb, uLutAmount);
  }

  // ---- 效果 ----
  if (uVignette.x != 0.0) {
    float dist = length((p - 0.5) * 2.0) / 1.41421;
    float e0 = uVignette.y * (1.0 - uVignette.z);
    float e1 = uVignette.y + (1.2 - uVignette.y) * uVignette.z + 0.001;
    float v = smoothstep(e0, e1, dist);
    g *= uVignette.x < 0.0 ? 1.0 + v * uVignette.x * 0.9 : 1.0 + v * uVignette.x;
  }
  if (uGrain.x > 0.0) {
    vec2 gp = p * uOutSize / uGrain.y;
    float n = (vnoise(gp) - 0.5) * 1.4 + (vnoise(gp * 2.03 + 17.0) - 0.5) * 0.6;
    float lg = clamp(luma(g), 0.0, 1.0);
    g += n * uGrain.x * (1.0 - 0.6 * pow(abs(2.0 * lg - 1.0), 2.0));
  }

  outColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}`;
