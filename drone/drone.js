import * as Tone from 'tone';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');

let reverb, reverbConv, reverbPreDelay, filters = [], lfos = [], compressor;
let shimmerShift, shimmerGain;
let crackleInterval, chordInterval;
let automationInterval;
let meter, meterCanvas, meterCtx;
let meterAnimationId;

const layers = {};

// Control parameters
const params = {
    synth1Volume: -40,
    synth2Volume: -40,
    bassVolume: -15,
    padVolume: -15,
    airVolume: -15,
    crackleVolume: -15,
    reverbDecay: 80,
    reverbWet: 1,
    automate: false
};

// Layer configurations
const layerConfigs = {
    synth1: {
        oscType: 'sine', attack: 6, decay: 2, sustain: 0.8, release: 10,
        volBase: -18, volStep: 2, detune: 8,
    },
    synth2: {
        oscType: 'triangle', attack: 8, decay: 3, sustain: 0.7, release: 12,
        volBase: -20, volStep: 2, detune: 12,
    },
    bass: {
        oscType: 'sine', attack: 6, decay: 0, sustain: 1, release: 10,
        volBase: -15, volStep: 0, detune: 0,
    },
    pad: {
        oscType: 'triangle', attack: 6, decay: 2, sustain: 0.8, release: 10,
        volBase: -20, volStep: 1.5, detune: 15,
        volLfo: { speed: 0.03, speedRange: 0.05, min: -25, max: -15 },
    },
    air: {
        oscType: 'sine', attack: 8, decay: 3, sustain: 0.6, release: 12,
        volBase: -25, volStep: 2, detune: 20,
        volLfo: { speed: 0.02, speedRange: 0.03, min: -35, max: -20 },
    },
};

// Chord progression — per-layer voicings
const progression = [
    { // Cmaj9
        bass: ['C2'],
        synth1: ['C2', 'G2', 'C3', 'G3', 'C4'],
        synth2: ['E3', 'B3', 'E4', 'B4'],
        pad: ['C3', 'E3', 'G3', 'B3', 'D4'],
        air: ['G5', 'B5', 'D6', 'E6', 'G6'],
    },
    { // Am7
        bass: ['A1'],
        synth1: ['A1', 'E2', 'A2', 'E3', 'A3'],
        synth2: ['C3', 'G3', 'C4', 'G4'],
        pad: ['A2', 'C3', 'E3', 'G3', 'B3'],
        air: ['E5', 'G5', 'B5', 'C6', 'E6'],
    },
    { // Fmaj7(9)
        bass: ['F1'],
        synth1: ['F1', 'C2', 'F2', 'C3', 'F3'],
        synth2: ['A3', 'E4', 'A4', 'C5'],
        pad: ['F2', 'A2', 'C3', 'E3', 'G3'],
        air: ['A5', 'C6', 'E6', 'G6'],
    },
    { // Dm9
        bass: ['D2'],
        synth1: ['D2', 'A2', 'D3', 'A3', 'D4'],
        synth2: ['F3', 'C4', 'F4', 'A4'],
        pad: ['D3', 'F3', 'A3', 'C4', 'E4'],
        air: ['F5', 'A5', 'C6', 'E6'],
    },
    { // Em7
        bass: ['E2'],
        synth1: ['E2', 'B2', 'E3', 'B3', 'E4'],
        synth2: ['G3', 'D4', 'G4', 'B4'],
        pad: ['E3', 'G3', 'B3', 'D4', 'G4'],
        air: ['B5', 'D6', 'G5', 'B5'],
    },
    { // Gsus2
        bass: ['G1'],
        synth1: ['G1', 'D2', 'G2', 'D3', 'G3'],
        synth2: ['A3', 'D4', 'G4', 'A4'],
        pad: ['G2', 'B2', 'D3', 'G3', 'A3'],
        air: ['D5', 'G5', 'A5', 'D6'],
    },
];

let chordIndex = 0;

function setupLayer(name, gainParam, filterOpts, filterLfoOpts) {
    const gain = new Tone.Gain(Tone.dbToGain(params[gainParam])).connect(reverb);
    const filt = new Tone.Filter(filterOpts).connect(gain);
    filters.push(filt);

    if (filterLfoOpts) {
        const lfo = new Tone.LFO(filterLfoOpts.speed, filterLfoOpts.min, filterLfoOpts.max).start();
        if (filterLfoOpts.phase) lfo.phase = filterLfoOpts.phase;
        lfo.connect(filt.frequency);
        lfos.push(lfo);
    }

    layers[name] = { gain, filt, synths: [] };
}

function triggerLayer(name, notes) {
    const layer = layers[name];
    const config = layerConfigs[name];

    // Release old synths — they fade out over release time
    const old = layer.synths;
    old.forEach(s => s.triggerRelease());
    setTimeout(() => old.forEach(s => {
        if (s.lfo) s.lfo.dispose();
        s.dispose();
    }), (config.release + 2) * 1000);

    // Create new synths for this chord
    layer.synths = notes.map((note, i) => {
        const synth = new Tone.Synth({
            oscillator: { type: config.oscType },
            envelope: {
                attack: config.attack,
                decay: config.decay,
                sustain: config.sustain,
                release: config.release
            },
            detune: (Math.random() - 0.5) * config.detune
        });
        synth.volume.value = config.volBase - (i * config.volStep);
        synth.connect(layer.filt);

        if (config.volLfo) {
            const volLfo = new Tone.LFO(
                config.volLfo.speed + Math.random() * config.volLfo.speedRange,
                config.volLfo.min, config.volLfo.max
            ).start();
            volLfo.phase = Math.random() * 360;
            volLfo.connect(synth.volume);
            synth.lfo = volLfo;
        }

        synth.triggerAttack(note);
        return synth;
    });
}

function changeChord() {
    const chord = progression[chordIndex];
    for (const name of Object.keys(layers)) {
        if (chord[name]) {
            triggerLayer(name, chord[name]);
        }
    }
    chordIndex = (chordIndex + 1) % progression.length;
    chordInterval = setTimeout(changeChord, 25000);
}

function crackle() {
    const gainCrackle = new Tone.Gain(Tone.dbToGain(params.crackleVolume)).connect(reverb);
    layers.crackle = { gain: gainCrackle, synths: [] };

    const popSynth = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.002, decay: 0.06, sustain: 0, release: 0.04 }
    });

    const popFilter = new Tone.Filter({ type: 'lowpass', frequency: 2500, Q: 0.5 }).connect(gainCrackle);
    filters.push(popFilter);
    popSynth.connect(popFilter);

    const hiss = new Tone.Noise('brown').start();
    hiss.volume.value = -30;
    const hissFilter = new Tone.Filter({ type: 'bandpass', frequency: 1500, Q: 0.3 }).connect(gainCrackle);
    filters.push(hissFilter);
    hiss.connect(hissFilter);

    function scheduleBurst() {
        if (!crackleInterval) return;
        popSynth.volume.value = -30 + Math.random() * 15;
        popSynth.triggerAttackRelease(0.01 + Math.random() * 0.05);
        crackleInterval = setTimeout(scheduleBurst, 200 + Math.random() * 2000);
    }

    crackleInterval = setTimeout(scheduleBurst, 1000);
    layers.crackle.synths = [popSynth, hiss];
}

function createAmbientIR(rawContext, duration) {
    const sr = rawContext.sampleRate;
    const len = Math.floor(sr * duration);
    const buffer = rawContext.createBuffer(2, len, sr);

    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let lpState = 0;

        for (let i = 0; i < len; i++) {
            const t = i / sr;
            const progress = t / duration;
            const decay = Math.exp(-5 * t / duration);
            const lpCoeff = 0.05 + progress * 0.9;
            const noise = Math.random() * 2 - 1;
            lpState = lpState + (noise - lpState) * (1 - lpCoeff);
            const mod = 1 + 0.12 * Math.sin(t * 0.7 + ch * 1.5) * Math.sin(t * 1.3);
            data[i] = lpState * decay * mod;
        }

        const erTimes = ch === 0
            ? [0.005, 0.012, 0.019, 0.028, 0.039, 0.052, 0.067, 0.085, 0.11, 0.14]
            : [0.007, 0.015, 0.023, 0.033, 0.044, 0.058, 0.075, 0.095, 0.12, 0.16];

        erTimes.forEach((time) => {
            const idx = Math.floor(time * sr);
            if (idx < len) {
                const amp = 0.5 * Math.exp(-4 * time);
                for (let j = 0; j < 4; j++) {
                    if (idx + j < len) {
                        data[idx + j] += (Math.random() * 2 - 1) * amp * (1 - j * 0.25);
                    }
                }
            }
        });

        let max = 0;
        for (let i = 0; i < len; i++) max = Math.max(max, Math.abs(data[i]));
        if (max > 0) {
            const scale = 0.7 / max;
            for (let i = 0; i < len; i++) data[i] *= scale;
        }
    }

    return buffer;
}

async function startDrone() {
    await Tone.start();

    compressor = new Tone.Compressor({
        threshold: -18, ratio: 2.5, attack: 0.05, release: 0.5
    }).toDestination();

    meter = new Tone.Meter();
    compressor.connect(meter);

    // Custom convolution reverb
    reverb = new Tone.Gain(1);
    const ir = createAmbientIR(Tone.getContext().rawContext, 15);
    reverbConv = new Tone.Convolver();
    reverbConv._convolver.buffer = ir;
    reverbPreDelay = new Tone.Delay(0.4);
    reverb.chain(reverbPreDelay, reverbConv, compressor);

    // Shimmer
    shimmerGain = new Tone.Gain(0.25);
    shimmerShift = new Tone.FeedbackDelay({ delayTime: 0.4, feedback: 0.6, wet: 1 });
    const shimmerFilter = new Tone.Filter({ type: 'highpass', frequency: 800 });
    reverbConv.connect(shimmerFilter);
    shimmerFilter.connect(shimmerShift);
    shimmerShift.connect(shimmerGain);
    shimmerGain.connect(compressor);

    // Setup layer chains (gain → filter → reverb, with optional filter LFOs)
    setupLayer('synth1', 'synth1Volume',
        { type: 'lowpass', frequency: 1500, Q: 0.5 },
        { speed: 0.03, min: 600, max: 1500 });

    setupLayer('synth2', 'synth2Volume',
        { type: 'lowpass', frequency: 2000, Q: 0.5 },
        { speed: 0.02, min: 800, max: 2000, phase: 180 });

    setupLayer('bass', 'bassVolume',
        { type: 'lowpass', frequency: 120, Q: 0.3 },
        null);

    setupLayer('pad', 'padVolume',
        { type: 'lowpass', frequency: 2000, Q: 0.5 },
        null);

    setupLayer('air', 'airVolume',
        { type: 'highpass', frequency: 2000, Q: 0.3 },
        null);

    crackle();

    // Trigger first chord and start progression
    chordIndex = 0;
    changeChord();

    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = 'Drone active...';

    drawMeter();
}

function stopDrone() {
    if (chordInterval) {
        clearTimeout(chordInterval);
        chordInterval = null;
    }

    if (crackleInterval) {
        clearTimeout(crackleInterval);
        crackleInterval = null;
    }

    if (automationInterval) {
        clearInterval(automationInterval);
        automationInterval = null;
    }

    // Release all layer synths
    for (const layer of Object.values(layers)) {
        layer.synths.forEach(s => {
            if (s.triggerRelease) s.triggerRelease();
        });
    }

    if (meterAnimationId) {
        cancelAnimationFrame(meterAnimationId);
        meterAnimationId = null;
    }

    setTimeout(() => {
        for (const layer of Object.values(layers)) {
            layer.synths.forEach(s => {
                if (s.lfo) s.lfo.dispose();
                s.dispose();
            });
            layer.synths = [];
            if (layer.gain) layer.gain.dispose();
            if (layer.filt) layer.filt.dispose();
        }
        lfos.forEach(l => l.dispose());
        lfos = [];
        if (shimmerGain) shimmerGain.dispose();
        if (shimmerShift) shimmerShift.dispose();
        if (reverbConv) reverbConv.dispose();
        if (reverbPreDelay) reverbPreDelay.dispose();
        if (reverb) reverb.dispose();
        filters.forEach(f => f.dispose());
        filters = [];
        if (compressor) compressor.dispose();
        if (meter) meter.dispose();

        startBtn.disabled = false;
        stopBtn.disabled = true;
        status.textContent = 'Drone stopped';
    }, 8000);
}

// Draw meter visualization
function drawMeter() {
    if (!meter || !meterCanvas) return;

    const level = meter.getValue();
    const normalizedLevel = Math.max(0, Math.min(1, (level + 60) / 60));

    const width = meterCanvas.width;
    const height = meterCanvas.height;

    meterCtx.fillStyle = '#0a0a1a';
    meterCtx.fillRect(0, 0, width, height);

    const barHeight = normalizedLevel * height;
    let color;
    if (normalizedLevel < 0.7) color = '#00ff00';
    else if (normalizedLevel < 0.9) color = '#ffff00';
    else color = '#ff0000';

    meterCtx.fillStyle = color;
    meterCtx.fillRect(0, height - barHeight, width, barHeight);

    meterCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    [0, -6, -12, -18, -24, -30].forEach(db => {
        const y = height * (1 - (db + 60) / 60);
        meterCtx.fillRect(0, y, width, 1);
    });

    meterCtx.fillStyle = '#fff';
    meterCtx.font = '12px monospace';
    meterCtx.fillText(level.toFixed(1) + ' dB', 5, 15);

    meterAnimationId = requestAnimationFrame(drawMeter);
}

// Setup controls
function setupControls() {
    const controls = document.getElementById('controls');

    const controlDefs = [
        { id: 'synth1Volume', label: 'Synth 1 Vol', min: -40, max: -10, step: 1 },
        { id: 'synth2Volume', label: 'Synth 2 Vol', min: -40, max: -10, step: 1 },
        { id: 'bassVolume', label: 'Bass Vol', min: -40, max: -10, step: 1 },
        { id: 'padVolume', label: 'Pad Vol', min: -40, max: -10, step: 1 },
        { id: 'airVolume', label: 'Air Vol', min: -40, max: -10, step: 1 },
        { id: 'crackleVolume', label: 'Crackle Vol', min: -40, max: 5, step: 1 },
    ];

    // Map param IDs to layer names
    const paramToLayer = {
        synth1Volume: 'synth1', synth2Volume: 'synth2',
        bassVolume: 'bass', padVolume: 'pad',
        airVolume: 'air', crackleVolume: 'crackle',
    };

    controlDefs.forEach(({ id, label, min, max, step }) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'control';

        const labelEl = document.createElement('label');
        labelEl.textContent = label;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = id;
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = params[id];

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'value';
        valueDisplay.textContent = params[id].toFixed(0) + ' dB';

        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            params[id] = value;
            valueDisplay.textContent = value.toFixed(0) + ' dB';

            const layer = layers[paramToLayer[id]];
            if (layer?.gain) layer.gain.gain.rampTo(Tone.dbToGain(value), 0.1);
        });

        wrapper.appendChild(labelEl);
        wrapper.appendChild(slider);
        wrapper.appendChild(valueDisplay);
        controls.appendChild(wrapper);
    });
}

startBtn.addEventListener('click', startDrone);
stopBtn.addEventListener('click', stopDrone);

function initMeter() {
    meterCanvas = document.getElementById('meter');
    if (meterCanvas) {
        meterCtx = meterCanvas.getContext('2d');
    }
}

setupControls();
initMeter();
