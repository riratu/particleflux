export let Tone = null;
let audioInitialized = false;
let audioContextStarted = false;
let redNoises = [];
let reverb = null;

// Exposed audio params — controller pushes values here each frame
export const audioParams = {
    filterQ: 15,
    reverbWet: 0.9,
    minVol: -15,
    maxVol: -10,
};

export function applyAudioParams(params) {
    if (!audioInitialized) return;

    if (params.filterQ !== undefined) {
        audioParams.filterQ = params.filterQ;
        for (const ch of redNoises) {
            ch.filter.Q.value = params.filterQ;
        }
    }
    if (params.reverbWet !== undefined) {
        audioParams.reverbWet = params.reverbWet;
        if (reverb) reverb.wet.value = params.reverbWet;
    }
    if (params.minVol !== undefined) audioParams.minVol = params.minVol;
    if (params.maxVol !== undefined) audioParams.maxVol = params.maxVol;
}

export async function startAudioContext() {
    if (!audioContextStarted) {
        console.log('Starting Tone.js...');
        Tone = await import('tone');
        await Tone.start();
        Tone.context.lookAhead = 1;
        Tone.context.updateInterval = 0.2;
        console.log('Tone.js started, context state:', Tone.context.state);
        audioContextStarted = true;
    }
}

export function isAudioStarted() {
    return audioContextStarted;
}

export function initAudio(redCount) {
    if (!audioInitialized && audioContextStarted) {
        console.log('Initializing audio...');
        console.log('Tone context state:', Tone.context.state);
        console.log('Tone context destination:', Tone.Destination);

        // Create a shared reverb effect
        reverb = new Tone.Reverb({
            decay: 20.5,
            wet: 0.9,
            preDelay: 0.01
        });
        reverb.toDestination();

        // Sound files for each red particle
        // Create audio players for each red particle
        for (let i = 0; i < redCount; i++) {
            const noise = new Tone.Noise('white');
            noise.start();

            const filter = new Tone.Filter({
                type: "bandpass",
                frequency: 5000,
                Q: 15,
                rolloff: -24
            });

            const volume = new Tone.Volume(-2);

            const panner = new Tone.Panner3D({
                panningModel: 'HRTF',
                positionX: 0,
                positionY: 0,
                positionZ: 0
            });

            // Connect: noise -> filter -> volume -> reverb -> output
            noise.connect(filter);
            filter.connect(volume);
            volume.connect(reverb);

            redNoises.push({
                source: noise,
                filter,
                volume,
                panner,
                isOscillator: false
            });
        }

        console.log(`Created ${redCount} audio players for red particles`);
        audioInitialized = true;
        console.log('Audio initialized - sounds started');
    }
}

export function updateAudio(redSpeeds, particles, forceControls) {
    if (!forceControls.soundEnabled || redSpeeds.length === 0 || !audioContextStarted) return;

    // Initialize audio on first use
    if (!audioInitialized) {
        initAudio(redSpeeds.length);
    }

    const now = Tone.now();
    const minFreq = 100;
    const maxFreq = forceControls.soundFrequency * 2;
    const minVol = audioParams.minVol;
    const maxVol = audioParams.maxVol;

    // Update each red particle's audio
    for (let i = 0; i < redSpeeds.length; i++) {
        const { speed, bufferIndex } = redSpeeds[i];

        // Get the particle to calculate distance
        const particle = particles.find(p => p.bufferKind === 'RED' && p.bufferIndex === bufferIndex);
        if (!particle) continue;

        const audioChannel = redNoises[bufferIndex];

        if (audioChannel) {
            // Update 3D panner position (scale down for reasonable audio space)
            const scale = 0.01;
            audioChannel.panner.positionX.linearRampToValueAtTime(particle.position.x * scale, now + 0.05);
            audioChannel.panner.positionY.linearRampToValueAtTime(particle.position.y * scale, now + 0.05);
            audioChannel.panner.positionZ.linearRampToValueAtTime(particle.position.z * scale, now + 0.05);

            // Map speed to filter frequency
            const speedNormalized = Math.min(speed / forceControls.soundSpeedMax, 2);
            let targetFreq = minFreq + (maxFreq - minFreq) * speedNormalized;

            // Update filter frequency
            audioChannel.filter.frequency.linearRampToValueAtTime(targetFreq, now + 0.05);

            // Map speed to volume (louder when faster)
            let targetVol = minVol + (maxVol - minVol) * speedNormalized;

            // Smooth volume changes
            audioChannel.volume.volume.linearRampToValueAtTime(targetVol, now + 0.05);
        }
    }
}
