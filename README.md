# time-dilation

Interactive twin-paradox demo with paired Minkowski diagrams, proper-time roses, and tiered explanations of time dilation in flat spacetime.

## Overview

This project is a browser-based visualization of special relativity:

- You control a rocket's speed and path (unidirectional or bidirectional).
- The app shows two spacetime diagrams:
  - **S (Earth frame)**  
  - **S′ (piecewise comoving rocket frame)**
- Live values update for:
  - worldlines,
  - boosted axes and light-cone cues,
  - proper-time style readouts (`tEarth`, `tShip`),
  - interval norms (`||s||`, `||s′||`).
- Paired wilting roses provide a visual analogy for coordinate time vs proper time.
- Explanation panels include beginner / intermediate / advanced levels.

## Live Demo

[https://time-dilation.netlify.app/](https://time-dilation.netlify.app/)

Feel free to visit!

## Project Structure

- `templates/time-dilation.html` - main page markup
- `static/time-dilation.js` - UI controls, motion loop, runtime state
- `static/time-dilation-graph.js` - graph simulation + rendering logic
- `static/time-dilation-*.css` - styling split by feature/responsiveness
- `static/img/` - visual assets

## How It Works (high level)

1. `time-dilation.js` runs the animation loop and updates rocket state.
2. Each frame, it sends a compact snapshot to `TimeDilationGraph.update(...)`.
3. `time-dilation-graph.js` stores events, transforms S -> S′ incrementally, and redraws both canvases.
4. Rose progression is driven from motion-time state and gamma-based proper-time accumulation.

## Running Locally

Serve the project with any static server and open:

- `templates/time-dilation.html`

Example (Python):

```bash
python -m http.server 8000
```

Then visit:

- `http://localhost:8000/templates/time-dilation.html`


## Notes

- Units are normalized where needed for spacetime plotting consistency.
- S′ is built by piecewise incremental boosts (useful for visualization, with known non-inertial caveats).

## License

GPL-3.0

