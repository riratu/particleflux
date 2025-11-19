struct Particle {
    position: vec2<f32>,
    velocity: vec2<f32>,
    life: f32,
    size: f32,
};

@group(0) @binding(0)
var<storage, read_write> particles: array<Particle>;

@group(0) @binding(1)
var<uniform> uniforms: Uniforms;

struct Uniforms {
    deltaTime: f32,
    screenWidth: f32,
    screenHeight: f32,
    mouseX: f32,
    mouseY: f32,
    _padding: f32,
};

fn random(seed: f32) -> f32 {
    return fract(sin(seed * 12.9898) * 43758.5453);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if index >= arrayLength(&particles) {
        return;
    }

    var p = particles[index];

    // Physik: Bewegung und Schwerkraft (in pixels/second)
    p.position += p.velocity * uniforms.deltaTime;

    // Attraction to center of screen
    //let center = vec2<f32>(uniforms.mouseX, uniforms.mouseY);
    let center = vec2<f32>(uniforms.screenWidth * 0.5, uniforms.screenHeight * 0.5);
    let toCenter = center - p.position;
    let distToCenter = length(toCenter);


    if distToCenter > 0.0 {
        let maxDistance = 500.0;
        let normalizedDist = clamp(distToCenter / maxDistance, 0.0, 1.0);

        // Exponential curve
        let forceStrength = 1000.0 * pow(normalizedDist, 2.0);

        let attraction = normalize(toCenter) * forceStrength;
        p.velocity += attraction * uniforms.deltaTime;
    }


    // Simple downward gravity
  //let gravity = vec2<f32>(0.0, 2000.0); // Positive Y is down
   // p.velocity += gravity * uniforms.deltaTime;

    // Apply damping (friction) to make this wohle circus a little quieter
    p.velocity *= 0.999; // 2% velocity loss per frame


    // Clamp velocity to prevent excessive speed
    let speed = length(p.velocity);
    let maxSpeed = 1000.0; // Maximum speed in pixels/s
    if speed > maxSpeed {
        p.velocity = normalize(p.velocity) * maxSpeed;
    }

    // Age the Partivles if you like so.
    p.life -= uniforms.deltaTime * .01;

    // Recyceln: Wenn Particle dead, spawn a new one.
    if p.life <= 0.0 {
        let randomSpread = 10.0;
        p.position = vec2<f32>(
            uniforms.mouseX + (random(f32(index * 13)) * randomSpread), // start posX (0 to screenWidth)
            uniforms.mouseY + (random(f32(index * 9)) * randomSpread),  // start posY (top of screen)
        );
        p.velocity = vec2<f32>(
            (random(f32(index)) - 0.5) * 1.0, // x vel (pixels/s)
            (random(f32(index + 1)) - 0.5) * 1.0 // y vel (pixels/s)
        );
        p.life = 1.0;
    }

    // Particles bounce on screen boundaries)
    if p.position.x < 0.0 || p.position.x > uniforms.screenWidth {
        p.velocity.x = -p.velocity.x;
        p.position.x = clamp(p.position.x, 0.0, uniforms.screenWidth);
    }
    if p.position.y > uniforms.screenHeight {
        p.position.y = uniforms.screenHeight;
        p.velocity.y = -p.velocity.y * random(f32(index + 10)) * 0.5;
    }


    // We calculate the Position a little to in the Future since there is some time left between frames.
    let futurePos = p.position + normalize(p.velocity) * 1;

    // Interactions with other Particles.
    let particleCount = arrayLength(&particles);
    for (var i = 0u; i < particleCount; i++) {
        if i == index {
            continue;
        }

        let other = particles[i];
        let dist = length(futurePos - other.position);
        let repulsionRange = (p.size + other.size * 6); // Sum of radii in pixels

        if dist < repulsionRange {
            // Calculate direction from other to this particle
            let direction = normalize(futurePos - other.position);

            // Reflect velocity along collision normal (bounce)
            let relativeVelocity = p.velocity - other.velocity;
            let velocityAlongNormal = dot(relativeVelocity, direction);

           // Calculate repulsive force based on distance
           let overlap2 = (p.size + other.size) - dist;

          let repulsionStrength = 1000.2;
          // Exponential force - gets much stronger as particles get closer
          let normalizedDist = dist / repulsionRange; // 0 to 1
          let forceMagnitude = repulsionStrength * pow(1.0 - normalizedDist, 3.0);
          let repulsionForce = direction * forceMagnitude;

          p.velocity += repulsionForce * 0.5;
          particles[i].velocity -= repulsionForce * 0.5;

        }
    }

    particles[index] = p;
}
