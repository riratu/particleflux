// paramHistory.js — Grafana-style live parameter history charts
// Self-contained module: circular buffer + Canvas2D sparklines

const BUFFER_SIZE = 600; // ~60 seconds at 10fps
const SAMPLE_INTERVAL = 100; // ms between samples (10fps)
const GUI_WIDTH = 245; // dat.gui panel width

const GROUPS = {
  Physics: {
    color: '#4fc3f7',
    params: ['gravity', 'maxRadius', 'repulsionRange', 'repulsionStrength', 'speedMultiplier', 'zThrust', 'zFlow', 'spaceAttraction'],
  },
  Forces: {
    color: '#ff8a65',
    params: ['RED-RED', 'RED-GREEN', 'RED-BLUE', 'GREEN-RED', 'GREEN-GREEN', 'GREEN-BLUE', 'BLUE-RED', 'BLUE-BLUE', 'BLUE-GREEN'],
  },
  Visual: {
    color: '#aed581',
    params: ['particleSize', 'bloomStrength', 'bloomRadius', 'fogNear', 'fogFar', 'rotationSpeed', 'exposure', 'cameraFov', 'vignetteOffset', 'vignetteDarkness'],
  },
  Audio: {
    color: '#ce93d8',
    params: ['filterQ', 'reverbWet', 'minVol', 'maxVol'],
  },
};

let active = false;
let container = null;
let chartCanvas = null;
let chartCtx = null;
let controllerRef = null;
let paramsRef = null;

// Circular buffer: { [paramName]: Float32Array }
let buffers = {};
let writeIndex = 0;
let sampleCount = 0;
let lastSampleTime = 0;

function createBuffers(PARAMS) {
  buffers = {};
  for (const key of Object.keys(PARAMS)) {
    buffers[key] = new Float32Array(BUFFER_SIZE);
  }
  writeIndex = 0;
  sampleCount = 0;
}

function startHistory(controller, PARAMS) {
  if (active) return;
  active = true;
  controllerRef = controller;
  paramsRef = PARAMS;

  createBuffers(PARAMS);

  container = document.createElement('div');
  container.id = 'param-history';
  Object.assign(container.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: `calc(100% - ${GUI_WIDTH}px)`,
    height: '100%',
    background: '#111',
    zIndex: '0',
    overflow: 'hidden',
  });

  chartCanvas = document.createElement('canvas');
  chartCanvas.style.width = '100%';
  chartCanvas.style.height = '100%';
  container.appendChild(chartCanvas);
  document.body.appendChild(container);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function stopHistory() {
  if (!active) return;
  active = false;
  window.removeEventListener('resize', resizeCanvas);
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
  container = null;
  chartCanvas = null;
  chartCtx = null;
  controllerRef = null;
  paramsRef = null;
  buffers = {};
}

function resizeCanvas() {
  if (!chartCanvas || !container) return;
  chartCanvas.width = container.clientWidth * window.devicePixelRatio;
  chartCanvas.height = container.clientHeight * window.devicePixelRatio;
  chartCtx = chartCanvas.getContext('2d');
  chartCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function recordFrame() {
  if (!active || !controllerRef || !paramsRef) return;

  const now = performance.now();
  if (now - lastSampleTime < SAMPLE_INTERVAL) return;
  lastSampleTime = now;

  for (const key of Object.keys(paramsRef)) {
    const val = controllerRef.get(key);
    const range = paramsRef[key].max - paramsRef[key].min || 1;
    const jitter = (Math.random() - 0.5) * range * 0.05;
    buffers[key][writeIndex] = val + jitter;
  }
  writeIndex = (writeIndex + 1) % BUFFER_SIZE;
  if (sampleCount < BUFFER_SIZE) sampleCount++;

  drawCharts();
}

function drawCharts() {
  if (!chartCtx || !paramsRef) return;

  const w = chartCanvas.width / window.devicePixelRatio;
  const h = chartCanvas.height / window.devicePixelRatio;

  chartCtx.clearRect(0, 0, w, h);

  const groupNames = Object.keys(GROUPS);
  const totalParams = groupNames.reduce((sum, g) => sum + GROUPS[g].params.length, 0);

  const labelWidth = 130;
  const chartLeft = labelWidth;
  const chartW = w - chartLeft - 8;

  const rowH = Math.min(Math.floor(h / (totalParams + groupNames.length)), 28);
  let y = 4;

  for (const groupName of groupNames) {
    const group = GROUPS[groupName];

    // Group header
    chartCtx.fillStyle = group.color;
    chartCtx.font = 'bold 11px monospace';
    chartCtx.fillText(groupName, 6, y + 11);
    y += 16;

    for (const paramName of group.params) {
      if (!paramsRef[paramName] || !buffers[paramName]) continue;

      const pDef = paramsRef[paramName];
      const buf = buffers[paramName];
      const pMin = pDef.min;
      const pMax = pDef.max;
      const range = pMax - pMin || 1;

      // Label
      chartCtx.fillStyle = '#888';
      chartCtx.font = '10px monospace';
      chartCtx.fillText(paramName, 10, y + rowH * 0.65);

      // Default line
      const defNorm = (pDef.default - pMin) / range;
      const defY = y + rowH - 2 - defNorm * (rowH - 4);
      chartCtx.strokeStyle = '#333';
      chartCtx.lineWidth = 1;
      chartCtx.setLineDash([2, 3]);
      chartCtx.beginPath();
      chartCtx.moveTo(chartLeft, defY);
      chartCtx.lineTo(chartLeft + chartW, defY);
      chartCtx.stroke();
      chartCtx.setLineDash([]);

      // Sparkline
      if (sampleCount > 1) {
        chartCtx.strokeStyle = group.color;
        chartCtx.lineWidth = 1.5;
        chartCtx.beginPath();

        const count = Math.min(sampleCount, BUFFER_SIZE);
        const startIdx = (writeIndex - count + BUFFER_SIZE) % BUFFER_SIZE;

        for (let i = 0; i < count; i++) {
          const idx = (startIdx + i) % BUFFER_SIZE;
          const val = buf[idx];
          const norm = (val - pMin) / range;
          const px = chartLeft + (i / (BUFFER_SIZE - 1)) * chartW;
          const py = y + rowH - 2 - norm * (rowH - 4);

          if (i === 0) chartCtx.moveTo(px, py);
          else chartCtx.lineTo(px, py);
        }
        chartCtx.stroke();
      }

      y += rowH;
    }

    y += 4; // gap between groups
  }
}

export { startHistory, stopHistory, recordFrame };
