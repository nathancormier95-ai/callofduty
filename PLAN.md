# Game Plan: Stormfall Arena

## Risk Tasks

### 1. Browser aim input against a top-down 3D arena
- **Why isolated:** Pointer coordinates must resolve to a stable world-space aim point across viewport sizes and camera perspective.
- **Approach:** Use Babylon scene picking against the arena ground mesh, cache the resulting world coordinate, and fire projectiles along a normalized horizontal direction. Keyboard movement is expressed as semantic movement actions.
- **Verify:** A mouse press sends amber player projectiles toward the pointer on the visible arena rather than screen-space directions; WASD movement remains aligned to the visual camera view.

### 2. Closing storm with autonomous survival AI
- **Why isolated:** The storm, enemy chase/shoot loop, collision damage, and reset state can otherwise create ambiguous defeat conditions.
- **Approach:** Use a compact `GameWorld` update loop. Enemies steer toward the player and fire only in range; the storm reduces a radius over time and applies proportional out-of-zone damage. The `?demo` mode controls the player via a deterministic orbit-and-fire pattern for repeatable captures.
- **Verify:** The violet ring visibly contracts, enemies move and fire, both player and enemies take damage from projectiles or storm exposure, and demo mode reaches live gameplay without user input.

## Main Build

Build a full-screen original browser survival arena with a 3D top-down battlefield, keyboard movement, mouse aiming/firing, rival bots, collectible survival crates, angular cover, a shrinking electrical storm, and explicit victory/defeat states. Keep the HUD as a lightweight React overlay and all simulation in framework-independent TypeScript.

- **Assets:**
  - Generated terrain texture — a repeating 5m ground material.
  - Generated supply crate art — 2.2m x 2.2m top-down pickup card.
  - Generated storm panel — full-screen pre-match visual field.
  - Generated storm signal logo — 72px UI identity mark.
  - Procedural meshes — player, rivals, bullets, boulders, shelter panels, storm ring, and rain particles.
- **Verify:**
  - WASD or arrow-key movement moves the amber player marker in the expected world direction.
  - Mouse / pointer aim drives visible tracer fire and enemies return fire.
  - Health, remaining-opponent count, storm timing, minimap, and instruction labels stay readable without overlap.
  - Supply crates visibly collect when the player crosses them and provide a health or burst-speed benefit.
  - A victory card appears after every rival is removed; a defeat card appears on zero health.
  - `?demo` supplies a deterministic active-match screenshot mode.
  - No missing textures, visual placeholders, or browser console errors appear during the captured run.
  - Reference consistency: high three-quarter camera, blue-slate terrain, amber player/pickups, coral rivals, violet storm boundary, and corner-anchored tactical HUD.

## Exact Lakeside Park Photo Rebuild

**Ground-truth visual:** The user-provided photograph is the required composition, not merely a texture source. The playable view must look up the two-lane asphalt road toward the uphill horizon, with the double-yellow centerline and white shoulder line leading forward. The left side must read as a shoreline park with a wooden guardrail, small beach, waterside seats, and park-sign landmark. The right side must read as a campground/RV strip behind utility poles and a dense mixed treeline. Bright late-day blue sky, sunlit vegetation, and the actual road photo backdrop take priority over the prior storm-night harbor presentation.

| Risk slice | Implementation response | Visible proof |
| --- | --- | --- |
| Perspective mismatch | Move the spawn to the right shoulder and make the road run straight along the camera’s forward axis with a rising grade. | The first active view points uphill along a wide road, matching the photograph’s vanishing point. |
| Landmark clutter | Replace town/marina silhouettes with a single left shoreline park, sign, beach rail, and a right campground/RV corridor. | Both sides of the road are immediately legible and preserve the reference’s sightline. |
| Tactical readability | Move gameplay cover off the middle of the highway and use roadside guardrails, RVs, utility cabinets, benches, and campground features. | The road centerline remains continuously visible while fighting can still use cover. |
| Mobile performance | Use simple procedural geometry and one direct photo backdrop/road texture without additional large assets. | Portrait play retains full touch controls and recognizable scene composition. |

**Verification criteria:** A desktop and mobile screenshot must visibly show the uphill double-yellow road, shoulder line, shoreline park/sign/guardrail to the left, overhead utility corridor, right campground/RV strip, and direct user photo in the forward composition.
