// launchpad.js — Launchpad Mini bridge for MomentaryController
// Maps 8×8 grid to BUTTON_MAP keys with color-coded LED feedback.
// Uses native Web MIDI API (no extra dependency).

import { BUTTON_MAP } from './controller.js';

// Launchpad Mini note layout: row * 16 + col (col 0-7 = grid, col 8 = side button)
// Map note numbers → keyboard codes from BUTTON_MAP
const PAD_MAP = {
  // Row 0: Compound effects
  0: 'Digit1',   // explode
  1: 'Digit2',   // implode
  2: 'Digit3',   // crystallize
  3: 'Digit4',   // melt
  4: 'Digit5',   // swarm
  5: 'Digit6',   // nebula
  6: 'Digit7',   // pulse
  7: 'Digit8',   // void

  // Row 1: Compounds + specials
  16: 'Digit9',       // aurora
  17: 'Digit0',       // storm
  18: 'BracketLeft',  // singularity
  19: 'Semicolon',    // tidal
  20: 'Quote',        // cascade
  21: 'BracketRight', // freeze
  22: 'Backslash',    // hyperdrive

  // Row 2: Space / expansion / visual
  32: 'KeyQ',  // expand
  33: 'KeyW',  // collapse
  34: 'KeyE',  // all-repel
  35: 'KeyR',  // hyper-g
  36: 'KeyT',  // scatter
  37: 'KeyZ',  // dense
  38: 'KeyU',  // bloom
  39: 'KeyI',  // red-magnet

  // Row 3: More visual + compound spatial
  48: 'KeyO',   // spin
  49: 'KeyP',   // exposure
  50: 'Comma',  // terraform
  51: 'Period', // dissolve
  52: 'Space',  // attract
  53: 'Backspace',  // z-flow

  // Row 4: Force matrix shaping
  64: 'KeyA',  // green-scatter
  65: 'KeyS',  // warp
  66: 'KeyD',  // cross-attract
  67: 'KeyF',  // cross-repel
  68: 'KeyG',  // green-cluster
  69: 'KeyJ',  // blue-orbit
  70: 'KeyK',  // blue-chaos
  71: 'KeyL',  // all-attract

  // Row 5: Sound shaping
  80: 'KeyY',  // bright
  81: 'KeyX',  // dark
  82: 'KeyC',  // resonant
  83: 'KeyV',  // smooth
  84: 'KeyB',  // red-hunt
  85: 'KeyN',  // vortex
  86: 'KeyM',  // quake
};

// Reverse lookup: keyboard code → note number (for LED sync from keyboard)
const CODE_TO_NOTE = {};
for (const [note, code] of Object.entries(PAD_MAP)) {
  CODE_TO_NOTE[code] = parseInt(note);
}

// Launchpad Mini MK1 LED velocity colors
// Bits 0-1: green (0-3), Bits 4-5: red (0-3)
const COLORS = {
  OFF:          0,
  RED_DIM:      1,   // low red
  RED:          3,   // full red
  GREEN_DIM:    16,  // low green
  GREEN:        48,  // full green
  AMBER_DIM:    17,  // low red + low green
  AMBER:        51,  // full red + full green
  ORANGE_DIM:   18,  // med red + low green
  ORANGE:       35,  // full red + med green
};

// Color theme per Launchpad row
const ROW_THEME = {
  0: { idle: COLORS.RED_DIM,    active: COLORS.RED },       // compounds
  1: { idle: COLORS.RED_DIM,    active: COLORS.RED },       // compounds + specials
  2: { idle: COLORS.GREEN_DIM,  active: COLORS.GREEN },     // visual / spatial
  3: { idle: COLORS.GREEN_DIM,  active: COLORS.GREEN },     // visual / spatial
  4: { idle: COLORS.AMBER_DIM,  active: COLORS.AMBER },     // force matrix
  5: { idle: COLORS.ORANGE_DIM, active: COLORS.ORANGE },    // sound
};

let midiOutput = null;
let controllerRef = null;
let lastLED = {};  // note → last sent velocity, for change-detection

// Spam protection — tunables
const SPAM_MAX_PRESSES  = 3;      // max presses per second before considered spam
const SPAM_WINDOW_MS    = 3000;  // how long the rate must be sustained (ms)
const LOCKOUT_MS        = 10000;  // how long inputs are ignored (ms)
const FLASH_INTERVAL_MS = 250;    // lockout LED flash speed (ms)

// Spam protection state
const pressTimestamps = [];
let spamStart = null;
let lockedOut = false;
let lockoutTimer = null;
let flashInterval = null;

function checkSpam() {
  const now = Date.now();
  while (pressTimestamps.length && pressTimestamps[0] < now - 1000) {
    pressTimestamps.shift();
  }
  if (pressTimestamps.length > SPAM_MAX_PRESSES) {
    if (!spamStart) spamStart = now;
    if (now - spamStart >= SPAM_WINDOW_MS) {
      triggerLockout();
    }
  } else {
    spamStart = null;
  }
}

function triggerLockout() {
  if (lockedOut) return;
  lockedOut = true;
  spamStart = null;
  pressTimestamps.length = 0;

  if (controllerRef) {
    for (const code of Object.values(PAD_MAP)) {
      if (controllerRef.pressed.has(code)) {
        controllerRef.release(code);
      }
    }
  }

  let flashOn = true;
  flashInterval = setInterval(() => {
    lastLED = {};
    for (const noteStr of Object.keys(PAD_MAP)) {
      setLED(parseInt(noteStr), flashOn ? COLORS.RED : COLORS.OFF);
    }
    flashOn = !flashOn;
  }, FLASH_INTERVAL_MS);

  lockoutTimer = setTimeout(() => {
    lockedOut = false;
    clearInterval(flashInterval);
    flashInterval = null;
    renderAllLEDs();
  }, LOCKOUT_MS);
}

function setLED(note, velocity) {
  if (!midiOutput || lastLED[note] === velocity) return;
  lastLED[note] = velocity;
  if (velocity === 0) {
    midiOutput.send([0x80, note, 0]);
  } else {
    midiOutput.send([0x90, note, velocity]);
  }
}

function colorForNote(note, active) {
  const row = Math.floor(note / 16);
  const theme = ROW_THEME[row];
  if (!theme) return active ? COLORS.AMBER : COLORS.OFF;
  return active ? theme.active : theme.idle;
}

function renderAllLEDs() {
  // Reset cache so every value gets re-sent
  lastLED = {};
  // Clear everything
  for (let note = 0; note < 128; note++) setLED(note, COLORS.OFF);
  // Light mapped pads in idle color
  for (const noteStr of Object.keys(PAD_MAP)) {
    const note = parseInt(noteStr);
    const active = controllerRef && controllerRef.pressed.has(PAD_MAP[note]);
    setLED(note, colorForNote(note, active));
  }
}

// Sync LED state with controller.pressed (picks up keyboard + websocket presses)
function syncLEDs() {
  if (!controllerRef || !midiOutput || lockedOut) return;
  for (const [noteStr, code] of Object.entries(PAD_MAP)) {
    const note = parseInt(noteStr);
    const active = controllerRef.pressed.has(code);
    setLED(note, colorForNote(note, active));
  }
}

/**
 * Connect to a Launchpad Mini and wire it into the controller.
 * @param {MomentaryController} controller
 * @param {(code: string) => void} onPress   — called on pad press (handle ws sync etc.)
 * @param {(code: string) => void} onRelease — called on pad release
 */
export function setupLaunchpad(controller, onPress, onRelease) {
  controllerRef = controller;

  if (!navigator.requestMIDIAccess) {
    console.warn('Launchpad: Web MIDI API not available');
    return;
  }

  navigator.requestMIDIAccess().then(access => {
    let input = null;
    let output = null;

    for (const i of access.inputs.values()) {
      if (i.name.includes('Launchpad')) { input = i; break; }
    }
    for (const o of access.outputs.values()) {
      if (o.name.includes('Launchpad')) { output = o; break; }
    }

    if (!output) {
      console.warn('Launchpad: output not found');
      return;
    }
    midiOutput = output;
    console.log('Launchpad: connected →', output.name);

    // Show initial layout
    renderAllLEDs();

    if (input) {
      input.onmidimessage = (e) => {
        const [status, note, velocity] = e.data;
        const code = PAD_MAP[note];
        if (!code || !BUTTON_MAP[code]) return;

        if ((status & 0xF0) === 0x90 && velocity > 0) {
          pressTimestamps.push(Date.now());
          checkSpam();
          if (lockedOut) return;
          onPress(code);
          setLED(note, colorForNote(note, true));
        } else {
          if (lockedOut) return;
          onRelease(code);
          setLED(note, colorForNote(note, false));
        }
      };
    }

    // Periodically sync LEDs so keyboard / websocket presses also show up
    setInterval(syncLEDs, 80);

    // Re-render if devices change (hot-plug / reconnect)
    access.onstatechange = () => {
      for (const o of access.outputs.values()) {
        if (o.name.includes('Launchpad') && o.state === 'connected') {
          midiOutput = o;
          renderAllLEDs();
          break;
        }
      }
      for (const i of access.inputs.values()) {
        if (i.name.includes('Launchpad') && i.state === 'connected') {
          i.onmidimessage = (e) => {
            const [status, note, velocity] = e.data;
            const code = PAD_MAP[note];
            if (!code || !BUTTON_MAP[code]) return;
            if ((status & 0xF0) === 0x90 && velocity > 0) {
              pressTimestamps.push(Date.now());
              checkSpam();
              if (lockedOut) return;
              onPress(code);
              setLED(note, colorForNote(note, true));
            } else {
              if (lockedOut) return;
              onRelease(code);
              setLED(note, colorForNote(note, false));
            }
          };
          break;
        }
      }
    };
  }).catch(err => {
    console.warn('Launchpad: MIDI access denied', err);
  });
}
