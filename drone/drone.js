import * as Tone from 'tone';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');

const padFiles = [
    "/sounds/compressed/pads/01 Andrew's Note.mp3",
    '/sounds/compressed/pads/07 Noise Bass.mp3',
    '/sounds/compressed/pads/08 MM Choir In The Clouds.mp3',
    '/sounds/compressed/pads/15 Crystal Palace hoch.mp3',
    '/sounds/compressed/pads/16 Crystal Palace tief.mp3',
    '/sounds/compressed/pads/eines tages-002.mp3',
    '/sounds/compressed/pads/schreipad.mp3',
    '/sounds/compressed/pads/space_drangels.mp3',
];

const toppingFiles = [
    '/sounds/compressed/toppings/03 Bleeps and More.mp3',
    '/sounds/compressed/toppings/04 v0 Kick.mp3',
    '/sounds/compressed/toppings/05 Polysynthnervös.mp3',
    '/sounds/compressed/toppings/06 Wedding Rhythm.mp3',
    '/sounds/compressed/toppings/09 FH Cracker.mp3',
    '/sounds/compressed/toppings/10 Banshee.mp3',
    '/sounds/compressed/toppings/11 Grid Tom 3.mp3',
    '/sounds/compressed/toppings/12 v1 Clap.mp3',
    '/sounds/compressed/toppings/13 FM Steeldrum.mp3',
    '/sounds/compressed/toppings/netter_bunsenbrenner.mp3',
];

const allFiles = [...padFiles, ...toppingFiles];

function fileName(f) {
    return f.split('/').pop().replace(/\.(mp3|wav)$/, '');
}

const oneshotFiles = [
    '/sounds/compressed/oneshots/14 v9 Crash.mp3',
    '/sounds/compressed/oneshots/eines tages-004.mp3',
    '/sounds/compressed/oneshots/langer_schnauzer.mp3',
];

const NUM_PAD_VOICES = 4;
const NUM_TOPPING_VOICES = 4;
const NUM_VOICES = NUM_PAD_VOICES + NUM_TOPPING_VOICES;
const FADE_TIME = 10;
const MIN_LOOPS = 4;
const MAX_LOOPS = 15;

let voices = [];
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
let lastAnimTime = 0;
let voiceLabels = [];
const sliderRefs = { vol: [], freq: [], reso: [] };

// Per-voice filter animation state
const animState = [];
for (let i = 0; i < NUM_VOICES; i++) {
    animState.push({
        freqPhase: (i / NUM_VOICES) * Math.PI * 2,
        freqSpeed: 0.05 + Math.random() * 0.2,
    });
}

const params = {
    masterVolume: -6,
    spaceVerbSend: -3,
    hallVerbSend: -6,
};

function cycleVoice(index) {
    if (!running) return;

    const isPad = index < NUM_PAD_VOICES;
    const sourcePool = isPad ? padFiles : toppingFiles;

    // Collect files currently playing in other voices
    const activeFiles = new Set();
    for (let i = 0; i < voices.length; i++) {
        if (i !== index && voices[i] && voices[i].file) {
            activeFiles.add(voices[i].file);
        }
    }

    // Pick a file that isn't already playing
    const available = sourcePool.filter(f => !activeFiles.has(f));
    const pool = available.length > 0 ? available : sourcePool;
    const file = pool[Math.floor(Math.random() * pool.length)];
    const name = fileName(file);

    const filter = new Tone.Filter({
        type: 'lowpass',
        frequency: 2000 + Math.random() * 16000,
        Q: 5 + Math.random() * 10,
        rolloff: -24,
    });
    filter.connect(masterVol);
    filter.connect(convSend);
    filter.connect(algoSend);

    const player = new Tone.Player({
        url: file,
        loop: true,
        volume: -60,
        onerror: () => {
            console.warn('Failed to load', file, '– skipping');
            player.dispose();
            filter.dispose();
            setTimeout(() => cycleVoice(index), 500);
        },
        onload: () => {
            if (!running) {
                player.dispose();
                filter.dispose();
                return;
            }

            const duration = player.buffer.duration;
            const loopCount = MIN_LOOPS + Math.floor(Math.random() * (MAX_LOOPS - MIN_LOOPS + 1));
            const totalTime = duration * loopCount;

            player.connect(filter);
            player.start();
            player.volume.rampTo(-6, FADE_TIME);

            if (voiceLabels[index]) voiceLabels[index].textContent = name;

            const fadeOutAt = Math.max(0, (totalTime - FADE_TIME) * 1000);
            const fadeOutTimeout = setTimeout(() => {
                if (!player.disposed) {
                    player.volume.rampTo(-60, FADE_TIME);
                }
            }, fadeOutAt);

            const stopTimeout = setTimeout(() => {
                if (!player.disposed) {
                    player.stop();
                    player.dispose();
                }
                filter.dispose();
                if (voiceLabels[index]) voiceLabels[index].textContent = '...';
                cycleVoice(index);
            }, totalTime * 1000);

            voices[index] = { player, filter, file, timeouts: [fadeOutTimeout, stopTimeout] };
        },
    });

    // Store reference immediately so it doesn't get lost
    voices[index] = { player, filter, file, timeouts: [] };
}

async function startDrone() {
    await Tone.start();

    meter = new Tone.Meter();

    compressor = new Tone.Compressor({
        threshold: -30,
        ratio: 5,
        attack: 0.05,
        release: 0.8,
    });
    compressor.connect(meter);
    compressor.toDestination();

    masterVol = new Tone.Volume(params.masterVolume);
    masterVol.connect(compressor);

    reverbConv = new Tone.Convolver({ url: '/sounds/space_verb.mp3', wet: 1 });
    convSend = new Tone.Volume(params.spaceVerbSend);
    convSend.connect(reverbConv);
    reverbConv.connect(compressor);

    reverbAlgo = new Tone.Reverb({ decay: 30, wet: 1, preDelay: 0.1 });
    algoSend = new Tone.Volume(params.hallVerbSend);
    algoSend.connect(reverbAlgo);
    reverbAlgo.connect(compressor);

    // Oneshot players
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
    status.textContent = 'Playing...';
    drawMeter();
    startAnimation();
    scheduleOneshot();

    for (let i = 0; i < NUM_VOICES; i++) {
        // stagger voice starts so they don't all load at once
        setTimeout(() => cycleVoice(i), i * 200);
    }
}

function stopDrone() {
    running = false;

    if (animationId) { clearInterval(animationId); animationId = null; }

    for (const v of voices) {
        if (!v) continue;
        v.timeouts.forEach(t => clearTimeout(t));
        if (v.player && !v.player.disposed) { v.player.stop(); v.player.dispose(); }
        if (v.filter && !v.filter.disposed) v.filter.dispose();
    }
    voices = [];

    if (oneshotTimer) { clearTimeout(oneshotTimer); oneshotTimer = null; }
    oneshotPlayers.forEach(p => p.dispose());
    oneshotPlayers = [];

    if (convSend) { convSend.dispose(); convSend = null; }
    if (reverbConv) { reverbConv.dispose(); reverbConv = null; }
    if (algoSend) { algoSend.dispose(); algoSend = null; }
    if (reverbAlgo) { reverbAlgo.dispose(); reverbAlgo = null; }
    if (masterVol) { masterVol.dispose(); masterVol = null; }
    if (compressor) { compressor.dispose(); compressor = null; }
    if (meter) { meter.dispose(); meter = null; }
    if (meterAnimationId) { cancelAnimationFrame(meterAnimationId); meterAnimationId = null; }

    voiceLabels.forEach(l => { if (l) l.textContent = '...'; });

    startBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = 'Stopped';
}

function showOneshotIndicator(file) {
    if (!oneshotIndicator) return;
    oneshotIndicator.textContent = fileName(file);
    oneshotIndicator.style.opacity = '1';
    setTimeout(() => {
        if (oneshotIndicator) oneshotIndicator.style.opacity = '0';
    }, 3000);
}

function scheduleOneshot() {
    if (!running) return;
    const delay = 5000 + Math.random() * 40000;
    oneshotTimer = setTimeout(() => {
        if (!running) return;
        const idx = Math.floor(Math.random() * oneshotPlayers.length);
        const p = oneshotPlayers[idx];
        if (p && p.loaded) {
            p.volume.value = -15 + Math.random() * 10;
            p.start();
            showOneshotIndicator(oneshotFiles[idx]);
        }
        scheduleOneshot();
    }, delay);
}

const ANIM_INTERVAL = 250; // ms between slider/filter updates

function startAnimation() {
    lastAnimTime = performance.now();
    animationId = setInterval(animate, ANIM_INTERVAL);
}

function animate() {
    if (!running) return;

    const now = performance.now();
    const dt = (now - lastAnimTime) / 1000;
    lastAnimTime = now;

    for (let i = 0; i < NUM_VOICES; i++) {
        const v = voices[i];
        if (!v || !v.player || v.player.disposed) continue;

        // Update volume slider to reflect actual value (tracks rampTo)
        const vol = v.player.volume.value;
        const ref = sliderRefs.vol[i];
        if (ref) {
            ref.slider.value = vol;
            ref.valueDisplay.textContent = Math.round(vol);
        }

        // Animate filter frequency with drifting sine
        const s = animState[i];
        s.freqPhase += s.freqSpeed * dt;
        const freqNorm = (Math.sin(s.freqPhase) + 1) / 2;
        const freqVal = Math.round(1500 * Math.pow(18000 / 1500, freqNorm));
        if (v.filter && !v.filter.disposed) {
            v.filter.frequency.value = freqVal;
        }
        const fRef = sliderRefs.freq[i];
        if (fRef) {
            fRef.slider.value = freqVal;
            fRef.valueDisplay.textContent = freqVal;
        }

        // Update Q slider from actual filter value
        if (v.filter && !v.filter.disposed) {
            const qRef = sliderRefs.reso[i];
            if (qRef) {
                const q = v.filter.Q.value;
                qRef.slider.value = q;
                qRef.valueDisplay.textContent = Math.round(q);
            }
        }
    }
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

function makeVoiceGroup(i) {
    const group = document.createElement('div');
    group.className = 'stem-group';

    const label = document.createElement('div');
    label.className = 'stem-name';
    label.textContent = '...';
    group.appendChild(label);
    voiceLabels[i] = label;

    sliderRefs.vol[i] = makeSlider(group, 'V', -60, 0, 1, -6, (v) => {
        if (voices[i] && voices[i].player && !voices[i].player.disposed) {
            voices[i].player.volume.value = v;
        }
    });

    sliderRefs.freq[i] = makeSlider(group, 'F', 20, 20000, 1, 10000, (v) => {
        if (voices[i] && voices[i].filter && !voices[i].filter.disposed) {
            voices[i].filter.frequency.value = v;
        }
    });

    sliderRefs.reso[i] = makeSlider(group, 'Q', 0, 30, 0.1, 15, (v) => {
        if (voices[i] && voices[i].filter && !voices[i].filter.disposed) {
            voices[i].filter.Q.value = v;
        }
    });

    return group;
}

function setupControls() {
    const controls = document.getElementById('controls');

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

    oneshotIndicator = document.createElement('div');
    oneshotIndicator.style.cssText = 'color:#ff6; font-weight:bold; opacity:0; transition:opacity 0.3s ease-in, opacity 1.5s ease-out; padding:4px 8px;';
    masterRow.appendChild(oneshotIndicator);

    controls.appendChild(masterRow);

    // Pad voices
    const padHeading = document.createElement('h3');
    padHeading.textContent = 'Pads';
    controls.appendChild(padHeading);

    const padGrid = document.createElement('div');
    padGrid.className = 'stem-grid';
    for (let i = 0; i < NUM_PAD_VOICES; i++) {
        padGrid.appendChild(makeVoiceGroup(i));
    }
    controls.appendChild(padGrid);

    // Topping voices
    const topHeading = document.createElement('h3');
    topHeading.textContent = 'Toppings';
    controls.appendChild(topHeading);

    const topGrid = document.createElement('div');
    topGrid.className = 'stem-grid';
    for (let i = NUM_PAD_VOICES; i < NUM_VOICES; i++) {
        topGrid.appendChild(makeVoiceGroup(i));
    }
    controls.appendChild(topGrid);
}

startBtn.addEventListener('click', startDrone);
stopBtn.addEventListener('click', stopDrone);

meterCanvas = document.getElementById('meter');
if (meterCanvas) meterCtx = meterCanvas.getContext('2d');

setupControls();
