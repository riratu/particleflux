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
    let center = vec2<f32>(uniforms.mouseX, uniforms.mouseY);
    //let center = vec2<f32>(uniforms.screenWidth * 0.5, uniforms.screenHeight * 0.5);
    let toCenter = center - p.position;
    let distToCenter = length(toCenter);

    if distToCenter > 0.0 {
        let maxDistance = 500.0;
        let normalizedDist = clamp(distToCenter / maxDistance, 0.0, 1.0);

        // Exponential curve
        let forceStrength = 1000.0 * pow(normalizedDist, 1.0);

        let attraction = normalize(toCenter) * forceStrength;
        p.velocity += attraction * uniforms.deltaTime;
    }


    // Apply damping (friction) to prevent infinite acceleration
    p.velocity *= 0.98; // 2% velocity loss per frame

    // Clamp velocity to prevent excessive speed
    let speed = length(p.velocity);
    let maxSpeed = 500.0; // Maximum speed in pixels/s
    if speed > maxSpeed {
        p.velocity = normalize(p.velocity) * maxSpeed;
    }

    // Leben: Partikel werden älter
    p.life -= uniforms.deltaTime * .1;

    // Recyceln: Wenn Partikel tot, neu spawnen

/*
    if p.life <= 0.0 {
        p.position = vec2<f32>(
            random(f32(index * 13)) * uniforms.screenWidth, // start posX (0 to screenWidth)
            random(f32(index * 9)) * uniforms.screenHeight,  // start posY (top of screen)
        );
        p.velocity = vec2<f32>(
            (random(f32(index)) - 0.5) * 50.0, // x vel (pixels/s)
            (random(f32(index + 1)) - 0.5) * 50.0 // y vel (pixels/s)
        );
        p.life = 1.0;
    }
    */


    // Grenzen: Partikel prallen ab (screen boundaries)
    if p.position.x < 0.0 || p.position.x > uniforms.screenWidth {
        p.velocity.x = -p.velocity.x;
        p.position.x = clamp(p.position.x, 0.0, uniforms.screenWidth);
    }
    if p.position.y > uniforms.screenHeight {
        p.position.y = uniforms.screenHeight;
        p.velocity.y = -p.velocity.y * random(f32(index + 10)) * 0.5;
    }

    let futurePos = p.position + normalize(p.velocity) * 1;

    // Kollisionserkennung mit anderen Partikeln
    let particleCount = arrayLength(&particles);
    for (var i = 0u; i < particleCount; i++) {
        if i == index {
            continue;
        }

        //if (p.position.y < uniforms.screenHeight * 0.8) {
        //    continue;
        //}

        let other = particles[i];
        let dist = length(futurePos - other.position);
        let minDist = (p.size + other.size * 5); // Sum of radii in pixels

        // Wenn Kollision erkannt, separate particles and bounce
        if dist < minDist {
            // Calculate direction from other to this particle
            let direction = normalize(futurePos - other.position);

/*
            // Move particle so they just touch (with small buffer to prevent re-collision)
            let overlap = minDist - dist;
            let separationBuffer = 1.1; // Extra pixels to ensure separation
            p.position += direction * (overlap + separationBuffer);


            // Reflect velocity along collision normal (bounce)
            let relativeVelocity = p.velocity - other.velocity;
            let velocityAlongNormal = dot(relativeVelocity, direction);

           // Calculate repulsive force based on distance
           let overlap2 = (p.size + other.size) - dist;
           */
           // Particles are close but not overlapping - apply weaker repulsion
           let repulsionRange = minDist; // Distance at which repulsion starts

           if dist < repulsionRange {
               let repulsionStrength = 2.2; // Weaker force for non-overlapping particles
               let forceMagnitude = repulsionStrength * (repulsionRange - dist) / repulsionRange;
               let repulsionForce = direction * forceMagnitude;

               p.velocity += repulsionForce * 0.5;
               // other.velocity -= repulsionForce * 0.5;
           }

           // Optional: Still apply collision response for realistic bouncing
          /* if velocityAlongNormal < 0.0 {
               let restitution = 0.9;
               var impulse = -(1.0 + restitution) * velocityAlongNormal;
               let maxImpulse = 0.1;
               impulse = min(impulse, maxImpulse);
               p.velocity += direction * impulse * 0.5;
           }
           */

        }
    }

    particles[index] = p;
}
