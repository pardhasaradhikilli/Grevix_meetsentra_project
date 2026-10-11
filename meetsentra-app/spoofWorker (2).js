// Web Worker: runs spoof analysis off the main thread so video/UI are unaffected.
import { SpoofDetector } from './spoofDetector.js';

const det = new SpoofDetector();
let count = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'frame') {
    det.push(m.gray);
    count++;
    if (count >= det.o.fps) { // about once per second
      count = 0;
      const r = det.analyze();
      self.postMessage({ type: 'result', static: r.static, loop: r.loop });
    }
  } else if (m.type === 'setFps') {
    det.setFps(m.fps); count = 0;
  } else if (m.type === 'reset') {
    det.reset(); count = 0;
  }
};
