import soundsFiles from './soundsFiles.js';
import { BUTTON_MAP } from '../controller.js';

// ─── Tone.js lazy loader + particle white-noise engine (merged from root audio.js) ───

let Tone = null;
let audioInitialized = false;
let audioContextStarted = false;
let redNoises = [];
let particleReverb = null;

// Exposed audio params — controller pushes values here each frame
export const audioParams = {
    filterQ: 15,
    reverbWet: 0.9,
    minVol: -15,
    maxVol: -10,
};

export function applyAudioParams(params) {
    if (!audioInitialized) return;

    if (params.filterQ !== undefined) {
        audioParams.filterQ = params.filterQ;
        for (const ch of redNoises) {
            ch.filter.Q.value = params.filterQ;
        }
    }
    if (params.reverbWet !== undefined) {
        audioParams.reverbWet = params.reverbWet;
        if (particleReverb) particleReverb.wet.value = params.reverbWet;
    }
    if (params.minVol !== undefined) audioParams.minVol = params.minVol;
    if (params.maxVol !== undefined) audioParams.maxVol = params.maxVol;
}

export async function startAudioContext() {
    if (!audioContextStarted) {
        console.log('Starting Tone.js...');
        Tone = await import('tone');
        await Tone.start();
        Tone.context.lookAhead = 0.1;
        Tone.context.updateInterval = 0.1;
        console.log('Tone.js started, context state:', Tone.context.state);
        audioContextStarted = true;
    }
}

export function isAudioStarted() {
    return audioContextStarted;
}

export function initAudio(redCount) {
    if (!audioInitialized && audioContextStarted) {
        console.log('Initializing audio...');
        console.log('Tone context state:', Tone.context.state);
        console.log('Tone context destination:', Tone.Destination);

        // Create a shared reverb effect
        particleReverb = new Tone.Reverb({
            decay: 20.5,
            wet: 0.9,
            preDelay: 0.01
        });
        const particleMaster = new Tone.Volume(0);
        particleReverb.connect(particleMaster);
        particleMaster.toDestination();

        const particleSlider = document.getElementById("particle-volume");
        if (particleSlider) {
            particleMaster.volume.value = Number(particleSlider.value);
            particleSlider.oninput = () => { particleMaster.volume.value = Number(particleSlider.value); };
        }

        // Create audio players for each red particle
        for (let i = 0; i < redCount; i++) {
            const noise = new Tone.Noise('white');
            noise.start();

            const filter = new Tone.Filter({
                type: "bandpass",
                frequency: 5000,
                Q: 15,
                rolloff: -24
            });

            const volume = new Tone.Volume(-2);

            const panner = new Tone.Panner3D({
                panningModel: 'HRTF',
                positionX: 0,
                positionY: 0,
                positionZ: 0
            });

            // Connect: noise -> filter -> volume -> reverb -> output
            noise.connect(filter);
            filter.connect(volume);
            volume.connect(particleReverb);

            redNoises.push({
                source: noise,
                filter,
                volume,
                panner,
                isOscillator: false
            });
        }

        console.log(`Created ${redCount} audio players for red particles`);
        audioInitialized = true;
        console.log('Audio initialized - samples started');
    }
}

export function updateAudio(redSpeeds, particles, forceControls) {
    if (!forceControls.soundEnabled || redSpeeds.length === 0 || !audioContextStarted) return;

    // Initialize audio on first use
    if (!audioInitialized) {
        initAudio(redSpeeds.length);
    }

    const now = Tone.now();
    const minFreq = 100;
    const maxFreq = forceControls.soundFrequency * 2;
    const minVol = audioParams.minVol;
    const maxVol = audioParams.maxVol;

    // Update each red particle's audio
    for (let i = 0; i < redSpeeds.length; i++) {
        const { speed, bufferIndex } = redSpeeds[i];

        // Get the particle to calculate distance
        const particle = particles.find(p => p.bufferKind === 'RED' && p.bufferIndex === bufferIndex);
        if (!particle) continue;

        const audioChannel = redNoises[bufferIndex];

        if (audioChannel) {
            // Update 3D panner position (scale down for reasonable audio space)
            const scale = 0.01;
            audioChannel.panner.positionX.linearRampToValueAtTime(particle.position.x * scale, now + 0.05);
            audioChannel.panner.positionY.linearRampToValueAtTime(particle.position.y * scale, now + 0.05);
            audioChannel.panner.positionZ.linearRampToValueAtTime(particle.position.z * scale, now + 0.05);

            // Map speed to filter frequency
            const speedNormalized = Math.min(speed / forceControls.soundSpeedMax, 2);
            let targetFreq = minFreq + (maxFreq - minFreq) * speedNormalized;

            // Update filter frequency
            audioChannel.filter.frequency.linearRampToValueAtTime(targetFreq, now + 0.05);

            // Map speed to volume (louder when faster)
            let targetVol = minVol + (maxVol - minVol) * speedNormalized;

            // Smooth volume changes
            audioChannel.volume.volume.linearRampToValueAtTime(targetVol, now + 0.05);
        }
    }
}

// ─── Music mixer ───

let noSound = false
let sounds = []
export var audioTrack = []

const bc = new BroadcastChannel("sceneValues");

let columnNo = 4
let sliderNosByScenes = []
export let rampTime = 1
let lastSlider = 0
let intervals = []
let midiConnected = true

let maxSLidersActive = 10

let mainVolume = -10

export function setRampTime(newTime){
    rampTime = newTime
}

let selection = {
    scene: 0,
    row: 0,
    col: 0,
    no: 0,
    parameter: 0
}

let lastUpdatedSliders = []

let soundFileDir = "samples-compressed/"

// Audio Effects — all created lazily inside setupAudio()

let meter
let meterCanvas, meterCtx, meterAnimId

let highpass
let mainGains = []
let reverbGains = []
var reverbSlider = []
var defaultReverbGain = 1
let reverbFx

let fx2Gains = []
let fx2Slider = []
let delay

// Convolution reverb (space_verb.mp3)
let convReverb
let convSend

// Algorithmic reverb send (like drone.js algoSend)
let algoSend

// Convolution reverb master (Reverb slider)
let reverbMaster

// Algorithmic reverb master (Hall slider)
let algoMaster

// Dry master volume (slider controls this)
let dryMaster

// Per-voice filter + animation
let voiceFilters = []
let filterSliders = []
let filterAnimState = []
let filterAnimId = null

// Per-voice delay animation
let delaySliders = []
let delayAnimState = []

// Per-voice volume animation
let volAnimState = []
let volRampActive = new Set()

// Indices by category
let padIndices = []
let toppingIndices = []
let oneshotSet = new Set()

// Oneshot handling (like drone.js)
let oneshotIndices = []

// Key oneshot players — one per BUTTON_MAP key, reuses loaded buffers
const keyPlayers = {}
const keySoundNames = {}
let keySoundsReady = false
let keySoundsMaster = null

// Track which voices are disconnected from the graph
const disconnected = new Set()

// Disconnect player from audio graph when volume is 0
function stopIfSilent(i) {
    if (oneshotSet.has(i) || disconnected.has(i)) return
    if (sounds[i] && voiceFilters[i]) {
        sounds[i].disconnect(voiceFilters[i])
        disconnected.add(i)
    }
}

// Reconnect player to audio graph when volume > 0
function startIfNeeded(i) {
    if (oneshotSet.has(i) || !disconnected.has(i)) return
    if (sounds[i] && voiceFilters[i]) {
        sounds[i].connect(voiceFilters[i])
        disconnected.delete(i)
    }
}
// Build oneshot players for each BUTTON_MAP key (called after all samples loaded)
function initKeySounds() {
    const keys = Object.keys(BUTTON_MAP)
    // Only use oneshot samples for key triggers
    const loaded = []
    for (let i = 0; i < sounds.length; i++) {
        if (sounds[i] && sounds[i].buffer && sounds[i].buffer.duration > 0
            && soundsFiles[i].startsWith('oneshots/')) {
            loaded.push(i)
        }
    }
    if (loaded.length === 0) return

    keySoundsMaster = new Tone.Volume(6)
    const keySendConv = new Tone.Volume(-6)
    const keySendAlgo = new Tone.Volume(-6)
    keySoundsMaster.connect(dryMaster)
    keySoundsMaster.connect(keySendConv)
    keySoundsMaster.connect(keySendAlgo)
    keySendConv.connect(convSend)
    keySendAlgo.connect(algoSend)

    // Oneshots volume slider
    const slider = document.getElementById("oneshot-volume")
    if (slider) {
        keySoundsMaster.volume.value = Number(slider.value)
        slider.oninput = () => { keySoundsMaster.volume.value = Number(slider.value) }
    }

    // Shared animated filter for all oneshots
    const sharedFilter = new Tone.Filter({
        type: 'bandpass',
        frequency: 2000,
        Q: 0.5,
        rolloff: -12,
    })
    sharedFilter.connect(keySoundsMaster)
    const filterAnim = { phase: 0, speed: 0.65 + Math.random() * 0.3 }

    keys.forEach((code, i) => {
        const soundIdx = loaded[i % loaded.length]
        const player = new Tone.Player({ loop: false })
        player.buffer = sounds[soundIdx].buffer
        player.connect(sharedFilter)
        keyPlayers[code] = player
        keySoundNames[code] = soundsFiles[soundIdx].split('/').pop().replace(/\.(mp3|wav)$/, '')
    })

    // Animate filter with drifting sine
    setInterval(() => {
        filterAnim.phase += filterAnim.speed * 0.15
        const norm = (Math.sin(filterAnim.phase) + 1) / 2
        sharedFilter.frequency.value = 400 * Math.pow(8000 / 400, norm)
    }, 150)

    keySoundsReady = true
    console.log('Key → Sound mapping:', Object.entries(keySoundNames).map(([k, v]) => `${BUTTON_MAP[k].name} → ${v}`).join(', '))
}

export function playKeyOneshot(code) {
    if (!keySoundsReady || !keyPlayers[code]) return
    const player = keyPlayers[code]
    if (!player.loaded) return
    if (player.state === 'started') player.stop()
    player.start()
    console.log(`[${BUTTON_MAP[code].name}] ${keySoundNames[code]}`)
}

let oneshotTimer = null

let multiband

export function setupAudio() {

    // Tone is already loaded by startAudioContext() in audio.js
    highpass = new Tone.Filter(80, "highpass");

    multiband = createMultibandCompressor();
    multiband.output.toDestination();

    // Convolution reverb output (Reverb slider)
    reverbMaster = new Tone.Volume(0);
    reverbMaster.connect(multiband.input);

    // Algorithmic reverb output (Hall slider)
    algoMaster = new Tone.Volume(0);
    algoMaster.connect(multiband.input);

    // Dry output (Dry slider)
    dryMaster = new Tone.Volume(0);
    dryMaster.connect(multiband.input);

    reverbFx = new Tone.Reverb({ decay: 15, wet: 1, preDelay: 0.9 });
    reverbFx.connect(algoMaster);
    algoSend = new Tone.Volume(0);
    algoSend.connect(highpass);
    highpass.connect(reverbFx);

    delay = new Tone.PingPongDelay({
        delayTime: "16n",
        feedback: 0.8,
        wet: 1,
    });
    // Convolution reverb from space_verb.mp3
    convReverb = new Tone.Convolver({ url: '/space_verb.mp3', wet: 1 });
    convReverb.connect(reverbMaster);
    convSend = new Tone.Volume(0);
    convSend.connect(convReverb);

    const delayVolume = new Tone.Volume(0);
    delay.connect(delayVolume);
    delayVolume.connect(dryMaster);

    // Audio meter on master output
    meter = new Tone.Meter();
    Tone.Destination.connect(meter);
    meterCanvas = document.getElementById("meter");
    if (meterCanvas) {
        meterCtx = meterCanvas.getContext("2d");
        drawMeter();
    }

    let loadedCount = 0;
    const totalSounds = soundsFiles.length;

    function onSoundLoaded() {
        loadedCount++;
        const helloEl = document.getElementById("helloContainer");
        if (helloEl) {
            helloEl.innerHTML = `<h1>Loaded sound ${loadedCount} of ${totalSounds}</h1>`
            if (loadedCount === totalSounds) {
                document.getElementById("helloBackground").classList.add("hide")
                Tone.Transport.start()
                setRandomAvScene()
                initKeySounds()
            }
        }
    }

    soundsFiles.sort()
    for (let i = 0; i < soundsFiles.length; i++) {
        const isOneshot = soundsFiles[i].startsWith('oneshots/')

        sounds[i] = new Tone.Player({
            url: soundFileDir + soundsFiles[i],
            loop: !isOneshot,
            onload: onSoundLoaded,
            onerror: (err) => {
                console.warn("Failed to load: " + soundsFiles[i], err);
                onSoundLoaded();
            }
        })

        if (soundsFiles[i].startsWith('pads/')) padIndices.push(i)
        if (soundsFiles[i].startsWith('toppings/')) toppingIndices.push(i)

        if (isOneshot) {
            // Oneshots: don't sync to transport, trigger randomly like drone.js
            sounds[i].volume.value = mainVolume
            oneshotIndices.push(i)
            oneshotSet.add(i)
        } else {
            // Loops: sync to transport, auto-start
            sounds[i].sync()
            sounds[i].volume.value = mainVolume
            if (midiConnected) sounds[i].start(0)
        }

        let defaultGain = Tone.gainToDb(defaultReverbGain)

        mainGains[i] = new Tone.Channel({volume: -140, channelCount: 2})
        fx2Gains[i] = new Tone.Channel({
            volume: -140,
            channelCount: 2
        }).connect(delay)

        // Per-voice animated lowpass filter
        voiceFilters[i] = new Tone.Filter({
            type: 'lowpass',
            frequency: 2000 + Math.random() * 16000,
            Q: 5 + Math.random() * 10,
            rolloff: -24,
        })
        filterAnimState[i] = {
            freqPhase: (i / soundsFiles.length) * Math.PI * 2,
            freqSpeed: 0.05 + Math.random() * 0.2,
        }
        delayAnimState[i] = {
            phase: (i / soundsFiles.length) * Math.PI * 2 + Math.PI / 3,
            speed: 0.02 + Math.random() * 0.1,
        }
        volAnimState[i] = {
            phase: (i / soundsFiles.length) * Math.PI * 2 + Math.PI / 2,
            speed: 0.03 + Math.random() * 0.08,
        }

        sounds[i].connect(voiceFilters[i])
        voiceFilters[i].connect(mainGains[i])
        mainGains[i].connect(convSend)
        mainGains[i].connect(algoSend)
        mainGains[i].connect(fx2Gains[i])

        mainGains[i].connect(dryMaster)
    }

    Tone.Transport.loop = true;
    Tone.Transport.loopStart = "1m";
    Tone.Transport.bpm.value = 120;
    Tone.Transport.loopEnd = "8m";

    let lastFolder = ""
    let containerDiv
    let offset = 0
    let slidersinCurrentScene = []
    let sceneNo = -1

    for (let i = 0; i < sounds.length; i++) {

        let folderName = soundsFiles[i].split('/')[0]

        //Create a new section
        if (folderName !== lastFolder) {
            sceneNo++

            if (slidersinCurrentScene.length > 0) {
                sliderNosByScenes.push(slidersinCurrentScene)
                slidersinCurrentScene = []
            }

            lastFolder = folderName
            containerDiv = document.createElement("div")
            const sceneLabels = { pads: "Pads (Ambient Layers)", toppings: "Toppings (Rhythmic Loops)", oneshots: "Oneshots (Triggered Samples)" }
            containerDiv.innerHTML = "<h3>" + (sceneLabels[folderName] || folderName) + "</h3>";
            containerDiv.classList.add("scene");

            const sliderContainer = document.getElementById("audio-sliders-container");
            if (sliderContainer) {
                sliderContainer.appendChild(containerDiv);
            }
        }

        offset += 40

        const div = document.createElement("div");
        div.style.position = "relative";
        div.innerHTML = `<p class='slider-label'>${soundsFiles[i].split('/')[1]}</p>`;
        div.classList.add("slider-entity");

        containerDiv.appendChild(div);

        slidersinCurrentScene.push(i)

        audioTrack[i] = createNewSlider(0, sceneNo)
        audioTrack[i].sceneName = folderName
        let sliderDomObject = audioTrack[i].slider
        sliderDomObject.addEventListener("input", () => updateSound(i));
        div.appendChild(sliderDomObject)

        // Filter frequency slider
        const filterEl = document.createElement("input")
        filterEl.type = "range"
        filterEl.min = 500
        filterEl.max = 20000
        filterEl.step = 1
        filterEl.className = "filter-slider"
        filterEl.valueAsNumber = voiceFilters[i] ? voiceFilters[i].frequency.value : 5000
        filterEl.addEventListener("input", () => {
            if (voiceFilters[i]) voiceFilters[i].frequency.value = Number(filterEl.value)
        })
        filterSliders[i] = filterEl
        div.appendChild(filterEl)

        // Delay send slider
        const delayEl = document.createElement("input")
        delayEl.type = "range"
        delayEl.min = 0
        delayEl.max = 1
        delayEl.step = 0.01
        delayEl.valueAsNumber = 0
        delayEl.className = "delay-slider"
        delayEl.addEventListener("input", () => {
            fx2Gains[i].volume.value = Tone.gainToDb(Number(delayEl.value))
        })
        delaySliders[i] = delayEl
        div.appendChild(delayEl)

        // Filter Q (resonance) slider
        const qEl = document.createElement("input")
        qEl.type = "range"
        qEl.min = 0
        qEl.max = 30
        qEl.step = 0.1
        qEl.valueAsNumber = voiceFilters[i] ? voiceFilters[i].Q.value : 5
        qEl.className = "q-slider"
        qEl.addEventListener("input", () => {
            if (voiceFilters[i]) voiceFilters[i].Q.value = Number(qEl.value)
        })
        div.appendChild(qEl)

    }
    sliderNosByScenes.push(slidersinCurrentScene)

    // Start filter animation loop (drifting sine from drone.js, ~4fps)
    let lastAnimTime = performance.now()
    filterAnimId = setInterval(() => {
        const now = performance.now()
        const dt = (now - lastAnimTime) / 1000
        lastAnimTime = now

        for (let i = 0; i < voiceFilters.length; i++) {
            if (!voiceFilters[i]) continue
            if (!audioTrack[i] || audioTrack[i].getValue() === 0) {
                stopIfSilent(i)
                if (filterSliders[i] && filterSliders[i].valueAsNumber !== 0) {
                    filterSliders[i].valueAsNumber = 0
                }
                if (delaySliders[i] && delaySliders[i].valueAsNumber !== 0) {
                    delaySliders[i].valueAsNumber = 0
                }
                continue
            }
            startIfNeeded(i)
            // Animate filter
            const s = filterAnimState[i]
            s.freqPhase += s.freqSpeed * dt
            const freqNorm = (Math.sin(s.freqPhase) + 1) / 2
            const freqVal = 1500 * Math.pow(18000 / 1500, freqNorm)
            voiceFilters[i].frequency.value = freqVal
            if (filterSliders[i]) filterSliders[i].valueAsNumber = freqVal

            // Animate delay send
            const d = delayAnimState[i]
            d.phase += d.speed * dt
            const delayNorm = Math.max(0, (Math.sin(d.phase) + 1) / 2)
            fx2Gains[i].volume.value = Tone.gainToDb(delayNorm)
            if (delaySliders[i]) delaySliders[i].valueAsNumber = delayNorm

            // Animate volume (drifting sine like drone.js) — skip during active ramps
            if (!volRampActive.has(i)) {
                const v = volAnimState[i]
                v.phase += v.speed * dt
                const volNorm = Math.max(0, (Math.sin(v.phase) + 1) / 2)
                mainGains[i].volume.value = Tone.gainToDb(volNorm)
                audioTrack[i].slider.value = volNorm
            }
        }
    }, 150)

    // Oneshot scheduling (like drone.js: random interval 5-40s, recursive)
    function scheduleOneshot() {
        if (oneshotIndices.length === 0) return
        const delay = 15000 + Math.random() * 40000
        oneshotTimer = setTimeout(() => {
            const idx = oneshotIndices[Math.floor(Math.random() * oneshotIndices.length)]
            const sound = sounds[idx]
            if (sound && sound.loaded) {
                const vol = 0.5 + Math.random() * 0.5
                // Ramp gain slider up so it's visible and audible
                mainGains[idx].volume.value = Tone.gainToDb(vol)
                if (audioTrack[idx]) audioTrack[idx].slider.value = vol
                sound.start()

                // Fade back down after the sound finishes
                const duration = sound.buffer.duration * 1000
                setTimeout(() => {
                    setSliderValue(0, "gain", 2, idx)
                }, duration)
            }
            // Always reschedule, even if sound wasn't loaded
            scheduleOneshot()
        }, delay)
    }
    // Start scheduling after a short delay to let samples load
    setTimeout(scheduleOneshot, 3000)

    // Auto-trigger random scene every 15–30s once samples are loaded
    let autoSceneTimer = null
    function scheduleRandomScene() {
        const delay = 4000 + Math.random() * 5000
        autoSceneTimer = setTimeout(() => {
            setRandomAvScene()
            scheduleRandomScene()
        }, delay)
    }
    // Wait a bit for samples to load, then start cycling
    setTimeout(scheduleRandomScene, 5000)

    // Reverb amount slider
    const reverbAmountSlider = document.getElementById("reverb-amount")
    if (reverbAmountSlider) {
        reverbMaster.volume.value = Number(reverbAmountSlider.value)
        reverbAmountSlider.oninput = () => {
            reverbMaster.volume.value = Number(reverbAmountSlider.value)
        }
    }

    // Algorithmic reverb output slider (Hall)
    const algoReverbSlider = document.getElementById("algo-reverb")
    if (algoReverbSlider) {
        algoMaster.volume.value = Number(algoReverbSlider.value)
        algoReverbSlider.oninput = () => {
            algoMaster.volume.value = Number(algoReverbSlider.value)
        }
    }

    // Dry volume slider (controls dry output level)
    const dryVolumeSlider = document.getElementById("dry-volume")
    if (dryVolumeSlider) {
        dryMaster.volume.value = Number(dryVolumeSlider.value)
        dryVolumeSlider.oninput = () => {
            dryMaster.volume.value = Number(dryVolumeSlider.value)
        }
    }
}

function drawMeter() {
    if (!meter || !meterCanvas || !meterCtx) return
    const level = meter.getValue()
    const normalized = Math.max(0, Math.min(1, (level + 60) / 60))
    const w = meterCanvas.width
    const h = meterCanvas.height

    meterCtx.fillStyle = '#111'
    meterCtx.fillRect(0, 0, w, h)

    const barW = normalized * w
    let color
    if (normalized < 0.7) color = '#0f0'
    else if (normalized < 0.9) color = '#ff0'
    else color = '#f00'

    meterCtx.fillStyle = color
    meterCtx.fillRect(0, 0, barW, h)

    meterAnimId = requestAnimationFrame(drawMeter)
}

function createNewSlider(value, folderNo) {
    let slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 1;
    slider.step = 1e-18;
    slider.valueAsNumber = value

    let sliderobject = {}
    sliderobject.getValue = () => {
        return Number(slider.value)
    }
    sliderobject.slider = slider
    sliderobject.scene = folderNo

    return sliderobject
}

function updateReverb(i) {
    const newValue = Number(reverbSlider[i].slider.value) * 2
    reverbGains[i].volume.value = Tone.gainToDb(newValue)
}

function updateFx2(i) {
    const newValue = Number(fx2Slider[i].slider.value)
    fx2Gains[i].volume.value = Tone.gainToDb(newValue)
}

export function getAudioTime(){
    return Number(Tone.Transport.seconds)
}

export function toggleAudio() {
    const status = Tone.Transport.state;
    if (status === "started") {
        Tone.Transport.stop()
    } else {
        Tone.Transport.start()
    }
}

export function updateSound(i) {
    if (!noSound) {

        let gain = audioTrack[i].slider.value
        setSliderValue(gain, "gain", 0.1, i)

        if (!midiConnected){
            if (gain === 0) {
                console.log("Stopping Sound " + i)
                sounds[i].stop(0)
            } else {
                if ("started" !== sounds[i].state) {
                    console.log("Starting Sound " + i)
                    sounds[i].start(0)
                }
            }
        }
    }

    //move sliders down, when too many are active
    selection.no = i
    lastUpdatedSliders = [i, ...lastUpdatedSliders.filter(x => x !== i)];
    if (lastUpdatedSliders.length > maxSLidersActive) {
        let removed = lastUpdatedSliders.pop();
        setSliderValue(0, "gain", 3, removed)
    }

    updateVisualMixer(i)
}

function updateVisualMixer(i) {
    let sum = 0;
    let count = 0;

    sliderNosByScenes[audioTrack[i].scene].forEach((index) => {
        sum += Number(audioTrack[index].slider.value);
        count++;
    });

    let avg = sum / count

    // Broadcast the values to other windows/tabs
    bc.postMessage(audioTrack[i].scene + ":" + avg);
}

export function setZero() {
    for (let i = 0; i < soundsFiles.length; i++) {
        mainGains[i].volume.value = Tone.gainToDb(0)
        audioTrack[i].slider.value = 0

        reverbGains[i].volume.value = Tone.gainToDb(defaultReverbGain)
        reverbSlider[i].slider.value = defaultReverbGain

        fx2Slider[i].slider.value = 0
        fx2Gains[i].volume.value = Tone.gainToDb(0)
    }
}

export function selectSliderByNo(newSliderNo) {
    let newSlider = audioTrack[newSliderNo]
    if (undefined === newSlider) return false
    lastSlider = audioTrack[selection.no]
    if (undefined !== lastSlider){
        lastSlider.slider.parentElement.classList.remove("red");
    }
    selection.no = newSliderNo
    newSlider.slider.parentElement.classList.add("red");
    return true
}

//change speed in sec
//Value normalised
export function setSliderValue(value, targetParameter = null, speed = null, controllerNo = null) {

    value = Number(value);

    if (null === controllerNo) controllerNo = selection.no
    let sliderNumber = controllerNo

    // Clear existing interval for this parameter
    if (intervals[sliderNumber + targetParameter] !== undefined) {
        clearInterval(intervals[sliderNumber + targetParameter]);
    }

    let endValue = value;

    if (null === speed) {
        speed = rampTime
    }

    let durationMs = speed * 1000;
    let stepTime = 10;
    let totalSteps = durationMs / stepTime;
    let currentStep = 0;

    let parameterSlider;
    let parameterGain;

    if (targetParameter === "reverb") {
        parameterSlider = reverbSlider[sliderNumber];
        parameterGain = reverbGains[sliderNumber];
    } else if (targetParameter === "delay") {
        parameterSlider = fx2Slider[sliderNumber];
        parameterGain = fx2Gains[sliderNumber];
    } else {
        parameterSlider = audioTrack[sliderNumber];
        parameterGain = mainGains[sliderNumber];
    }

    let isGainRamp = targetParameter !== "reverb" && targetParameter !== "delay"
    if (isGainRamp) volRampActive.add(sliderNumber)

    if (undefined === parameterSlider) return

    // Start player before ramping up
    if (isGainRamp && endValue > 0) startIfNeeded(sliderNumber)
    let startValue = Number(parameterSlider.getValue());

    intervals[sliderNumber + targetParameter] = setInterval(() => {
        currentStep++;
        let currentValue = startValue + (endValue - startValue) * (currentStep / totalSteps);

        if (currentStep < totalSteps) {
            parameterSlider.slider.value = currentValue;
            parameterGain.volume.value = Tone.gainToDb(currentValue);
            updateVisualMixer(sliderNumber);
        } else {
            parameterSlider.slider.value = endValue;
            parameterGain.volume.value = Tone.gainToDb(endValue);
            clearInterval(intervals[sliderNumber + targetParameter]);
            delete intervals[sliderNumber + targetParameter];
            if (isGainRamp) {
                volRampActive.delete(sliderNumber)
                // Stop player when ramped down to zero
                if (endValue === 0) stopIfSilent(sliderNumber)
                // Sync animation phase to current value so it continues smoothly
                if (volAnimState[sliderNumber]) {
                    const clamped = Math.max(-1, Math.min(1, 2 * endValue - 1))
                    volAnimState[sliderNumber].phase = Math.asin(clamped)
                }
            }
        }
    }, stepTime);
}


export function getVelFromCurrentTrack(param){
    return getVelFromTrack(selection.no, param)
}

export function getVelFromTrack(trackNo, param = "gain"){
    if (!audioTrack[trackNo]){
        return
    }
    if (param === "gain"){
        return Number(audioTrack[trackNo].getValue())
    } else if (param === "delay"){
        return Number(fx2Slider[trackNo].getValue());
    } else if (param === "reverb"){
        return Number(reverbSlider[trackNo].getValue());
    }
}

function pickRandom(arr, count) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, Math.min(count, shuffled.length))
}

export function setRandomAvScene() {
    let speedUp = 3
    let speedDown = 5
    let effectGain = 0.7

    // Fade out all active voices
    audioTrack.forEach((track, i) => {
        let volume = track.getValue()
        if (volume > 0.1) {
            setSliderValue(0, null, speedDown, i)
            setSliderValue(0, "delay", speedDown / 2, i)
            setSliderValue(0, "reverb", speedDown / 2, i)
        }
    })

    // Pick 3 pads and 2 toppings
    const chosen = [...pickRandom(padIndices, 4), ...pickRandom(toppingIndices, 2)]

    for (const activeChannelNo of chosen) {
        let volume = 0.5 + Math.random() * 0.5
        setSliderValue(volume, null, speedUp, activeChannelNo)

        let delay = Math.random() * effectGain
        setSliderValue(delay, "delay", speedUp, activeChannelNo)

        let reverb = Math.random() * effectGain
        setSliderValue(reverb, "reverb", speedUp, activeChannelNo)
    }
}

function createMultibandCompressor() {
    const lowFilter = new Tone.Filter(250, "lowpass");
    lowFilter.rolloff = -24;

    const midFilter = new Tone.Filter(250, "highpass");
    midFilter.rolloff = -24;

    const midHighFilter = new Tone.Filter(2500, "lowpass");
    midHighFilter.rolloff = -24;

    const highFilter = new Tone.Filter(2500, "highpass");
    highFilter.rolloff = -24;

    const lowCompressor = new Tone.Compressor({
        threshold: -24,
        ratio: 8,
        attack: 0.005,
        release: 0.05,
        knee: 2
    });

    const midCompressor = new Tone.Compressor({
        threshold: -30,
        ratio: 12,
        attack: 0.003,
        release: 0.1,
        knee: 2
    });

    const highCompressor = new Tone.Compressor({
        threshold: -24,
        ratio: 15,
        attack: 0.001,
        release: 0.03,
        knee: 2
    });

    const lowGain = new Tone.Gain(1);
    const midGain = new Tone.Gain(1);
    const highGain = new Tone.Gain(1);

    const input = new Tone.Gain(1);
    const output = new Tone.Gain(1);

    input.connect(lowFilter);
    lowFilter.connect(lowCompressor);
    lowCompressor.connect(lowGain);
    lowGain.connect(output);

    input.connect(midFilter);
    midFilter.connect(midHighFilter);
    midHighFilter.connect(midCompressor);
    midCompressor.connect(midGain);
    midGain.connect(output);

    input.connect(highFilter);
    highFilter.connect(highCompressor);
    highCompressor.connect(highGain);
    highGain.connect(output);

    return {
        input,
        output,
        filters: { lowFilter, midFilter, midHighFilter, highFilter },
        compressors: { lowCompressor, midCompressor, highCompressor },
        gains: { lowGain, midGain, highGain }
    };
}
