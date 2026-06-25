# Computer Graphics - Exercise 6 - Interactive Bowling Game

## Gameplay Video

[▶ Watch gameplay video on Google Drive](https://drive.google.com/file/d/1wmRUHWT-jHCQqFGjAwps--NjD-DgFLnh/view?usp=sharing)

## Group Members

- Lavie Zanzuri
- Michael Shampaner

## How to Run

1. Make sure Node.js is installed.
2. Clone / unzip the project folder.
3. Start the local server:
   ```bash
   node index.js
   ```
4. Open your browser at: `http://localhost:8000`

## Controls

| Key / Input | Action |
|-------------|--------|
| **◄ / ►** (Arrow Left/Right) | Aim — move the ball along the foul line |
| **▲ / ▼** (Arrow Up/Down) | Adjust spin / curve (hook) |
| **Space** | Start the oscillating power meter, then press again to lock power and release the ball |
| **R** | Reset the pins / start a new game (works at any time) |
| **O** | Toggle orbit camera on/off (carried over from HW05) |
| Mouse drag | Rotate camera (orbit mode) |
| Mouse wheel | Zoom in/out (orbit mode) |

### Game Flow
The game runs as a small state machine: **aiming → power → rolling → resolving → (next roll / next frame)**.
Arrow keys and Space only do something while in the matching state — e.g. you can't change your aim
once the ball is rolling. The 'O' toggle and 'R' reset both work in every state.

## Features Implemented (HW06)

### Aiming & Controls
- ✅ Ball aiming along the foul line (Arrow Left/Right), clamped to the lane width
- ✅ Optional spin/curve input (Arrow Up/Down) that bends the ball's path while rolling
- ✅ Oscillating on-screen power meter (Space to start, Space again to lock & release)
- ✅ 'O' orbit-camera toggle still works in every game state
- ✅ On-screen controls list (extended HW05's `#controls-container`)

### Ball Physics (simplified, hand-written — no physics engine)
- ✅ Velocity-based motion integrated every frame with `THREE.Clock` delta time
- ✅ Rolling friction (gradual deceleration)
- ✅ Optional sideways curve/hook acceleration driven by the spin input
- ✅ Gutter-ball detection: the ball drops into the gutter and the roll counts 0 pins if it leaves the lane edges
- ✅ Ball visually rolls (rotates) as it travels

### Pin Collision & Toppling
- ✅ Ball–pin collision via horizontal distance check (sphere vs. pin bounding cylinder)
- ✅ Pin–pin propagation: a falling pin can knock down standing neighbours within range
- ✅ Pins topple by rotating about a horizontal axis away from the impact direction
- ✅ Accurate standing-pin bookkeeping feeds directly into the scorecard

### Ten-Frame Scoring System
- ✅ Full 10-frame game: two rolls per frame (three in frame 10 after a strike/spare)
- ✅ Correct strike (`X`), spare (`/`), and open-frame notation
- ✅ Correct bonus-roll math for strikes/spares, including all 10th-frame edge cases
- ✅ Running cumulative total rendered live in the HW05 scorecard container
- ✅ Verified against known references: a 12-strike perfect game scores 300, and an
  all-spares (5/5 each frame + a final bonus roll of 5) game scores 150

### Game Flow & State
- ✅ End-of-roll detection (ball reaches the pin deck or comes to a stop)
- ✅ Automatic frame/roll advancement, including correct pin-reset timing
  (no reset between two rolls of the same frame; full reset between frames,
  and the special 10th-frame fresh-rack rules after a strike or spare)
- ✅ Ball resets to the approach for the next roll
- ✅ 'R' resets pins and starts a brand-new game at any time
- ✅ Clear "GAME OVER" banner after the 10th frame, with the reset hint

### Bonus Features
- ✅ Ball hook/curve dynamics driven by the spin input (Arrow Up/Down)
- ✅ Aim guide marker on the approach that follows the chosen aim position
- ✅ Live phase/spin readout next to the power meter

### Carried Over from HW05
- ✅ Bowling lane, foul line, approach area/dots, targeting arrows, gutters, lane boards
- ✅ 10 `LatheGeometry` pins in standard triangular formation, regulation positions
- ✅ Bowling ball with three finger holes
- ✅ Room environment (walls, ceiling, floor, fog), overhead spotlights with visible bulbs
- ✅ PCFSoft shadows, ACESFilmic tone mapping
- ✅ Orbit camera (now using the vendored `THREE.OrbitControls`, toggled with **O**)

## Technical Details

- **Library**: Three.js r128 (loaded from CDN)
- **OrbitControls**: vendored `src/OrbitControls.js`, imported as an ES module
- **Server**: Simple Node.js HTTP static server (`index.js`)
- **No build step required** — vanilla JS ES module (`src/hw6.js`)
- **No external physics engine** — all motion, gutter detection, and collision are
  hand-written in `updateGame(deltaTime)`, called every frame from `animate()`

## Known Issues / Limitations

- Pin–pin collision uses a simple distance threshold rather than true rigid-body contact,
  so toppling chains are a reasonable approximation rather than a physically exact simulation.
- The ball does not bounce or deflect off pins; it passes through visually while pins fall,
  which is a common simplification for hand-written (non-engine) bowling physics.

## External Assets

- Three.js r128 via cdnjs CDN (`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`)
- No other external assets
