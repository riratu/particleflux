import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui'
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RectAreaLightHelper} from 'three/addons/helpers/RectAreaLightHelper.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

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
    gravity: 1000,
    particleCount: 6000,
    'RED-RED': 2,
    'RED-GREEN': 1.4,
    'RED-BLUE': 0.1,
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
redCount = Math.max(1, Math.floor(redRatio * forceControls.particleCount));
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

// Velocity computation shader - calculates forces between particles
const velocityShader = `
    uniform float deltaTime;
    uniform float repulsionRange;
    uniform float repulsionStrength;
    uniform float gravity;
    uniform vec3 center;
    uniform float damping;
    uniform float maxSpeed;
    uniform vec2 mouse;
    uniform float mouseAttraction;
    uniform float maxForce;

    // Force matrix: forces[from][to]
    uniform mat3 forceMatrix; // 3x3 for RED, GREEN, BLUE interactions

    // Helper to get grid cell from position
    vec3 getGridCell(vec3 pos) {
        return floor(pos / repulsionRange);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 tmpPos = texture2D(texturePosition, uv);
        vec3 position = tmpPos.xyz;
        float particleType = tmpPos.w;

        vec4 tmpVel = texture2D(textureVelocity, uv);
        vec3 velocity = tmpVel.xyz;

        vec3 force = vec3(0.0);

        // Get current particle's grid cell
        vec3 gridCell = getGridCell(position);
        float searchRadius = 1.0;

        // Particle-particle interactions with spatial optimization
        for (float y = 0.0; y < resolution.y; y++) {
            for (float x = 0.0; x < resolution.x; x++) {
                vec2 otherUV = vec2(x, y) / resolution.xy;
                vec4 otherPos = texture2D(texturePosition, otherUV);
                vec3 otherPosition = otherPos.xyz;
                float otherType = otherPos.w;

                if (otherUV == uv) continue;

                // Spatial grid optimization: skip if particle is too far
                vec3 otherGridCell = getGridCell(otherPosition);
                vec3 gridDiff = abs(gridCell - otherGridCell);

                // Skip if not in neighboring cells (check 3x3x3 = 27 cells)
                if (gridDiff.x > searchRadius || gridDiff.y > searchRadius || gridDiff.z > searchRadius) {
                    continue;
                }

                vec3 diff = position - otherPosition;
                float dist = length(diff);

                if (dist < repulsionRange && dist > 0.0) {
                    vec3 dir = diff / dist;

                    // Get force rule from matrix
                    int typeIdx = int(particleType);
                    int otherIdx = int(otherType);
                    float rule = forceMatrix[typeIdx][otherIdx];

                    // Clamp distance to prevent extreme forces
                    float minDist = repulsionRange * 0.05;
                    float clampedDist = max(dist, minDist);

                    float forceMagnitude = repulsionStrength *
                        pow(1.0 - clampedDist / repulsionRange, 2.0);

                    // Reduce force when particles are very close and attracting
                    if (rule < 0.0 && dist < repulsionRange * 0.09) {
                        forceMagnitude = 0.0;
                    }

                    float f = clamp(forceMagnitude * rule, -maxForce, maxForce);
                    force += dir * f;
                }
            }
        }

        // Gravity towards center
        vec3 toCenter = center - position;
        float distToCenter = length(toCenter);
        if (distToCenter > 10.0) {
            vec3 dirToCenter = toCenter / distToCenter;
            force += dirToCenter * gravity * deltaTime;
        }

        // Mouse attraction
        if (mouseAttraction > 0.0) {
            vec2 toMouse = mouse - position.xy;
            force.xy += toMouse * mouseAttraction * deltaTime;
        }

        // Update velocity
        velocity += force;
        velocity *= damping;

        // Clamp speed
        float speed = length(velocity);
        if (speed > maxSpeed) {
            velocity = normalize(velocity) * maxSpeed;
        }

        gl_FragColor = vec4(velocity, 0.0);
    }
`;

// Position computation shader - integrates velocity into position
const positionShader = `
    uniform float deltaTime;

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 tmpPos = texture2D(texturePosition, uv);
        vec3 position = tmpPos.xyz;
        float particleType = tmpPos.w;

        vec3 velocity = texture2D(textureVelocity, uv).xyz;

        position += velocity * deltaTime;

        gl_FragColor = vec4(position, particleType);
    }
`;

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
velocityVariable.material.uniforms['mouseAttraction'] = { value: 0.0 };
velocityVariable.material.uniforms['maxForce'] = { value: 100.0 };
velocityVariable.material.uniforms['forceMatrix'] = { value: new THREE.Matrix3() };

positionVariable.material.uniforms['deltaTime'] = { value: 0.0 };

const error = gpuCompute.init();
if (error !== null) {
    console.error('GPUComputationRenderer error:', error);
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
    4.0,  // strength
    1,  // radius
    0.0   // threshold (0 = bloom everything)
);
composer.addPass(bloomPass);

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
    velocityVariable.material.uniforms['mouseAttraction'].value = mouseButtonsClicked[2] ? 500000 : 0;

    updateForceMatrix();

    positionVariable.material.uniforms['deltaTime'].value = deltaTime;

    // Compute on GPU
    gpuCompute.compute();

    // Read back positions from GPU to update particle buffers
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(positionVariable),
        0, 0, WIDTH, WIDTH,
        posArray
    );

    // Update particle position buffers
    for (let i = 0; i < forceControls.particleCount; i++) {
        const p = particles[i];
        const i4 = i * 4;

        p.position.x = posArray[i4 + 0];
        p.position.y = posArray[i4 + 1];
        p.position.z = posArray[i4 + 2];

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

    redGeometry.attributes.position.needsUpdate = true;
    otherGeometry.attributes.position.needsUpdate = true;
}

let lastFrameTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

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
