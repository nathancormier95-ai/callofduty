# Stormfall Arena — Build Notes

- The game uses Babylon.js with a lifecycle-safe React canvas host and must dispose of all window listeners when unmounted.
- A top-down third-person `FreeCamera` gives immediate tactical clarity while allowing 3D props and a visible closing ring.
- The `?demo` query parameter triggers a deterministic orbit, target selection, and sustained firing pattern for visual review.
- No external models are required; all scene props are procedurally generated, while the visual identity and key textures use generated art.

