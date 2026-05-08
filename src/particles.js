// particles.js — Particle flow systems for water currents and airflow
import * as THREE from 'three';

const TAU = Math.PI * 2;

export class FlowParticles {
  /**
   * @param {THREE.Scene} scene
   * @param {'water'|'air'} type
   */
  constructor(scene, type) {
    this.scene  = scene;
    this.type   = type;
    this.count  = type === 'water' ? 4000 : 2000;
    this.baseSpeed = type === 'water' ? 0.018 : 0.032;
    this.visible   = true;

    // Flow direction (updated externally)
    this.flowDir = new THREE.Vector3(1, 0, 0);

    // Model bounds for deflection
    this.modelCenter = null;
    this.modelRadius = 0;

    // Working arrays
    this.positions  = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.opacities  = new Float32Array(this.count);

    this._build();
  }

  // ── Setup ────────────────────────────────────────────────────
  _randomPos(i) {
    const spread = 28;
    if (this.type === 'water') {
      this.positions[i * 3]     = (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 1] = -Math.random() * 7 - 0.2;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    } else {
      this.positions[i * 3]     = (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 1] =  Math.random() * 7 + 0.2;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
  }

  _randomVel(i, speed) {
    const s = speed || this.baseSpeed;
    this.velocities[i * 3]     = (Math.random() * 0.4 + 0.8) * s * this.flowDir.x;
    this.velocities[i * 3 + 1] = (Math.random() - 0.5) * s * 0.04;
    this.velocities[i * 3 + 2] = (Math.random() * 0.4 + 0.8) * s * this.flowDir.z
                                  + (Math.random() - 0.5) * s * 0.15;
  }

  _build() {
    for (let i = 0; i < this.count; i++) {
      this._randomPos(i);
      this._randomVel(i);
      this.opacities[i] = Math.random();
    }

    // Geometry
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    // Vertex colours
    const cols = new Float32Array(this.count * 3);
    const c1 = this.type === 'water'
      ? new THREE.Color('#00ccff')
      : new THREE.Color('#ddeeff');
    const c2 = this.type === 'water'
      ? new THREE.Color('#0044bb')
      : new THREE.Color('#ffffff');

    for (let i = 0; i < this.count; i++) {
      const t = Math.random();
      const c = c1.clone().lerp(c2, t);
      cols[i * 3]     = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    this.geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

    this.mat = new THREE.PointsMaterial({
      size:         this.type === 'water' ? 0.07 : 0.10,
      vertexColors: true,
      transparent:  true,
      opacity:      this.type === 'water' ? 0.75 : 0.45,
      depthWrite:   false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.renderOrder = 1;
    this.scene.add(this.points);
  }

  // ── Public API ───────────────────────────────────────────────
  setSpeed(knots) {
    const mps = knots * 0.51444;
    const factor = mps / 2.5;
    for (let i = 0; i < this.count; i++) {
      const s = this.baseSpeed * factor;
      this._randomVel(i, s);
    }
  }

  setHeading(angleDeg) {
    const r = (angleDeg * Math.PI) / 180;
    this.flowDir.set(Math.cos(r), 0, Math.sin(r));
    // Recompute all velocities
    for (let i = 0; i < this.count; i++) this._randomVel(i);
  }

  setModelBounds(center, radius) {
    this.modelCenter = center.clone();
    this.modelRadius = radius * 1.35;
  }

  setVisible(v) {
    this.visible = v;
    this.points.visible = v;
  }

  // ── Per-frame update ─────────────────────────────────────────
  update(running, turbulence = 1) {
    if (!running || !this.visible) return;

    const pos = this.positions;
    const vel = this.velocities;
    const t   = turbulence;

    for (let i = 0; i < this.count; i++) {
      const ix = i * 3, iy = ix + 1, iz = ix + 2;

      // Advance particle
      pos[ix] += vel[ix];
      pos[iy] += vel[iy];
      pos[iz] += vel[iz];

      // Micro-turbulence
      pos[iz] += (Math.random() - 0.5) * 0.004 * t;
      pos[iy] += (Math.random() - 0.5) * 0.002 * t;

      // Deflect around hull bounding sphere
      if (this.modelCenter && this.modelRadius > 0) {
        const dx = pos[ix] - this.modelCenter.x;
        const dy = pos[iy] - this.modelCenter.y;
        const dz = pos[iz] - this.modelCenter.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r  = this.modelRadius;

        if (d2 < r * r && d2 > 0.0001) {
          const dist   = Math.sqrt(d2);
          const push   = (r - dist) / r;
          const scale  = push * 0.08;

          // Push outward from center
          pos[ix] += (dx / dist) * scale;
          pos[iy] += (dy / dist) * scale * 0.5;
          pos[iz] += (dz / dist) * scale;

          // Extra spanwise turbulence in wake
          if (dx < -r * 0.3) {
            pos[iz] += (Math.random() - 0.5) * 0.025 * t;
            pos[iy] += (Math.random() - 0.5) * 0.012 * t;
          }
        }
      }

      // Respawn out-of-bounds particles
      const spawnX = this.flowDir.x > 0 ? -14 : 14;
      if (pos[ix] > 14 || pos[ix] < -14) {
        this._randomPos(i);
        pos[ix] = spawnX;
        this._randomVel(i);
      }
      if (Math.abs(pos[iz]) > 7) pos[iz] *= 0.9;
    }

    this.geo.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ── Wake particles (turbulent, behind vessel) ──────────────────────────────
export class WakeParticles {
  constructor(scene) {
    this.scene  = scene;
    this.count  = 600;
    this.positions = new Float32Array(this.count * 3);
    this.ages      = new Float32Array(this.count);
    this.center    = new THREE.Vector3();
    this.radius    = 3;
    this.visible   = true;
    this._build();
  }

  _build() {
    for (let i = 0; i < this.count; i++) this._spawn(i);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.mat = new THREE.PointsMaterial({
      color:       0x88ccff,
      size:        0.06,
      transparent: true,
      opacity:     0.35,
      depthWrite:  false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.renderOrder = 1;
    this.scene.add(this.points);
  }

  _spawn(i) {
    const r = Math.random() * this.radius * 0.5;
    const a = Math.random() * Math.PI * 2;
    this.positions[i * 3]     = this.center.x - (2 + Math.random() * 8);
    this.positions[i * 3 + 1] = this.center.y + (Math.random() - 0.5) * r;
    this.positions[i * 3 + 2] = this.center.z + Math.cos(a) * r;
    this.ages[i] = Math.random();
  }

  setCenter(v, r) {
    this.center.copy(v);
    this.radius = r;
  }

  setVisible(v) {
    this.visible = v;
    this.points.visible = v;
  }

  update(running) {
    if (!running || !this.visible) return;
    for (let i = 0; i < this.count; i++) {
      const ix = i * 3;
      this.ages[i] += 0.008;
      this.positions[ix]     -= 0.04 + Math.random() * 0.02;
      this.positions[ix + 1] += (Math.random() - 0.5) * 0.015;
      this.positions[ix + 2] += (Math.random() - 0.5) * 0.02;
      if (this.ages[i] > 1 || this.positions[ix] < this.center.x - 14) {
        this._spawn(i);
        this.ages[i] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}
