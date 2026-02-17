import * as Tone from 'tone';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');

const stemFiles = [
    "/sounds/stems/01 Andrew's Note.mp3",
    '/sounds/stems/03 Bleeps and More.mp3',
    '/sounds/stems/04 v0 Kick.mp3',
    '/sounds/stems/05 Polysynthnervös.mp3',
    '/sounds/stems/06 Wedding Rhythm.mp3',
    '/sounds/stems/07 Noise Bass.mp3',
    '/sounds/stems/08 MM Choir In The Clouds.mp3',
    '/sounds/stems/09 FH Cracker.mp3',
    '/sounds/stems/10 Banshee.mp3',
    '/sounds/stems/11 Grid Tom 3.mp3',
    '/sounds/stems/12 v1 Clap.mp3',
    '/sounds/stems/13 FM Steeldrum.mp3',
    '/sounds/stems/15 Crystal Palace hoch.mp3',
    '/sounds/stems/16 Crystal Palace tief.mp3',
    '/sounds/stems/eines tages-001.wav',
    '/sounds/stems/eines tages-002.wav',
    '/sounds/stems/eines tages-003.wav',
    '/sounds/stems/eines tages-004.wav',
];

const stemNames = stemFiles.map(f =>
    f.split('/').pop().replace(/\.(mp3|wav)$/, '')
);

const oneshotFiles = [
    '/sounds/oneshots/14 v9 Crash.mp3',
];

let players = [];
let filters = [];
let oneshotPlayers = [];
let oneshotTimer = null;
let oneshotIndicator = null;
let masterVol = null;
let reverbConv = null;
let reverbAlgo = null;
let convSend = null;
let algoSend = null;
let compressor = null;
let meter = null;
let meterCanvas, meterCtx, meterAnimationId;
let running = false;
let animationId = null;
let animationPaused = false;

// All slider refs for animation: { slider, valueDisplay, onChange, min, max }
const sliderRefs = {
    stemVol: [],
    stemFreq: [],
    stemReso: [],
};

// Manual override: when user drags a slider, pause automation for that param
const OVERRIDE_DURATION = 5000; // ms
const manualOverrides = {}; // key -> expiry timestamp

function setManualOverride(stemIndex, param) {
    manualOverrides[`${stemIndex}-${param}`] = Date.now() + OVERRIDE_DURATION;
}

function isOverridden(stemIndex, param) {
    const key = `${stemIndex}-${param}`;
    if (manualOverrides[key] && Date.now() < manualOverrides[key]) {
        return true;
    }
    delete manualOverrides[key];
    return false;
}

// Per-stem animation state: evenly distributed phases so they don't all go quiet at once
const animState = stemNames.map((_, i) => ({
    volPhase: (i / stemNames.length) * Math.PI * 2,
    volSpeed: 0.1 + Math.random() * 0.3,
    freqPhase: ((i + 0.5) / stemNames.length) * Math.PI * 2,
    freqSpeed: 0.05 + Math.random() * 0.2,
}));

const params = {
    masterVolume: -6,
    spaceVerbSend: -3,
    hallVerbSend: -6,
    stemVolumes: stemNames.map(() => -6),
    stemFilterFreqs: stemNames.map(() => 20000),
    stemFilterResos: stemNames.map(() => 15),
};

async function startDrone() {
    await Tone.start();

    meter = new Tone.Meter();

    compressor = new Tone.Compressor({
        threshold: -30,
        ratio: 5,
        attack: 0.05,
        release: 0.2,
    });
    compressor.connect(meter);
    compressor.toDestination();

    // Dry path
    masterVol = new Tone.Volume(params.masterVolume);
    masterVol.connect(compressor);

    // Send 1: Convolver (space_verb.mp3)
    reverbConv = new Tone.Convolver({ url: '/sounds/space_verb.mp3', wet: 1 });
    convSend = new Tone.Volume(params.spaceVerbSend);
    convSend.connect(reverbConv);
    reverbConv.connect(compressor);

    // Send 2: Algorithmic reverb
    reverbAlgo = new Tone.Reverb({ decay: 30, wet: 1, preDelay: 0.1 });
    algoSend = new Tone.Volume(params.hallVerbSend);
    algoSend.connect(reverbAlgo);
    reverbAlgo.connect(compressor);

    for (let i = 0; i < stemFiles.length; i++) {
        const filt = new Tone.Filter({
            type: 'lowpass',
            frequency: params.stemFilterFreqs[i],
            Q: params.stemFilterResos[i],
            rolloff: -24,
        });
        filt.connect(masterVol);
        filt.connect(convSend);
        filt.connect(algoSend);
        filters.push(filt);

        const player = new Tone.Player({
            url: stemFiles[i],
            loop: true,
            autostart: true,
            volume: params.stemVolumes[i],
        });
        player.connect(filt);
        players.push(player);
    }

    // Oneshot players (not looped)
    for (const file of oneshotFiles) {
        const p = new Tone.Player({ url: file, loop: false });
        p.connect(masterVol);
        p.connect(convSend);
        p.connect(algoSend);
        oneshotPlayers.push(p);
    }

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = 'Playing stems...';
    drawMeter();
    startAnimation();
    scheduleOneshot();
}

function stopDrone() {
    running = false;

    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }

    if (oneshotTimer) { clearTimeout(oneshotTimer); oneshotTimer = null; }
    oneshotPlayers.forEach(p => p.dispose());
    oneshotPlayers = [];

    players.forEach(p => {
        p.stop();
        p.dispose();
    });
    players = [];

    filters.forEach(f => f.dispose());
    filters = [];
    if (convSend) { convSend.dispose(); convSend = null; }
    if (reverbConv) { reverbConv.dispose(); reverbConv = null; }
    if (algoSend) { algoSend.dispose(); algoSend = null; }
    if (reverbAlgo) { reverbAlgo.dispose(); reverbAlgo = null; }
    if (masterVol) { masterVol.dispose(); masterVol = null; }
    if (compressor) { compressor.dispose(); compressor = null; }
    if (meter) { meter.dispose(); meter = null; }
    if (meterAnimationId) { cancelAnimationFrame(meterAnimationId); meterAnimationId = null; }

    startBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = 'Stopped';
}

function showOneshotIndicator(file) {
    if (!oneshotIndicator) return;
    const name = file.split('/').pop().replace('.mp3', '');
    oneshotIndicator.textContent = name;
    oneshotIndicator.style.opacity = '1';
    setTimeout(() => {
        if (oneshotIndicator) oneshotIndicator.style.opacity = '0';
    }, 3000);
}

// Random oneshot triggers
function scheduleOneshot() {
    if (!running) return;
    const delay = 5 + Math.random() * 40 * 1000;
    oneshotTimer = setTimeout(() => {
        if (!running) return;
        const idx = Math.floor(Math.random() * oneshotPlayers.length);
        const p = oneshotPlayers[idx];
        if (p && p.loaded) {
            p.volume.value = -15 + Math.random() * 10; // -15 to -5 dB
            p.start();
            showOneshotIndicator(oneshotFiles[idx]);
        }
        scheduleOneshot();
    }, delay);
}

// Animate sliders with slow drifting sine waves
let lastAnimTime = 0;

function startAnimation() {
    lastAnimTime = performance.now();
    animateSliders();
}

function animateSliders() {
    if (!running) return;

    const now = performance.now();
    const dt = (now - lastAnimTime) / 1000;
    lastAnimTime = now;

    for (let i = 0; i < stemNames.length; i++) {
        const s = animState[i];

        if (animationPaused) continue;

        // Advance phases
        s.volPhase += s.volSpeed * dt;
        s.freqPhase += s.freqSpeed * dt;

        // Volume: drift between -25 and -3
        if (!isOverridden(i, 'vol')) {
            const volVal = Math.round(-14 + Math.sin(s.volPhase) * 11);
            updateSlider(sliderRefs.stemVol[i], volVal);
            params.stemVolumes[i] = volVal;
            if (players[i]) players[i].volume.value = volVal;
        }

        // Filter freq: drift between 200 and 18000 (exponential feel via sin)
        if (!isOverridden(i, 'freq')) {
            const freqNorm = (Math.sin(s.freqPhase) + 1) / 2; // 0-1
            const freqVal = Math.round(200 * Math.pow(18000 / 200, freqNorm));
            updateSlider(sliderRefs.stemFreq[i], freqVal);
            params.stemFilterFreqs[i] = freqVal;
            if (filters[i]) filters[i].frequency.value = freqVal;
        }
    }

    animationId = requestAnimationFrame(animateSliders);
}

function updateSlider(ref, value) {
    if (!ref) return;
    ref.slider.value = value;
    ref.valueDisplay.textContent = Number(value).toFixed(0);
}

function drawMeter() {
    if (!meter || !meterCanvas || !running) return;

    const level = meter.getValue();
    const normalizedLevel = Math.max(0, Math.min(1, (level + 60) / 60));

    const width = meterCanvas.width;
    const height = meterCanvas.height;

    meterCtx.fillStyle = '#0a0a1a';
    meterCtx.fillRect(0, 0, width, height);

    const barWidth = normalizedLevel * width;
    let color;
    if (normalizedLevel < 0.7) color = '#00ff00';
    else if (normalizedLevel < 0.9) color = '#ffff00';
    else color = '#ff0000';

    meterCtx.fillStyle = color;
    meterCtx.fillRect(0, 0, barWidth, height);

    meterAnimationId = requestAnimationFrame(drawMeter);
}

function makeSlider(parent, label, min, max, step, value, onChange, overrideKey) {
    const wrapper = document.createElement('div');
    wrapper.className = 'control';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'value';
    valueDisplay.textContent = Number(value).toFixed(0);

    slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        valueDisplay.textContent = v.toFixed(0);
        if (overrideKey) setManualOverride(overrideKey.stem, overrideKey.param);
        onChange(v);
    });

    wrapper.appendChild(labelEl);
    wrapper.appendChild(slider);
    wrapper.appendChild(valueDisplay);
    parent.appendChild(wrapper);

    return { slider, valueDisplay };
}

function setupControls() {
    const controls = document.getElementById('controls');

    // Master volume row
    const masterRow = document.createElement('div');
    masterRow.className = 'master-control';
    makeSlider(masterRow, 'Master', -60, 0, 1, params.masterVolume, (v) => {
        params.masterVolume = v;
        if (masterVol) masterVol.volume.value = v;
    });
    makeSlider(masterRow, 'Space Verb', -60, 0, 1, params.spaceVerbSend, (v) => {
        params.spaceVerbSend = v;
        if (convSend) convSend.volume.value = v;
    });
    makeSlider(masterRow, 'Hall Verb', -60, 0, 1, params.hallVerbSend, (v) => {
        params.hallVerbSend = v;
        if (algoSend) algoSend.volume.value = v;
    });
    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'Pause Animation';
    pauseBtn.addEventListener('click', () => {
        animationPaused = !animationPaused;
        pauseBtn.textContent = animationPaused ? 'Resume Animation' : 'Pause Animation';
    });
    masterRow.appendChild(pauseBtn);

    oneshotIndicator = document.createElement('div');
    oneshotIndicator.style.cssText = 'color:#ff6; font-weight:bold; opacity:0; transition:opacity 0.3s ease-in, opacity 1.5s ease-out; padding:4px 8px;';
    masterRow.appendChild(oneshotIndicator);

    controls.appendChild(masterRow);

    // Grid of stem groups
    const grid = document.createElement('div');
    grid.className = 'stem-grid';
    controls.appendChild(grid);

    stemNames.forEach((name, i) => {
        const group = document.createElement('div');
        group.className = 'stem-group';

        const heading = document.createElement('div');
        heading.className = 'stem-name';
        heading.textContent = name;
        group.appendChild(heading);

        sliderRefs.stemVol[i] = makeSlider(group, 'V', -60, 0, 1, params.stemVolumes[i], (v) => {
            params.stemVolumes[i] = v;
            if (players[i]) players[i].volume.value = v;
        }, { stem: i, param: 'vol' });

        sliderRefs.stemFreq[i] = makeSlider(group, 'F', 20, 20000, 1, params.stemFilterFreqs[i], (v) => {
            params.stemFilterFreqs[i] = v;
            if (filters[i]) filters[i].frequency.value = v;
        }, { stem: i, param: 'freq' });

        sliderRefs.stemReso[i] = makeSlider(group, 'Q', 0, 30, 0.1, params.stemFilterResos[i], (v) => {
            params.stemFilterResos[i] = v;
            if (filters[i]) filters[i].Q.value = v;
        }, { stem: i, param: 'reso' });

        grid.appendChild(group);
    });
}

startBtn.addEventListener('click', startDrone);
stopBtn.addEventListener('click', stopDrone);

meterCanvas = document.getElementById('meter');
if (meterCanvas) meterCtx = meterCanvas.getContext('2d');

setupControls();