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
];

const stemNames = stemFiles.map(f =>
    f.split('/').pop().replace('.mp3', '')
);

let players = [];
let filters = [];
let masterVol = null;
let reverb = null;
let meter = null;
let meterCanvas, meterCtx, meterAnimationId;
let running = false;
let animationId = null;

// All slider refs for animation: { slider, valueDisplay, onChange, min, max }
const sliderRefs = {
    stemVol: [],
    stemFreq: [],
    stemReso: [],
};

// Per-stem animation state: each has its own slow random LFO phase + speed
const animState = stemNames.map(() => ({
    volPhase: Math.random() * Math.PI * 2,
    volSpeed: 0.1 + Math.random() * 0.3,
    freqPhase: Math.random() * Math.PI * 2,
    freqSpeed: 0.05 + Math.random() * 0.2,
    resoPhase: Math.random() * Math.PI * 2,
    resoSpeed: 0.08 + Math.random() * 0.15,
}));

const params = {
    masterVolume: -6,
    stemVolumes: stemNames.map(() => -6),
    stemFilterFreqs: stemNames.map(() => 20000),
    stemFilterResos: stemNames.map(() => 0),
};

async function startDrone() {
    await Tone.start();

    meter = new Tone.Meter();

    reverb = new Tone.Reverb({ decay: 30, wet: 0.6, preDelay: 0.1 });
    await reverb.generate();

    masterVol = new Tone.Volume(params.masterVolume);
    masterVol.connect(meter);
    masterVol.toDestination();

    reverb.connect(masterVol);

    for (let i = 0; i < stemFiles.length; i++) {
        const filt = new Tone.Filter({
            type: 'lowpass',
            frequency: params.stemFilterFreqs[i],
            Q: params.stemFilterResos[i],
            rolloff: -24,
        });
        filt.connect(masterVol);
        filt.connect(reverb);
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

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = 'Playing stems...';
    drawMeter();
    startAnimation();
}

function stopDrone() {
    running = false;

    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }

    players.forEach(p => {
        p.stop();
        p.dispose();
    });
    players = [];

    filters.forEach(f => f.dispose());
    filters = [];
    if (reverb) { reverb.dispose(); reverb = null; }
    if (masterVol) { masterVol.dispose(); masterVol = null; }
    if (meter) { meter.dispose(); meter = null; }
    if (meterAnimationId) { cancelAnimationFrame(meterAnimationId); meterAnimationId = null; }

    startBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = 'Stopped';
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

        // Advance phases
        s.volPhase += s.volSpeed * dt;
        s.freqPhase += s.freqSpeed * dt;
        s.resoPhase += s.resoSpeed * dt;

        // Volume: drift between -40 and 0
        const volVal = Math.round(-20 + Math.sin(s.volPhase) * 20);
        updateSlider(sliderRefs.stemVol[i], volVal);
        params.stemVolumes[i] = volVal;
        if (players[i]) players[i].volume.value = volVal;

        // Filter freq: drift between 200 and 18000 (exponential feel via sin)
        const freqNorm = (Math.sin(s.freqPhase) + 1) / 2; // 0-1
        const freqVal = Math.round(200 * Math.pow(18000 / 200, freqNorm));
        updateSlider(sliderRefs.stemFreq[i], freqVal);
        params.stemFilterFreqs[i] = freqVal;
        if (filters[i]) filters[i].frequency.value = freqVal;

        // Resonance: drift between 0 and 12
        const resoVal = Math.round((Math.sin(s.resoPhase) + 1) * 6 * 10) / 10;
        updateSlider(sliderRefs.stemReso[i], resoVal);
        params.stemFilterResos[i] = resoVal;
        if (filters[i]) filters[i].Q.value = resoVal;
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

function makeSlider(parent, label, min, max, step, value, onChange) {
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
        });

        sliderRefs.stemFreq[i] = makeSlider(group, 'F', 20, 20000, 1, params.stemFilterFreqs[i], (v) => {
            params.stemFilterFreqs[i] = v;
            if (filters[i]) filters[i].frequency.value = v;
        });

        sliderRefs.stemReso[i] = makeSlider(group, 'Q', 0, 30, 0.1, params.stemFilterResos[i], (v) => {
            params.stemFilterResos[i] = v;
            if (filters[i]) filters[i].Q.value = v;
        });

        grid.appendChild(group);
    });
}

startBtn.addEventListener('click', startDrone);
stopBtn.addEventListener('click', stopDrone);

meterCanvas = document.getElementById('meter');
if (meterCanvas) meterCtx = meterCanvas.getContext('2d');

setupControls();