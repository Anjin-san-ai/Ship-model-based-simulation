# ⬡ MBT — Model Based Testing
### Platform & Design Commission | Vessel Hydrodynamic & Aerodynamic Simulation

A lightweight, browser-based simulation tool for testing physical vessel (platform) designs against water currents and aerodynamic forces. Drop your GLB model, configure the environment, and see live hydrodynamic/aero metrics with 3D flow visualisation.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies (~25 MB, Three.js only)
npm install

# 2. Start the dev server (opens browser automatically)
npm run dev
```

Navigate to `http://localhost:5173` — or it opens automatically.

---

## 📂 Loading Your Model

**Option A — Drag & Drop (recommended)**
Drag your `.glb` or `.gltf` file directly onto the 3D viewport drop zone.

**Option B — File Browser**
Click "Browse Files" in the drop zone and select your GLB file.

The model is auto-centred and scaled to fit the scene. If your submarine
appears rotated incorrectly, use the **Orbit Controls** (left-drag to orbit,
right-drag to pan, scroll to zoom) to adjust your view.

---

## 🎛️ Controls

| Panel | Controls |
|---|---|
| **Water Environment** | Current speed (kts), heading angle, depth, sea state |
| **Atmospheric** | Wind speed (kts), wind angle |
| **Vessel Parameters** | Hull length, displacement, draft |
| **Simulation Control** | Play/Pause, Reset, particle toggles |

---

## 📊 Live Metrics

| Metric | Description |
|---|---|
| **Drag Force** | Total hydrodynamic + aerodynamic resistance (kN) |
| **Lift Force** | Vertical hydrodynamic lift (kN) |
| **Side Force** | Lateral force from cross-current / cross-wind (kN) |
| **Reynolds No.** | Flow regime indicator (millions) |
| **Froude No.** | Wave-making resistance regime |
| **Drag Coeff.** | Effective Cd, rises sharply with heading angle |
| **Pressure Coeff.** | Bernoulli pressure coefficient |
| **Heel Angle** | Lateral tilt due to side forces (°) |
| **Pitch Angle** | Longitudinal motion from wave action (°) |
| **Added Resistance** | Extra resistance from sea state (kN) |

### Status Bars
- **Hull Stress** — Combined force as fraction of vessel limit
- **Flow Separation** — Boundary layer separation risk
- **Cavitation Risk** — Propeller/hull cavitation onset (> 7 m/s)
- **Stability Index** — Intact stability score (100% = very stable)

---

## 🌊 3D Visualisation

| Element | Colour | Meaning |
|---|---|---|
| Cyan particles | `#00ccff` | Water current flow |
| White particles | `#ddeeff` | Air flow / wind |
| White turbulent | `#88ccff` | Wake / turbulent trail |
| Red arrow | `#ff3333` | Drag force vector |
| Green arrow | `#33ff88` | Lift force vector |
| Yellow arrow | `#ffcc00` | Side force vector |
| Red glow (bow) | | High pressure zone |
| Blue glow (stern) | | Low pressure / wake separation |
| Green glow (sides) | | Suction peak / shoulder |

Particles **deflect around the hull bounding sphere** — you can see the
flow separate at the shoulder and form a turbulent wake aft.

---

## ⚙️ Physics Model (Simplified)

The simulation uses standard naval architecture formulae with mocked
material properties — suitable for design concept evaluation, not
classification-society certification.

```
F_drag  = ½ · ρ_w · V² · Cd(θ) · A_wet
F_lift  = ½ · ρ_w · V² · Cl(θ) · A_wet
Re      = V · L / ν
Fn      = V / √(g · L)
```

Where `θ` is the heading angle. `Cd` rises from ~0.15 (head-on) toward ~0.80
(beam-on), demonstrating the importance of hull alignment to the current.

---

## 🏗️ Stack

| Package | Purpose |
|---|---|
| `vite ^5.2` | Dev server + bundler |
| `three ^0.163` | 3D rendering, GLB loading, particles |

No other runtime dependencies.

---

## 📁 Project Structure

```
model-based-testing/
├── package.json
├── vite.config.js
├── index.html
├── src/
│   ├── main.js          ← Three.js scene + UI wiring
│   ├── particles.js     ← Water & air particle flow systems
│   ├── simulation.js    ← Hydrodynamic physics model
│   └── style.css        ← Naval engineering dark UI
└── public/              ← (optional: place GLBs here for direct URL)
```

---

*MBT — Model Based Testing for platform commissioning. For design evaluation only.*
