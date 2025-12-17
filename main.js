import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui'
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RectAreaLightHelper} from 'three/addons/helpers/RectAreaLightHelper.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {BloomPass} from 'three/addons/postprocessing/BloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({antialias: true});
const oControls = new OrbitControls(camera, renderer.domElement);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

let lastTime = performance.now();
let frames = 0;
const fpsDisplay = document.getElementById('fps');

let controls= {
    repulsionRange: 150,
    particleSize: 2,
    repulsionStrength: 100.2,
    gravity: 1000,
    particleCount: 1000
}

//const repulsionRange = 150;
//const particleSize = 7;
const count = 1000;
const particles = [];
const center = new THREE.Vector3(0, 0, 0);
const maxDistance = 500;
const maxSpeed = 500;
const damping = 0.9;


let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let mouseButtonsClicked = [];

let spatialGrid = new Map();

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 5);
scene.add(ambientLight);
//
// const ambientLight = new THREE.AmbientLight(0xffffff, 3);
// scene.add(ambientLight);

// const pointLight = new THREE.PointLight(0xffffff, 100000, 0);
// pointLight.position.set(200, 200, 100);
// pointLight.castShadow = true;
// scene.add(pointLight);
//light.add(helper);
//
// const pointLight2 = new THREE.PointLight(0xffffff, 100000, 0);
// pointLight2.position.set(-200, 200, 100);
// pointLight2.castShadow = true;
// scene.add(pointLight2);

const color = 0xFFFFFF;
const intensity = 10;
const width = 5;
const height = 300;
const light = new THREE.RectAreaLight(color, intensity, width, height);
light.position.set(0, 50, 0);
scene.add(light);
//light.rotation.x = THREE.MathUtils.degToRad(-90);


const helper = new RectAreaLightHelper(light);
scene.add(helper);


//
// const lightHelper = new THREE.PointLightHelper(pointLight, 20);


const gui = new GUI()
const cubeFolder = gui.addFolder('Cube')
cubeFolder.add(controls, "repulsionStrength", 1, 4000)
cubeFolder.add(controls, "repulsionRange", 1, 200)
cubeFolder.add(controls, 'particleSize', 1, 200)
//cubeFolder.add(controls, 'particleCount', 1, 2000)
cubeFolder.open()
// const cameraFolder = gui.addFolder('Camera')
// cameraFolder.add(camera.position, 'z', 0, 10)
// cameraFolder.open()

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX - window.innerWidth / 2;
    mouseY = window.innerHeight - e.clientY - window.innerHeight / 2;
    //pointLight.position.x = mouseX;
    //pointLight.position.y = mouseY;
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

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new BloomPass(
    10000,    // strength
    5000,  // kernel size
    5100,    // sigma ?
    1000,  // blur render target resolution
);
composer.addPass(bloomPass);
const outputPass = new OutputPass();
composer.addPass(outputPass);


// Create sphere geometry and material
const sphereGeometry = new THREE.SphereGeometry(controls.particleSize, 9, 9);
// const sphereMaterial = new THREE.MeshPhysicalMaterial({
//     color: 0xffffff,
//     metalness: 0,
//     roughness: 0.9,
//     transmission: 0.9,        // Glass transparency
//     emissive: 0x3c3c3c,
//     //thickness: 0.5,         // Refraction depth
//     //clearcoat: 0.5,           // Glossy coating
//     //clearcoatRoughness: 0,
//     //ior: 1.5,               // Index of refraction (glass)
//     reflectivity: 0.5
//     //envMapIntensity: 1
// });

// Load texture
//const textureLoader = new THREE.TextureLoader();
//const moonTexture = textureLoader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/textures/planets/moon_1024.jpg');

const sphereMaterial = new THREE.MeshStandardMaterial({
    // map: moonTexture,
    // aoMap: moonTexture,       // Use same texture for AO
  //  aoMapIntensity: 1.5,       // Darken crevices
    roughness: 0.9,
    metalness: 0.1,
    //emissive: 0xFFFFFF,
    // bumpMap: moonTexture,      // Add surface depth
    // bumpScale: 0.05            // Adjust bump intensity
});

// Note: aoMap requires UV2 coordinates
//sphereGeometry.setAttribute('uv2', sphereGeometry.attributes.uv);

const spheres = [];

for (let i = 0; i < controls.particleCount; i++) {
    particles.push({
        position: new THREE.Vector3((Math.random() - 0.5) * window.innerWidth, (Math.random() - 0.5) * window.innerHeight, (Math.random() - 0.5) * 500),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
        life: Math.random(),
        size: controls.repulsionRange
    });

    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial.clone());
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    scene.add(sphere);
    spheres.push(sphere);
}

camera.position.z = 500;

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

//     if(mouseButtonsClicked[0]) {
//     const strength = 50000;
//     const dmx = mouseX - p.position.x;
//     const dmy = mouseY - p.position.y;
//     p.velocity.x += dmx * deltaTime * strength;
//     p.velocity.y += dmy * deltaTime * strength;
// }

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

        spheres[i].position.copy(p.position);

        // Map velocity to hue (0-1)
        // const hue = (speed / maxSpeed) * 0.01; // 0 = red, 0.33 = green, 0.66 = blue
        // const saturation = 0.5;
        // const lightness = 0.5;
        //
        // spheres[i].material.color.setHSL(hue, saturation, lightness);

    }

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
