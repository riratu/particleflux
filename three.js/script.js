<!DOCTYPE html>
<html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>50,000 Points with Three.js</title>
    <style>
        body {
        margin: 0;
        overflow: hidden;
        background: #000;
    }
        canvas {
        display: block;
    }
    </style>
</head>
<body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    const count = 50000;
    const positions = new Float32Array(count * 3);

    // Generate random points
    for (let i = 0; i < count * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 200;
    positions[i + 1] = (Math.random() - 0.5) * 200;
    positions[i + 2] = (Math.random() - 0.5) * 200;
}

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Create material and points
    const material = new THREE.PointsMaterial({ color: 0x00ff00, size: 0.5 });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    camera.position.z = 100;

    // Handle window resize
    window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

    // Animation loop
    function animate() {
    requestAnimationFrame(animate);

    // Move points every frame
    const positionAttribute = geometry.getAttribute('position');
    const pos = positionAttribute.array;

    for (let i = 0; i < pos.length; i += 3) {
    pos[i] += (Math.random() - 0.5) * 0.5;      // x
    pos[i + 1] += (Math.random() - 0.5) * 0.5;  // y
    pos[i + 2] += (Math.random() - 0.5) * 0.5;  // z
}

    positionAttribute.needsUpdate = true;

    points.rotation.x += 0.0005;
    points.rotation.y += 0.0005;
    renderer.render(scene, camera);
}

    animate();
</script>
</body>
</html>
