---
name: threejs-camera
description: Three.js camera and interaction for the SYSONE 3D office - raycasting, picking, pointer/touch/wheel input, orbit/follow camera controls, damping/inertia, dead-angle avoidance. Use when changing how the camera moves or how users control it (drag, zoom, pinch, keys, click-to-move) in src/ui/camera.js or src/main.js.
---

# Three.js Camera & Interaction (SYSONE office)

## When to Use
- Changing the camera (follow / overview / first person / walk mode) or how users control it.
- Raycasting, object picking, pointer handling, touch input, wheel/trackpad zoom.
- Anything interactive in the 3D scene rather than a passive render.

## SYSONE project rules (read first)

The project does NOT use OrbitControls. The camera is a custom rig: `CameraRig` in `src/ui/camera.js`.
Extend it instead of adding a controls library on top (two controllers fighting over the same camera cause jitter).

- **State**: `rig.S` = current spherical camera `{ th, ph, r, t }`, `rig.G` = goal. Every frame S eases toward G;
  input writes to G (or to both for an instant response). `th` = azimuth, `ph` = polar angle, `r` = distance, `t` = target.
- **Modes**:
  - `follow.local`: third person behind your own character (`updateThirdPerson`).
  - `fp`: first person (V key).
  - `walkMode`: free walking (WASD + mouse look).
  - Overview: no follow, presets `PRESETS` / `go(k)`.
- **Limits live in `LIM`**:
  - `fEl`: follow elevation angle.
  - `fR`: follow distance, multiplied by the character size `camR`.
  - `oR`, `oPh`: overview distance and polar angle.
  - `ox`, `oy`, `oz`: overview target bounds.

  Always clamp against the limits of the *current* mode. Pinching in follow mode must use `fR`, not `oR`.
- **Spring arm: the character is never hidden, and the scene is never cut away.**
  - `armFree(t, th, ph, maxD, a)` measures how far the camera can go from the shoulder target. It casts 5 parallel
    rays (centre, the two lens edges, head height, feet height) against walls, respects the ceiling (`rig.clamp`) and
    the building shell (`world.sameSpace`).
  - `bestArm(...)` raises the camera (up to about 80° looking down) until there is enough room (`armNeed` ≈ 0.8·`fR[0]`·R)
    and `furnitureBlocks()` reports no desk, counter or plant over the head or feet. For seeing, furniture boxes count as at
    most 0.95 m tall; furniture never pulls the camera in, it only raises it.
  - Distance = min(user distance, free). Pull in fast (`exp(-dt*20)`), ease out slowly (`exp(-dt*2.2)`). The assisted
    elevation rises fast (×9) and relaxes slowly (×2.5).
  - Dragging, two-finger rotate and inertia go through `canOrbit(th, ph)`, so users cannot orbit into a blocked direction.
  - **No auto-return after release**: the camera stays where the user left it. Auto-rotate (`escapeTh`) only fires when
    every elevation is cramped (`f < 0.5·need`), which is rare.
  - Zooming out against a wall does not pile up "virtual" distance (`zoom()` caps it at `lastFree + 0.5`).
  - Dead spots: `player.camOk(x, z)` (cached per 0.2 m cell) blocks walking into cells where no direction gives enough
    room. It is part of `walkable()`.
  - Measured in testing: 300 random spots across 3 floors gave 0 walls or furniture between the camera and the
    character, the camera was never inside a wall, and the camera costs about 0.25 ms per frame.
- **Follow camera = hangmu.online model** (user request, 2026-11-10):
  - FOV 55; fixed distance ≈ 7.6 × character size (`camR`); default pitch ~22° down.
  - Look target at **1.15 × character height** (above the head), so the character sits in the lower part of the frame.
  - The target snaps to the character every frame (no lag, `S.t.copy(G.t)`). If the target ends up inside a roof or
    beam box, lower it to just under that box.
  - Walls pull the camera in immediately (farthest valid point); it eases back out at `exp(-dt*8)`.
  - Furniture does not move the camera.
  - When the user's pitch leaves less room than `armNeed`: the camera rises a little. If that lasts ≥0.5 s and the
    user hasn't orbited in the last 2.5 s, it turns to the nearest direction with comfortable room (`openDir`, ≥60% of
    the wanted distance).
  - `follow()` calls `pickOpenStart()` so the camera never starts facing a wall.
  - Drag sensitivity matches hangmu: yaw 0.006, pitch 0.004 rad/px.
- **Movement = hangmu model**:
  - acceleration `v += (target − v)·min(1, 14·dt)`, so movement starts and stops smoothly;
  - heading turns at 12 rad/s;
  - the mobile joystick is analog (`player.stick {x,y}`): a small tilt walks slowly, past 0.92 it runs.
- **Pitfall that bit twice**: never put a `//` comment in the middle of a line before code (`for (...) // note { body }`
  comments out the body). After scripted edits, grep for `//` followed by code.
- **Inertia**: `coast(dt, phLim)` applies `vth/vph` (rad/s) after release and decays them with `exp(-dt*6)`.
  - Coast only after a real drag (`moved > 6` px) when the pointer was still moving at release.
  - Disable it for `prefers-reduced-motion`, walk mode and first person.
  - `stopCoast()` on pointerdown, presets, `C` recenter and first-person toggle.
- **Wheel**: normalise `deltaMode` (lines ×16, pages ×400). Trackpad pinch on macOS arrives as `wheel` + `ctrlKey`
  (small deltas: scale them up). Clamp each event, zoom multiplicatively (`exp(dy*k)`), always `preventDefault`
  with `{ passive: false }`.
- **Touch**: the canvas has `touch-action: none`. Use Pointer Events (one code path for mouse, pen and touch):
  - 1 pointer: orbit.
  - 2 pointers: pinch distance for zoom and midpoint x for rotate.
  - Reset the pinch state when a finger lifts.
- **Click vs drag**: `rig.lastMoved > 6` means the pointer was a drag. Click-to-move in `src/main.js` must ignore it.
- **Picking**: raycast against specific groups, never all of `scene.children`. Pool meshes carry `userData.agent`.
  Floor clicks only count for the player's current floor, then snap to the nav grid with `nearestFree` (returns an
  index; use `cx(k)`/`cz(k)`).
- **Keys**: the player owns W A S D, arrows, E, F, B, C, V, T, Space, 1–5 and Esc (`src/session/player.js`).
  The camera uses `+`/`-` for zoom. Check both files before binding a new key, and update `KEYROWS3D` in
  `src/main.js` (the shortcuts dialog).
- **Smoothness is a requirement** (see the project memory "UI must be smooth"):
  - Ease everything with frame-rate independent factors (`1 - exp(-dt*k)`), never a fixed per-frame lerp.
  - No snapping, except deliberate fades such as quick travel.
- **Verify**:
  - `npx vitest run` (`tests/rig.test.js` covers the rig).
  - `npm run e2e`.
  - For feel changes, drive the page with Playwright: `window.__app.app.rig`, `window.__app.session.player`.

## Quick Start (generic Three.js)

```javascript
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(clickables, true);
  if (intersects.length > 0) console.log("Clicked:", intersects[0].object);
}
renderer.domElement.addEventListener("click", onClick);
```

## Raycaster

```javascript
raycaster.setFromCamera(ndc, camera);          // mouse picking
raycaster.set(origin, direction);              // any origin + normalized direction
const hits = raycaster.intersectObjects(objects, recursive);
// hit: { distance, point, face, faceIndex, object, uv, uv1, normal, instanceId }

raycaster.near = 0; raycaster.far = 100;
raycaster.params.Line.threshold = 0.1;
raycaster.params.Points.threshold = 0.1;
raycaster.layers.set(1);                       // only objects on layer 1
```

Mouse → NDC for a canvas (not the window):

```javascript
const r = canvas.getBoundingClientRect();
ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
```

Efficient raycasting:
- Pass a short list of candidates (`recursive: false` where possible).
- Use layers to filter targets.
- Throttle hover raycasts to about 20/s.
- Raycast against invisible simple proxies, linked with `userData.target`, instead of detailed meshes.

## Camera Controls (reference)

### OrbitControls
```javascript
controls.enableDamping = true; controls.dampingFactor = 0.05;
controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI / 2;
controls.minAzimuthAngle = -Math.PI / 4; controls.maxAzimuthAngle = Math.PI / 4;
controls.minDistance = 2; controls.maxDistance = 50;
controls.enableRotate = true; controls.enableZoom = true; controls.enablePan = true;
controls.autoRotate = true; controls.autoRotateSpeed = 2.0;
controls.target.set(0, 1, 0);
// call controls.update() every frame (required for damping / autoRotate)
controls.dolly(1.5); controls.pan(dx, dy); controls.rotate(dAz, dPolar);          // r183
controls.cursorStyle = { orbit: "grab", pan: "move", dolly: "zoom-in" };          // r183
```

### MapControls / TrackballControls / FlyControls / FirstPersonControls
```javascript
new MapControls(camera, dom);        // screenSpacePanning = false, maxPolarAngle = PI/2
new TrackballControls(camera, dom);  // rotateSpeed, zoomSpeed, panSpeed, staticMoving
new FlyControls(camera, dom);        // movementSpeed, rollSpeed, dragToLook; update(delta)
new FirstPersonControls(camera, dom);// lookSpeed, constrainVertical, verticalMin/Max; update(delta)
```

### PointerLockControls
```javascript
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
const controls = new PointerLockControls(camera, document.body);
document.addEventListener("click", () => controls.lock());

const velocity = new THREE.Vector3();
let moveForward = false, moveBackward = false;   // let, not const: they change on key events
document.addEventListener("keydown", e => { if (e.code === "KeyW") moveForward = true; if (e.code === "KeyS") moveBackward = true; });
document.addEventListener("keyup", e => { if (e.code === "KeyW") moveForward = false; if (e.code === "KeyS") moveBackward = false; });

function animate(dt) {
  if (!controls.isLocked) return;
  const dir = Number(moveForward) - Number(moveBackward);
  velocity.z += dir * 20 * dt;
  velocity.z *= Math.exp(-dt * 6);             // frame-rate independent friction
  controls.moveForward(velocity.z * dt);
}
```

### TransformControls / DragControls
```javascript
const tc = new TransformControls(camera, renderer.domElement);
scene.add(tc.getHelper ? tc.getHelper() : tc);  // r169+: add the helper
tc.attach(mesh); tc.setMode("translate");      // 'rotate' | 'scale'; setSpace('local'|'world')
tc.addEventListener("dragging-changed", e => { orbit.enabled = !e.value; });

const dc = new DragControls(draggables, camera, renderer.domElement);
dc.addEventListener("dragstart", () => { orbit.enabled = false; });
dc.addEventListener("dragend", () => { orbit.enabled = true; });
```

## Selection

- **Click select**: raycast on pointerdown or click. Restore the previous object's emissive or colour, then highlight the new one.
- **Hover**:
  - Throttle the raycast.
  - Store the original colour in `userData`.
  - Set `cursor: pointer` only while something is hovered.
- **Box select**: `SelectionBox` + `SelectionHelper` from `three/addons/interactive/`.

## Coordinates

```javascript
// world → screen (position HTML over a 3D object)
const v = pos.clone().project(camera);
const x = (v.x + 1) / 2 * rect.width, y = (1 - v.y) / 2 * rect.height;

// screen → ground plane
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
raycaster.setFromCamera(ndc, camera);
const p = new THREE.Vector3(); raycaster.ray.intersectPlane(ground, p);
```

## Performance Tips
1. Throttle pointermove raycasts; never raycast the whole scene recursively on hover.
2. Use layers or explicit lists for raycast targets; use simple proxy meshes.
3. Disable controls when a modal is open (`controls.enabled = false`).
4. Reuse `Vector3` / `Raycaster` instances; do not allocate per frame.

## Limitations
- Use this skill only when the task is about camera or interaction.
- The output does not replace testing in the real app. Check feel and smoothness in a browser, not only in unit tests.
- Ask when success criteria (feel, speeds, limits) are unclear.
