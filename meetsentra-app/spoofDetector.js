// Detects frozen or looped camera feeds from tiny grayscale frames (e.g. 32x32).
// Heuristic: tune thresholds against a real webcam before the demo.

const dist = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
const avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
const quantile = (arr, q) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export class SpoofDetector {
  constructor(opts = {}) {
    this.o = {
      fps: 3,
      bufferSec: 14,
      staticSec: 8,        // how long the feed must be motionless to call it frozen
      staticEps: 0.35,     // mean frame-to-frame change below this = motionless
      loopRatio: 0.25,     // repeat-distance must be < 25% of typical distance
      motionMin: 0.8,      // loop check only when the feed has real motion
      minLagSec: 2,
      maxLagSec: 10,       // longest loop period we can catch
      recentFrames: 9,     // ~3 s of recent frames compared against their past
      loopAbsMax: 0.6,     // a copy matches almost exactly; a live camera never does (sensor noise)
      loopConfirm: 2,      // same loop period must be found on this many checks in a row
      ...opts,
    };
    this.reset();
  }

  reset() { this.frames = []; this.diffs = []; this.lagHistory = []; }
  setFps(fps) { this.o.fps = fps; this.reset(); }

  push(gray) {
    const max = Math.ceil(this.o.bufferSec * this.o.fps);
    const copy = Uint8Array.from(gray);
    if (this.frames.length) this.diffs.push(dist(copy, this.frames[this.frames.length - 1]));
    this.frames.push(copy);
    if (this.frames.length > max) { this.frames.shift(); this.diffs.shift(); }
  }

  analyze() {
    const o = this.o;
    const n = this.frames.length;

    // 1) Frozen feed: almost no change between frames for staticSec.
    const need = Math.ceil(o.staticSec * o.fps);
    let isStatic = false;
    if (this.diffs.length >= need) {
      const recent = this.diffs.slice(-need);
      isStatic = avg(recent) < o.staticEps && quantile(recent, 0.95) < o.staticEps * 3;
    }

    // 2) Looped feed: recent frames match frames from exactly one period earlier,
    //    much better than they match frames from other lags.
    let isLoop = false, bestLag = null, ratio = null;
    if (!isStatic) {
      const M = o.recentFrames;
      const minLag = Math.round(o.minLagSec * o.fps);
      const maxLag = Math.min(Math.round(o.maxLagSec * o.fps), n - M);
      if (maxLag >= minLag) {
        const ds = [];
        for (let lag = minLag; lag <= maxLag; lag++) {
          let sum = 0;
          for (let i = n - M; i < n; i++) sum += dist(this.frames[i], this.frames[i - lag]);
          ds.push({ lag, d: sum / M });
        }
        const sorted = ds.map((x) => x.d).sort((x, y) => x - y);
        const median = sorted[Math.floor(sorted.length / 2)];
        const best = ds.reduce((a, b) => (b.d < a.d ? b : a));
        ratio = best.d / median; bestLag = best.lag;
        const recentMotion = avg(this.diffs.slice(-M)); // a loop still moves; a frozen feed doesn't
        const candidate = median >= o.motionMin && recentMotion >= o.motionMin &&
          best.d < o.loopRatio * median && best.d < o.loopAbsMax;
        this.lagHistory.push(candidate ? best.lag : null);
        if (this.lagHistory.length > o.loopConfirm) this.lagHistory.shift();
        const h = this.lagHistory;
        isLoop = h.length === o.loopConfirm && h.every((l) => l !== null && Math.abs(l - h[0]) <= 1);
      } 
    }
    if (isStatic || n === 0) this.lagHistory = [];

    return { static: isStatic, loop: isLoop, bestLag, ratio };
  }
}
