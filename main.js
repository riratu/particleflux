import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui'
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RectAreaLightHelper} from 'three/addons/helpers/RectAreaLightHelper.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({antialias: true});
const oControls = new OrbitControls(camera, renderer.domElement);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

let lastTime = performance.now();
let frames = 0;
const fpsDisplay = document.getElementById('fps');

// NOTE: Removed duplicate `controls` object to avoid desync with physics.

const particles = [];
const center = new THREE.Vector3(0, 0, 0);
const maxDistance = 500;
const maxSpeed = 100.1
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

addEventListener("mousedown", (event) => {
    mouseButtonsClicked[event.button] = true
})

addEventListener("mouseup", (event) => {
    mouseButtonsClicked[event.button] = false
})

// Placeholder declarations; actual counts are defined after forceControls
let redRatio = 0.005; // far less red particles
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

// Single source of truth for forces
let forceControls = {
    repulsionRange: 150,
    particleSize: 2,
    repulsionStrength: 100.2,
    gravity: 400,
    particleCount: 1000,
    'RED-RED': 2,
    'RED-GREEN': 1.4,
    'RED-BLUE': 0.1,
    'GREEN-RED': 0,
    'GREEN-GREEN': 0,
    'GREEN-BLUE': 0.1,
    'BLUE-RED': -1.1,
    'BLUE-BLUE': -0.1,
    'BLUE-GREEN': -0.3,
};

// Update GUI
const gui = new GUI();
const cubeFolder = gui.addFolder('Cube');
cubeFolder.add(forceControls, 'repulsionStrength', 1, 4000);
cubeFolder.add(forceControls, 'repulsionRange', 1, 200);
cubeFolder.add(forceControls, 'gravity', 1, 2000);
cubeFolder.add(forceControls, 'particleSize', 1, 20).onChange(() => updateParticleSize());
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

cubeFolder.open();

// Now that forceControls is known, allocate buffers and geometries
redCount = Math.max(1, Math.floor(redRatio * forceControls.particleCount));
otherCount = forceControls.particleCount - redCount;
redGeometry = new THREE.BufferGeometry();
otherGeometry = new THREE.BufferGeometry();
redPositions = new Float32Array(redCount * 3);
redColors = new Float32Array(redCount * 3);
otherPositions = new Float32Array(otherCount * 3);
otherColors = new Float32Array(otherCount * 3);

// Modify particle initialization
let redIndex = 0;
let otherIndex = 0;
for (let i = 0; i < forceControls.particleCount; i++) {
    // Distribute types but ensure RED is far less frequent
    // Choose RED for the first redCount particles; others cycle between GREEN/BLUE
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
    opacity: 0.8,
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

camera.position.z = 500;

// Initialize RectAreaLight uniforms once
RectAreaLightUniformsLib.init();

// Setup bloom post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    3.0,  // strength
    1.0,  // radius
    0.0   // threshold (0 = bloom everything)
);
composer.addPass(bloomPass);

// const bokehPass = new BokehPass( scene, camera, {
//     focus: forceControls.bokehFocus,
//     aperture: forceControls.bokehAperture,
//     maxblur: forceControls.bokehMaxblur
// } );
// composer.addPass( bokehPass );

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

function particleInteractions(deltaTime) {
    const futureTime = deltaTime * 0.01;

    for (let i = 0; i < forceControls.particleCount; i++) {
        const p = particles[i];
        const futureX = p.position.x + p.velocity.x * futureTime;
        const futureY = p.position.y + p.velocity.y * futureTime;
        const futureZ = p.position.z + p.velocity.z * futureTime;
        const nearbyCells = getNearbyCells(futureX, futureY, futureZ);

        for (const cellKey of nearbyCells) {
            const cell = spatialGrid.get(cellKey);
            if (!cell) continue;

            cell.forEach(otherNo => {
                if (i === otherNo) return;

                const other = particles[otherNo];
                const dx = futureX - other.position.x;
                const dy = futureY - other.position.y;
                const dz = futureZ - other.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist < forceControls.repulsionRange && dist > 0) {
                    const type1 = typeNames[p.type];
                    const type2 = typeNames[other.type];

                    // Asymmetric (bidirectional) forces: use exact pair from forceControls
                    const ruleKey = `${type1}-${type2}`;
                    let rule = forceControls[ruleKey];
                    if (rule === undefined) rule = 0;

                    const dirX = dx / dist;
                    const dirY = dy / dist;
                    const dirZ = dz / dist;

                    // Clamp distance to prevent extreme forces at very small distances
                    const minDist = forceControls.repulsionRange * 0.05;
                    const clampedDist = Math.max(dist, minDist);

                    let forceMagnitude = forceControls.repulsionStrength *
                        Math.pow(1 - clampedDist / forceControls.repulsionRange, 2)

                    // Reduce force when particles are very close and attracting
                    if (rule < 0 && dist < forceControls.repulsionRange * 0.09) {
                        forceMagnitude =  0// dist / (forceControls.repulsionRange * 0.2);
                    }

                    // Clamp final force to prevent instability
                    const maxForce = 100;
                    const force = Math.max(-maxForce, Math.min(maxForce, forceMagnitude * rule));

                    p.velocity.x += dirX * force;
                    p.velocity.y += dirY * force;
                    p.velocity.z += dirZ * force;
                    // other.velocity.x -= dirX * force;
                    // other.velocity.y -= dirY * force;
                    // other.velocity.z -= dirZ * force;
                }
            });
        }
    }
}


function updatePhysics(deltaTime) {
    for (let i = 0; i < forceControls.particleCount; i++) {
        const p = particles[i];

        p.position.x += p.velocity.x * deltaTime;
        p.position.y += p.velocity.y * deltaTime;
        p.position.z += p.velocity.z * deltaTime;

        const dx = center.x - p.position.x;
        const dy = center.y - p.position.y;
        const dz = center.z - p.position.z;
        const distToCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distToCenter > 10) {
            const dirX = dx / distToCenter;
            const dirY = dy / distToCenter;
            const dirZ = dz / distToCenter;
            p.velocity.x += dirX * deltaTime * forceControls.gravity;
            p.velocity.y += dirY * deltaTime * forceControls.gravity;
            p.velocity.z += dirZ * deltaTime * forceControls.gravity;
        }

        // Mouse right-click attraction to cursor
        if (mouseButtonsClicked[2]) {
            const strength = 500000;
            const dmx = mouseX - p.position.x;
            const dmy = mouseY - p.position.y;
            p.velocity.x -= dmx * deltaTime * strength;
            p.velocity.y -= dmy * deltaTime * strength;
        }

        p.velocity.multiplyScalar(damping);

        const speed = p.velocity.length();
        if (speed > maxSpeed) {
            p.velocity.normalize().multiplyScalar(maxSpeed);
        }

        // write to correct buffer
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

    redGeometry.attributes.position.needsUpdate = true;
    otherGeometry.attributes.position.needsUpdate = true;
    buildSpatialGrid();
    particleInteractions(deltaTime);
}

let lastFrameTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    updatePhysics(deltaTime);
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
