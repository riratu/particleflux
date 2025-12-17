import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui'
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RectAreaLightHelper} from 'three/addons/helpers/RectAreaLightHelper.js';

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

let controls= {
    repulsionRange: 150,
    particleSize: 2,
    repulsionStrength: 100.2,
    gravity: 1000,
    particleCount: 4000
}

const particles = [];
const center = new THREE.Vector3(0, 0, 0);
const maxDistance = 500;
const maxSpeed = 500;
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

const helper = new RectAreaLightHelper(light);
scene.add(helper);

const gui = new GUI()
const cubeFolder = gui.addFolder('Cube')
cubeFolder.add(controls, "repulsionStrength", 1, 4000)
cubeFolder.add(controls, "repulsionRange", 1, 200)
cubeFolder.add(controls, 'particleSize', 1, 20).onChange(updateParticleSize)
cubeFolder.open()

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

// Create particle system
const particleGeometry = new THREE.BufferGeometry();
const positions = new Float32Array(controls.particleCount * 3);
const colors = new Float32Array(controls.particleCount * 3);

for (let i = 0; i < controls.particleCount; i++) {
    particles.push({
        position: new THREE.Vector3(
            (Math.random() - 0.5) * window.innerWidth,
            (Math.random() - 0.5) * window.innerHeight,
            (Math.random() - 0.5) * 500
        ),
        velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
        ),
        life: Math.random(),
        size: controls.repulsionRange
    });

    positions[i * 3] = particles[i].position.x;
    positions[i * 3 + 1] = particles[i].position.y;
    positions[i * 3 + 2] = particles[i].position.z;

    colors[i * 3] = 1;
    colors[i * 3 + 1] = 1;
    colors[i * 3 + 2] = 1;
}

particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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

const particleMaterial = new THREE.PointsMaterial({
    size: controls.particleSize,
    map: texture,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
});

const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particleSystem);

camera.position.z = 500;

function updateParticleSize() {
    particleMaterial.size = controls.particleSize;
}

function getGridKey(x, y, z) {
    const gridX = Math.floor(x / controls.repulsionRange);
    const gridY = Math.floor(y / controls.repulsionRange);
    const gridZ = Math.floor(z / controls.repulsionRange);
    return `${gridX},${gridY},${gridZ}`;
}

function buildSpatialGrid() {
    spatialGrid.clear();
    for (let i = 0; i < controls.particleCount; i++) {
        const key = getGridKey(particles[i].position.x, particles[i].position.y, particles[i].position.z);
        if (!spatialGrid.has(key)) {
            spatialGrid.set(key, []);
        }
        spatialGrid.get(key).push(i);
    }
}

function getNearbyCells(x, y, z) {
    const searchCells = [];
    const gridX = Math.floor(x / controls.repulsionRange);
    const gridY = Math.floor(y / controls.repulsionRange);
    const gridZ = Math.floor(z / controls.repulsionRange);
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
    const futureTime = deltaTime * 0.3;

    for (let i = 0; i < controls.particleCount; i++) {
        const p = particles[i];
        const futureX = p.position.x + p.velocity.x * futureTime;
        const futureY = p.position.y + p.velocity.y * futureTime;
        const futureZ = p.position.z + p.velocity.z * futureTime;
        const nearbyCells = getNearbyCells(futureX, futureY, futureZ);

        for (const cellKey of nearbyCells) {
            const cell = spatialGrid.get(cellKey);
            if (!cell) continue;

            cell.forEach(otherNo => {
                const other = particles[otherNo];
                const dx = futureX - other.position.x;
                const dy = futureY - other.position.y;
                const dz = futureZ - other.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist < controls.repulsionRange && dist > 0) {
                    const dirX = dx / dist;
                    const dirY = dy / dist;
                    const dirZ = dz / dist;
                    const force = controls.repulsionStrength * Math.pow(1 - dist / controls.repulsionRange, 2) * 0.5 * deltaTime;
                    p.velocity.x += dirX * force;
                    p.velocity.y += dirY * force;
                    p.velocity.z += dirZ * force;
                    other.velocity.x -= dirX * force;
                    other.velocity.y -= dirY * force;
                    other.velocity.z -= dirZ * force;
                }
            });
        }
    }
}

function updatePhysics(deltaTime) {
    const positions = particleGeometry.attributes.position.array;

    for (let i = 0; i < controls.particleCount; i++) {
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
            p.velocity.x += dirX * deltaTime * controls.gravity;
            p.velocity.y += dirY * deltaTime * controls.gravity;
            p.velocity.z += dirZ * deltaTime * controls.gravity;
        }

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

        if (mouseButtonsClicked[1]) {
            p.life -= deltaTime * 0.01;

            if (p.life <= 0) {
                p.position.set(mouseX + Math.random() * 20, mouseY + Math.random() * 20, (Math.random() - 0.5) * 100);
                p.velocity.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
                p.life = 1;
            }
        }

        positions[i * 3] = p.position.x;
        positions[i * 3 + 1] = p.position.y;
        positions[i * 3 + 2] = p.position.z;
    }

    particleGeometry.attributes.position.needsUpdate = true;
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
    renderer.render(scene, camera);
    RectAreaLightUniformsLib.init();

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
});

animate();
