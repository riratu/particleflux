// particles.js

const NUM_PARTICLES = 500;

let mouseX = 0;
let mouseY = 0;

document.addEventListener('mousemove', function(event) {
    //console.log('Mouse X:', event.clientX, 'Mouse Y:', event.clientY);
    mouseX = event.clientX;
    mouseY = event.clientY;
});

async function loadShader(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${path}`);
        }
        const text = await response.text();
        console.log(`✅ Shader geladen: ${path}`);
        return text;
    } catch (error) {
        console.error(`❌ Fehler beim Laden von ${path}:`, error);
        throw error;
    }
}

async function main() {
    if (!navigator.gpu) {
        showError('WebGPU nicht verfügbar',
            'Dein Browser unterstützt WebGPU nicht.'
        );
        return;
    }

    try {
        const canvas = document.getElementById('canvas');
        if (!canvas) {
            showError('Canvas nicht gefunden', 'Das Canvas-Element existiert nicht.');
            return;
        }

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            showError('WebGPU Adapter nicht gefunden', 'WebGPU ist möglicherweise deaktiviert.');
            return;
        }

        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();

        context.configure({
            device,
            format,
            alphaMode: 'premultiplied',
        });

        console.log('✅ WebGPU erfolgreich initialisiert');
        console.log('Format:', format);

        // Lade Shaders
        console.log('📂 Lade Shaders...');
        const computeCode = await loadShader('shaders/compute.wgsl');
        const renderCode = await loadShader('shaders/render.wgsl');
        console.log('✅ Alle Shaders geladen');

        // Initialisiere Partikel (in pixel coordinates)
        const particleData = new Float32Array(NUM_PARTICLES * 6);
        for (let i = 0; i < NUM_PARTICLES; i++) {
            particleData[i * 6 + 0] = Math.random() * canvas.width; //PosX (pixels)
            particleData[i * 6 + 1] = Math.random() * canvas.height; //POSY (pixels)
            particleData[i * 6 + 2] = (Math.random() - 0.5) * 100; //VelX (pixels/s)
            particleData[i * 6 + 3] = (Math.random() - 0.5) * 100; //VelY (pixels/s)
            particleData[i * 6 + 4] = Math.random(); //Life
            particleData[i * 6 + 5] = 2; //Size (radius in pixels)
        }

        const particlesBuffer = device.createBuffer({
            size: particleData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(particlesBuffer.getMappedRange()).set(particleData);
        particlesBuffer.unmap();

        const uniformBuffer = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Shader Module
        const computeShader = device.createShaderModule({ code: computeCode });
        const renderShader = device.createShaderModule({ code: renderCode });

        console.log('✅ Shader Module erstellt');

        // Pipelines
        const computePipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: computeShader, entryPoint: 'main' },
        });

        const renderPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: renderShader,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 6 * Float32Array.BYTES_PER_ELEMENT,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x2' },
                        { shaderLocation: 1, offset: 8, format: 'float32x2' },
                        { shaderLocation: 2, offset: 16, format: 'float32' },
                        { shaderLocation: 3, offset: 20, format: 'float32' },
                    ],
                }],
            },
            fragment: {
                module: renderShader,
                entryPoint: 'fs_main',
                targets: [{ format }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        console.log('✅ Pipelines erstellt');

        const computeBindGroup = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: particlesBuffer } },
                { binding: 1, resource: { buffer: uniformBuffer } },
            ],
        });

        const renderBindGroup = device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 1, resource: { buffer: uniformBuffer } },
            ],
        });

        let lastTime = performance.now();
        let frameCount = 0;
        let fpsTime = performance.now();

        mouseX =

        console.log('🎬 Starte Animation...');

        function animate() {
            const currentTime = performance.now();
            const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.016);
            lastTime = currentTime;

            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([deltaTime, canvas.width, canvas.height, mouseX, mouseY, 0]));

            const commandEncoder = device.createCommandEncoder();

            // Compute Pass
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(computePipeline);
            computePass.setBindGroup(0, computeBindGroup);
            computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 256));
            computePass.end();

            // Render Pass
            const textureView = context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: textureView,
                    clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            renderPass.setPipeline(renderPipeline);
            renderPass.setBindGroup(0, renderBindGroup);
            renderPass.setVertexBuffer(0, particlesBuffer);
            renderPass.draw(6, NUM_PARTICLES, 0, 0); // 6 vertices per circle (2 triangles)
            renderPass.end();

            device.queue.submit([commandEncoder.finish()]);

            frameCount++;
            if (currentTime - fpsTime > 1000) {
                console.log(`FPS: ${frameCount}`);
                frameCount = 0;
                fpsTime = currentTime;
            }

            requestAnimationFrame(animate);
        }

        animate();

        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });

    } catch (error) {
        console.error('Fehler:', error);
        showError('WebGPU Fehler', error.message);
    }
}

function showError(title, message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: #ff6b6b;
        padding: 30px;
        border-radius: 10px;
        font-family: monospace;
        max-width: 500px;
        z-index: 1000;
        border: 2px solid #ff6b6b;
    `;
    errorDiv.innerHTML = `
        <h2 style="margin-top: 0; color: #ff6b6b;">${title}</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
    `;
    document.body.appendChild(errorDiv);
}

main();
