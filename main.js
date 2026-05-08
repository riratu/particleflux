import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui'
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RectAreaLightHelper} from 'three/addons/helpers/RectAreaLightHelper.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { startAudioContext, isAudioStarted, initAudio, updateAudio, applyAudioParams, setupAudio as setupMixer, setRandomAvScene, playKeyOneshot, stopAudio, resumeAudio } from './audio/audio.js';
import { MomentaryController, PARAMS } from './controller.js';
import { startHistory, stopHistory, recordFrame } from './paramHistory.js';
import { setupLaunchpad } from './launchpad.js';
import velocityShader from './shaders/velocity.glsl?raw';
import positionShader from './shaders/position.glsl?raw';

const scene = new THREE.Scene();

// Add fog for depth perception with red shift
scene.fog = new THREE.Fog(0x550000, 50, 1000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({antialias: true});
const oControls = new OrbitControls(camera, renderer.domElement);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// HDR tone mapping to prevent bloom blow-out
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;  // Adjust this to control overall brightness
document.body.appendChild(renderer.domElement);

let lastTime = performance.now();
let frames = 0;
const fpsDisplay = document.getElementById('fps');

// NOTE: Removed duplicate `controls` object to avoid desync with physics.

const particles = [];
const center = new THREE.Vector3(0, 0, 0);
const maxDistance = 500;
const maxSpeed = 20000.1
const damping = 0.9;

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let mouseButtonsClicked = [];
let spatialGrid = new Map();

const ambientLight = new THREE.AmbientLight(0xffffff, 5);
scene.add(ambientLight);

const color = 0xFFFFFF;
const intensity = 10;
const width = 5;
const height = 300;
const light = new THREE.RectAreaLight(color, intensity, width, height);
light.position.set(0, 50, 0);
scene.add(light);
// const helper = new RectAreaLightHelper(light);
// scene.add(helper);

// GUI is initialized after forceControls is defined to avoid TDZ errors

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX - window.innerWidth / 2;
    mouseY = window.innerHeight - e.clientY - window.innerHeight / 2;
});

window.oncontextmenu = function () {
    return false;
}

// Shared audio startup logic
let audioInitDone = false;
const startBtn = document.getElementById('start-audio-btn');
const mixerBtn = document.getElementById('show-mixer-btn');

async function doStartAudio() {
    if (isAudioStarted()) return;
    if (audioInitDone) {
        await resumeAudio();
    } else {
        await startAudioContext();
        initAudio(redCount);
        document.getElementById('helloBackground').classList.remove('hide');
        setupMixer();
        audioInitDone = true;
    }
    localStorage.setItem('audioAutoStart', 'true');
    startBtn.textContent = 'Sound Off';
    startBtn.onclick = handleStopAudio;
    mixerBtn.style.display = '';
    console.log('Audio started');
}

function handleStopAudio() {
    stopAudio();
    localStorage.removeItem('audioAutoStart');
    startBtn.textContent = 'Sound On';
    startBtn.onclick = doStartAudio;
    console.log('Audio stopped');
}

mixerBtn.addEventListener('click', () => {
    const panel = document.getElementById('audio-panel');
    const hidden = panel.classList.toggle('hide');
    mixerBtn.textContent = hidden ? 'Mixer' : 'Hide Mixer';
});

document.getElementById('show-audio-btn').addEventListener('click', () => {
    document.getElementById('audio-panel').classList.toggle('hide');
});

// Start audio when user clicks the button
startBtn.addEventListener('click', doStartAudio);

// Auto-start audio if it was running last session
if (localStorage.getItem('audioAutoStart') === 'true') {
    // Check if browser allows autoplay without producing warnings
    const allowed = navigator.getAutoplayPolicy
        ? navigator.getAutoplayPolicy('audiocontext') === 'allowed'
        : false;

    if (allowed) {
        doStartAudio().catch(() => {});
    } else {
        // Browser would block — start on first user interaction instead
        const autoStart = () => {
            doStartAudio();
            document.removeEventListener('click', autoStart);
            document.removeEventListener('keydown', autoStart);
        };
        document.addEventListener('click', autoStart);
        document.addEventListener('keydown', autoStart);
    }
}

// Random music button
document.getElementById('randomMusicBtn').addEventListener('click', () => {
    setRandomAvScene();
});

// Placeholder declarations; actual counts are defined after forceControls
let redCount;
let otherCount;
let redGeometry;
let otherGeometry;
let redPositions;
let redColors;
let otherPositions;
let otherColors;

const particleTypes = {
    RED: { color: 0xFFAAAA, id: 0 },    // Desaturated light red
    GREEN: { color: 0xFFFF00, id: 1 },  // Desaturated light green
    BLUE: { color: 0xCCCCEE, id: 2 }    // More desaturated light blue
};

// HSL to RGB conversion (h: 0-1, s: 0-1, l: 0-1) -> [r, g, b] (0-1)
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [r, g, b];
}

// Cache type names array to avoid repeated allocation
const typeNames = Object.keys(particleTypes);

// Default values for forces
const defaultForceControls = {
    repulsionRange: 150,
    particleSize: 2,
    repulsionStrength: 1,
    gravity: 247,
    particleCount: 6000,
    soundSpeedMax: 100,
    soundFrequency: 10000,
    soundEnabled: true,
    filterQ: 15,
    reverbWet: 0.9,
    maxRadius: 200.0,
    speedMultiplier: 1.0,
    zFlow: 0,
    launchpadEnabled: false,
    vignetteOffset: 1.0,
    vignetteDarkness: 1.0,
    'RED-RED': 2,
    'RED-GREEN': -0.7,
    'RED-BLUE': 0.5,
    'GREEN-RED': 0,
    'GREEN-GREEN': 0,
    'GREEN-BLUE': 0.1,
    'BLUE-RED': -1.1,
    'BLUE-BLUE': 0,
    'BLUE-GREEN': -0.3
};

// Load settings from localStorage or use defaults
function loadSettings() {
    try {
        const saved = localStorage.getItem('particleSettings');
        if (saved) {
            return { ...defaultForceControls, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e);
    }
    return { ...defaultForceControls };
}

// Single source of truth for forces
let forceControls = loadSettings();

// Baseline tracks user-set values (GUI sliders). Controller reads from this.
// forceControls gets overwritten each frame with effective (baseline + offsets) values for display.
const forceBaseline = { ...forceControls };

// Save settings to localStorage
function saveSettings() {
    try {
        localStorage.setItem('particleSettings', JSON.stringify(forceBaseline));
    } catch (e) {
        console.warn('Failed to save settings to localStorage:', e);
    }
}

// Update GUI
const gui = new GUI();
const generalFolder = gui.addFolder('General');
const masterSpeedObj = { masterSpeed: 1.0 };
let masterSpeedFromRemote = false;
const masterSpeedCtrl = generalFolder.add(masterSpeedObj, 'masterSpeed', 0.01, 1.0).name('Master Speed (sync)').onChange(v => {
    masterSpeed = v;
    if (!masterSpeedFromRemote && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'masterSpeed', value: v }));
    }
    masterSpeedFromRemote = false;
});
generalFolder.add(forceControls, 'speedMultiplier', 0.01, 2.0).onChange(saveSettings).name('Speed Multiplier');
generalFolder.add(forceControls, 'repulsionStrength', 0.1, 10).onChange(saveSettings);
generalFolder.add(forceControls, 'repulsionRange', 1, 500).onChange(saveSettings);
generalFolder.add(forceControls, 'gravity', 0.01, 2000).onChange(saveSettings);
generalFolder.add(forceControls, 'particleSize', 0.1, 3).onChange(() => { updateParticleSize(); saveSettings(); });
generalFolder.add(forceControls, 'maxRadius', 1, 1000).onChange(saveSettings);
generalFolder.add(forceControls, 'zFlow', 0, 5000).onChange(saveSettings).name('Z Flow');
generalFolder.add(forceControls, 'vignetteOffset', 0.0, 3.0, 0.01).onChange(saveSettings).name('Vignette Offset');
generalFolder.add(forceControls, 'vignetteDarkness', 0.0, 2.0, 0.01).onChange(saveSettings).name('Vignette Darkness');
generalFolder.add(forceControls, 'particleCount', 100, 5000, 100).onChange(saveSettings).name('Particle Count');
generalFolder.add({ reload: reloadParticles }, 'reload').name('Apply Particle count');
generalFolder.open()

const forcesFolder = gui.addFolder('Particle Forces');
forcesFolder.add(forceControls, 'RED-RED', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'RED-GREEN', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'RED-BLUE', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'GREEN-RED', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'GREEN-GREEN', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'GREEN-BLUE', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'BLUE-RED', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'BLUE-BLUE', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add(forceControls, 'BLUE-GREEN', -2, 2, 0.1).onChange(saveSettings);
forcesFolder.add({ randomize: randomizeForces }, 'randomize').name('Randomize (R)');
forcesFolder.open();

const soundFolder = gui.addFolder('Sound');
soundFolder.add(forceControls, 'soundEnabled').onChange(saveSettings);
soundFolder.add(forceControls, 'soundSpeedMax', 5, 500).onChange(saveSettings);
soundFolder.add(forceControls, 'soundFrequency', 100, 10000).onChange(saveSettings);
soundFolder.add(forceControls, 'filterQ', 0.5, 30).onChange(saveSettings).name('Filter Q');
soundFolder.add(forceControls, 'reverbWet', 0, 1, 0.01).onChange(saveSettings).name('Reverb Wet');

const networkFolder = gui.addFolder('Network');
networkFolder.add(forceControls, 'launchpadEnabled').onChange((enabled) => {
    saveSettings();
    if (enabled) {
        setupLaunchpad(controller, handlePress, handleRelease);
    }
}).name('Launchpad MIDI');

// Randomize particle forces using their min/max
function randomizeForces() {
    forcesFolder.__controllers.forEach(ctrl => {
        if (typeof ctrl.__min === 'number' && typeof ctrl.__max === 'number') {
            const value = ctrl.__min + Math.random() * (ctrl.__max - ctrl.__min);
            ctrl.setValue(value);
        }
    });
    saveSettings();
}

// Reset to default values
function resetToDefaults() {
    Object.assign(forceControls, defaultForceControls);
    Object.assign(forceBaseline, defaultForceControls);
    gui.updateDisplay();
    saveSettings();
    reloadParticles();
}

// Reload particles with current settings (for particle count changes)
function reloadParticles() {
    location.reload();
}

gui.add({ reset: resetToDefaults }, 'reset').name('Reset to Defaults');

gui.open();

// Wrap all GUI onChange callbacks to keep forceBaseline in sync.
// gui.updateDisplay() does NOT trigger onChange, so this only fires on real user interaction.
(function trackBaseline(folder) {
    for (const ctrl of folder.__controllers) {
        if (ctrl.property in forceBaseline) {
            const orig = ctrl.__onChange;
            ctrl.__onChange = function (value) {
                forceBaseline[ctrl.property] = value;
                if (orig) orig.call(this, value);
            };
        }
    }
    for (const key of Object.keys(folder.__folders || {})) {
        trackBaseline(folder.__folders[key]);
    }
})(gui);

// Keys whose effective values get written back to forceControls for GUI display
const displayKeys = [
    'gravity', 'maxRadius', 'repulsionRange', 'repulsionStrength', 'speedMultiplier', 'zFlow',
    'particleSize',
    'RED-RED', 'RED-GREEN', 'RED-BLUE', 'GREEN-RED', 'GREEN-GREEN', 'GREEN-BLUE',
    'BLUE-RED', 'BLUE-BLUE', 'BLUE-GREEN', 'filterQ', 'reverbWet',
    'vignetteOffset', 'vignetteDarkness'
];

// const bokehFolder = gui.addFolder('Bokeh');
// bokehFolder.add(forceControls, 'bokehFocus', 0, 10000).onChange(() => {
//     bokehPass.uniforms['focus'].value = forceControls.bokehFocus;
// });
// bokehFolder.add(forceControls, 'bokehAperture', 0, 10).onChange(() => {
//     bokehPass.uniforms['aperture'].value = forceControls.bokehAperture * 0.00001;
// });
// bokehFolder.add(forceControls, 'bokehMaxblur', 0, 0.1).onChange(() => {
//     bokehPass.uniforms['maxblur'].value = forceControls.bokehMaxblur;
// });
// bokehFolder.open();

//generalFolder.open();

// Setup GPU Computation
const WIDTH = Math.ceil(Math.sqrt(forceControls.particleCount));
const gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);

// Position texture (xyz = position, w = particle type)
const dtPosition = gpuCompute.createTexture();
// Velocity texture (xyz = velocity, w = unused)
const dtVelocity = gpuCompute.createTexture();

// Now that forceControls is known, allocate buffers and geometries
redCount = 3; // Exactly 3 red balls
otherCount = forceControls.particleCount - redCount;
redGeometry = new THREE.BufferGeometry();
otherGeometry = new THREE.BufferGeometry();
redPositions = new Float32Array(redCount * 3);
redColors = new Float32Array(redCount * 3);
otherPositions = new Float32Array(otherCount * 3);
otherColors = new Float32Array(otherCount * 3);

// Initialize GPU textures with particle data
let redIndex = 0;
let otherIndex = 0;
const posArray = dtPosition.image.data;
const velArray = dtVelocity.image.data;

for (let i = 0; i < forceControls.particleCount; i++) {
    // Distribute types but ensure RED is far less frequent
    const isRed = i < redCount;
    const typeKey = isRed ? 'RED' : (otherIndex % 2 === 0 ? 'GREEN' : 'BLUE');
    const type = particleTypes[typeKey];
    const typeId = type.id;

    const pos = new THREE.Vector3(
        (Math.random() - 0.5) * window.innerWidth,
        (Math.random() - 0.5) * window.innerHeight,
        (Math.random() - 0.5) * 500
    );
    const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
    );

    // Store in GPU texture
    const i4 = i * 4;
    posArray[i4 + 0] = pos.x;
    posArray[i4 + 1] = pos.y;
    posArray[i4 + 2] = pos.z;
    posArray[i4 + 3] = typeId; // Store particle type in w component

    velArray[i4 + 0] = vel.x;
    velArray[i4 + 1] = vel.y;
    velArray[i4 + 2] = vel.z;
    velArray[i4 + 3] = 0.0;

    // Keep track of which buffer this particle writes to and its index within that buffer
    const bufferKind = isRed ? 'RED' : 'OTHER';
    const bufferIndex = isRed ? redIndex : otherIndex;

    particles.push({
        position: pos,
        velocity: vel,
        type: typeId,
        life: Math.random(),
        size: forceControls.repulsionRange,
        bufferKind,
        bufferIndex
    });

    const rgb = [
        (type.color >> 16) & 255,
        (type.color >> 8) & 255,
        type.color & 255
    ];

    if (isRed) {
        redPositions[redIndex * 3] = pos.x;
        redPositions[redIndex * 3 + 1] = pos.y;
        redPositions[redIndex * 3 + 2] = pos.z;
        redColors[redIndex * 3] = rgb[0] / 255;
        redColors[redIndex * 3 + 1] = rgb[1] / 255;
        redColors[redIndex * 3 + 2] = rgb[2] / 255;
        redIndex++;
    } else {
        otherPositions[otherIndex * 3] = pos.x;
        otherPositions[otherIndex * 3 + 1] = pos.y;
        otherPositions[otherIndex * 3 + 2] = pos.z;
        otherColors[otherIndex * 3] = rgb[0] / 255;
        otherColors[otherIndex * 3 + 1] = rgb[1] / 255;
        otherColors[otherIndex * 3 + 2] = rgb[2] / 255;
        otherIndex++;
    }
}

redGeometry.setAttribute('position', new THREE.BufferAttribute(redPositions, 3));
redGeometry.setAttribute('color', new THREE.BufferAttribute(redColors, 3));
otherGeometry.setAttribute('position', new THREE.BufferAttribute(otherPositions, 3));
otherGeometry.setAttribute('color', new THREE.BufferAttribute(otherColors, 3));

// Create computation variables
const velocityVariable = gpuCompute.addVariable('textureVelocity', velocityShader, dtVelocity);
const positionVariable = gpuCompute.addVariable('texturePosition', positionShader, dtPosition);

// Add dependencies
gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

// Add uniforms
velocityVariable.material.uniforms['deltaTime'] = { value: 0.0 };
velocityVariable.material.uniforms['repulsionRange'] = { value: forceControls.repulsionRange };
velocityVariable.material.uniforms['repulsionStrength'] = { value: forceControls.repulsionStrength };
velocityVariable.material.uniforms['gravity'] = { value: forceControls.gravity };
velocityVariable.material.uniforms['center'] = { value: center };
velocityVariable.material.uniforms['damping'] = { value: damping };
velocityVariable.material.uniforms['maxSpeed'] = { value: maxSpeed };
velocityVariable.material.uniforms['mouse'] = { value: new THREE.Vector2() };
velocityVariable.material.uniforms['spaceAttraction'] = { value: 0.0 };
velocityVariable.material.uniforms['maxForce'] = { value: 300.0 };
velocityVariable.material.uniforms['forceMatrix'] = { value: new THREE.Matrix3() };
velocityVariable.material.uniforms['zThrust'] = { value: 0.0 };
velocityVariable.material.uniforms['zFlow'] = { value: 0.0 };

positionVariable.material.uniforms['deltaTime'] = { value: 0.0 };
positionVariable.material.uniforms['maxRadius'] = { value: forceControls.maxRadius };
positionVariable.material.uniforms['zFlow'] = { value: 0.0 };
positionVariable.material.uniforms['speedMultiplier'] = { value: forceControls.speedMultiplier };

const error = gpuCompute.init();
if (error !== null) {
    console.error('GPUComputationRenderer error:', error);
}

// Master speed — synced across all devices via WebSocket
let masterSpeed = 1.0;

const keysPressed = {};
const controller = new MomentaryController();
controller.syncBaseline(forceBaseline);

// WebSocket connection to sync keystrokes across devices
let ws = null;

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return; // Already connected or connecting
    }

    ws = new WebSocket(`ws://${location.host}/keystroke-sync`);

    const wsKeyTimers = {};

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'masterSpeed') {
                masterSpeed = data.value;
                masterSpeedFromRemote = true;
                masterSpeedCtrl.setValue(masterSpeed);
            } else if (data.type === 'keydown') {
                keysPressed[data.code] = true;
                controller.press(data.code);
                // Auto-release after 3s if keyup is lost
                clearTimeout(wsKeyTimers[data.code]);
                wsKeyTimers[data.code] = setTimeout(() => {
                    keysPressed[data.code] = false;
                    controller.release(data.code);
                    delete wsKeyTimers[data.code];
                }, 25000);
            } else if (data.type === 'keyup') {
                clearTimeout(wsKeyTimers[data.code]);
                delete wsKeyTimers[data.code];
                keysPressed[data.code] = false;
                controller.release(data.code);
            }
        } catch (err) {
            // Ignore parsing errors from non-JSON messages
        }
    };

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
    };
}

function disconnectWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
        console.log('WebSocket disconnected by user');
    }
}

// Auto-connect WebSocket on local/internal networks
const host = location.hostname;
if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
) {
    connectWebSocket();
}

// Shared press/release — used by keyboard, Launchpad, and WebSocket
function handlePress(code) {
    if (!keysPressed[code]) playKeyOneshot(code);
    keysPressed[code] = true;
    controller.press(code);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'keydown', code }));
    }
}

function handleRelease(code) {
    keysPressed[code] = false;
    controller.release(code);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'keyup', code }));
    }
}

function hideUi() {
    document.getElementById('top-bar').style.display = 'none';
    document.getElementById('audio-panel').style.display = 'none';
    if (gui.domElement.style.display !== 'none') GUI.toggleHide();
}

document.addEventListener('keydown', (event) => {
    const hint = document.getElementById('key-hint');
    if (hint) { hint.style.opacity = '0'; setTimeout(() => hint.remove(), 2000); }
    if (event.code === 'Enter') {
        event.preventDefault();
        toggleFullscreen();
        return;
    }
    if (event.code === 'KeyH') {
        // dat.gui handles its own H toggle; sync the rest
        document.getElementById('top-bar').style.display =
            document.getElementById('top-bar').style.display === 'none' ? 'flex' : 'none';
        document.getElementById('audio-panel').style.display =
            document.getElementById('audio-panel').style.display === 'none' ? '' : 'none';
        return;
    }
    handlePress(event.code);
});

document.addEventListener('keyup', (event) => {
    handleRelease(event.code);
});

// Connect Launchpad Mini if enabled in settings
if (forceControls.launchpadEnabled) {
    setupLaunchpad(controller, handlePress, handleRelease);
} else {
    console.warn('Launchpad: MIDI disabled — enable in Network → Launchpad MIDI');
}

// Create circular texture
const canvas = document.createElement('canvas');
canvas.width = 64;
canvas.height = 64;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.beginPath();
ctx.arc(32, 32, 32, 0, Math.PI * 2);
ctx.fill();

const texture = new THREE.CanvasTexture(canvas);

const otherMaterial = new THREE.PointsMaterial({
    size: forceControls.particleSize,
    map: texture,
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    sizeAttenuation: true,
    alphaTest: 0.01,
    depthWrite: false
});

const redMaterial = new THREE.PointsMaterial({
    size: forceControls.particleSize * 6, // much bigger
    map: texture,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
    alphaTest: 0.1,
    depthWrite: false
});

function updateParticleSize() {
    otherMaterial.size = forceControls.particleSize;
    otherMaterial.needsUpdate = true;
    // keep red larger proportionally
    redMaterial.size = forceControls.particleSize * 6;
    redMaterial.needsUpdate = true;
}

// Call it once on initialization
updateParticleSize();

const redSystem = new THREE.Points(redGeometry, redMaterial);
const otherSystem = new THREE.Points(otherGeometry, otherMaterial);
scene.add(otherSystem);
scene.add(redSystem);

camera.position.z = 350;
camera.far = 500000;
camera.updateProjectionMatrix();

// Initialize RectAreaLight uniforms once
RectAreaLightUniformsLib.init();

// Setup bloom post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5,   // strength (can be higher now with tone mapping)
    0.8,   // radius (spread of the bloom)
    0.1   // threshold (only bloom bright pixels - HDR style)
);
composer.addPass(bloomPass);

// Vignette post-processing
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        offset:   { value: forceControls.vignetteOffset },
        darkness: { value: forceControls.vignetteDarkness },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float offset;
        uniform float darkness;
        varying vec2 vUv;
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            float dist = length((vUv - 0.5) * 2.0);
            float vignette = 1.0 - smoothstep(offset, offset + darkness, dist);
            texel.rgb *= vignette;
            gl_FragColor = texel;
        }
    `,
};
const vignettePass = new ShaderPass(VignetteShader);
composer.addPass(vignettePass);

// OutputPass for proper sRGB encoding after HDR bloom
const outputPass = new OutputPass();
composer.addPass(outputPass);

// const bokehPass = new BokehPass( scene, camera, {
//     focus: forceControls.bokehFocus,
//     aperture: forceControls.bokehAperture,
//     maxblur: forceControls.bokehMaxblur
// } );
// composer.addPass( bokehPass );

// Helper to update force matrix from controller
function updateForceMatrix() {
    const matrix = velocityVariable.material.uniforms['forceMatrix'].value;
    matrix.set(
        controller.get('RED-RED'), controller.get('RED-GREEN'), controller.get('RED-BLUE'),
        controller.get('GREEN-RED'), controller.get('GREEN-GREEN'), controller.get('GREEN-BLUE'),
        controller.get('BLUE-RED'), controller.get('BLUE-GREEN'), controller.get('BLUE-BLUE')
    );
}

// Update force matrix on init
updateForceMatrix();

function getGridKey(x, y, z) {
    const gridX = Math.floor(x / forceControls.repulsionRange);
    const gridY = Math.floor(y / forceControls.repulsionRange);
    const gridZ = Math.floor(z / forceControls.repulsionRange);
    return `${gridX},${gridY},${gridZ}`;
}

function buildSpatialGrid() {
    spatialGrid.clear();
    for (let i = 0; i < particles.length; i++) {
        const key = getGridKey(particles[i].position.x, particles[i].position.y, particles[i].position.z);
        if (!spatialGrid.has(key)) {
            spatialGrid.set(key, []);
        }
        spatialGrid.get(key).push(i);
    }
}

function getNearbyCells(x, y, z) {
    const searchCells = [];
    const gridX = Math.floor(x / forceControls.repulsionRange);
    const gridY = Math.floor(y / forceControls.repulsionRange);
    const gridZ = Math.floor(z / forceControls.repulsionRange);
    const searchRadius = 1;

    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                const key = `${gridX + dx},${gridY + dy},${gridZ + dz}`;
                if (spatialGrid.has(key)) {
                    searchCells.push(key);
                }
            }
        }
    }
    return searchCells;
}


function updatePhysicsGPU(deltaTime) {
    // Update uniforms from controller (smooth interpolated values)
    velocityVariable.material.uniforms['deltaTime'].value = deltaTime;
    velocityVariable.material.uniforms['repulsionRange'].value = controller.get('repulsionRange');
    velocityVariable.material.uniforms['repulsionStrength'].value = controller.get('repulsionStrength');
    velocityVariable.material.uniforms['gravity'].value = controller.get('gravity');
    velocityVariable.material.uniforms['mouse'].value.set(mouseX, mouseY);
    velocityVariable.material.uniforms['spaceAttraction'].value = controller.get('spaceAttraction');
    velocityVariable.material.uniforms['zThrust'].value = controller.get('zThrust');
    velocityVariable.material.uniforms['zFlow'].value = controller.get('zFlow');

    updateForceMatrix();

    positionVariable.material.uniforms['deltaTime'].value = deltaTime;
    positionVariable.material.uniforms['maxRadius'].value = controller.get('maxRadius');
    positionVariable.material.uniforms['zFlow'].value = controller.get('zFlow');
    positionVariable.material.uniforms['speedMultiplier'].value = controller.get('speedMultiplier') * masterSpeed;

    // Compute on GPU
    gpuCompute.compute();

    // Read back positions from GPU to update particle buffers
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(positionVariable),
        0, 0, WIDTH, WIDTH,
        posArray
    );

    // Read back velocities for sound control
    const velocityArray = new Float32Array(WIDTH * WIDTH * 4);
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(velocityVariable),
        0, 0, WIDTH, WIDTH,
        velocityArray
    );

    // Track red particle speeds for audio control
    const redSpeeds = [];

    // Update particle position buffers
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const i4 = i * 4;

        p.position.x = posArray[i4 + 0];
        p.position.y = posArray[i4 + 1];
        p.position.z = posArray[i4 + 2];

        // Update velocity and track red particle speeds
        const vx = velocityArray[i4 + 0];
        const vy = velocityArray[i4 + 1];
        const vz = velocityArray[i4 + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

        p.velocity.x = vx;
        p.velocity.y = vy;
        p.velocity.z = vz;

        if (p.bufferKind === 'RED') {
            redSpeeds.push({ speed, bufferIndex: p.bufferIndex });
        }

        // Write to correct rendering buffer
        if (p.bufferKind === 'RED') {
            const bi = p.bufferIndex * 3;
            redPositions[bi] = p.position.x;
            redPositions[bi + 1] = p.position.y;
            redPositions[bi + 2] = p.position.z;
        } else {
            const bi = p.bufferIndex * 3;
            otherPositions[bi] = p.position.x;
            otherPositions[bi + 1] = p.position.y;
            otherPositions[bi + 2] = p.position.z;

            // Rotate hue for green particles based on speed
            if (p.type === 1) { // GREEN
                const speedNorm = Math.min(speed / 500, 1); // Normalize speed (0-1)
                const hue = (0.33 + speedNorm * 0.67) % 1; // Green (0.33) to red (0) via yellow
                const [r, g, b] = hslToRgb(hue, 0.7, 0.7);
                otherColors[bi] = r;
                otherColors[bi + 1] = g;
                otherColors[bi + 2] = b;
            }
        }
    }

    // Control audio for every red particle
    updateAudio(redSpeeds, particles, forceControls);

    redGeometry.attributes.position.needsUpdate = true;
    otherGeometry.attributes.position.needsUpdate = true;
    otherGeometry.attributes.color.needsUpdate = true;
}

let lastFrameTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // Controller: sync baseline from user-set values, then interpolate
    controller.syncBaseline(forceBaseline);
    controller.update(deltaTime);

    // Write effective values back to forceControls so GUI sliders move
    for (const key of displayKeys) {
        forceControls[key] = controller.get(key);
    }
    gui.updateDisplay();

    // Apply visual params from controller
    camera.fov = controller.get('cameraFov');
    camera.updateProjectionMatrix();
    otherMaterial.size = controller.get('particleSize');
    redMaterial.size = controller.get('particleSize') * 6;
    bloomPass.strength = controller.get('bloomStrength');
    bloomPass.radius = controller.get('bloomRadius');
    scene.fog.near = controller.get('fogNear');
    scene.fog.far = controller.get('fogFar');
    renderer.toneMappingExposure = controller.get('exposure');
    vignettePass.uniforms['offset'].value = controller.get('vignetteOffset');
    vignettePass.uniforms['darkness'].value = controller.get('vignetteDarkness');
    scene.rotation.y += controller.get('rotationSpeed');

    // Apply audio params from controller
    applyAudioParams({
        filterQ: controller.get('filterQ'),
        reverbWet: controller.get('reverbWet'),
        minVol: controller.get('minVol'),
        maxVol: controller.get('maxVol'),
    });

    updatePhysicsGPU(deltaTime);
    recordFrame();
    composer.render();

    frames++;
    if (now >= lastTime + 1000) {
        fpsDisplay.textContent = `FPS: ${frames}`;
        frames = 0;
        lastTime = now;
    }
}

window.addEventListener('resize', () => {
    if (p5pop && !p5pop.closed) return; // canvas is in popup, ignore main window resize
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// Pop-out canvas — moves the canvas element into a popup window (zero-copy)
let p5pop = null;

function popCanvas() {
    // Already open — bring to front
    if (p5pop && !p5pop.closed) {
        p5pop.focus();
        return;
    }

    const canvas = renderer.domElement;

    p5pop = window.open('', 'VISUALS', 'left=0,top=0,width=800,height=600');
    p5pop.document.write('<!DOCTYPE html><html><head><title>VISUALS</title><style>body{margin:0;overflow:hidden;background:#000;}</style></head><body></body></html>');
    p5pop.document.close();

    // Move canvas into popup
    p5pop.document.body.appendChild(canvas);

    // Resize renderer to fit the popup window
    function resizeToPopup() {
        const w = p5pop.innerWidth;
        const h = p5pop.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
    }
    resizeToPopup();
    p5pop.addEventListener('resize', resizeToPopup);

    // Enter key fullscreens the popup window
    p5pop.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') {
            e.preventDefault();
            const el = p5pop.document.documentElement;
            if (!p5pop.document.fullscreenElement) {
                el.requestFullscreen?.() || el.webkitRequestFullscreen?.();
            } else {
                p5pop.document.exitFullscreen?.() || p5pop.document.webkitExitFullscreen?.();
            }
        }
    });

    // Show live parameter history charts in the main window
    startHistory(controller, PARAMS);

    // When popup closes, move canvas back
    const tick = setInterval(() => {
        if (p5pop.closed) {
            clearInterval(tick);
            stopHistory();
            document.body.appendChild(canvas);
            p5pop = null;
            // Resize back to main window
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        }
    }, 500);
}

document.getElementById('popstream-btn').addEventListener('click', popCanvas);

// Fullscreen toggle with mobile support
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fsEnter = document.getElementById('fs-enter');
const fsExit = document.getElementById('fs-exit');

function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

function toggleFullscreen() {
    if (!isFullscreen()) {
        const el = document.documentElement;
        if (el.requestFullscreen) {
            el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        } else if (el.mozRequestFullScreen) {
            el.mozRequestFullScreen();
        } else if (el.msRequestFullscreen) {
            el.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

function updateFullscreenIcon() {
    const fs = isFullscreen();
    fsEnter.style.display = fs ? 'none' : 'block';
    fsExit.style.display = fs ? 'block' : 'none';
    if (fs) hideUi();
}

fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
document.addEventListener('mozfullscreenchange', updateFullscreenIcon);
document.addEventListener('MSFullscreenChange', updateFullscreenIcon);

animate();
