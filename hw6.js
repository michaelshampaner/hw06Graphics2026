/**
 * HW06 - Interactive Bowling Game with WebGL / Three.js
 * Computer Graphics, Spring Semester 2026
 *
 * Builds on the HW05 static bowling alley (lane, markings, gutters, pins,
 * ball, lighting, room, UI containers, orbit camera) and adds the HW06
 * interactive layer on top:
 *   1. Aiming & power-meter controls, with a small state machine
 *   2. Simplified hand-written ball physics (rolling, gutter balls, hook)
 *   3. Pin collision detection + pin-to-pin propagation + topple animation
 *   4. Full ten-frame bowling scoring (strikes, spares, 10th-frame rules)
 *   5. Game flow: end-of-roll detection, frame advancement, reset, game over
 *
 * Coordinate system (shared with HW05): foul line at Z=0, lane extends to
 * negative Z, head pin at Z=-57.
 */

import { OrbitControls } from './OrbitControls.js';

// ─────────────────────────────────────────────────────────────────────────────
// Colours (constants) — carried over from HW05
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  LANE:         0xDEB887,
  APPROACH:     0xC8A87A,
  FOUL_LINE:    0xFF2222,
  ARROW:        0xCC8800,
  DOT:          0xCC8800,
  GUTTER:       0x8B6914,
  PIN_WHITE:    0xF5F0E8,
  PIN_RED:      0xCC1111,
  BALL:         0x1B3A6E,
  BALL_HOLE:    0x0A0A0A,
  PIN_DECK:     0xC0A060,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scene constants — carried over from HW05
// ─────────────────────────────────────────────────────────────────────────────
const LANE_LENGTH  = 60;
const LANE_WIDTH   = 3.5;
const APPROACH_LEN = 15;
const GUTTER_W     = 0.35;
const GUTTER_DEPTH = 0.04;
const LANE_Y       = 0;
const TOTAL_LENGTH = LANE_LENGTH + APPROACH_LEN;

const PIN_POSITIONS = [
  { id: 1,  x:  0.0, z: -57.000 },
  { id: 2,  x: -0.5, z: -57.866 },
  { id: 3,  x:  0.5, z: -57.866 },
  { id: 4,  x: -1.0, z: -58.732 },
  { id: 5,  x:  0.0, z: -58.732 },
  { id: 6,  x:  1.0, z: -58.732 },
  { id: 7,  x: -1.5, z: -59.598 },
  { id: 8,  x: -0.5, z: -59.598 },
  { id: 9,  x:  0.5, z: -59.598 },
  { id: 10, x:  1.5, z: -59.598 },
];

// ─────────────────────────────────────────────────────────────────────────────
// HW06 gameplay constants
// ─────────────────────────────────────────────────────────────────────────────
const BALL_RADIUS       = 0.45;
const BALL_START_Z      = 5.0;     // approach position, in front of foul line
const AIM_X_LIMIT       = LANE_WIDTH / 2 - BALL_RADIUS - 0.05;
const CURVE_STEP        = 0.08;
const CURVE_MAX         = 1.0;

const MIN_SPEED         = 8.0;     // units/sec at 0% power
const MAX_SPEED         = 22.0;    // units/sec at 100% power
const FRICTION          = 0.4;     // units/sec^2 deceleration
const CURVE_STRENGTH    = 0.12;    // lateral accel per unit of curve
const POWER_CYCLE_SPEED = 1.25;    // meter traversal speed (0..1 per ~0.8s)

const GUTTER_TRIGGER_X  = AIM_X_LIMIT - 0.1; // reachable by aim alone, near the limit
const GUTTER_X          = LANE_WIDTH / 2 + GUTTER_W / 2; // gutter channel center (matches buildLane)
const ROLL_END_Z        = -61.5;   // just past the pin deck
const STOP_EPSILON      = 0.05;    // velocity below this counts as "stopped"

const PIN_RADIUS_HIT    = 0.22;    // approximate pin collision radius
const PIN_PROPAGATE_R   = 1.08;    // distance for pin-to-pin knock-on
const PROPAGATE_DOT_MIN = -0.25;   // neighbor must lie roughly in the fall direction (generous spread)
const MAX_PROPAGATE_GEN = 2;       // direct hit = gen 0; gens 0 & 1 may chain further, gen 2 cannot
const FALL_ANGULAR_SPEED = Math.PI * 1.3; // rad/sec while toppling
const RESOLVE_WAIT       = 0.7;    // seconds to let pins finish falling

// ─────────────────────────────────────────────────────────────────────────────
// Renderer / Scene / Camera
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111118);
scene.fog = new THREE.Fog(0x111118, 50, 120);

const camera = new THREE.PerspectiveCamera(
  55, window.innerWidth / window.innerHeight, 0.1, 300
);
camera.position.set(0, 4.5, 8);
camera.lookAt(0, 1, -30);

// ─────────────────────────────────────────────────────────────────────────────
// Orbit camera (vendored OrbitControls, toggled with 'O' — same as HW05)
// ─────────────────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, -28);
controls.minDistance = 3;
controls.maxDistance = 80;
controls.enablePan = false;
controls.update();

let isOrbitEnabled = true;
const cameraStatusEl = document.getElementById('camera-status');
function setOrbitStatusUI() {
  if (!cameraStatusEl) return;
  cameraStatusEl.textContent = `ORBIT: ${isOrbitEnabled ? 'ON' : 'OFF'}`;
  cameraStatusEl.className = isOrbitEnabled ? 'active' : '';
}
setOrbitStatusUI();

// ─────────────────────────────────────────────────────────────────────────────
// Lighting — carried over from HW05
// ─────────────────────────────────────────────────────────────────────────────
function buildLighting() {
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  const lightPositions = [-50, -35, -20, -5, 10];
  lightPositions.forEach((z) => {
    const spot = new THREE.SpotLight(0xfff8e8, 1.4, 60, Math.PI / 5, 0.35, 1.5);
    spot.position.set(0, 9, z);
    spot.target.position.set(0, 0, z);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 40;
    scene.add(spot);
    scene.add(spot.target);

    const bulbGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfffde0 });
    const bulbMesh = new THREE.Mesh(bulbGeo, bulbMat);
    bulbMesh.position.copy(spot.position);
    scene.add(bulbMesh);
  });

  const backFill = new THREE.DirectionalLight(0x8899cc, 0.3);
  backFill.position.set(0, 6, -65);
  scene.add(backFill);
}

// ─────────────────────────────────────────────────────────────────────────────
// Room / environment — carried over from HW05
// ─────────────────────────────────────────────────────────────────────────────
function buildRoom() {
  const floorGeo = new THREE.PlaneGeometry(20, 110);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1c28, roughness: 0.9 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.12, -25);
  floor.receiveShadow = true;
  scene.add(floor);

  const ceilGeo = new THREE.PlaneGeometry(20, 110);
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x16161e, roughness: 1 });
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 10, -25);
  scene.add(ceil);

  const backWallGeo = new THREE.PlaneGeometry(20, 12);
  const backWallMat = new THREE.MeshStandardMaterial({ color: 0x1e1e2c, roughness: 0.8 });
  const backWall = new THREE.Mesh(backWallGeo, backWallMat);
  backWall.position.set(0, 5, -63);
  scene.add(backWall);

  [-8, 8].forEach((x) => {
    const wallGeo = new THREE.PlaneGeometry(110, 12);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c1c2a, roughness: 0.9 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    wall.position.set(x, 5, -25);
    scene.add(wall);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lane (with all required markings) — carried over from HW05
// ─────────────────────────────────────────────────────────────────────────────
function buildLane() {
  const approachGeo = new THREE.BoxGeometry(LANE_WIDTH, 0.08, APPROACH_LEN);
  const approachMat = new THREE.MeshStandardMaterial({
    color: C.APPROACH, roughness: 0.25, metalness: 0.05
  });
  const approach = new THREE.Mesh(approachGeo, approachMat);
  approach.position.set(0, LANE_Y - 0.04, APPROACH_LEN / 2);
  approach.receiveShadow = true;
  scene.add(approach);

  const laneGeo = new THREE.BoxGeometry(LANE_WIDTH, 0.08, LANE_LENGTH);
  const laneMat = new THREE.MeshStandardMaterial({
    color: C.LANE, roughness: 0.18, metalness: 0.1
  });
  const lane = new THREE.Mesh(laneGeo, laneMat);
  lane.position.set(0, LANE_Y - 0.04, -LANE_LENGTH / 2);
  lane.receiveShadow = true;
  scene.add(lane);

  const deckGeo = new THREE.BoxGeometry(LANE_WIDTH, 0.08, 4.5);
  const deckMat = new THREE.MeshStandardMaterial({ color: C.PIN_DECK, roughness: 0.22 });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(0, LANE_Y - 0.04, -60.5);
  deck.receiveShadow = true;
  scene.add(deck);

  const gutterLen = TOTAL_LENGTH + 2;
  const gutterCenterX = LANE_WIDTH / 2 + GUTTER_W / 2;
  const gutterY = LANE_Y - 0.04 - GUTTER_DEPTH / 2;
  const gutterCenterZ = -LANE_LENGTH / 2 + APPROACH_LEN / 2;

  [-gutterCenterX, gutterCenterX].forEach((x) => {
    const gGeo = new THREE.BoxGeometry(GUTTER_W, 0.04 - GUTTER_DEPTH, gutterLen);
    const gMat = new THREE.MeshStandardMaterial({ color: C.GUTTER, roughness: 0.4 });
    const gutter = new THREE.Mesh(gGeo, gMat);
    gutter.position.set(x, gutterY, gutterCenterZ);
    gutter.receiveShadow = true;
    scene.add(gutter);
  });

  const foulGeo = new THREE.BoxGeometry(LANE_WIDTH + 0.02, 0.005, 0.06);
  const foulMat = new THREE.MeshStandardMaterial({ color: C.FOUL_LINE, roughness: 0.3 });
  const foulLine = new THREE.Mesh(foulGeo, foulMat);
  foulLine.position.set(0, LANE_Y + 0.001, 0);
  scene.add(foulLine);

  const dotRows = [3.7, 4.6];
  const dotXPositions = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5];
  const dotGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12);
  const dotMat = new THREE.MeshStandardMaterial({ color: C.DOT, roughness: 0.3 });
  dotRows.forEach((zOff) => {
    dotXPositions.forEach((x) => {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(x, LANE_Y + 0.002, zOff);
      scene.add(dot);
    });
  });

  const arrowZ = -15;
  const arrowXPositions = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5];
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.22);
  arrowShape.lineTo(0.09, 0);
  arrowShape.lineTo(0.045, 0.04);
  arrowShape.lineTo(0.045, -0.22);
  arrowShape.lineTo(-0.045, -0.22);
  arrowShape.lineTo(-0.045, 0.04);
  arrowShape.lineTo(-0.09, 0);
  arrowShape.closePath();

  const extSettings = { depth: 0.012, bevelEnabled: false };
  const arrowGeo3D = new THREE.ExtrudeGeometry(arrowShape, extSettings);
  const arrowMat = new THREE.MeshStandardMaterial({ color: C.ARROW, roughness: 0.25 });
  arrowXPositions.forEach((x) => {
    const arrow = new THREE.Mesh(arrowGeo3D, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(x - 0.045, LANE_Y + 0.002, arrowZ + 0.22);
    scene.add(arrow);
  });

  const boardMat = new THREE.MeshStandardMaterial({
    color: 0xBB9060, roughness: 0.2, metalness: 0.05
  });
  const nBoards = 39;
  const boardW = LANE_WIDTH / nBoards;
  for (let i = 0; i < nBoards; i++) {
    if (i % 5 !== 0) continue;
    const lineGeo = new THREE.BoxGeometry(0.003, 0.006, LANE_LENGTH);
    const line = new THREE.Mesh(lineGeo, boardMat);
    line.position.set(-LANE_WIDTH / 2 + boardW * i, LANE_Y + 0.001, -LANE_LENGTH / 2);
    scene.add(line);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bowling pins — carried over from HW05, restructured into trackable objects
// for collision, toppling, and standing-pin bookkeeping.
// ─────────────────────────────────────────────────────────────────────────────
function buildPins() {
  const pinPoints = [
    new THREE.Vector2(0.20, 0.00),
    new THREE.Vector2(0.19, 0.05),
    new THREE.Vector2(0.18, 0.12),
    new THREE.Vector2(0.19, 0.22),
    new THREE.Vector2(0.19, 0.30),
    new THREE.Vector2(0.17, 0.38),
    new THREE.Vector2(0.13, 0.50),
    new THREE.Vector2(0.10, 0.58),
    new THREE.Vector2(0.10, 0.62),
    new THREE.Vector2(0.115, 0.70),
    new THREE.Vector2(0.125, 0.78),
    new THREE.Vector2(0.115, 0.86),
    new THREE.Vector2(0.09, 0.92),
    new THREE.Vector2(0.05, 0.97),
    new THREE.Vector2(0.01, 1.00),
  ];

  const pinGeo = new THREE.LatheGeometry(pinPoints, 20);
  const pinBodyMat = new THREE.MeshStandardMaterial({
    color: C.PIN_WHITE, roughness: 0.25, metalness: 0.05
  });
  const stripeGeo = new THREE.CylinderGeometry(0.135, 0.105, 0.07, 20);
  const stripeMat = new THREE.MeshStandardMaterial({ color: C.PIN_RED, roughness: 0.3 });
  const baseGeo = new THREE.CylinderGeometry(0.195, 0.195, 0.02, 20);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });

  const pins = [];

  PIN_POSITIONS.forEach((p) => {
    const pinGroup = new THREE.Group();

    const body = new THREE.Mesh(pinGeo, pinBodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    pinGroup.add(body);

    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 0.545;
    stripe.castShadow = true;
    pinGroup.add(stripe);

    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.01;
    pinGroup.add(base);

    pinGroup.position.set(p.x, LANE_Y, p.z);
    scene.add(pinGroup);

    pins.push({
      id: p.id,
      group: pinGroup,
      baseX: p.x,
      baseZ: p.z,
      standing: true,    // still standing, for the scorecard/state
      falling: false,    // currently animating a topple
      fallAngle: 0,
      fallAxis: new THREE.Vector3(1, 0, 0),
      fallDirX: 0,        // horizontal direction this pin is toppling toward
      fallDirZ: -1,
    });
  });

  return pins;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bowling ball — carried over from HW05, returns the mesh so HW06 physics
// can move it.
// ─────────────────────────────────────────────────────────────────────────────
function buildBall() {
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 48, 48);
  const ballMat = new THREE.MeshPhongMaterial({
    color: C.BALL, specular: 0x99bbdd, shininess: 180,
  });
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.position.set(0, LANE_Y + BALL_RADIUS, BALL_START_Z);
  ball.castShadow = true;
  ball.receiveShadow = true;
  scene.add(ball);

  const HOLE_R = 0.055;
  const HOLE_DEPTH = 0.14;
  const holeMat = new THREE.MeshStandardMaterial({ color: C.BALL_HOLE, roughness: 0.9 });
  const holeConfigs = [
    { polar: 0.55, azim: 0.25 },
    { polar: 0.55, azim: -0.25 },
    { polar: 0.30, azim: 0.00 },
  ];

  // Finger holes are parented to the ball so they travel and (optionally)
  // spin with it.
  holeConfigs.forEach((cfg) => {
    const sp = cfg.polar;
    const sa = cfg.azim;
    const nx = Math.sin(sp) * Math.sin(sa);
    const ny = Math.cos(sp);
    const nz = Math.sin(sp) * Math.cos(sa);

    const holeGeo = new THREE.CylinderGeometry(HOLE_R, HOLE_R * 0.7, HOLE_DEPTH, 12);
    const holeMesh = new THREE.Mesh(holeGeo, holeMat);
    holeMesh.position.set(
      nx * (BALL_RADIUS - HOLE_DEPTH * 0.4),
      ny * (BALL_RADIUS - HOLE_DEPTH * 0.4),
      nz * (BALL_RADIUS - HOLE_DEPTH * 0.4)
    );

    const up = new THREE.Vector3(0, 1, 0);
    const inward = new THREE.Vector3(-nx, -ny, -nz);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, inward);
    holeMesh.setRotationFromQuaternion(quat);
    holeMesh.castShadow = true;
    ball.add(holeMesh);
  });

  return ball;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aim guide — a thin marker on the foul line showing where the ball will
// release from while aiming.
// ─────────────────────────────────────────────────────────────────────────────
function buildAimGuide() {
  const geo = new THREE.ConeGeometry(0.18, 0.4, 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const cone = new THREE.Mesh(geo, mat);
  cone.rotation.x = Math.PI; // point toward the pins (down -Z)
  cone.position.set(0, 0.5, BALL_START_Z + 1.0);
  scene.add(cone);
  return cone;
}

// ── Build the whole scene ────────────────────────────────────────────────────
buildLighting();
buildRoom();
buildLane();
const pins = buildPins();
const ball = buildBall();
const aimGuide = buildAimGuide();

// ─────────────────────────────────────────────────────────────────────────────
// HW06 GAME STATE
// ─────────────────────────────────────────────────────────────────────────────
const gameState = {
  phase: 'aiming',          // 'aiming' | 'power' | 'rolling' | 'resolving' | 'gameover'
  frameIndex: 0,             // 0-based (0..9)
  frameRolls: Array.from({ length: 10 }, () => []), // pins-down per roll, per frame
  pinsStandingAtRollStart: 10,
  aimX: 0,
  curve: 0,
  powerValue: 0,
  powerDirection: 1,
  lockedPower: 0,
  velocity: new THREE.Vector3(0, 0, 0),
  isGutter: false,
  resolveTimer: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// HW06 UI: power meter + status readouts
// (reuses the HW05 controls / scorecard / info containers from index.html)
// ─────────────────────────────────────────────────────────────────────────────
const powerFillEl   = document.getElementById('power-fill');
const phaseLabelEl  = document.getElementById('phase-label');
const curveLabelEl  = document.getElementById('curve-label');
const pinsStandingEl = document.getElementById('pins-standing');
const currentFrameEl = document.getElementById('current-frame');
const gameOverEl = document.getElementById('game-over-banner');

function phaseDisplayName(phase) {
  switch (phase) {
    case 'aiming':   return 'AIMING — pick your spot';
    case 'power':    return 'POWER — press Space to lock & release';
    case 'rolling':  return 'ROLLING…';
    case 'resolving': return 'RESOLVING…';
    case 'gameover': return 'GAME OVER';
    default: return phase;
  }
}

function updateStatusUI() {
  if (phaseLabelEl) phaseLabelEl.textContent = phaseDisplayName(gameState.phase);
  if (curveLabelEl) curveLabelEl.textContent = `Spin: ${gameState.curve.toFixed(2)}`;
  if (pinsStandingEl) pinsStandingEl.textContent = String(getStandingCount());
  if (currentFrameEl) {
    currentFrameEl.textContent = gameState.phase === 'gameover'
      ? '10 (done)'
      : String(gameState.frameIndex + 1);
  }
}

function updatePowerMeterUI() {
  if (powerFillEl) powerFillEl.style.width = `${Math.round(gameState.powerValue * 100)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HW06 SCORING
// ─────────────────────────────────────────────────────────────────────────────
function isTenthFrameComplete(rolls) {
  if (rolls.length < 2) return false;
  if (rolls.length >= 3) return true;
  if (rolls[0] === 10) return false;          // strike on ball 1 → needs ball 3
  if (rolls[0] + rolls[1] === 10) return false; // spare → needs bonus ball
  return true;                                 // open frame, 2 balls is final
}

function calculateScores(frameRolls) {
  const flat = [];
  const frameStart = [];
  frameRolls.forEach((rolls) => {
    frameStart.push(flat.length);
    rolls.forEach((r) => flat.push(r));
  });

  const frameTotals = new Array(10).fill(null);

  for (let f = 0; f < 9; f++) {
    const rolls = frameRolls[f];
    if (!rolls || rolls.length === 0) continue;
    const start = frameStart[f];

    if (rolls[0] === 10) {
      if (flat.length >= start + 3) {
        frameTotals[f] = 10 + flat[start + 1] + flat[start + 2];
      }
    } else if (rolls.length >= 2) {
      const sum = rolls[0] + rolls[1];
      if (sum === 10) {
        if (flat.length >= start + 3) {
          frameTotals[f] = 10 + flat[start + 2];
        }
      } else {
        frameTotals[f] = sum;
      }
    }
  }

  const rolls10 = frameRolls[9];
  if (rolls10 && isTenthFrameComplete(rolls10)) {
    frameTotals[9] = rolls10.reduce((a, b) => a + b, 0);
  }

  const runningTotals = new Array(10).fill(null);
  let cum = 0;
  for (let f = 0; f < 10; f++) {
    if (frameTotals[f] === null) break;
    cum += frameTotals[f];
    runningTotals[f] = cum;
  }

  return { frameTotals, runningTotals };
}

function formatFrameDisplay(frameIndex, rolls) {
  if (frameIndex < 9) {
    const out = ['', ''];
    if (!rolls || rolls.length === 0) return out;
    if (rolls[0] === 10) {
      out[0] = 'X';
      return out;
    }
    out[0] = rolls[0] === 0 ? '-' : String(rolls[0]);
    if (rolls.length > 1) {
      out[1] = (rolls[0] + rolls[1] === 10) ? '/' : (rolls[1] === 0 ? '-' : String(rolls[1]));
    }
    return out;
  }

  // 10th frame — up to three balls, each contextual on what came before.
  const out = ['', '', ''];
  if (!rolls || rolls.length === 0) return out;

  out[0] = rolls[0] === 10 ? 'X' : (rolls[0] === 0 ? '-' : String(rolls[0]));

  if (rolls.length > 1) {
    if (rolls[0] === 10) {
      out[1] = rolls[1] === 10 ? 'X' : (rolls[1] === 0 ? '-' : String(rolls[1]));
    } else if (rolls[0] + rolls[1] === 10) {
      out[1] = '/';
    } else {
      out[1] = rolls[1] === 0 ? '-' : String(rolls[1]);
    }
  }

  if (rolls.length > 2) {
    if (rolls[0] === 10 && rolls[1] === 10) {
      out[2] = rolls[2] === 10 ? 'X' : (rolls[2] === 0 ? '-' : String(rolls[2]));
    } else if (rolls[0] === 10 && rolls[1] !== 10) {
      out[2] = (rolls[1] + rolls[2] === 10) ? '/' : (rolls[2] === 10 ? 'X' : (rolls[2] === 0 ? '-' : String(rolls[2])));
    } else {
      out[2] = rolls[2] === 10 ? 'X' : (rolls[2] === 0 ? '-' : String(rolls[2]));
    }
  }

  return out;
}

function renderScorecard() {
  const { frameTotals, runningTotals } = calculateScores(gameState.frameRolls);

  for (let f = 0; f < 10; f++) {
    const display = formatFrameDisplay(f, gameState.frameRolls[f]);
    const frameNum = f + 1;

    for (let b = 0; b < display.length; b++) {
      const el = document.getElementById(`b${frameNum}-${b + 1}`);
      if (el) el.textContent = display[b];
    }

    const ftEl = document.getElementById(`ft${frameNum}`);
    if (ftEl) ftEl.textContent = frameTotals[f] === null ? '' : String(runningTotals[f]);
  }

  const grandTotalEl = document.getElementById('grand-total');
  if (grandTotalEl) {
    const last = runningTotals.filter((v) => v !== null).pop();
    grandTotalEl.textContent = last === undefined ? '—' : String(last);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HW06 PIN HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getStandingCount() {
  return pins.filter((p) => p.standing).length;
}

function resetPinsFullRack() {
  pins.forEach((p) => {
    p.standing = true;
    p.falling = false;
    p.fallAngle = 0;
    p.group.rotation.set(0, 0, 0);
    p.group.position.set(p.baseX, LANE_Y, p.baseZ);
    p.group.visible = true;
  });
}

function triggerPinFall(pin, impactDirXZ, generation) {
  if (!pin.standing || pin.falling) return;
  pin.standing = false;
  pin.falling = true;
  pin.fallAngle = 0;

  // Topple about a horizontal axis perpendicular to the impact direction,
  // so the pin falls away from whatever hit it.
  const dx = impactDirXZ.x;
  const dz = impactDirXZ.z;
  const len = Math.hypot(dx, dz) || 1;
  const ndx = dx / len;
  const ndz = dz / len;

  pin.fallAxis.set(-ndz, 0, ndx);
  pin.fallDirX = ndx;
  pin.fallDirZ = ndz;

  // Cap the chain depth: a direct ball hit (generation 0) can knock on
  // neighbours (generation 1), which can knock on one more ring
  // (generation 2) — but generation-2 pins don't propagate further.
  // Without this cap, every hit cascades through the ENTIRE triangular
  // rack regardless of where the ball actually went, since each pin sits
  // within range of several neighbours on all sides.
  if (generation < MAX_PROPAGATE_GEN) {
    propagateFromPin(pin, generation + 1);
  }
}

function propagateFromPin(sourcePin, nextGeneration) {
  pins.forEach((other) => {
    if (other === sourcePin || !other.standing || other.falling) return;
    const ddx = other.baseX - sourcePin.baseX;
    const ddz = other.baseZ - sourcePin.baseZ;
    const dist = Math.hypot(ddx, ddz);
    if (dist > PIN_PROPAGATE_R || dist === 0) return;

    // Directional check: a toppling pin only reaches neighbours that lie
    // roughly in the direction it's falling toward — not pins behind it.
    const dot = (ddx / dist) * sourcePin.fallDirX + (ddz / dist) * sourcePin.fallDirZ;
    if (dot >= PROPAGATE_DOT_MIN) {
      triggerPinFall(other, new THREE.Vector3(ddx, 0, ddz), nextGeneration);
    }
  });
}

function updateTopplingPins(dt) {
  const maxAngle = Math.PI / 2 + 0.05;
  pins.forEach((p) => {
    if (!p.falling) return;
    if (p.fallAngle >= maxAngle) return;
    const step = Math.min(FALL_ANGULAR_SPEED * dt, maxAngle - p.fallAngle);
    p.group.rotateOnAxis(p.fallAxis, step);
    p.fallAngle += step;
  });
}

function checkBallPinCollisions() {
  pins.forEach((p) => {
    if (!p.standing || p.falling) return;
    const dx = ball.position.x - p.baseX;
    const dz = ball.position.z - p.baseZ;
    const dist = Math.hypot(dx, dz);
    if (dist <= BALL_RADIUS + PIN_RADIUS_HIT) {
      triggerPinFall(p, new THREE.Vector3(-dx, 0, -dz), 0);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HW06 BALL / AIM HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function resetBallToApproach() {
  gameState.velocity.set(0, 0, 0);
  gameState.isGutter = false;
  ball.position.set(gameState.aimX, LANE_Y + BALL_RADIUS, BALL_START_Z);
  aimGuide.position.x = gameState.aimX;
  aimGuide.visible = true;
}

function releaseBall() {
  const speed = MIN_SPEED + gameState.lockedPower * (MAX_SPEED - MIN_SPEED);
  gameState.velocity.set(0, 0, -speed);
  gameState.isGutter = false;
  aimGuide.visible = false;
  gameState.phase = 'rolling';
}

// ─────────────────────────────────────────────────────────────────────────────
// HW06 GAME FLOW
// ─────────────────────────────────────────────────────────────────────────────
function finalizeRoll() {
  const standingNow = getStandingCount();
  const pinsDownThisRoll = Math.max(0, gameState.pinsStandingAtRollStart - standingNow);

  gameState.frameRolls[gameState.frameIndex].push(pinsDownThisRoll);
  renderScorecard();

  const frameIdx = gameState.frameIndex;
  const rolls = gameState.frameRolls[frameIdx];

  if (frameIdx < 9) {
    const strike = rolls.length === 1 && rolls[0] === 10;
    const frameDone = strike || rolls.length === 2;

    if (frameDone) {
      advanceToNextFrame();
    } else {
      gameState.pinsStandingAtRollStart = standingNow;
      gameState.phase = 'aiming';
      resetBallToApproach();
    }
  } else {
    if (isTenthFrameComplete(rolls)) {
      finishGame();
    } else {
      let needsFreshRack = false;
      if (rolls.length === 1) {
        needsFreshRack = rolls[0] === 10;
      } else if (rolls.length === 2) {
        needsFreshRack = rolls[0] === 10 ? rolls[1] === 10 : (rolls[0] + rolls[1] === 10);
      }

      if (needsFreshRack) {
        resetPinsFullRack();
        gameState.pinsStandingAtRollStart = 10;
      } else {
        gameState.pinsStandingAtRollStart = standingNow;
      }
      gameState.phase = 'aiming';
      resetBallToApproach();
    }
  }

  updateStatusUI();
}

function advanceToNextFrame() {
  gameState.frameIndex += 1;
  if (gameState.frameIndex >= 10) {
    finishGame();
    return;
  }
  resetPinsFullRack();
  gameState.pinsStandingAtRollStart = 10;
  gameState.phase = 'aiming';
  resetBallToApproach();
}

function finishGame() {
  gameState.phase = 'gameover';
  if (gameOverEl) gameOverEl.style.display = 'block';
  aimGuide.visible = false;
}

function startNewGame() {
  gameState.frameIndex = 0;
  gameState.frameRolls = Array.from({ length: 10 }, () => []);
  gameState.pinsStandingAtRollStart = 10;
  gameState.aimX = 0;
  gameState.curve = 0;
  gameState.powerValue = 0;
  gameState.powerDirection = 1;
  gameState.lockedPower = 0;
  gameState.phase = 'aiming';
  if (gameOverEl) gameOverEl.style.display = 'none';

  resetPinsFullRack();
  resetBallToApproach();
  renderScorecard();
  updateStatusUI();
  updatePowerMeterUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// HW06 INPUT HANDLING
// ─────────────────────────────────────────────────────────────────────────────
function handleKeyDown(e) {
  if (e.key === 'o' || e.key === 'O') {
    isOrbitEnabled = !isOrbitEnabled;
    setOrbitStatusUI();
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    startNewGame();
    return;
  }

  if (gameState.phase === 'aiming') {
    if (e.key === 'ArrowLeft') {
      gameState.aimX = Math.max(-AIM_X_LIMIT, gameState.aimX - 0.08);
      ball.position.x = gameState.aimX;
      aimGuide.position.x = gameState.aimX;
    } else if (e.key === 'ArrowRight') {
      gameState.aimX = Math.min(AIM_X_LIMIT, gameState.aimX + 0.08);
      ball.position.x = gameState.aimX;
      aimGuide.position.x = gameState.aimX;
    } else if (e.key === 'ArrowUp') {
      gameState.curve = Math.min(CURVE_MAX, gameState.curve + CURVE_STEP);
    } else if (e.key === 'ArrowDown') {
      gameState.curve = Math.max(-CURVE_MAX, gameState.curve - CURVE_STEP);
    } else if (e.key === ' ') {
      e.preventDefault();
      gameState.phase = 'power';
      gameState.powerValue = 0;
      gameState.powerDirection = 1;
    }
    updateStatusUI();
  } else if (gameState.phase === 'power') {
    if (e.key === ' ') {
      e.preventDefault();
      gameState.lockedPower = gameState.powerValue;
      releaseBall();
    }
  }
}

document.addEventListener('keydown', handleKeyDown);

// ─────────────────────────────────────────────────────────────────────────────
// HW06 PHYSICS & COLLISION (advanced every frame from animate)
// ─────────────────────────────────────────────────────────────────────────────
function updateGame(dt) {
  if (gameState.phase === 'power') {
    gameState.powerValue += gameState.powerDirection * POWER_CYCLE_SPEED * dt;
    if (gameState.powerValue >= 1) {
      gameState.powerValue = 1;
      gameState.powerDirection = -1;
    } else if (gameState.powerValue <= 0) {
      gameState.powerValue = 0;
      gameState.powerDirection = 1;
    }
    updatePowerMeterUI();
  }

  if (gameState.phase === 'rolling') {
    // Curve / hook: lateral acceleration proportional to chosen spin.
    gameState.velocity.x += gameState.curve * CURVE_STRENGTH * dt;

    // Rolling friction (deceleration along Z).
    const speed = Math.abs(gameState.velocity.z);
    if (speed > 0) {
      const newSpeed = Math.max(0, speed - FRICTION * dt);
      gameState.velocity.z = gameState.velocity.z < 0 ? -newSpeed : newSpeed;
    }

    ball.position.x += gameState.velocity.x * dt;
    ball.position.z += gameState.velocity.z * dt;
    ball.rotation.x -= gameState.velocity.z * dt / BALL_RADIUS;

    // Gutter detection: once triggered, snap into the gutter channel and
    // kill lateral velocity so the ball travels dead-straight down the
    // gutter the rest of the way — a clean, reliable 0-pin outcome.
    if (!gameState.isGutter && Math.abs(ball.position.x) > GUTTER_TRIGGER_X) {
      gameState.isGutter = true;
      const side = ball.position.x < 0 ? -1 : 1;
      ball.position.x = side * GUTTER_X;
      gameState.velocity.x = 0;
    }
    ball.position.y = gameState.isGutter
      ? LANE_Y - GUTTER_DEPTH + BALL_RADIUS * 0.85
      : LANE_Y + BALL_RADIUS;

    if (!gameState.isGutter) {
      checkBallPinCollisions();
    }

    const reachedEnd = ball.position.z <= ROLL_END_Z;
    const stoppedShort = Math.abs(gameState.velocity.z) < STOP_EPSILON;

    if (reachedEnd || stoppedShort) {
      gameState.phase = 'resolving';
      gameState.resolveTimer = 0;
    }
  }

  if (gameState.phase === 'resolving') {
    gameState.resolveTimer += dt;
    if (gameState.resolveTimer >= RESOLVE_WAIT) {
      finalizeRoll();
    }
  }

  updateTopplingPins(dt);
  if (gameState.phase !== 'power') {
    // Keep the standing-pin readout live during rolling/resolving too.
    if (pinsStandingEl) pinsStandingEl.textContent = String(getStandingCount());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION LOOP
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // clamp to avoid huge tab-switch jumps
  updateGame(dt);

  controls.enabled = isOrbitEnabled;
  controls.update();

  renderer.render(scene, camera);
}

startNewGame();
animate();

// ─────────────────────────────────────────────────────────────────────────────
// Responsiveness
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
