"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Loaded from CDN on the client only. Bundling mind-ar through npm pulls in a
// native "canvas" build that fails on Windows and on Vercel, so we script-load
// the browser builds instead — nothing native, deploys anywhere.
const AFRAME_SRC = "https://aframe.io/releases/1.5.0/aframe.min.js";
const MINDAR_SRC =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js";

// ---------------------------------------------------------------------------
// A-Frame scene HTML
//
// Object hierarchy once the model loads:
//
//   <a-entity mindar-image-target>          ← tracked card transform
//     └── <a-gltf-model place-on-card>      ← RoomARAnchor pivot lives here
//           └── (glTF scene graph)
//                 ├── Rug   ← anchor reference surface (rug top = card surface)
//                 ├── Walls
//                 ├── Furniture
//                 ├── Shelves
//                 └── Decorations
//
// Tunable parameters on place-on-card:
//   size    — room footprint in card-width units  (default 1.4)
//   yaw     — spin about vertical axis, degrees   (default 0)
//   rugName — substring matched against mesh name (default "rug")
//   offsetX — manual X nudge, card-width units    (default 0)
//   offsetY — manual Y nudge, card-width units    (default 0)
//   offsetZ — lift above card surface             (default 0)
//   debug   — show anchor sphere + axes + console log (default false)
//
// Set debug: true to see a cyan sphere at the exact rug anchor and XYZ axes.
// ---------------------------------------------------------------------------
const SCENE_HTML = `
  <a-scene
    mindar-image="imageTargetSrc: /targets/card.mind; autoStart: true; uiScanning: no; uiLoading: no; warmupTolerance: 1; missTolerance: 5"
    loading-screen="enabled: false"
    color-space="sRGB"
    renderer="colorManagement: true, antialias: true, alpha: true, logarithmicDepthBuffer: true"
    vr-mode-ui="enabled: false"
    device-orientation-permission-ui="enabled: false"
  >
    <a-light type="ambient" intensity="1.5"></a-light>
    <a-light type="directional" intensity="1.3" position="1 2 2"></a-light>
    <a-light type="directional" intensity="0.8" position="-1 1 -1"></a-light>

    <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>

    <!-- mindar-image-target: its transform IS the card's real-world position.
         Everything parented here moves exactly with the physical card. -->
    <a-entity mindar-image-target="targetIndex: 0">
      <!--
        place-on-card aligns the room so the RUG's top surface sits flush on
        the card surface (z=0 in card space) and the rug center aligns with
        the card center.  The whole room stands upward from there.

        To tune alignment:
          size    → scale the room up/down relative to card width
          yaw     → rotate the room around its vertical axis (degrees)
          rugName → mesh-name substring for the rug (check debug console)
          offsetX/Y/Z → fine-tune if still slightly off
          debug   → set to "true" to see the anchor sphere + axes
      -->
      <a-gltf-model
        id="theModel"
        src="/models/US.glb"
        place-on-card="size: 1.4; yaw: 0; rugName: rug; offsetX: 0; offsetY: 0; offsetZ: 0; debug: false"
      ></a-gltf-model>
    </a-entity>
  </a-scene>
`;

// ---------------------------------------------------------------------------
// registerPlaceOnCard
//
// A-Frame component implementing the RoomARAnchor pattern:
//
//   1. Wait for the glTF model to fully load.
//   2. Compute local-space bounding box of the WHOLE model (for scale).
//   3. Find the rug mesh by name substring (rugName param).
//   4. Compute the rug's local-space bounding box and locate its TOP-CENTER
//      after the rotate+scale transform — this is the RoomARAnchor.
//   5. Rotate: +Y (glTF/Blender up) → +Z (card normal). Apply yaw.
//   6. Scale so the room's largest footprint fits within `size` card widths.
//   7. Apply position so:
//        rug_top_center.z = 0  → rug top surface ON the card surface
//        rug_top_center.x = 0  → rug center aligned with card X center
//        rug_top_center.y = 0  → rug center aligned with card Y center
//   8. Apply manual fine-tune offsets (offsetX/Y/Z).
//   9. If debug=true, add a cyan sphere at the anchor + AxesHelper.
//
// WHY LOCAL SPACE?
//   Under MindAR the world transform is invalid at model-load time.
//   setFromObject() (world-space) returns empty → NaN → model disappears.
//   Local-space measurement (accumulating mesh matrices up to root) is safe.
//
// WHY NOT BOUNDING-BOX CENTER?
//   The rug's top surface must be the reference, not the room's geometric
//   center.  The rug top and card surface must be coincident.  Everything
//   else (walls, furniture) inherits this automatically as children of root.
// ---------------------------------------------------------------------------
function registerPlaceOnCard() {
  const AFRAME = (window as unknown as { AFRAME?: any }).AFRAME;
  if (!AFRAME || AFRAME.components["place-on-card"]) return;

  AFRAME.registerComponent("place-on-card", {
    schema: {
      size:    { type: "number",  default: 1.4 },
      yaw:     { type: "number",  default: 0 },
      rugName: { type: "string",  default: "rug" },
      offsetX: { type: "number",  default: 0 },
      offsetY: { type: "number",  default: 0 },
      offsetZ: { type: "number",  default: 0 },
      debug:   { type: "boolean", default: false },
    },

    init() {
      this.el.addEventListener("model-loaded", () => {
        const THREE = AFRAME.THREE;
        const root = this.el.getObject3D("mesh");
        if (!root) return;

        const { size, yaw, rugName, offsetX, offsetY, offsetZ, debug } =
          this.data;

        // -----------------------------------------------------------------
        // Step 1 — Collect all meshes; compute local-space bounding boxes.
        // -----------------------------------------------------------------
        const allMeshes: { mesh: any; localBox: any }[] = [];
        const fullBox  = new THREE.Box3();
        const tmpBox   = new THREE.Box3();

        root.traverse((o: any) => {
          if (!o.isMesh || !o.geometry) return;
          o.geometry.computeBoundingBox();

          // Build local matrix chain: mesh → root (exclusive).
          const local = new THREE.Matrix4().identity();
          let cur = o;
          while (cur && cur !== root) {
            cur.updateMatrix();
            local.premultiply(cur.matrix);
            cur = cur.parent;
          }
          tmpBox.copy(o.geometry.boundingBox).applyMatrix4(local);
          fullBox.union(tmpBox);
          allMeshes.push({ mesh: o, localBox: tmpBox.clone() });

          // Visibility and depth fixes for enclosed rooms with alpha-texture characters:
          //
          // DoubleSide: interior faces (walls from outside) are visible.
          // depthWrite:true: every mesh participates in the depth buffer so
          //   objects in the room center are not depth-rejected by walls.
          // alphaTest + transparent:false (ALPHA-CUTOUT MODE) for transparent
          //   meshes: when transparent:true + depthWrite:true are combined,
          //   near-transparent pixels (hair edges, clothing outlines) write a
          //   depth value to the depth buffer but contribute no color → they
          //   punch transparent holes through any geometry behind the character.
          //   The fix: convert to cutout mode (alphaTest=0.1, transparent=false).
          //   Pixels with alpha < 0.1 are DISCARDED — they write no depth and
          //   no color, so the wall/poster behind shows through correctly.
          //   Pixels with alpha ≥ 0.1 render as fully opaque and write depth.
          o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m: any) => {
            if (!m) return;
            m.side      = THREE.DoubleSide;
            m.depthWrite = true;
            if (m.transparent) {
              // Switch from alpha-blend to alpha-cutout:
              //   transparent pixels → discarded (no depth write, no color)
              //   opaque pixels      → rendered normally with depth write
              m.alphaTest  = Math.max(m.alphaTest || 0, 0.1);
              m.transparent = false;
            }
            m.needsUpdate = true;
          });
        });

        if (allMeshes.length === 0 || fullBox.isEmpty()) return;

        // -----------------------------------------------------------------
        // Step 2 — Scale: fit largest footprint within `size` card widths.
        // -----------------------------------------------------------------
        const fullSize = fullBox.getSize(new THREE.Vector3());
        const maxDim   = Math.max(fullSize.x, fullSize.y, fullSize.z);
        if (!isFinite(maxDim) || maxDim <= 0) return;
        const scale = size / maxDim;

        // -----------------------------------------------------------------
        // Step 3 — Rotation.
        //   rotX = +90°: lays the model flat (glTF +Y up → card +Z normal).
        //   rotZ = yaw: spins the room so its front faces the viewer.
        // -----------------------------------------------------------------
        const euler = new THREE.Euler(
          Math.PI / 2,
          0,
          THREE.MathUtils.degToRad(yaw),
          "XYZ"
        );
        const rotM   = new THREE.Matrix4().makeRotationFromEuler(euler);
        const sclM   = new THREE.Matrix4().makeScale(scale, scale, scale);
        // Apply scale THEN rotate (scale first, then rotate around scaled axes).
        const xformM = new THREE.Matrix4().multiplyMatrices(sclM, rotM);

        // -----------------------------------------------------------------
        // Step 4 — Find the rug mesh.
        //
        //   a) Mesh name contains rugName (case-insensitive).
        //   b) Among matches, prefer the largest XY area (flat surface).
        //   c) Fallback: use model’s overall floor with a console warning.
        // -----------------------------------------------------------------
        const lower = rugName.toLowerCase();
        let rugEntry: { mesh: any; localBox: any } | null = null;
        let bestArea = -Infinity;

        for (const entry of allMeshes) {
          if (entry.mesh.name.toLowerCase().includes(lower)) {
            const s    = entry.localBox.getSize(new THREE.Vector3());
            const area = s.x * s.y; // XY area in pre-rotation local space
            if (area > bestArea) {
              bestArea = area;
              rugEntry = entry;
            }
          }
        }

        // -----------------------------------------------------------------
        // Step 5 — Compute the RoomARAnchor in TRANSFORMED space.
        //
        // Z axis: ALWAYS use the model's absolute floor (fullBoxT.min.z).
        //   This is the lowest point of any geometry — the true floor level.
        //   Placing this at z=0 means the room floor sits exactly on the card.
        //   Using rugBoxT.max.z was unreliable: if the rug mesh is detected at
        //   mid-height or slightly above the actual floor, the room floats.
        //
        // X/Y axes: use the rug center if found (so the rug center aligns with
        //   the card center horizontally), otherwise use the full model center.
        // -----------------------------------------------------------------
        const fullBoxT = fullBox.clone().applyMatrix4(xformM);
        let anchorX: number;
        let anchorY: number;

        if (rugEntry) {
          const rugBoxT = rugEntry.localBox.clone().applyMatrix4(xformM);
          anchorX = (rugBoxT.min.x + rugBoxT.max.x) / 2;  // rug center X
          anchorY = (rugBoxT.min.y + rugBoxT.max.y) / 2;  // rug center Y
          if (debug) {
            const rs = rugEntry.localBox.getSize(new THREE.Vector3());
            console.log(
              `[place-on-card] Rug: "${rugEntry.mesh.name}" | ` +
              `local size: ${rs.x.toFixed(3)}×${rs.y.toFixed(3)}×${rs.z.toFixed(3)}`
            );
          }
        } else {
          anchorX = (fullBoxT.min.x + fullBoxT.max.x) / 2;  // model center X
          anchorY = (fullBoxT.min.y + fullBoxT.max.y) / 2;  // model center Y
          console.warn(
            `[place-on-card] No mesh matching "${rugName}" found. ` +
            `Using full model center for X/Y. Enable debug:true to see all mesh names.`
          );
        }

        // Z: always the model's absolute floor (lowest geometry in card space).
        const anchorZ = fullBoxT.min.z;
        const anchorInTransformed = new THREE.Vector3(anchorX, anchorY, anchorZ);

        if (debug) {
          const names = allMeshes.map((e: any) => `"${e.mesh.name}"`).join(", ");
          console.log(`[place-on-card] All mesh names: ${names}`);
          console.log(
            `[place-on-card] Anchor: x=${anchorX.toFixed(4)} y=${anchorY.toFixed(4)} z=${anchorZ.toFixed(4)}`
          );
        }

        // -----------------------------------------------------------------
        // Step 6 — Apply transform to the glTF root Object3D.
        //
        // In card space: z=0 is the card surface, z>0 is above it.
        // We want anchorInTransformed to land at (offsetX, offsetY, offsetZ).
        //
        //   root.position = -anchor + manualOffset
        //
        // This moves the whole room so the rug’s top-center sits exactly at
        // the card center+surface, then applies any manual fine-tune.
        // -----------------------------------------------------------------
        root.matrixAutoUpdate = true;
        root.scale.setScalar(scale);
        root.setRotationFromEuler(euler);
        root.position.set(
          -anchorInTransformed.x + offsetX,
          -anchorInTransformed.y + offsetY,
          -anchorInTransformed.z + offsetZ
        );

        if (debug) {
          console.log(
            `[place-on-card] scale=${scale.toFixed(5)} | ` +
            `pos: ${JSON.stringify(root.position)} | ` +
            `size:${size} yaw:${yaw}° offset:(${offsetX},${offsetY},${offsetZ})`
          );
        }

        // -----------------------------------------------------------------
        // Step 7 — Debug visuals (only when debug: true).
        //
        //   Cyan sphere  → RoomARAnchor location (rug top-center on card).
        //                  Should appear flush with card surface, centered.
        //   AxesHelper   → red=X, green=Y, blue=Z of card coordinate system.
        // -----------------------------------------------------------------
        if (debug) {
          const existing = root.parent?.getObjectByName("__rugAnchorDebug");
          if (existing) root.parent?.remove(existing);

          const debugGroup = new THREE.Group();
          debugGroup.name = "__rugAnchorDebug";

          // Sphere at the rug anchor in CARD space.
          // After offset: anchor + root.position = (offsetX, offsetY, offsetZ)
          // which defaults to (0,0,0) — card center/surface.
          const sphereGeo = new THREE.SphereGeometry(0.04, 16, 16);
          const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
          const sphere    = new THREE.Mesh(sphereGeo, sphereMat);
          sphere.position.set(offsetX, offsetY, offsetZ);
          debugGroup.add(sphere);

          // Axes at card origin: red=X, green=Y, blue=Z.
          const axes = new THREE.AxesHelper(0.25);
          debugGroup.add(axes);

          root.parent?.add(debugGroup);
        }
      });
    },
  });
}

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`Failed to load ${src}`))
      );
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false; // keep A-Frame -> MindAR execution order
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () =>
      reject(new Error(`Failed to load ${src}`))
    );
    document.head.appendChild(script);
  });
}

// Turn a getUserMedia failure into a message the user can act on.
function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was blocked. Tap the 🎥/lock icon in the address bar, allow the camera, then Retry.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it (Zoom/Teams/other tabs) and Retry.";
    default:
      return `Couldn't start the camera${
        name ? ` (${name})` : ""
      }. Make sure you're on https:// or localhost and try again.`;
  }
}

type Status = "idle" | "starting" | "running" | "error";

export default function ARScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [found, setFound] = useState(false);
  const [modelState, setModelState] = useState<"loading" | "loaded" | "error">(
    "loading"
  );

  const teardown = useCallback(() => {
    const container = containerRef.current;
    const sceneEl = container?.querySelector("a-scene") as
      | (HTMLElement & { systems?: Record<string, { stop?: () => void }> })
      | null;
    try {
      sceneEl?.systems?.["mindar-image-system"]?.stop?.();
    } catch {}
    try {
      sceneEl?.parentNode?.removeChild(sceneEl);
    } catch {}
    if (container) container.innerHTML = "";
  }, []);

  const start = useCallback(async () => {
    setStatus("starting");
    setMessage("");

    // 1) Pre-flight the camera so we can show the REAL reason if it fails,
    //    instead of a silent black screen. We stop the stream right away and
    //    let MindAR open the camera itself.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setStatus("error");
      setMessage(cameraErrorMessage(err));
      return;
    }

    // 2) Load the AR engine, then inject the scene.
    try {
      await loadScript(AFRAME_SRC, "aframe-script");
      registerPlaceOnCard();
      await loadScript(MINDAR_SRC, "mindar-script");
    } catch {
      setStatus("error");
      setMessage("Couldn't load the AR engine. Check your connection and Retry.");
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = SCENE_HTML;

    const sceneEl = container.querySelector("a-scene");
    if (sceneEl) {
      sceneEl.addEventListener("arReady", () => setStatus("running"));
      sceneEl.addEventListener("arError", () => {
        setStatus("error");
        setMessage(
          "The AR engine failed to start the camera. Reload the page and allow camera access."
        );
      });
    } else {
      // Fallback if the custom element didn't upgrade for some reason.
      setStatus("running");
    }

    // Detection indicator: MindAR fires these on the target entity so you can
    // SEE whether the card is actually being recognized.
    const targetEl = container.querySelector("[mindar-image-target]");
    if (targetEl) {
      targetEl.addEventListener("targetFound", () => setFound(true));
      targetEl.addEventListener("targetLost", () => setFound(false));
    }

    // Model load status.
    const modelEl = container.querySelector("#theModel");
    if (modelEl) {
      modelEl.addEventListener("model-loaded", () => setModelState("loaded"));
      modelEl.addEventListener("model-error", () => setModelState("error"));
    }
  }, []);

  // Release the camera when leaving the page.
  useEffect(() => teardown, [teardown]);

  return (
    <div className="ar-root">
      <div ref={containerRef} className="ar-container" />

      {status === "running" && !found && (
        <div className="ar-hint-pill">
          {modelState === "error"
            ? "Couldn’t load the surprise — reload the page"
            : "Point your camera at the card"}
        </div>
      )}

      {status !== "running" && (
        <div className="ar-status">
          {status === "idle" && (
            <div className="ar-status-box">
              <span className="ar-status-heart" aria-hidden="true">
                ♥
              </span>
              <p className="ar-status-text">A little surprise is waiting</p>
              <button className="ar-start" onClick={start}>
                Begin
              </button>
            </div>
          )}

          {status === "starting" && (
            <p className="ar-status-text">Getting things ready…</p>
          )}

          {status === "error" && (
            <div className="ar-status-box">
              <p className="ar-status-text">{message}</p>
              <button className="ar-start" onClick={start}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
