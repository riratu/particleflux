# Interdimensional - Projekt-Zusammenfassung

## Was ist das?
Eine interaktive WebGL-Partikel-Simulation mit Live-Audio-Engine. Tausende Partikel (3 Typen: RED, GREEN, BLUE) interagieren physikalisch miteinander auf der GPU. Die Partikel-Geschwindigkeiten steuern Klang-Parameter in Echtzeit. Das Ganze ist als performative Installation gedacht -- Tastatur-Tasten oder ein Launchpad MIDI-Controller verformen die Simulation live.

## Tech-Stack
- **Three.js** (WebGL-Renderer, Post-Processing: Bloom, Vignette, Tone Mapping)
- **GPUComputationRenderer** (Partikel-Physik auf der GPU via GLSL-Shaders)
- **Tone.js** (Audio-Engine: Noise-Synthese, Sample-Playback, Effekte)
- **dat.gui** (Parameter-GUI)
- **Vite** (Dev-Server + Build, mit integriertem WebSocket-Server)
- **Web MIDI API** (Launchpad-Integration)

## Dateistruktur

### Kern-Dateien (Root)

| Datei | Beschreibung |
|---|---|
| `main.js` (~1060 Zeilen) | **Hauptdatei.** Three.js Scene-Setup, Kamera, Renderer, GPU-Partikel-System, Animation-Loop, GUI-Setup (dat.gui), WebSocket-Verbindung, Keyboard-Handler, Pop-out-Fenster, Fullscreen. Importiert alles andere. |
| `controller.js` (~187 Zeilen) | **MomentaryController** -- das Herzstück der Live-Steuerung. Definiert `PARAMS` (alle steuerbaren Parameter mit min/max/default) und `BUTTON_MAP` (Tasten-Zuordnungen mit Offset-Werten). Additive Offsets, Lerp-Interpolation (~100ms). |
| `launchpad.js` (~293 Zeilen) | Launchpad Mini MIDI-Bridge. Mappt 8x6 Pad-Grid auf `BUTTON_MAP`-Keys. LED-Farbfeedback (Rot/Gruen/Amber/Orange je nach Zeile). Spam-Schutz mit Lockout. |
| `paramHistory.js` (~205 Zeilen) | Live-Parameter-Visualisierung (Grafana-Style Sparklines). Circular Buffer, Canvas2D-Rendering. Wird im Pop-out-Modus aktiviert. |
| `index.html` | Einstiegspunkt. Minimal-HTML mit Audio-Mixer-Panel, Top-Bar (FPS, Fullscreen, Pop-out, Sound On/Off, Mixer-Button), Key-Hint-Overlay. |
| `vite.config.js` | Vite-Konfiguration. Port 5555, WebSocket-Server auf `/keystroke-sync` fuer Multi-Device-Sync. |
| `package.json` | Dependencies: three, tone, ws. DevDeps: dat.gui, vite. |
| `getAndconvertSoundFiles.php` | PHP-Script: Konvertiert WAV-Master aus `samples/masters/` zu komprimierten MP3s in `public/samples-compressed/` und generiert `audio/soundsFiles.js`. |

### Audio-System (`audio/`)

| Datei | Beschreibung |
|---|---|
| `audio.js` (~1040 Zeilen) | **Komplette Audio-Engine.** Zwei Teile: (1) Partikel-Noise-Engine (White-Noise pro Red-Particle, Bandpass-Filter gesteuert durch Geschwindigkeit, 3D-Panner). (2) Musik-Mixer mit Tone.js Playern: Pads (Ambient-Loops), Toppings (rhythmische Loops), Oneshots (getriggerte Samples). Effektkette: Per-Voice animierter Filter + Delay-Send + Convolution-Reverb (space_verb.mp3) + Algorithmic Reverb + Dry-Bus + Multiband-Kompressor. Auto-Scene-Wechsel, Slider-UI-Generierung, Key-Oneshot-System. |
| `soundsFiles.js` | Generierte Liste aller Sound-Dateien (wird von PHP-Script erzeugt). |
| `style.css` | Styles fuer Audio-Panel und Mixer-UI. |
| `sliders.css` | Custom-Slider-Styles (Volumen, Filter, Delay, Q). |

### GPU-Shaders (`shaders/`)

| Datei | Beschreibung |
|---|---|
| `velocity.glsl` | Berechnet Partikel-Geschwindigkeiten. Kraft-Matrix (3x3 fuer RED/GREEN/BLUE-Interaktionen), Repulsion, Gravity zum Zentrum, Space-Attraction, Z-Thrust/Flow. Spatial-Grid-Optimierung. |
| `position.glsl` | Aktualisiert Partikel-Positionen. Speed-Multiplier, spherical/cylindrical Clamping (Tunnel-Modus bei Z-Flow). |

### Sound-Dateien

| Ordner | Beschreibung |
|---|---|
| `samples/masters/` | Original-Sounddateien (WAV + MP3). Unterordner: `pads/` (Ambient), `toppings/` (Rhythmisch), `oneshots/` (Einmal-Sounds). |
| `public/samples-compressed/` | Komprimierte MP3-Versionen fuer den Browser. Gleiche Unterstruktur wie masters. |
| `public/space_verb.mp3` | Impulsantwort fuer Convolution-Reverb. |
| `sounds/` | Einzelne Sounddateien (WIP/temporaer). |

### Sonstiges

| Ordner/Datei | Beschreibung |
|---|---|
| `archive/` | Alte/archivierte Dateien. |
| `.tool-versions` | asdf Version Manager Konfiguration. |
| `dist/` | Build-Output (vite build). |

## Architektur-Ueberblick

```
Keyboard/Launchpad/WebSocket
        |
        v
  MomentaryController (controller.js)
   - press(code) / release(code)
   - Additive Offsets aus BUTTON_MAP
   - Lerp-Interpolation pro Frame
        |
        v
  +-----+------+-----+
  |            |           |
  v            v           v
GPU Shaders   Three.js    Audio Engine
(velocity/    (Bloom,     (Tone.js)
 position)    Vignette,   - Noise per Red
              Fog, etc.)  - Music Mixer
                          - Key Oneshots
```

### Datenfluss pro Frame (animate())
1. `controller.syncBaseline(forceBaseline)` -- GUI-Werte als Basis
2. `controller.update(dt)` -- Interpolation aller Parameter
3. Effective Werte -> GUI-Display, Kamera, Bloom, Fog, Exposure, Vignette
4. Effective Werte -> GPU Uniforms (velocity/position Shaders)
5. `gpuCompute.compute()` -- GPU berechnet neue Positionen/Geschwindigkeiten
6. Readback: GPU -> CPU (Positionen fuer Rendering, Geschwindigkeiten fuer Audio)
7. `updateAudio()` -- Red-Particle-Speeds steuern Noise-Filter-Frequenz + Lautstaerke
8. `applyAudioParams()` -- Controller-Werte fuer FilterQ, ReverbWet, etc.
9. `recordFrame()` -- Parameter-History fuer Sparklines
10. `composer.render()` -- Three.js Rendering mit Post-Processing

### Steuerung (BUTTON_MAP in controller.js)
- **Q-P** (Zeile 1): Raum/Expansion/Visual (expand, collapse, all-repel, hyper-g, scatter, dense, bloom, red-magnet, spin, exposure)
- **A-L** (Zeile 2): Kraft-Matrix (green-scatter, warp, cross-attract, cross-repel, green-cluster, blue-orbit, blue-chaos, all-attract)
- **Y-M** (Zeile 3): Sound-Shaping (bright, dark, resonant, smooth, red-hunt, vortex, quake)
- **1-0** (Ziffern): Compound-Effekte (explode, implode, crystallize, melt, swarm, nebula, pulse, void, aurora, storm)
- **Sondertasten**: Comma=terraform, Period=dissolve, Backspace=z-flow, Space=attract
- **Swiss-Keys**: BracketLeft=singularity, Semicolon=tidal, Quote=cascade, BracketRight=freeze, Backslash=hyperdrive
- **H**: UI ein/ausblenden, **Enter**: Fullscreen

### WebSocket Multi-Device-Sync
- Vite-Plugin startet WebSocket-Server auf `/keystroke-sync`
- Automatische Verbindung auf localhost/LAN
- Broadcast: keydown/keyup Events + masterSpeed werden an alle Clients gesendet
- Erlaubt mehrere Personen gleichzeitig die Simulation zu steuern

### Audio-Architektur (Tone.js)
```
Per Voice: Player -> AnimatedFilter -> MainGain -> ConvSend (Reverb)
                                                 -> AlgoSend (Hall)
                                                 -> DelayGain -> PingPongDelay
                                                 -> DryMaster

ConvSend -> Convolver(space_verb.mp3) -> ReverbMaster -> MultibandComp -> Destination
AlgoSend -> Highpass -> AlgoReverb -> AlgoMaster -> MultibandComp -> Destination
DryMaster -> MultibandComp -> Destination

Partikel-Noise: WhiteNoise -> Bandpass -> Volume -> ParticleReverb -> ParticleMaster -> Destination
Key-Oneshots: Player -> SharedBandpass(animated) -> KeyMaster -> DryMaster + ConvSend + AlgoSend
```

## Entwicklung

```bash
npm run dev     # Startet Vite Dev-Server auf Port 5555
npm run build   # Production Build nach dist/
npm run preview # Preview des Builds
```

### Sound-Pipeline
```bash
php getAndconvertSoundFiles.php  # WAV->MP3 Konvertierung + soundsFiles.js Generierung
```
Benoetigt: ffmpeg (fuer WAV->MP3), PHP CLI.

## Wichtige Patterns

- **Baseline + Offsets**: GUI-Slider setzen `forceBaseline`, Controller addiert Tasten-Offsets, Ergebnis wird per Lerp interpoliert und zurueck in `forceControls` geschrieben (fuer GUI-Display).
- **GPU Readback**: Positionen/Geschwindigkeiten werden pro Frame von der GPU zurueck gelesen -- notwendig fuer Audio und CPU-seitiges Rendering-Buffer-Update.
- **Disconnect/Reconnect**: Stille Audio-Voices werden vom Graph getrennt (Performance).
- **Spam-Schutz**: Launchpad hat Rate-Limiting mit visueller Lockout-Anzeige (rotes Blinken).
- **Auto-Scene**: Musik-Mixer wechselt automatisch alle 4-9 Sekunden die aktive Kombination aus Pads/Toppings.
- **localStorage**: Partikel-Settings und Audio-Autostart werden persistent gespeichert.
