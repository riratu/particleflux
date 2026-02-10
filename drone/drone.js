import * as Tone from 'tone';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');

let synths = [];
let group1 = [], group2 = [];
let reverb, filters = [], lfos = [], compressor;
let gain1, gain2;
let shimmerShift, shimmerGain;
let automationInterval;
let volumeAutomationInterval;
let meter, meterCanvas, meterCtx;
let meterAnimationId;

// Control parameters
const params = {
    synth1Volume: -15,
    synth2Volume: -15,
    filterFreq: 800,
    filterQ: 1,
    reverbDecay: 30,
    reverbWet: 1,
    lfo1Speed: 0.1,
    lfo2Speed: 0.05,
    automate: false
};

function synth1(notes) {
    const newSynths = notes.map((note, i) => {
        // Randomly choose oscillator type for each synth
        const types = ['sine', 'sawtooth', 'square'];
        const randomType = types[Math.floor(Math.random() * types.length)];

        const synth = new Tone.Synth({
            oscillator: {
                type: randomType,
            },
            envelope: {
                attack: 4,
                decay: 0,
                sustain: 1,
                release: 8
            }
        }).toDestination();

        synth.volume.value = -15 - (i * 2); // Quieter for upper harmonics
        return {synth, note};
    });

    gain1 = new Tone.Gain(Tone.dbToGain(params.synth1Volume)).connect(reverb);

    // Add filter for movement
    const filt = new Tone.Filter({
        type: 'lowpass',
        frequency: params.filterFreq,
        Q: params.filterQ
    }).connect(gain1);
    filters.push(filt);

    // Reconnect synths through effects chain
    newSynths.forEach(({synth}) => {
        synth.disconnect();
        synth.connect(filt);
    });

    // LFO for subtle modulation
    const lfo = new Tone.LFO(params.lfo1Speed, 400, 5200).start();
    lfo.connect(filt.frequency);
    lfos.push(lfo);

    // Create individual LFOs for each synth with random speeds
    newSynths.forEach(({synth}) => {
        const randomSpeed = 0.1 + Math.random() * 0.15;
        const volLfo = new Tone.LFO(randomSpeed, -20, -10).start();
        volLfo.connect(synth.volume);
        synth.lfo = volLfo; // Store LFO reference on synth for cleanup
    });

    // Start all notes
    newSynths.forEach(({ synth, note }) => {
        synth.triggerAttack(note);
    });

    group1 = newSynths;
    synths.push(...newSynths);
}

function synth2(notes) {
    const newSynths = notes.map((note, i) => {
        // Randomly choose oscillator type for each synth
        const types = ['sine', 'sawtooth', 'square'];
        const randomType = types[Math.floor(Math.random() * types.length)];

        const synth = new Tone.Synth({
            oscillator: {
                type: randomType,
            },
            envelope: {
                attack: 4,
                decay: 0,
                sustain: 1,
                release: 8
            },
            detune: (Math.random() - 0.5) * 200
        }).toDestination();

        synth.volume.value = -15 - (i * 2); // Quieter for upper harmonics
        return {synth, note};
    });

    gain2 = new Tone.Gain(Tone.dbToGain(params.synth2Volume)).connect(reverb);

    // Add filter for movement
    const filt = new Tone.Filter({
        type: 'lowpass',
        frequency: params.filterFreq,
        Q: params.filterQ
    }).connect(gain2);
    filters.push(filt);

    // Reconnect synths through effects chain
    newSynths.forEach(({synth}) => {
        synth.disconnect();
        synth.connect(filt);
    });

    // LFO for subtle modulation
    const lfo = new Tone.LFO(params.lfo1Speed, 400, 5200).start();
    lfo.connect(filt.frequency);
    lfos.push(lfo);

    // Create individual LFOs for each synth with random speeds
    newSynths.forEach(({synth}) => {
        const randomSpeed = 0.1 + Math.random() * 0.15;
        const volLfo = new Tone.LFO(randomSpeed, -20, -10).start();
        volLfo.connect(synth.volume);
        synth.lfo = volLfo; // Store LFO reference on synth for cleanup
    });

    // Start all notes
    newSynths.forEach(({ synth, note }) => {
        synth.triggerAttack(note);
    });

    group2 = newSynths;
    synths.push(...newSynths);
}

function bass(notes) {
    const newSynths = notes.map((note, i) => {
        const synth = new Tone.Synth({
            oscillator: {
                type: "square",
            },
            envelope: {
                attack: 4,
                decay: 0,
                sustain: 1,
                release: 8
            },
            detune: (Math.random() - 0.5) * 5
        }).toDestination();

        synth.volume.value = -15 - (i * 2); // Quieter for upper harmonics
        return {synth, note};
    });

    gain2 = new Tone.Gain(Tone.dbToGain(params.synth2Volume)).connect(reverb);

    // Add filter for movement
    const filt = new Tone.Filter({
        type: 'lowpass',
        frequency: "300",
        Q: params.filterQ
    }).connect(gain2);
    filters.push(filt);

    // Reconnect synths through effects chain
    newSynths.forEach(({synth}) => {
        synth.disconnect();
        synth.connect(filt);
    });

    // LFO for subtle modulation
    const lfo = new Tone.LFO(params.lfo1Speed, 400, 5200).start();
    lfo.connect(filt.frequency);
    lfos.push(lfo);

    // Create individual LFOs for each synth with random speeds
    newSynths.forEach(({synth}) => {
        const randomSpeed = 0.1 + Math.random() * 0.15;
        const volLfo = new Tone.LFO(randomSpeed, -20, -10).start();
        volLfo.connect(synth.volume);
        synth.lfo = volLfo; // Store LFO reference on synth for cleanup
    });

    // Start all notes
    newSynths.forEach(({ synth, note }) => {
        synth.triggerAttack(notes[0]);
    });
}

async function startDrone() {
    await Tone.start();

    // Create compressor for output
    compressor = new Tone.Compressor({
        threshold: -24,
        ratio: 4,
        attack: 0.003,
        release: 0.25
    }).toDestination();

    // Create meter
    meter = new Tone.Meter();
    compressor.connect(meter);

    // Shared reverb
    reverb = new Tone.Reverb({
        decay: params.reverbDecay,
        wet: params.reverbWet
    }).connect(compressor);

    // Shimmer: pitch shift reverb tail up an octave and feed back
    shimmerShift = new Tone.PitchShift({ pitch: 12, wet: 1 });
    shimmerGain = new Tone.Gain(0.3); // feedback amount
    reverb.connect(shimmerShift);
    shimmerShift.connect(shimmerGain);
    shimmerGain.connect(reverb);

    // Create multiple synth layers for richness
    const notes = ['C2', 'G2', 'C3', 'E3', 'G3', 'C4', 'G4', 'C5', 'E5', 'G5'];

    synth1(notes);
    synth2(notes);
    bass(notes);

    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = 'Drone active...';

    // Start automation if enabled
    if (params.automate) {
        automationInterval = setInterval(automateParameters, 3000);
    }

    // Start individual volume automation
    startVolumeAutomation();

    // Start meter visualization
    drawMeter();
}

function stopDrone() {
    synths.forEach(({ synth }) => {
        synth.triggerRelease();
    });

    if (automationInterval) {
        clearInterval(automationInterval);
        automationInterval = null;
    }

    if (volumeAutomationInterval) {
        clearInterval(volumeAutomationInterval);
        volumeAutomationInterval = null;
    }

    if (meterAnimationId) {
        cancelAnimationFrame(meterAnimationId);
        meterAnimationId = null;
    }

    setTimeout(() => {
        synths.forEach(({ synth }) => {
            if (synth.lfo) synth.lfo.dispose();
            synth.dispose();
        });
        synths = [];
        group1 = [];
        group2 = [];
        lfos.forEach(l => l.dispose());
        lfos = [];
        if (shimmerGain) shimmerGain.dispose();
        if (shimmerShift) shimmerShift.dispose();
        if (reverb) reverb.dispose();
        filters.forEach(f => f.dispose());
        filters = [];
        if (gain1) gain1.dispose();
        if (gain2) gain2.dispose();
        if (compressor) compressor.dispose();
        if (meter) meter.dispose();

        startBtn.disabled = false;
        stopBtn.disabled = true;
        status.textContent = 'Drone stopped';
    }, 8000);
}


// Individual synth volume automation
function startVolumeAutomation() {
    volumeAutomationInterval = setInterval(() => {
        const applyToGroup = (group, baseVolume) => {
            group.forEach(({ synth }, i) => {
                const offset = (Math.random() - 0.5) * 6; // +/- 3 dB variation
                const rampTime = 2 + Math.random() * 2;
                synth.volume.rampTo(baseVolume - (i * 2) + offset, rampTime);
            });
        };
        applyToGroup(group1, params.synth1Volume);
        applyToGroup(group2, params.synth2Volume);
    }, 2500);
}

// Draw meter visualization
function drawMeter() {
    if (!meter || !meterCanvas) return;

    const level = meter.getValue(); // Returns dB value
    const normalizedLevel = Math.max(0, Math.min(1, (level + 60) / 60)); // Normalize -60dB to 0dB -> 0 to 1

    const width = meterCanvas.width;
    const height = meterCanvas.height;

    meterCtx.fillStyle = '#0a0a1a';
    meterCtx.fillRect(0, 0, width, height);

    // Draw meter bar
    const barHeight = normalizedLevel * height;

    // Color based on level (green -> yellow -> red)
    let color;
    if (normalizedLevel < 0.7) {
        color = '#00ff00'; // Green
    } else if (normalizedLevel < 0.9) {
        color = '#ffff00'; // Yellow
    } else {
        color = '#ff0000'; // Red (overdriven)
    }

    meterCtx.fillStyle = color;
    meterCtx.fillRect(0, height - barHeight, width, barHeight);

    // Draw dB markings
    meterCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    const dbMarks = [0, -6, -12, -18, -24, -30];
    dbMarks.forEach(db => {
        const y = height * (1 - (db + 60) / 60);
        meterCtx.fillRect(0, y, width, 1);
    });

    // Draw current dB value
    meterCtx.fillStyle = '#fff';
    meterCtx.font = '12px monospace';
    meterCtx.fillText(level.toFixed(1) + ' dB', 5, 15);

    meterAnimationId = requestAnimationFrame(drawMeter);
}

// Setup controls
function setupControls() {
    const controls = document.getElementById('controls');

    const controlDefs = [
        { id: 'synth1Volume', label: 'Synth 1 Vol', min: -40, max: 0, step: 1, gain: () => gain1 },
        { id: 'synth2Volume', label: 'Synth 2 Vol', min: -40, max: 0, step: 1, gain: () => gain2 },
    ];

    controlDefs.forEach(({ id, label, min, max, step, gain }) => {
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

            const g = gain();
            if (g) g.gain.rampTo(Tone.dbToGain(value), 0.1);
        });

        wrapper.appendChild(labelEl);
        wrapper.appendChild(slider);
        wrapper.appendChild(valueDisplay);
        controls.appendChild(wrapper);
    });
}

startBtn.addEventListener('click', startDrone);
stopBtn.addEventListener('click', stopDrone);

// Initialize meter canvas
function initMeter() {
    meterCanvas = document.getElementById('meter');
    if (meterCanvas) {
        meterCtx = meterCanvas.getContext('2d');
    }
}

// Initialize controls on load
setupControls();
initMeter();
