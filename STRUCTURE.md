# Stormfall Arena — Runtime Structure

## Layering

React is the **picture frame**. `GameCanvas.tsx` owns the lifecycle-safe Babylon canvas and the DOM HUD. Babylon owns rendering and scene nodes. The gameplay simulation lives in `client/src/game/scene.ts`, entirely independent from React state.

## Module Ownership

| Module | Ownership | Responsibility |
| --- | --- | --- |
| `components/GameCanvas.tsx` | React host | Initializes the canvas, listens for HUD status events, renders the overlay, and dispatches start/restart commands. |
| `game/scene.ts` | Game runtime | Builds the Babylon scene, owns `GameWorld`, input listeners, simulation, meshes, projectiles, and cleanup. |
| `App.tsx` | Route shell | Makes the game canvas the sole route-level content. |
| `index.css` | Visual system | Defines the Voltage Wilds typography, HUD language, accessibility, and responsive behavior. |

## GameWorld State

`GameWorld` explicitly owns the match mode (`briefing`, `active`, `victory`, `defeat`), player health and position, enemy states, projectile lifetimes, collectible crates, storm radius, movement actions, and the deterministic demo brain. It updates once from `scene.onBeforeRenderObservable`.

## Input Contract

| Action | Input | Result |
| --- | --- | --- |
| Move | WASD or arrows | Directional player motion within the arena. |
| Aim | Pointer over arena | Updates horizontal world-space aim target. |
| Fire | Pointer press / Space | Fires an amber energy bolt after a brief cooldown. |
| Drop / restart | Overlay button | Starts a match or recreates match entities. |

## Asset Hints

Generated files are referenced through stable `/manus-storage/...` paths, never copied into the project. Terrain is a tiled Babylon material. The logo and storm panel are DOM overlay assets. Supply crate art is used as a translucent horizontal pickup card and supported by a procedural glow cylinder.

