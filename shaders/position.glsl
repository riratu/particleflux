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