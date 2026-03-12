// controller.js — Momentary button controller
// Additive offsets, not presets. Multiple buttons combine by summing offsets.
// All transitions lerped (~200ms to settle).

const PARAMS = {
  // Physics
  gravity:           { min: 0.01, max: 4000, default: 247 },
  maxRadius:         { min: 1,    max: 2000, default: 200 },
  repulsionRange:    { min: 1,    max: 500,  default: 150 },
  repulsionStrength: { min: 0.1,  max: 10,   default: 1 },
  speedMultiplier:   { min: 0.01, max: 3.0,  default: 1.0 },
  zThrust:           { min: -3000, max: 3000, default: 0 },
  zFlow:             { min: -3000, max: 3000, default: 0 },
  spaceAttraction:   { min: 0, max: 100, default: 0 },
  // Force matrix
  'RED-RED':     { min: -10, max: 10, default: 2 },
  'RED-GREEN':   { min: -10, max: 10, default: -0.7 },
  'RED-BLUE':    { min: -10, max: 10, default: 0.5 },
  'GREEN-RED':   { min: -10, max: 10, default: 0 },
  'GREEN-GREEN': { min: -10, max: 10, default: 0 },
  'GREEN-BLUE':  { min: -10, max: 10, default: 0.1 },
  'BLUE-RED':    { min: -10, max: 10, default: -1.1 },
  'BLUE-BLUE':   { min: -10, max: 10, default: 0 },
  'BLUE-GREEN':  { min: -10, max: 10, default: -0.3 },
  // Visual
  particleSize:  { min: 0.1,   max: 20,   default: 2 },
  bloomStrength: { min: 0,     max: 3,    default: 0.5 },
  bloomRadius:   { min: 0,     max: 2,    default: 0.8 },
  fogNear:       { min: 1,     max: 2000, default: 50 },
  fogFar:        { min: 10,    max: 5000, default: 1000 },
  rotationSpeed: { min: -0.03, max: 0.03, default: 0.003 },
  exposure:         { min: 0.1,   max: 3.0,  default: 1.0 },
  cameraFov:        { min: 5,     max: 120,  default: 75 },
  vignetteOffset:   { min: 0.0,   max: 3.0,  default: 1.0 },
  vignetteDarkness: { min: 0.0,   max: 2.0,  default: 1.0 },
  // Audio
  filterQ:   { min: 0.5, max: 30, default: 15 },
  reverbWet: { min: 0,   max: 1,  default: 0.9 },
  minVol:    { min: -60, max: 0,  default: -15 },
  maxVol:    { min: -60, max: 0,  default: -10 },
};

const BUTTON_MAP = {
  // q-p (10): Space / expansion / visual
  KeyQ: { name: 'expand',   offsets: { maxRadius: +800, rotationSpeed: -100.01, particleSize: +1 } },
  KeyW: { name: 'collapse', offsets: { maxRadius: -1050 } },
  KeyE: { name: 'all-repel', offsets: { 'RED-RED': -3, 'RED-GREEN': -3, 'RED-BLUE': -3, 'GREEN-RED': -3, 'GREEN-GREEN': -3, 'GREEN-BLUE': -3, 'BLUE-RED': -3, 'BLUE-GREEN': -3, 'BLUE-BLUE': -3 } },
  KeyR: { name: 'hyper-g',  offsets: { gravity: +1500 } },
  KeyT: { name: 'scatter',  offsets: { repulsionStrength: +5 } },
  KeyZ: { name: 'dense',    offsets: { repulsionRange: -100 } },
  KeyU: { name: 'bloom',    offsets: { bloomStrength: +1.5 } },
  KeyI: { name: 'red-magnet', offsets: { 'GREEN-RED': +8, 'BLUE-RED': +8, 'RED-RED': +4, repulsionRange: +200 } },
  KeyO: { name: 'spin',     offsets: { rotationSpeed: +0.01 } },
  KeyP: { name: 'exposure', offsets: { exposure: +1.0 } },

  // a-l (9): Force matrix shaping
  KeyA: { name: 'green-scatter', offsets: { 'GREEN-GREEN': -3 } },
  KeyS: { name: 'warp',          offsets: { cameraFov: -55, zThrust: +2000, speedMultiplier: +1.5, bloomStrength: +0.5, exposure: +0.5 } },
  KeyD: { name: 'cross-attract', offsets: { 'RED-GREEN': +10, 'RED-BLUE': +10, repulsionRange: +100 } },
  KeyF: { name: 'cross-repel',   offsets: { 'RED-GREEN': -20, 'RED-BLUE': -20 } },
  KeyG: { name: 'green-cluster', offsets: { 'GREEN-GREEN': +3 } },
  KeyJ: { name: 'blue-orbit',    offsets: { 'BLUE-RED': +2, 'BLUE-GREEN': +2 } },
  KeyK: { name: 'blue-chaos',    offsets: { 'BLUE-BLUE': +3, 'BLUE-GREEN': -2 } },
  KeyL: { name: 'all-attract',   offsets: {
    'RED-RED': +1, 'RED-GREEN': +1, 'RED-BLUE': +1,
    'GREEN-RED': +1, 'GREEN-GREEN': +1, 'GREEN-BLUE': +1,
    'BLUE-RED': +1, 'BLUE-GREEN': +1, 'BLUE-BLUE': +1,
  }},

  // z-m (7): Sound shapingn
  KeyY: { name: 'bright',   offsets: { filterQ: -10, maxVol: +5, particleSize: +1, bloomStrength: +0.3, fogNear: -30, bloomRadius: +0.1, speedMultiplier: +0.3 } },
  KeyX: { name: 'dark',     offsets: { filterQ: +10, minVol: -10, zThrust: -2000 } },
  KeyC: { name: 'resonant', offsets: { filterQ: +15,  rotationSpeed: 3500.01 } },
  KeyV: { name: 'smooth',   offsets: { filterQ: -8, reverbWet: +0.1, 'RED-GREEN': -7, 'RED-BLUE': -7, 'GREEN-RED': -20, 'BLUE-RED': -5,  'GREEN-GREEN': -3, speedMultiplier: -1.3 } },
  KeyB: { name: 'red-hunt',  offsets: { 'RED-GREEN': +4, 'RED-BLUE': +4, 'GREEN-RED': -3, 'BLUE-RED': -3 } },
  KeyN: { name: 'vortex',   offsets: { reverbWet: -0.5, rotationSpeed: +0.025, cameraFov: -25, gravity: +1200, maxRadius: +900, bloomStrength: +0.8, speedMultiplier: -0.7, repulsionStrength: +8 } },
  KeyM: { name: 'quake',    offsets: { maxVol: +8, minVol: +8, cameraFov: +30, bloomStrength: +1, zThrust: -1500, gravity: +500 } },

  // , . — Compound spatial effects
  Comma:  { name: 'terraform', offsets: { gravity: +600, maxRadius: +400, repulsionRange: +200, repulsionStrength: +3, 'RED-RED': +2, 'GREEN-GREEN': +2, 'BLUE-BLUE': +2, particleSize: +3, bloomStrength: +0.5, filterQ: -5, speedMultiplier: +0.4, cameraFov: +50 } },
  Period: { name: 'dissolve',  offsets: { gravity: -500, maxRadius: +600, repulsionStrength: +4, bloomStrength: -0.3, bloomRadius: +0.1, exposure: +0.6, reverbWet: +0.1, filterQ: -8, speedMultiplier: -0.3, cameraFov: +50 } },
  Backspace: { name: 'z-flow',    offsets: { zFlow: +2000 } },
  Space:  { name: 'attract',  offsets: { spaceAttraction: +50 } },

  // ü ö ä ¨ $ — Special keys (Swiss/German keyboard)
  BracketLeft:  { name: 'singularity', offsets: { gravity: +3000, repulsionRange: -120, bloomStrength: +2, exposure: +0.1, fogNear: +80, filterQ: +12, maxVol: +5, speedMultiplier: +0.2 } },
  Semicolon:    { name: 'tidal',       offsets: { 'RED-GREEN': +5, 'GREEN-BLUE': +5, 'BLUE-RED': +5, 'RED-BLUE': -5, 'GREEN-RED': -5, 'BLUE-GREEN': -5, repulsionStrength: +3, rotationSpeed: +0.015, bloomStrength: +0.6, reverbWet: +0.1, speedMultiplier: +0.3 } },
  Quote:        { name: 'cascade',     offsets: { gravity: +800, repulsionStrength: +6, repulsionRange: +150, maxRadius: +300, speedMultiplier: +0.1, bloomStrength: +1.0, bloomRadius: +0.5, filterQ: -12, maxVol: +3, zThrust: +1500, cameraFov: +15 } },
  BracketRight: { name: 'freeze',      offsets: { speedMultiplier: -0.8, gravity: +500, repulsionRange: -80, particleSize: -1, bloomStrength: +1.8, bloomRadius: +1.0, exposure: +0.8, fogNear: -30, filterQ: +8, reverbWet: +0.1, minVol: -10 } },
  Backslash:    { name: 'hyperdrive',  offsets: { speedMultiplier: +0.2, zThrust: +2500, cameraFov: -50, gravity: -300, maxRadius: +1000, bloomStrength: +1.5, bloomRadius: +0.8, exposure: +1.0, fogNear: -40, filterQ: -15, maxVol: +8, rotationSpeed: +0.02 } },

  // 0-9 (10): Compound effects (physics + sound + visual)
  Digit1: { name: 'explode',     offsets: { maxRadius: +1000, gravity: -200, repulsionStrength: +5, bloomStrength: +1 } },
  Digit2: { name: 'implode',     offsets: { maxRadius: -180, gravity: +1500, bloomStrength: +0.5 } },
  Digit3: { name: 'crystallize', offsets: { 'GREEN-GREEN': +3, 'BLUE-BLUE': +3, repulsionRange: -80, filterQ: +10 } },
  Digit4: { name: 'melt',        offsets: { gravity: -200, repulsionStrength: -2, reverbWet: +0.1} },
  Digit5: { name: 'swarm',       offsets: { 'RED-GREEN': -5, 'GREEN-BLUE': -5, 'BLUE-RED': -5, 'RED-BLUE': -5, 'GREEN-RED': -5, 'BLUE-GREEN': +5, speedMultiplier: +0.1, maxRadius: +80, cameraFov: -20 } },
  Digit6: { name: 'nebula',      offsets: { maxRadius: +500, bloomStrength: +1, exposure: +0.5 } },
  Digit7: { name: 'pulse',       offsets: { gravity: +800, maxRadius: -100, bloomStrength: +0.8 } },
  Digit8: { name: 'void',        offsets: { gravity: +2000, maxRadius: -150, minVol: -20 } },
  Digit9: { name: 'aurora',      offsets: { bloomStrength: +1.5, exposure: +0.8, fogNear: -40, reverbWet: +0.1 } },
  Digit0: { name: 'storm',       offsets: { gravity: +1000, repulsionStrength: +3, speedMultiplier: +0.2, filterQ: -10, maxVol: +5 } },
};

const paramKeys = Object.keys(PARAMS);

class MomentaryController {
  constructor() {
    this.pressed = new Set();
    this.current = {};
    this.target = {};
    this.baseline = {};

    for (const key of paramKeys) {
      const def = PARAMS[key].default;
      this.current[key] = def;
      this.target[key] = def;
      this.baseline[key] = def;
    }
  }

  // Sync baseline from external source (GUI / forceControls).
  // Only updates keys that exist in source, so visual/audio baselines
  // stay at their PARAMS defaults unless explicitly set.
  syncBaseline(source) {
    let changed = false;
    for (const key of paramKeys) {
      if (key in source && this.baseline[key] !== source[key]) {
        this.baseline[key] = source[key];
        changed = true;
      }
    }
    if (changed) this._recalcTargets();
  }

  setBaseline(key, value) {
    if (key in PARAMS && this.baseline[key] !== value) {
      this.baseline[key] = value;
      this._recalcTargets();
    }
  }

  press(code) {
    if (this.pressed.has(code) || !BUTTON_MAP[code]) return;
    this.pressed.add(code);
    this._recalcTargets();
  }

  release(code) {
    if (!this.pressed.has(code)) return;
    this.pressed.delete(code);
    this._recalcTargets();
  }

  _recalcTargets() {
    for (const key of paramKeys) {
      this.target[key] = this.baseline[key];
    }
    for (const code of this.pressed) {
      const button = BUTTON_MAP[code];
      if (!button) continue;
      for (const [param, offset] of Object.entries(button.offsets)) {
        this.target[param] += offset;
      }
    }
    for (const key of paramKeys) {
      const p = PARAMS[key];
      if (this.target[key] < p.min) this.target[key] = p.min;
      if (this.target[key] > p.max) this.target[key] = p.max;
    }
  }

  // Lerp all params toward target. Call once per frame.
  update(dt) {
    const factor = 1 - Math.exp(-dt * 10); // ~100ms half-life
    for (const key of paramKeys) {
      this.current[key] += (this.target[key] - this.current[key]) * factor;
    }
  }

  get(param) {
    return this.current[param];
  }
}

export { PARAMS, BUTTON_MAP, MomentaryController };
