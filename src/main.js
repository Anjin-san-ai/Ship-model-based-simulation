// main.js — MBT Platform & Design Simulation
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { Simulation }    from './simulation.js';
import { FlowParticles, WakeParticles } from './particles.js';

// ── Global state ───────────────────────────────────────────────
const sim     = new Simulation();
let model     = null;        // loaded THREE.Object3D
let modelBox  = null;        // THREE.Box3
let modelCenter = new THREE.Vector3();
let modelRadius = 3;

let waterParticles = null;
let airParticles   = null;
let wakeParticles  = null;
let forceArrows    = {};
let pressureMeshes = [];
let oceanSurface   = null;

let clock     = new THREE.Clock();
let isRunning = false;
let elapsed   = 0;

const SIM_DURATION = 60; // seconds before auto-stop

// ── Three.js setup ─────────────────────────────────────────────
const canvas    = document.getElementById('canvas');
const renderer  = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#c4d4e4');
scene.fog = new THREE.FogExp2('#b8ccd8', 0.015);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(16, 8, 14);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping  = true;
orbit.dampingFactor  = 0.06;
orbit.minDistance    = 3;
orbit.maxDistance    = 80;
orbit.target.set(0, 0, 0);

// ── Lighting ───────────────────────────────────────────────────
const ambient = new THREE.HemisphereLight('#c8dce8', '#2a4a62', 1.0);
scene.add(ambient);

const sun = new THREE.DirectionalLight('#fff0d8', 1.8);
sun.position.set(20, 30, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far  = 200;
sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
sun.shadow.camera.right = sun.shadow.camera.top   =  30;
scene.add(sun);

const underLight = new THREE.PointLight('#0066ff', 0.4, 30);
underLight.position.set(0, -5, 0);
scene.add(underLight);

// ── Ocean floor grid ───────────────────────────────────────────
const floorGeo = new THREE.PlaneGeometry(80, 60, 1, 1);
floorGeo.rotateX(-Math.PI / 2);
const floorMat = new THREE.MeshStandardMaterial({ color: '#1a3a54', roughness: 1 });
const floor    = new THREE.Mesh(floorGeo, floorMat);
floor.position.y = -12;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(80, 40, '#2a5070', '#1a3850');
grid.position.y = -12.01;
scene.add(grid);

// ── Ocean surface ──────────────────────────────────────────────
function buildOceanSurface() {
  const waveGeo = new THREE.PlaneGeometry(80, 60, 80, 60);
  waveGeo.rotateX(-Math.PI / 2);
  const waveMat = new THREE.MeshStandardMaterial({
    color:       '#2a5a7a',
    transparent: true,
    opacity:     0.60,
    side:        THREE.DoubleSide,
    metalness:   0.1,
    roughness:   0.6,
  });
  const mesh = new THREE.Mesh(waveGeo, waveMat);
  mesh.position.y = 0;
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}
oceanSurface = buildOceanSurface();

function animateOcean(t, seaState) {
  const geo  = oceanSurface.geometry;
  const pos  = geo.attributes.position;
  const amp  = Math.min(0.5, seaState * 0.07);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i,
      Math.sin(x * 0.3 + t * 0.8) * amp +
      Math.cos(z * 0.4 + t * 0.6) * amp * 0.6
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// ── Depth reference lines ──────────────────────────────────────
function buildDepthLines() {
  const mat  = new THREE.LineBasicMaterial({ color: '#1a3060', transparent: true, opacity: 0.5 });
  const pts  = [];
  for (let x = -25; x <= 25; x += 2) {
    pts.push(new THREE.Vector3(x, 0, -20), new THREE.Vector3(x, 0, 20));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.LineSegments(geo, mat));
}
buildDepthLines();

// ── Particle systems ───────────────────────────────────────────
waterParticles = new FlowParticles(scene, 'water');
airParticles   = new FlowParticles(scene, 'air');
wakeParticles  = new WakeParticles(scene);

// ── Force arrows ───────────────────────────────────────────────
function buildForceArrows(center) {
  // Remove old
  Object.values(forceArrows).forEach(a => scene.remove(a));
  forceArrows = {};

  const origin = center.clone().add(new THREE.Vector3(0, 0.3, 0));

  forceArrows.drag = new THREE.ArrowHelper(
    new THREE.Vector3(-1, 0, 0), origin, 3.5, 0xff3333, 0.9, 0.45
  );
  forceArrows.lift = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0), origin, 2.5, 0x33ff88, 0.7, 0.35
  );
  forceArrows.side = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1), origin, 2.0, 0xffcc00, 0.6, 0.30
  );

  scene.add(forceArrows.drag, forceArrows.lift, forceArrows.side);
}

function updateForceArrows(res) {
  if (!forceArrows.drag) return;
  const heading = sim.params.currentHeading * Math.PI / 180;

  // Drag opposes flow direction
  const dragDir = new THREE.Vector3(-Math.cos(heading), 0, -Math.sin(heading));
  forceArrows.drag.setDirection(dragDir);
  const dragLen = Math.max(0.5, Math.min(6, parseFloat(res.dragForce) / 30));
  forceArrows.drag.setLength(dragLen, dragLen * 0.25, dragLen * 0.12);

  // Lift (vertical)
  const liftLen = Math.max(0.3, Math.min(4, parseFloat(res.liftForce) / 20));
  forceArrows.lift.setLength(liftLen, liftLen * 0.25, liftLen * 0.12);

  // Side force
  const sideDir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  forceArrows.side.setDirection(sideDir);
  const sideLen = Math.max(0.3, Math.min(4, parseFloat(res.sideForce) / 20));
  forceArrows.side.setLength(sideLen, sideLen * 0.25, sideLen * 0.12);

  // Visibility
  const vis = document.getElementById('tog-forces').checked;
  forceArrows.drag.visible = vis;
  forceArrows.lift.visible = vis;
  forceArrows.side.visible = vis;
}

// ── Pressure zone visualisation ────────────────────────────────
function buildPressureZones(box) {
  pressureMeshes.forEach(m => scene.remove(m));
  pressureMeshes = [];

  const ctr = box.getCenter(new THREE.Vector3());
  const sx  = (box.max.x - box.min.x) * 0.5;

  // Bow — high pressure (red)
  const bowGeo = new THREE.SphereGeometry(0.9, 16, 12);
  const bowMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.18, depthWrite: false });
  const bow = new THREE.Mesh(bowGeo, bowMat);
  bow.position.set(box.max.x - sx * 0.1, ctr.y, ctr.z);
  bow.scale.set(0.6, 0.4, 0.4);
  scene.add(bow);
  pressureMeshes.push(bow);

  // Stern — low pressure / separation (purple-blue)
  const sGeo = new THREE.SphereGeometry(1.2, 16, 12);
  const sMat = new THREE.MeshBasicMaterial({ color: 0x2200ff, transparent: true, opacity: 0.12, depthWrite: false });
  const stern = new THREE.Mesh(sGeo, sMat);
  stern.position.set(box.min.x + sx * 0.1, ctr.y, ctr.z);
  stern.scale.set(1.2, 0.5, 0.5);
  scene.add(stern);
  pressureMeshes.push(stern);

  // Side shoulder — suction peak (green)
  [-1, 1].forEach(side => {
    const shGeo = new THREE.SphereGeometry(0.7, 12, 10);
    const shMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.1, depthWrite: false });
    const sh    = new THREE.Mesh(shGeo, shMat);
    sh.position.set(ctr.x + sx * 0.2, ctr.y, ctr.z + side * modelRadius * 0.7);
    sh.scale.set(0.6, 0.35, 0.35);
    scene.add(sh);
    pressureMeshes.push(sh);
  });
}

function updatePressureZones(res) {
  const vis = document.getElementById('tog-pressure').checked;
  pressureMeshes.forEach(m => { m.visible = vis; });
  if (!pressureMeshes.length) return;

  // Pulsate intensity based on speed
  const speed = sim.params.waterSpeed;
  const scale = 0.9 + 0.15 * Math.sin(Date.now() * 0.003) * (speed / 15);
  pressureMeshes[0].material.opacity = Math.min(0.35, 0.12 * (speed / 5));
  pressureMeshes[1].material.opacity = Math.min(0.25, 0.08 * (speed / 5));
}

// ── GLB Loader ─────────────────────────────────────────────────
const loader = new GLTFLoader();

function loadModel(url) {
  setStatus('Loading…', 'loading');
  addLog('Loading model file…', 'info');
  if (model) {
    scene.remove(model);
    model = null;
  }

  loader.load(url, (gltf) => {
    model = gltf.scene;

    // Shadow + material enhancement
    model.traverse(child => {
      if (child.isMesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.envMapIntensity = 0.4;
          // Keep original material but add slight metalness
          if (!child.material.metalness) child.material.metalness = 0.3;
          child.material.roughness = child.material.roughness ?? 0.6;
        }
      }
    });

    // Centre and fit
    modelBox = new THREE.Box3().setFromObject(model);
    modelBox.getCenter(modelCenter);
    const size = modelBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 12; // world units
    const scaleFactor = targetSize / maxDim;

    model.scale.setScalar(scaleFactor);
    modelBox.setFromObject(model); // recompute after scale
    modelBox.getCenter(modelCenter);

    // Centre at origin
    model.position.sub(modelCenter);
    modelBox.setFromObject(model);
    modelBox.getCenter(modelCenter);

    const bSphere = new THREE.Sphere();
    modelBox.getBoundingSphere(bSphere);
    modelRadius = bSphere.radius;

    scene.add(model);

    // Initialise dependent systems
    waterParticles.setModelBounds(modelCenter, modelRadius);
    airParticles.setModelBounds(modelCenter, modelRadius);
    wakeParticles.setCenter(modelCenter, modelRadius);
    buildForceArrows(modelCenter);
    buildPressureZones(modelBox);

    // Camera reset
    camera.position.set(modelRadius * 2, modelRadius * 1.2, modelRadius * 2.2);
    orbit.target.copy(modelCenter);
    orbit.update();

    // Hide drop zone
    document.getElementById('drop-zone').style.display = 'none';
    setStatus('Model Loaded', 'ready');
    addLog(`Model loaded. Bounding sphere r=${modelRadius.toFixed(1)} m`, 'ok');
    addLog('Drop GLB or press ▶ to start simulation.', 'info');
  },
  (xhr) => {
    const pct = ((xhr.loaded / xhr.total) * 100).toFixed(0);
    setStatus(`Loading ${pct}%`, 'loading');
  },
  (err) => {
    console.error(err);
    setStatus('Load error', 'error');
    addLog('Failed to load model: ' + err.message, 'error');
  });
}

// ── Drag & drop ────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFromFile(file);
});

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadFromFile(file);
});

function loadFromFile(file) {
  const url = URL.createObjectURL(file);
  loadModel(url);
}

// ── UI Controls ────────────────────────────────────────────────
function bindSlider(id, paramKey, valId, formatter) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    sim.params[paramKey] = v;
    document.getElementById(valId).textContent = formatter(v);
    onParamChange();
  });
}

bindSlider('water-speed',    'waterSpeed',      'wc-val',   v => `${v} kts`);
bindSlider('wind-speed',     'windSpeed',       'ws-val',   v => `${v} kts`);
bindSlider('current-heading','currentHeading',  'ch-val',   v => `${v}°`);
bindSlider('wind-angle',     'windAngle',       'wa-val',   v => `${v}°`);
bindSlider('water-depth',    'waterDepth',      'wd-val',   v => `${v} m`);
bindSlider('sea-state',      'seaState',        'ss-val',   v => `${v}`);
bindSlider('hull-length',    'hullLength',      'hl-val',   v => `${v} m`);
bindSlider('displacement',   'displacement',    'disp-val', v => `${v} t`);
bindSlider('draft',          'draft',           'draft-val',v => `${v} m`);

function onParamChange() {
  const heading = sim.params.currentHeading;
  waterParticles.setHeading(heading);
  airParticles.setHeading(sim.params.windAngle);
  waterParticles.setSpeed(sim.params.waterSpeed);
  airParticles.setSpeed(sim.params.windSpeed);
  drawCompass(heading);
}

// Play / Reset buttons
document.getElementById('btn-play').addEventListener('click', () => {
  isRunning = !isRunning;
  sim.running = isRunning;
  const btn = document.getElementById('btn-play');
  btn.textContent = isRunning ? '⏸ Pause' : '▶ Run Simulation';
  btn.className   = isRunning ? 'btn-pause' : 'btn-primary';
  if (isRunning) {
    setStatus('Simulation Running', 'running');
    addLog('Simulation started.', 'ok');
  } else {
    setStatus('Paused', 'ready');
    addLog('Simulation paused.', 'info');
    if (elapsed > 0) showRecommendations();
  }
});

document.getElementById('btn-reset').addEventListener('click', () => {
  isRunning     = false;
  sim.running   = false;
  sim.time      = 0;
  elapsed       = 0;
  document.getElementById('btn-play').textContent = '▶ Run Simulation';
  document.getElementById('btn-play').className   = 'btn-primary';
  document.getElementById('sim-time').textContent = 'T+00:00';
  setStatus('Ready', 'ready');
  addLog('Simulation reset.', 'info');
  clearMetrics();
});

// Toggle checkboxes
document.getElementById('tog-water').addEventListener('change', e => {
  waterParticles.setVisible(e.target.checked);
  wakeParticles.setVisible(e.target.checked);
});
document.getElementById('tog-air').addEventListener('change', e => {
  airParticles.setVisible(e.target.checked);
});
document.getElementById('tog-forces').addEventListener('change', () => updateForceArrows(sim.results));
document.getElementById('tog-pressure').addEventListener('change', () => updatePressureZones(sim.results));

// ── Compass HUD ────────────────────────────────────────────────
const compassCtx = document.getElementById('compass-canvas').getContext('2d');

function drawCompass(angleDeg) {
  const ctx = compassCtx, w = 80, h = 80, cx = w / 2, cy = h / 2, r = 34;
  ctx.clearRect(0, 0, w, h);
  // Ring
  ctx.strokeStyle = '#1a3050';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // Cardinal labels
  ctx.fillStyle = '#5080a0';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - r + 10);
  ctx.fillText('S', cx, cy + r - 2);
  ctx.fillText('E', cx + r - 4, cy + 4);
  ctx.fillText('W', cx - r + 4, cy + 4);
  // Arrow
  const rad = (angleDeg * Math.PI) / 180;
  const arrowLen = r - 6;
  ctx.strokeStyle = '#00ccff';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(rad) * arrowLen * 0.35, cy - Math.sin(rad) * arrowLen * 0.35);
  ctx.lineTo(cx + Math.cos(rad) * arrowLen, cy + Math.sin(rad) * arrowLen);
  ctx.stroke();
  // Head dot
  ctx.fillStyle = '#00ccff';
  ctx.beginPath();
  ctx.arc(cx + Math.cos(rad) * arrowLen, cy + Math.sin(rad) * arrowLen, 3, 0, Math.PI * 2);
  ctx.fill();
}
drawCompass(0);

// ── UI helpers ─────────────────────────────────────────────────
function setStatus(text, state) {
  document.getElementById('status-text').textContent = text;
  document.getElementById('status-dot').className = 'status-dot ' + state;
}

function addLog(msg, cls = 'info') {
  const log   = document.getElementById('log');
  const entry = document.createElement('div');
  const ts    = new Date().toTimeString().slice(0, 8);
  entry.className = 'log-entry ' + cls;
  entry.textContent = `[${ts}] ${msg}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  // Keep max 20 entries
  while (log.children.length > 21) log.removeChild(log.children[1]);
}

function clearMetrics() {
  ['m-drag','m-lift','m-side','m-re','m-fn','m-cd','m-cp','m-heel','m-pitch','m-aw'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  ['b-stress','b-sep','b-cav','b-stab'].forEach(id => {
    document.getElementById(id).style.width = '0%';
  });
  ['bp-stress','bp-sep','bp-cav','bp-stab'].forEach(id => {
    document.getElementById(id).textContent = '0%';
  });
}

function updateUI(res) {
  document.getElementById('m-drag').textContent  = res.dragForce;
  document.getElementById('m-lift').textContent  = res.liftForce;
  document.getElementById('m-side').textContent  = res.sideForce;
  document.getElementById('m-re').textContent    = res.reynolds;
  document.getElementById('m-fn').textContent    = res.froude;
  document.getElementById('m-cd').textContent    = res.cd;
  document.getElementById('m-cp').textContent    = res.cp;
  document.getElementById('m-heel').textContent  = res.heelAngle;
  document.getElementById('m-pitch').textContent = res.pitchAngle;
  document.getElementById('m-aw').textContent    = res.addedResist;

  setBar('b-stress', 'bp-stress', res.stressLevel);
  setBar('b-sep',    'bp-sep',    res.flowSep);
  setBar('b-cav',    'bp-cav',    res.cavRisk);
  setBar('b-stab',   'bp-stab',   res.stability);

  // Clock
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = Math.floor(elapsed % 60).toString().padStart(2, '0');
  document.getElementById('sim-time').textContent = `T+${m}:${s}`;

  // Vessel tilt
  if (model) {
    model.rotation.z = THREE.MathUtils.lerp(model.rotation.z, res.heelRad * 0.6, 0.03);
    model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, res.pitchRad * 0.4, 0.03);
  }
}

function setBar(id, pctId, val) {
  const pct = Math.round(val * 100);
  document.getElementById(id).style.width = pct + '%';
  document.getElementById(pctId).textContent = pct + '%';
}

// ── Recommendations ────────────────────────────────────────
function generateRecommendations(res, params) {
  const recs = [];

  if (res.stressLevel > 0.8)
    recs.push({ sev: 'danger', icon: '⚠', text: 'Hull stress critical — reduce water speed or align heading closer to head-on.' });
  else if (res.stressLevel > 0.5)
    recs.push({ sev: 'warn',   icon: '⚡', text: 'Elevated hull stress — consider reducing current speed by 20–30%.' });
  else
    recs.push({ sev: 'ok',    icon: '✓', text: 'Hull stress within safe operating limits.' });

  if (res.cavRisk > 0.6)
    recs.push({ sev: 'danger', icon: '⚠', text: 'High cavitation risk — propeller cavitation likely. Reduce speed below 14 knots.' });
  else if (res.cavRisk > 0.3)
    recs.push({ sev: 'warn',   icon: '⚡', text: 'Moderate cavitation risk — monitor propeller noise and vibration.' });
  else
    recs.push({ sev: 'ok',    icon: '✓', text: 'Cavitation risk low at current speed.' });

  const heel = Math.abs(parseFloat(res.heelAngle));
  if (heel > 15)
    recs.push({ sev: 'danger', icon: '⚠', text: `Heel angle ${res.heelAngle}° exceeds safe limit — adjust ballast or reduce beam-current exposure.` });
  else if (heel > 8)
    recs.push({ sev: 'warn',   icon: '⚡', text: `Heel angle ${res.heelAngle}° — crew operations may be affected. Review ballast distribution.` });
  else
    recs.push({ sev: 'ok',    icon: '✓', text: `Heel angle ${res.heelAngle}° — vessel sitting level.` });

  if (res.flowSep > 0.7)
    recs.push({ sev: 'warn', icon: '⚡', text: 'High flow separation — hull form not optimised for this heading. Rotate bow closer to current direction.' });

  const fn = parseFloat(res.froude);
  if (fn > 0.35)
    recs.push({ sev: 'warn', icon: '⚡', text: `Froude No. ${res.froude} — significant wave-making resistance. Consider reducing speed.` });
  else
    recs.push({ sev: 'ok',  icon: '✓', text: `Froude No. ${res.froude} — operating in efficient displacement regime.` });

  if (res.stability < 0.5)
    recs.push({ sev: 'danger', icon: '⚠', text: 'Stability index low — vessel approaching marginal stability. Reduce side-force exposure immediately.' });
  else if (res.stability > 0.8)
    recs.push({ sev: 'ok',    icon: '✓', text: `Stability index ${Math.round(res.stability * 100)}% — vessel stable throughout run.` });

  if (Math.abs(params.currentHeading) > 45)
    recs.push({ sev: 'warn', icon: '⚡', text: `Heading ${params.currentHeading}° — beam exposure is increasing drag coefficient. Head-on approach recommended.` });

  return recs;
}

function overallScore(res) {
  const pct = Math.round(
    (1 - res.stressLevel) * 0.30 * 100 +
    (1 - res.cavRisk)     * 0.25 * 100 +
    res.stability         * 0.30 * 100 +
    (1 - res.flowSep)     * 0.15 * 100
  );
  if (pct >= 75) return { pct, label: `${pct}% GOOD`,     cls: 'score-good' };
  if (pct >= 50) return { pct, label: `${pct}% MARGINAL`, cls: 'score-warn' };
  return           { pct, label: `${pct}% CRITICAL`,  cls: 'score-danger' };
}

function showRecommendations() {
  const res    = sim.results;
  const params = sim.params;
  const recs   = generateRecommendations(res, params);
  const score  = overallScore(res);

  // Populate elapsed time
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = Math.floor(elapsed % 60).toString().padStart(2, '0');
  document.getElementById('rec-elapsed').textContent = `Run duration  T+${m}:${s}`;

  // Score badge
  const badge = document.getElementById('rec-score-badge');
  badge.textContent = score.label;
  badge.className   = 'rec-score-badge ' + score.cls;

  // Recommendation list
  const list = document.getElementById('rec-list');
  list.innerHTML = '';
  recs.forEach(r => {
    const li = document.createElement('li');
    li.className = 'rec-item ' + r.sev;
    li.innerHTML = `<span class="rec-item-icon">${r.icon}</span><span>${r.text}</span>`;
    list.appendChild(li);
  });

  document.getElementById('rec-modal').classList.remove('rec-hidden');
}

function hideRecommendations() {
  document.getElementById('rec-modal').classList.add('rec-hidden');
}

function stopSimulation() {
  isRunning   = false;
  sim.running = false;
  const btn   = document.getElementById('btn-play');
  btn.textContent = '▶ Run Simulation';
  btn.className   = 'btn-primary';
  setStatus('Complete', 'ready');
  addLog('Simulation complete — generating recommendations.', 'ok');
  showRecommendations();
}

document.getElementById('rec-close').addEventListener('click', hideRecommendations);
document.getElementById('rec-rerun').addEventListener('click', () => {
  hideRecommendations();
  elapsed   = 0;
  sim.time  = 0;
  document.getElementById('sim-time').textContent = 'T+00:00';
  isRunning   = true;
  sim.running = true;
  const btn   = document.getElementById('btn-play');
  btn.textContent = '⏸ Pause';
  btn.className   = 'btn-pause';
  setStatus('Simulation Running', 'running');
  addLog('Simulation restarted.', 'ok');
});

// ── Log alerts on thresholds
let lastAlertTime = 0;
function checkAlerts(res) {
  const now = sim.time;
  if (now - lastAlertTime < 5) return;
  if (res.cavRisk > 0.6) {
    addLog('⚠ High cavitation risk detected!', 'warn');
    lastAlertTime = now;
  } else if (res.stressLevel > 0.8) {
    addLog('⚠ Hull stress approaching limit!', 'warn');
    lastAlertTime = now;
  } else if (Math.abs(parseFloat(res.heelAngle)) > 15) {
    addLog(`⚠ Excessive heel angle: ${res.heelAngle}°`, 'warn');
    lastAlertTime = now;
  }
}

// ── Resize ─────────────────────────────────────────────────────
function onResize() {
  const vp = document.getElementById('viewport');
  const w  = vp.clientWidth;
  const h  = vp.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── Render loop ────────────────────────────────────────────────
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  frameCount++;

  orbit.update();

  if (isRunning) {
    elapsed += dt;
    if (elapsed >= SIM_DURATION) {
      stopSimulation();
      return;
    }
    sim.update(dt);
    const res = sim.results;

    const turbulence = 1 + sim.params.seaState * 0.15;
    waterParticles.update(true, turbulence);
    airParticles.update(true, turbulence * 0.5);
    wakeParticles.update(true);

    updateUI(res);
    updateForceArrows(res);
    updatePressureZones(res);

    if (frameCount % 60 === 0) checkAlerts(res);

    // Animate ocean surface (every other frame for perf)
    if (frameCount % 2 === 0) {
      animateOcean(elapsed, sim.params.seaState);
    }
  } else {
    // Idle particle drift
    waterParticles.update(true, 0.3);
    airParticles.update(true, 0.2);
  }

  renderer.render(scene, camera);
}

// ── Init ───────────────────────────────────────────────────────
setStatus('Awaiting Model', 'loading');
drawCompass(0);
animate();

// Initial idle drift
waterParticles.setVisible(true);
airParticles.setVisible(true);

// Auto-load the bundled ship model
loadModel('/uss_oliver_hazard_perry_ffg-7.glb');

console.log('%c⬡ MBT Platform & Design — Simulation Ready', 'color:#00ccff;font-size:14px;');
