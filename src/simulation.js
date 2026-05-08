// simulation.js — Mock hydrodynamic & aerodynamic physics engine
// Implements simplified naval architecture formulas for real-time feedback

const RHO_WATER = 1025;       // kg/m³ seawater density
const RHO_AIR   = 1.225;      // kg/m³ air density
const NU_WATER  = 1.004e-6;   // m²/s kinematic viscosity (seawater, 20°C)
const NU_AIR    = 1.516e-5;   // m²/s kinematic viscosity (air)
const G         = 9.81;       // m/s²

// Beaufort sea state → wave height (m)
const SEA_STATE_HEIGHT = [0, 0.1, 0.5, 1.25, 2.5, 4.0, 6.0, 9.0, 14.0, 14.0];

export class Simulation {
  constructor() {
    this.running  = false;
    this.time     = 0; // seconds
    this._results = null;

    // Default parameters
    this.params = {
      waterSpeed:    5,    // knots
      windSpeed:     10,   // knots
      currentHeading: 0,   // degrees (0 = head-on, 90 = beam)
      windAngle:     0,    // degrees
      waterDepth:    50,   // m
      seaState:      2,
      hullLength:    80,   // m
      displacement:  3200, // tonnes
      draft:         8,    // m
    };
  }

  update(dt) {
    if (!this.running) return;
    this.time += dt;
    this._results = this._compute();
  }

  get results() {
    return this._results || this._compute();
  }

  _compute() {
    const p  = this.params;

    // ── Unit conversions ──────────────────────────────────────
    const vw = p.waterSpeed * 0.51444;   // knots → m/s
    const va = p.windSpeed  * 0.51444;
    const L  = p.hullLength;
    const D  = p.displacement * 1000;    // t → kg (displacement mass)

    // Heading angle effects
    const ha = (p.currentHeading * Math.PI) / 180;
    const wa = (p.windAngle      * Math.PI) / 180;

    // Approximate wetted surface area (Denny formula, simplified)
    const A_wet  = 1.025 * Math.sqrt(D / RHO_WATER * L); // m²
    const A_above = L * (p.draft * 0.3);                  // above-waterline projected area

    // ── Drag coefficient (varies with angle of attack) ────────
    //   Cd_0 for streamlined hull (axisymmetric submarine ≈ 0.12–0.18)
    //   rises steeply at non-zero heading (cos profile of hydrodynamic efficiency)
    const Cd_hydro = 0.15 + 0.65 * Math.pow(Math.abs(Math.sin(ha)), 1.4);
    const Cd_aero  = 0.6  + 1.2  * Math.pow(Math.abs(Math.sin(wa)), 1.2);

    // Lift & side force coefficients
    const Cl_hydro = 0.08 * Math.sin(2 * ha);
    const Cf_hydro = 0.45 * Math.sin(ha);   // side force

    // ── Forces ────────────────────────────────────────────────
    const dragHydro = 0.5 * RHO_WATER * vw * vw * Cd_hydro * A_wet  / 1000; // kN
    const dragAero  = 0.5 * RHO_AIR   * va * va * Cd_aero  * A_above / 1000;
    const liftHydro = 0.5 * RHO_WATER * vw * vw * Cl_hydro * A_wet  / 1000;
    const sideHydro = 0.5 * RHO_WATER * vw * vw * Cf_hydro * A_wet  / 1000;
    const sideAero  = 0.5 * RHO_AIR   * va * va * 0.7       * A_above / 1000;

    const dragTotal = dragHydro + dragAero;
    const sideTotal = Math.abs(sideHydro) + Math.abs(sideAero);

    // Added wave resistance (simplified Faltinsen approach)
    const Hs         = SEA_STATE_HEIGHT[Math.min(p.seaState, 9)];
    const addedResist = 0.05 * RHO_WATER * G * Hs * Hs * L / 1000; // kN

    // ── Dimensionless numbers ─────────────────────────────────
    const Re  = (vw * L) / NU_WATER / 1e6;      // millions
    const Fn  = vw / Math.sqrt(G * L);
    const Cp  = 1 - Math.pow((1.5 * vw) / (vw + 0.5), 2); // simplified pressure coeff

    // ── Vessel response ───────────────────────────────────────
    // Heel angle (small angle approx): heel = atan(heeling moment / restoring moment)
    //   GZ restoring lever ~ 0.5 m (simplification)
    const GM    = 0.5 + p.draft * 0.06; // metacentric height (m)
    const heelRad   = Math.atan(sideTotal / (D * G / 1000 * GM));
    const heelDeg   = (heelRad * 180) / Math.PI;

    // Pitch angle from wave action
    const pitchDeg = Hs * 0.4 * Math.sin(this.time * 0.3);

    // ── Health indicators ─────────────────────────────────────
    // Hull stress (normalised 0-1)
    const stressLevel = Math.min(1, (dragTotal + sideTotal) / (D * 0.00008));
    // Flow separation onset
    const flowSep = Math.min(1, 0.15 + 0.85 * Math.abs(Math.sin(ha)));
    // Cavitation risk (significant above ~8 m/s in fresh water)
    const cavRisk = Math.min(1, Math.max(0, (vw - 7.0) / 8.0));
    // Stability index (1 = very stable, 0 = unsafe)
    const stability = Math.max(0, 1 - Math.abs(heelDeg) / 30);

    return {
      dragForce:    dragTotal.toFixed(1),
      liftForce:    Math.abs(liftHydro).toFixed(1),
      sideForce:    sideTotal.toFixed(1),
      addedResist:  addedResist.toFixed(1),
      reynolds:     Re.toFixed(2),
      froude:       Fn.toFixed(3),
      cd:           Cd_hydro.toFixed(3),
      cp:           Cp.toFixed(3),
      heelAngle:    heelDeg.toFixed(1),
      pitchAngle:   pitchDeg.toFixed(1),
      // Raw values for 3D
      heelRad,
      pitchRad: (pitchDeg * Math.PI) / 180,
      dragMag:  dragTotal,
      liftMag:  Math.abs(liftHydro),
      sideMag:  sideTotal,
      // Bars
      stressLevel,
      flowSep,
      cavRisk,
      stability,
    };
  }
}
