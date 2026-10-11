// Browser glue: collects cheap local signals and feeds the engine.
// Privacy: no screen capture. Only (a) yes/no "is the meeting window focused",
// (b) mic loudness level (no recording), (c) a 32x32 grayscale copy of the
// participant's OWN camera preview for motion analysis. Nothing leaves the device
// except the final state string.
import { EngagementEngine } from './engagementEngine.js';

export function watchWindowFocus(onChange, pollMs = 1000) {
  let last = null;
  const read = () => document.visibilityState === 'visible' && document.hasFocus();
  const emit = () => { const v = read(); if (v !== last) { last = v; onChange(v); } };
  window.addEventListener('focus', emit);
  window.addEventListener('blur', emit);
  document.addEventListener('visibilitychange', emit);
  const id = setInterval(emit, pollMs);
  emit();
  return () => {
    window.removeEventListener('focus', emit);
    window.removeEventListener('blur', emit);
    document.removeEventListener('visibilitychange', emit);
    clearInterval(id);
  };
}

export function watchMicActivity(stream, onActive, { threshold = 0.02, minMs = 300, checkMs = 200 } = {}) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let above = 0;
  const id = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    const rms = Math.sqrt(s / buf.length);
    if (rms > threshold) { above += checkMs; if (above >= minMs) onActive(Date.now()); } else above = 0;
  }, checkMs);
  return () => { clearInterval(id); ctx.close(); };
}

// Samples a tiny grayscale frame at a low rate. CPU guard: if sampling is slow
// five times in a row, drop to 1 fps. Pauses (and resets) while the tab is hidden.
export function startFrameSampler(videoEl, worker, { fps = 3, size = 32, budgetMs = 3 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let timer = null, slow = 0, paused = false;

  function setFps(f) {
    clearInterval(timer);
    timer = setInterval(tick, 1000 / f);
    worker.postMessage({ type: 'setFps', fps: f });
    slow = 0;
  }
  let curFps = fps;

  function tick() {
    if (document.visibilityState !== 'visible' || videoEl.readyState < 2) {
      if (!paused) { paused = true; worker.postMessage({ type: 'reset' }); }
      return;
    }
    paused = false;
    const t0 = performance.now();
    ctx.drawImage(videoEl, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const gray = new Uint8Array(size * size);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }
    worker.postMessage({ type: 'frame', gray }, [gray.buffer]);
    slow = performance.now() - t0 > budgetMs ? slow + 1 : Math.max(0, slow - 1);
    if (slow >= 5 && curFps > 1) { curFps = 1; setFps(1); }
  }

  setFps(curFps);
  return () => clearInterval(timer);
}

// Wires everything together. getFaceState() comes from your existing face/gaze model:
// it must return { facePresent: boolean, gazeOnScreen: boolean | null }.
export function createEngagementRuntime({
  videoEl, micStream, getFaceState, onStateChange, onPulsePrompt,
  workerUrl = new URL('./spoofWorker.js', import.meta.url),
}) {
  const engine = new EngagementEngine();
  const worker = new Worker(workerUrl, { type: 'module' });
  let spoof = { static: false, loop: false };
  let focused = true;
  worker.onmessage = (e) => { if (e.data.type === 'result') spoof = e.data; };

  const stops = [watchWindowFocus((v) => { focused = v; }), startFrameSampler(videoEl, worker)];
  if (micStream) stops.push(watchMicActivity(micStream, (t) => engine.noteAudio(t)));

  let lastSent = null;
  const timer = setInterval(() => {
    const face = getFaceState();
    const r = engine.update(Date.now(), {
      facePresent: face.facePresent,
      gazeOnScreen: face.gazeOnScreen,
      windowFocused: focused,
      spoofStatic: spoof.static,
      spoofLoop: spoof.loop,
    });
    if (r.state !== lastSent) { lastSent = r.state; onStateChange({ state: r.state, reasons: r.reasons }); }
    if (r.promptPulse && onPulsePrompt) onPulsePrompt();
  }, 1000);

  return {
    noteChat: () => engine.noteChat(),
    noteReaction: () => engine.noteReaction(), // call from the "I'm here" / reaction buttons
    stop() { clearInterval(timer); stops.forEach((s) => s()); worker.terminate(); },
  };
}
