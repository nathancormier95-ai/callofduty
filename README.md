# Stormfall Arena

**Stormfall Arena** is an original browser-based, third-person survival-shooter prototype. It is built with React, TypeScript, Babylon.js, and Vite. The project includes a mobile-first control layer, an original Sable Ridge environment, AI rivals, shrinking-storm pressure, pickups, weapon magazines, reload states, and tactical HUD feedback.

> This project is an original work. It uses familiar survival-shooter genre conventions but does not include branded maps, characters, visual identity, or assets from any commercial game.

## Run locally

Install dependencies with `pnpm install`, then start the development server with `pnpm dev`. Build a production bundle with `pnpm build` and run type-checking with `pnpm check`.

## Controls

| Platform | Movement | Aim | Fire | Reload |
| --- | --- | --- | --- | --- |
| Desktop | WASD or arrow keys | Mouse | Click or Space | R or HUD button |
| Mobile | Left movement stick | Right aim pad | Hold FIRE | Weapon HUD button |

## Project layout

The game UI is in `client/src/components/GameCanvas.tsx`, while the Babylon.js combat world and environment are in `client/src/game/scene.ts`. Global tactical HUD and mobile-control styling lives in `client/src/index.css`.

## 3D map assets

Use **GLB** for single-file browser-ready map models. Source assets can be kept under `assets/maps/` with Git LFS when they are large. Before deployment, place large binary assets in managed web storage and reference their provided URL; do not commit deployment-only copies into the app’s source directories.
