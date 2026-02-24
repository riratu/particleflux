uniform float deltaTime;
uniform float maxRadius;
uniform float zFlow;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 tmpPos = texture2D(texturePosition, uv);
    vec3 position = tmpPos.xyz;
    float particleType = tmpPos.w;

    vec3 velocity = texture2D(textureVelocity, uv).xyz;

    position += velocity * deltaTime;

    if (zFlow != 0.0) {
        // When z-flow is active: clamp x,y to maxRadius, wrap z
        float distXY = length(position.xy);
        if (distXY > maxRadius) {
            position.xy = normalize(position.xy) * maxRadius;
        }
        // Wrap z for seamless tunnel effect
        if (position.z > 500.0) position.z -= 1000.0;
        if (position.z < -500.0) position.z += 1000.0;
    } else {
        // Default: spherical clamp
        float dist = length(position);
        if (dist > maxRadius) {
            position = normalize(position) * maxRadius;
        }
    }

    gl_FragColor = vec4(position, particleType);
}