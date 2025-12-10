struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) velocity: vec2<f32>,
    @location(2) life: f32,
    @location(3) size: f32,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
};

struct Uniforms {
    deltaTime: f32,
    screenWidth: f32,
    screenHeight: f32,
    _padding: f32,
};

@group(0) @binding(1)
var<uniform> uniforms: Uniforms;

// HSL to RGB conversion
fn hslToRgb(h: f32, s: f32, l: f32) -> vec3<f32> {
    let c = (1.0 - abs(2.0 * l - 1.0)) * s;
    let x = c * (1.0 - abs((h * 6.0) % 2.0 - 1.0));
    let m = l - c * 0.5;

    var rgb: vec3<f32>;
    let hue = h * 6.0;

    if (hue < 1.0) {
        rgb = vec3<f32>(c, x, 0.0);
    } else if (hue < 2.0) {
        rgb = vec3<f32>(x, c, 0.0);
    } else if (hue < 3.0) {
        rgb = vec3<f32>(0.0, c, x);
    } else if (hue < 4.0) {
        rgb = vec3<f32>(0.0, x, c);
    } else if (hue < 5.0) {
        rgb = vec3<f32>(x, 0.0, c);
    } else {
        rgb = vec3<f32>(c, 0.0, x);
    }

    return rgb + vec3<f32>(m, m, m);
}

@vertex
fn vs_main(in: VertexInput, @builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
    var out: VertexOutput;

    // Particle position is in pixels
    let screenPos = in.position;

    // Convert pixel coordinates to clip space [-1, 1]
    let clipX = (screenPos.x / uniforms.screenWidth) * 2.0 - 1.0;
    let clipY = 1.0 - (screenPos.y / uniforms.screenHeight) * 2.0;

    out.clip_position = vec4<f32>(clipX, clipY, 0.0, 1.0);

    // Calculate velocity magnitude
    let speed = length(in.velocity);

    let maxSpeed = 200.0; // Tune this value based on the Particle Speeds
    let normalizedSpeed = clamp(speed / maxSpeed, 0.0, 1.0) * 0.7;

    let hue = normalizedSpeed + 0.5;
    let saturation = 0.5;
    let lightness = 0.9;

    let rgb = hslToRgb(hue, saturation, lightness);
    out.color = vec4<f32>(rgb, 1.0);

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}
