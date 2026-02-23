uniform float deltaTime;
uniform float repulsionRange;
uniform float repulsionStrength;
uniform float gravity;
uniform vec3 center;
uniform float damping;
uniform float maxSpeed;
uniform vec2 mouse;
uniform float spaceAttraction;
uniform float maxForce;
uniform float speedMultiplier;
uniform float zThrust;

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

    // Z-axis attraction (pull towards the line where x=0, y=0)
    if (spaceAttraction > 0.0) {
        vec3 toZAxis = vec3(-position.x, -position.y, 0.0);
        force += toZAxis * spaceAttraction * deltaTime;
    }

    // Z thrust (starflight rush)
    velocity.z += zThrust * deltaTime;

    // Update velocity
    velocity += force;
    velocity *= damping;

    // Apply speed multiplier for calmer movement
    velocity *= speedMultiplier;

    // Clamp speed
    float speed = length(velocity);
    if (speed > maxSpeed) {
        velocity = normalize(velocity) * maxSpeed;
    }

    gl_FragColor = vec4(velocity, 0.0);
}
