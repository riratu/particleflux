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
import * as Tone from 'tone';
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

// Start audio context on user interaction
document.addEventListener('click', async () => {
    if (!audioContextStarted) {
        console.log('Starting Tone.js...');
        await Tone.start();
        console.log('Tone.js started, context state:', Tone.context.state);
        audioContextStarted = true;
        initAudio();
        console.log('Audio started');
    }
}, { once: true });

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
    GREEN: { color: 0xAAFFAA, id: 1 },  // Desaturated light green
    BLUE: { color: 0xAAAAFF, id: 2 }    // Desaturated light blue
};

// Cache type names array to avoid repeated allocation
const typeNames = Object.keys(particleTypes);

// Audio setup
let audioInitialized = false;
let audioContextStarted = false;
let redNoises = []; // Array of sound sources for each red particle
let reverb = null; // Shared reverb effect

function initAudio() {
    if (!audioInitialized && audioContextStarted) {
        console.log('Initializing audio...');
        console.log('Tone context state:', Tone.context.state);
        console.log('Tone context destination:', Tone.Destination);

        // Create a shared reverb effect
        reverb = new Tone.Reverb({
            decay: 20.5,
            wet: 0.9,
            preDelay: 0.01
        });
        reverb.toDestination();

        // Sound files for each red particle
        const soundFiles = [
            'sounds/7 Drone - Gittiliveset.wav',
            'sounds/atmos verb 120bpm 32t fm11.wav',
            'sounds/Gittipad.wav'
        ];

        // Create audio players for each red particle
        for (let i = 0; i < redCount; i++) {
            // Create a looping player for the sound file
            const player = new Tone.Player({
                url: soundFiles[i % soundFiles.length],
                loop: true,
                autostart: true
            });

            const filter = new Tone.Filter({
                type: "lowpass",
                frequency: 100,
                Q: 3,
                rolloff: -48
            });

            const volume = new Tone.Volume(-60); // Start very quiet

            const panner = new Tone.Panner3D({
                panningModel: 'HRTF',
                positionX: 0,
                positionY: 0,
                positionZ: 0
            });

            // Connect: player -> filter -> volume -> panner -> reverb -> output
            player.connect(filter);
            filter.connect(volume);
            volume.connect(reverb);
            //panner.connect(reverb);

            redNoises.push({
                source: player,
                filter,
                volume,
                panner,
                isOscillator: false
            });
        }

        console.log(`Created ${redCount} audio players for red particles`);
        audioInitialized = true;
        console.log('Audio initialized - sounds started');
    }
}

// Single source of truth for forces
let forceControls = {
    repulsionRange: 150,
    particleSize: 2,
    repulsionStrength: 1,
    gravity: 247,
    particleCount: 6000,
    soundSpeedMax: 100,
    soundFrequency: 440,
    soundEnabled: true,
    maxRadius: 200.0,
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

// Update GUI
const gui = new GUI();
const cubeFolder = gui.addFolder('Cube');
cubeFolder.add(forceControls, 'repulsionStrength', 0.1, 1000);
cubeFolder.add(forceControls, 'repulsionRange', 1, 500);
cubeFolder.add(forceControls, 'gravity', 0.01, 2000);
cubeFolder.add(forceControls, 'particleSize', 0.1, 20).onChange(() => updateParticleSize());
cubeFolder.add(forceControls, 'maxRadius', 1, 1000);
cubeFolder.open();

const forcesFolder = gui.addFolder('Particle Forces');
forcesFolder.add(forceControls, 'RED-RED', -2, 2, 0.1);
forcesFolder.add(forceControls, 'RED-GREEN', -2, 2, 0.1);
forcesFolder.add(forceControls, 'RED-BLUE', -2, 2, 0.1);
forcesFolder.add(forceControls, 'GREEN-RED', -2, 2, 0.1);
forcesFolder.add(forceControls, 'GREEN-GREEN', -2, 2, 0.1);
forcesFolder.add(forceControls, 'GREEN-BLUE', -2, 2, 0.1);
forcesFolder.add(forceControls, 'BLUE-RED', -2, 2, 0.1);
forcesFolder.add(forceControls, 'BLUE-BLUE', -2, 2, 0.1);
forcesFolder.add(forceControls, 'BLUE-GREEN', -2, 2, 0.1);
forcesFolder.open();

const soundFolder = gui.addFolder('Sound');
soundFolder.add(forceControls, 'soundEnabled');
soundFolder.add(forceControls, 'soundSpeedMax', 5, 500);
soundFolder.add(forceControls, 'soundFrequency', 100, 10000);
soundFolder.open();

// Randomize particle forces using their min/max
function randomizeForces() {
    forcesFolder.__controllers.forEach(ctrl => {
        if (typeof ctrl.__min === 'number' && typeof ctrl.__max === 'number') {
            const value = ctrl.__min + Math.random() * (ctrl.__max - ctrl.__min);
            ctrl.setValue(value);
        }
    });
}

gui.add({ randomize: randomizeForces }, 'randomize').name('Randomize (R)');

gui.close();

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

//cubeFolder.open();

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

positionVariable.material.uniforms['deltaTime'] = { value: 0.0 };
positionVariable.material.uniforms['maxRadius'] = { value: forceControls.maxRadius };

const error = gpuCompute.init();
if (error !== null) {
    console.error('GPUComputationRenderer error:', error);
}

const keysPressed = { };

// WebSocket connection to sync keystrokes across devices
const ws = new WebSocket(`ws://${location.host}/keystroke-sync`);

ws.onmessage = (e) => {
    try {
        const data = JSON.parse(e.data);
        // Only process our keystroke messages, ignore Vite HMR and other messages
        if (data.type === 'keydown') {
            console.log('Received keydown:', data.code);
            keysPressed[data.code] = true;
            handleKeyDown(data.code);
        } else if (data.type === 'keyup') {
            console.log('Received keyup:', data.code);
            keysPressed[data.code] = false;
            handleKeyUp(data.code);
        }
        // Silently ignore other message types (like Vite HMR)
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

// Map keys 1-9 and 0 to GUI properties for temporary manipulation
const keyToProperty = {
    'Digit1': 'RED-RED',
    'Digit2': 'RED-GREEN',
    'Digit3': 'RED-BLUE',
    'Digit4': 'GREEN-RED',
    'Digit5': 'GREEN-GREEN',
    'Digit6': 'GREEN-BLUE',
    'Digit7': 'BLUE-RED',
    'Digit8': 'BLUE-BLUE',
    'Digit9': 'BLUE-GREEN',
    'Digit0': 'gravity'
};

// Store original values when keys are pressed
const originalValues = {};

// Boosted values when keys are held (set to max for forces, high for gravity)
const boostedValues = {
    'RED-RED': 20,
    'RED-GREEN': 2,
    'RED-BLUE': -10,
    'GREEN-RED': 20,
    'GREEN-GREEN': 6,
    'GREEN-BLUE': 20,
    'BLUE-RED': 20,
    'BLUE-BLUE': 20,
    'BLUE-GREEN': 20,
    'gravity': 4000
};

// Handler for keydown logic
function handleKeyDown(code) {
    // R key to randomize
    if (code === 'KeyR') {
        randomizeForces();
    }

    // Handle number keys for GUI manipulation
    const property = keyToProperty[code];
    if (property && !originalValues.hasOwnProperty(code)) {
        // Store original value
        originalValues[code] = forceControls[property];
        // Set boosted value
        forceControls[property] = boostedValues[property];
        // Update GUI display
        gui.updateDisplay();
        console.log(code);
    }
}

// Handler for keyup logic
function handleKeyUp(code) {
    // Restore original value when key is released
    const property = keyToProperty[code];
    if (property && originalValues.hasOwnProperty(code)) {
        forceControls[property] = originalValues[code];
        delete originalValues[code];
        // Update GUI display
        gui.updateDisplay();
    }
}

document.addEventListener('keydown', (event) => {
    keysPressed[event.code] = true;
    handleKeyDown(event.code);

    // Send keystroke to other devices via WebSocket
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'keydown', code: event.code }));
    }
});

document.addEventListener('keyup', (event) => {
    keysPressed[event.code] = false;
    handleKeyUp(event.code);

    // Send keystroke to other devices via WebSocket
    if (ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify({ type: 'keyup', code: event.code }));
    }
});

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
    sizeAttenuation: true
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

// Create 3D starfield background
const starCount = 2000;
const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);

for (let i = 0; i < starCount; i++) {
    // Distribute stars in a large sphere around the scene
    const radius = 800 + Math.random() * 400;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = radius * Math.cos(phi);

    // White stars with slight brightness variation
    const brightness = 0.5 + Math.random() * 0.5;
    starColors[i * 3] = brightness;
    starColors[i * 3 + 1] = brightness;
    starColors[i * 3 + 2] = brightness;
}

starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 5));
starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 5));

const starMaterial = new THREE.PointsMaterial({
    size: 10.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
});

const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

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

// OutputPass for proper sRGB encoding after HDR bloom
const outputPass = new OutputPass();
composer.addPass(outputPass);

// const bokehPass = new BokehPass( scene, camera, {
//     focus: forceControls.bokehFocus,
//     aperture: forceControls.bokehAperture,
//     maxblur: forceControls.bokehMaxblur
// } );
// composer.addPass( bokehPass );

// Helper to update force matrix from forceControls
function updateForceMatrix() {
    const matrix = velocityVariable.material.uniforms['forceMatrix'].value;
    // Matrix layout: [RED][GREEN][BLUE] rows, [RED][GREEN][BLUE] columns
    matrix.set(
        forceControls['RED-RED'], forceControls['RED-GREEN'], forceControls['RED-BLUE'],
        forceControls['GREEN-RED'], forceControls['GREEN-GREEN'], forceControls['GREEN-BLUE'],
        forceControls['BLUE-RED'], forceControls['BLUE-GREEN'], forceControls['BLUE-BLUE']
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
    for (let i = 0; i < forceControls.particleCount; i++) {
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
    // Update uniforms
    velocityVariable.material.uniforms['deltaTime'].value = deltaTime;
    velocityVariable.material.uniforms['repulsionRange'].value = forceControls.repulsionRange;
    velocityVariable.material.uniforms['repulsionStrength'].value = forceControls.repulsionStrength;
    velocityVariable.material.uniforms['gravity'].value = forceControls.gravity;
    velocityVariable.material.uniforms['mouse'].value.set(mouseX, mouseY);
    velocityVariable.material.uniforms['spaceAttraction'].value = keysPressed['Space'] ? 50 : 0;

    updateForceMatrix();

    positionVariable.material.uniforms['deltaTime'].value = deltaTime;
    positionVariable.material.uniforms['maxRadius'].value = forceControls.maxRadius;

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
    for (let i = 0; i < forceControls.particleCount; i++) {
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
        }
    }

    // Control audio for every red particle
    if (forceControls.soundEnabled && redSpeeds.length > 0 && audioContextStarted) {
        // Initialize audio on first use
        if (!audioInitialized) {
            initAudio();
        }

        const now = Tone.now();
        const minFreq = 100;
        const maxFreq = forceControls.soundFrequency * 2;
        const minVol = -15;
        const maxVol = -10;

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

                // Map speed to filter frequency and source frequency (for oscillators)
                const speedNormalized = Math.min(speed / forceControls.soundSpeedMax, 2);
                let targetFreq = minFreq + (maxFreq - minFreq) * speedNormalized;

                // Update filter frequency
                audioChannel.filter.frequency.linearRampToValueAtTime(targetFreq, now + 0.05);

                // If it's an oscillator, also update its base frequency
                // if (audioChannel.isOscillator) {
                //     audioChannel.source.frequency.linearRampToValueAtTime(targetFreq * 0.5, now + 0.05);
                // }
                //
                // Map speed to volume (louder when faster)
                let targetVol = minVol + (maxVol - minVol) * speedNormalized;
                //let targetVol = maxVol

                // Smooth volume changes
                audioChannel.volume.volume.linearRampToValueAtTime(targetVol, now + 0.05);
            }
        }
    }

    redGeometry.attributes.position.needsUpdate = true;
    otherGeometry.attributes.position.needsUpdate = true;
}

let lastFrameTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // Slowly rotate the whole scene
    scene.rotation.y += 0.003;

    updatePhysicsGPU(deltaTime);
    composer.render();

    frames++;
    if (now >= lastTime + 1000) {
        fpsDisplay.textContent = `FPS: ${frames}`;
        frames = 0;
        lastTime = now;
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
