import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface HistogramHandle {
  draw: (bins: Uint32Array) => void;
}

const W = 256;
const H = 96;
const COLORS = ['#ff4d4d', '#3ddc5a', '#4d8dff'];

export const Histogram = forwardRef<HistogramHandle>((_, ref) => {
  const cv = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    draw(bins) {
      const ctx = cv.current?.getContext('2d');
      if (!ctx) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      // 純黑與純白的尖峰不參與縮放，否則會把其餘分佈壓扁
      let max = 1;
      for (let c = 0; c < 3; c++) for (let i = 2; i < 254; i++) max = Math.max(max, bins[c * 256 + i]);
      ctx.globalCompositeOperation = 'lighter';
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = COLORS[c];
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i < 256; i++) ctx.lineTo(i, H - Math.min(1, bins[c * 256 + i] / max) * (H - 2));
        ctx.lineTo(W, H);
        ctx.fill();
      }
    },
  }));

  return <canvas ref={cv} className="histogram" width={W} height={H} />;
});
