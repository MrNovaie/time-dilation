"use strict";

// ===========================================================================
//  time-dilation-graph.js
//
//  Draws two spacetime diagrams side-by-side:
//    Graph 1  –  Earth frame  S   (x  vs ct )
//    Graph 2  –  Rocket frame S′  (x′ vs ct′)
//
//  Both graphs share the same underlying event history recorded in Earth-frame
//  coordinates.  Graph 2 is produced by Lorentz-transforming that history into
//  the rocket's comoving frame using an incremental piecewise boost (unfortunately, not Fermi-Walker, so there are inconsistencies).
//
//  ── Lorentz transform recap ──
//
//  For an inertial frame S′ moving at velocity βc relative to S the standard
//  boost is:
//      x′  = γ ( x  − β · ct )        γ = 1 / √(1 − β²)
//      ct′ = γ ( ct − β · x  )
//
//  When β changes over time (acceleration / direction change) there is no
//  single global S′. Handling this with an incremental piecewise strategy:
//
//    1. Between consecutive recorded events the rocket has a specific β.
//    2. We compute the Earth-frame step  (Δx, Δct) = (x_i − x_{i−1}, ct_i − ct_{i−1}).
//    3. We boost that step with the β active at step i:
//           Δx′  = γ_i ( Δx  − β_i · Δct )
//           Δct′ = γ_i ( Δct − β_i · Δx  )
//    4. We accumulate: x′_i = x′_{i−1} + Δx′ ,  ct′_i = ct′_{i−1} + Δct′
//    This method gets more accurate the faster you update each point.
//
//  Further breakdown
//  ───────────────────────────
//  • Rocket worldline:  at every step Δx = β·Δct  (the rocket moves at its
//    own speed), so  Δx′ = γ(β·Δct − β·Δct) = 0.  The rocket stays at x′ ≈ 0
//    regardless of how β changes.  ct′ accumulates as proper time (Δct/γ).
//
//  • Earth worldline:  Δx = 0  (Earth is stationary in S), so
//    Δx′ = −γβ·Δct  and  Δct′ = γ·Δct.  Earth traces a smooth diagonal in S′
//    whose slope is −β; when β changes, the slope changes — no backwards jump.
//
//  • At a bounce (bidirectional mode) β flips sign, producing a kink in the
//    Earth's S′ worldline — the physical signature of the turnaround.
//
//  ── Unit normalisation ──
//
//  The animation stage moves in pixels, but Lorentz mixing of x and ct only
//  makes sense when both share the same units.  time-dilation.js converts
//  pixel position to c-normalised units before sending:
//      x_phys = x_px / scaledPxPerC()   (140 px/s at 1c when innerWidth >= 1440; scales down on narrow viewports)
//  so that  x = β · ct  holds for constant-speed motion (c = 1).
// ===========================================================================

function lorentzToPrime(x, ct, beta) {
  const g = window.gammaFromBeta(beta); // Uses the gammaFromBeta function from time-dilation.js
  return {
    x:  g * (x  - beta * ct),
    ct: g * (ct - beta * x),
  };
}

// ---------------------------------------------------------------------------
// Graph-local simulation state
// ---------------------------------------------------------------------------

const graphState = {
  c: 1,                
  tEarth: 0,           // accumulated Earth-frame coordinate time (seconds)
  tRocket: 0,          // accumulated rocket proper time (seconds)
  earthPoints: [],      
  rocketPoints: [],     
  maxDrawPoints: 2000,  // decimation ceiling for canvas rendering
  axes: { padL: 21, padR: 12, padT: 12, padB: 18 },
  sScale:  { xMin: 0, xMax: 1, ctMin: 0, ctMax: 1 },  // axis range for S
  spScale: { xMin: 0, xMax: 1, ctMin: 0, ctMax: 1 },  // axis range for S′
  lastProgress: 0,             // normalised animation progress [0,1]
};

function resetGraphState() {
  graphState.tEarth = 0;
  graphState.tRocket = 0;
  graphState.earthPoints.length = 0;
  graphState.rocketPoints.length = 0;
  graphState.sScale  = { xMin: 0, xMax: 1, ctMin: 0, ctMax: 1 };
  graphState.spScale = { xMin: 0, xMax: 1, ctMin: 0, ctMax: 1 };
  graphState.lastProgress = 0;
  redraw();
}

// ---------------------------------------------------------------------------
// Coordinate → pixel mapping
//
// Maps world coordinates (x, ct) into canvas pixel positions using the
// provided axis-range object {xMin, xMax, ctMin, ctMax}.
//
// Axis convention on screen:
//   horizontal → ct  (or ct′)     increases to the right
//   vertical   → x   (or x′)     increases upward (S) or downward (S′ flipX)
//
// The optional flipX flag inverts the vertical direction so the S′ graph
// can place its origin at the top-left (ct′ axis at top, x′ grows down).
// ---------------------------------------------------------------------------
// Hi-DPI: backing store = CSS layout size × devicePixelRatio (capped), then
// ctx.setTransform(dpr, dpr) so all drawing stays in CSS pixel coordinates.
// ---------------------------------------------------------------------------

const MAX_GRAPH_DPR = 2.5;

/** Layout size in CSS pixels (after prepareGraphCanvas2D). */
function getGraphCssSize(canvas) {
  return [canvas.clientWidth, canvas.clientHeight];
}


// ---------------------------------------------------------------------------
// Sizes the bitmap for the current layout + DPR, locks display size, returns 2d context scaled for CSS px drawing.
// ---------------------------------------------------------------------------
function prepareGraphCanvas2D(canvas) {
  const rect = canvas.getBoundingClientRect();
  let cssW = Math.round(rect.width);
  let cssH = Math.round(rect.height);
  if (cssW < 2 || cssH < 2) {
    cssW = Math.max(2, parseInt(canvas.getAttribute("width"), 10) || 300);
    cssH = Math.max(2, parseInt(canvas.getAttribute("height"), 10) || 195);
  }
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_GRAPH_DPR);
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return ctx;
}

// Convert world coordinates (x, ct) to canvas pixel coordinates (x, y).

function createCanvasMapper(canvas, scale, flipX) {
  const { padL, padR, padT, padB } = graphState.axes;
  const left  = 5 * padL;
  const top   = 5 * padT;
  const [cw, ch] = getGraphCssSize(canvas);
  const plotW = Math.max(1, cw - left - padR);
  const plotH = Math.max(1, ch - top - padB);
  const ctRange = Math.max(0.0001, scale.ctMax - scale.ctMin);
  const xRange  = Math.max(0.0001, scale.xMax  - scale.xMin);
  return function mapPoint(x, ct) {
    const px   = left + ((ct - scale.ctMin) / ctRange) * plotW;
    const norm = (x - scale.xMin) / xRange;
    const py   = flipX
      ? top + norm * plotH
      : ch - padB - norm * plotH;
    return { x: px, y: py };
  };
}

// ---------------------------------------------------------------------------
// Canvas drawing primitives
// ---------------------------------------------------------------------------

// Draw the L-shaped (or ⌐-shaped for flipX) axis border and place labels.
function drawGraphAxes(ctx, canvas, frameLabel, flipX) {
  const { padL, padR, padT, padB } = graphState.axes;
  const [cw, ch] = getGraphCssSize(canvas);
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "rgba(0, 33, 85, 0.5)";
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = "rgba(143, 221, 255, 0.85)";
  ctx.lineWidth = 1.0;
  const prime = frameLabel === "S\u2032" ? "\u2032" : "";
  ctx.fillStyle = "rgba(220, 245, 255, 0.9)";
  ctx.font = "9px sans-serif";
  if (flipX) {
    // ⌐ shape: horizontal line at top, vertical line on left
    ctx.beginPath();
    ctx.moveTo(5*padL, 5*padT);
    ctx.lineTo(cw - padR, 5*padT);
    ctx.moveTo(5*padL, 5*padT);
    ctx.lineTo(5*padL, ch - padB);
    ctx.stroke();
    ctx.fillText("x" + prime, 5*padL + 4, ch - padB - 4);
    ctx.fillText("ct" + prime, cw - padR - 16, 5*padT + 9);
  } else {
    // L shape: vertical line on left, horizontal line at bottom
    ctx.beginPath();
    ctx.moveTo(5*padL, 5*padT);
    ctx.lineTo(5*padL, ch - padB);
    ctx.lineTo(cw - padR, ch - padB);
    ctx.stroke();
    ctx.fillText("x", 5*padL + 4, 5*padT + 9);
    ctx.fillText("ct", cw - padR - 16, ch - padB - 4);
  }
}

// Draw the boosted S′ axes overlaid on the S diagram.
// In a Minkowski diagram the ct′ axis tilts from ct toward x by arctan(β),
// and the x′ axis tilts from x toward ct by the same angle — both converge
// on the 45° light cone as β → 1.
function drawBoostedAxes(ctx, canvas, beta, scale) {
  const absBeta = Math.abs(beta);
  if (absBeta < 0.001) return;

  const { padL, padR, padT, padB } = graphState.axes;
  const left   = 5 * padL;
  const top    = 5 * padT;
  const [cw, ch] = getGraphCssSize(canvas);
  const plotW  = Math.max(1, cw - left - padR);
  const plotH  = Math.max(1, ch - top - padB);

  // Origin in canvas pixels (where ct=0, x=0 maps to)
  const ox = left + (-scale.ctMin / Math.max(0.0001, scale.ctMax - scale.ctMin)) * plotW;
  const oy = ch - padB - (-scale.xMin / Math.max(0.0001, scale.xMax - scale.xMin)) * plotH;

  // In the S diagram, ct is horizontal and x is vertical (up).
  // The ct′ axis (worldline of x′=0) has slope dx/d(ct) = β,
  // i.e. for each unit right in ct-pixels, it rises by β units in x-pixels.
  const ctScale = plotW / Math.max(0.0001, scale.ctMax - scale.ctMin);
  const xScale  = plotH / Math.max(0.0001, scale.xMax  - scale.xMin);

  // ct′ axis direction in canvas pixels: +1 in ct, +β in x
  const ctPrimeX =  ctScale;
  const ctPrimeY = -absBeta * xScale;  // negative because y increases downward

  // x′ axis direction in canvas pixels: +β in ct, +1 in x
  const xPrimeX =  absBeta * ctScale;
  const xPrimeY = -xScale;

  // Extend boosted S' axes (plotted in S-frame) to the edge of the plot area.
  const bounds = { left, right: left + plotW, top, bottom: ch - padB };

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;

  // ct′ axis (yellow-orange)
  ctx.strokeStyle = "rgba(255, 200, 80, 0.9)";
  const tCt = clipRayToBounds(ox, oy, ctPrimeX, ctPrimeY, bounds);
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + ctPrimeX * tCt, oy + ctPrimeY * tCt);
  ctx.stroke();
  ctx.font = "9px sans-serif";
  ctx.fillStyle = "rgba(255, 200, 80, 0.9)";
  ctx.fillText("ct\u2032", ox + ctPrimeX * tCt - 14, oy + ctPrimeY * tCt - 4);
  // x′ axis
  const tX = clipRayToBounds(ox, oy, xPrimeX, xPrimeY, bounds);
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + xPrimeX * tX, oy + xPrimeY * tX);
  ctx.stroke();
  ctx.fillText("x\u2032", ox + xPrimeX * tX + 4, oy + xPrimeY * tX + 4);

  ctx.restore();
}

function clipRayToBounds(ox, oy, dx, dy, bounds) {
  let t = 1e6;
  if (dx > 0) t = Math.min(t, (bounds.right - ox) / dx);
  if (dx < 0) t = Math.min(t, (bounds.left - ox) / dx);
  if (dy < 0) t = Math.min(t, (bounds.top - oy) / dy);
  if (dy > 0) t = Math.min(t, (bounds.bottom - oy) / dy);
  return Math.max(0, t);
}

// Draw a light cone (x = ct line) on any graph.
// Anchored at the axes corner (not data origin) so it never slides during animation.
function drawLightCone(ctx, canvas, scale, flipX) {
  const { padL, padR, padT, padB } = graphState.axes;
  const left  = 5 * padL;
  const top   = 5 * padT;
  const [cw, ch] = getGraphCssSize(canvas);
  const plotW = Math.max(1, cw - left - padR);
  const plotH = Math.max(1, ch - top - padB);
  const ctRange = Math.max(0.0001, scale.ctMax - scale.ctMin);
  const xRange  = Math.max(0.0001, scale.xMax  - scale.xMin);

  // Axes corner in canvas pixels
  const ox = left;
  const oy = flipX ? top : ch - padB;

  // Light cone direction: x = ct means equal increments in both.
  const dx =  plotW / ctRange;
  const dy = flipX ? (plotH / xRange) : -(plotH / xRange);

  // Extend to plot boundary
  const t = clipRayToBounds(ox, oy, dx, dy, {
    left,
    right: left + plotW,
    top,
    bottom: ch - padB,
  });

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.setLineDash([2, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + dx * t, oy + dy * t);
  ctx.stroke();
  ctx.font = "9px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillText("c", ox + dx * t - 8, oy + dy * t + (flipX ? 12 : -4));
  ctx.restore();
}

// Draw a worldline from an array of {x, ct} points.
// When the array exceeds maxDrawPoints, every Nth point is sampled to keep
// rendering fast.  The final point is always drawn so the line reaches "now".
function drawPolyline(ctx, canvas, points, style, scale, flipX) {
  if (!points || points.length < 2) return;
  const mapPoint = createCanvasMapper(canvas, scale, flipX);
  ctx.beginPath();
  const stride = Math.max(1, Math.ceil(points.length / graphState.maxDrawPoints)); 
  const first = mapPoint(points[0].x, points[0].ct);
  ctx.moveTo(first.x, first.y);
  for (let i = stride; i < points.length; i += stride) {
    const p = mapPoint(points[i].x, points[i].ct);
    ctx.lineTo(p.x, p.y);
  }
  const last = mapPoint(points[points.length - 1].x, points[points.length - 1].ct);
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = style;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLabel(ctx, text, x, y, color) {
  ctx.fillStyle = color;
  ctx.font = "9px sans-serif";
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Legend overlay — live readout, worldline colour key, frame label
// ---------------------------------------------------------------------------

function drawLegend(ctx, beta, gamma) {
  ctx.fillStyle = "rgba(220, 245, 255, 0.9)";
  ctx.font = "9px sans-serif";
  ctx.fillText("\u03B2=" + beta.toFixed(3) + "  \u03B3=" + gamma.toFixed(3), 10, 12);
  ctx.fillText("tEarth=" + graphState.tEarth.toFixed(2) + "  tShip=" + graphState.tRocket.toFixed(2), 10, 23);

  // Colour key swatches
  ctx.strokeStyle = "rgba(143, 221, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(10, 34); ctx.lineTo(25, 34); ctx.stroke();
  drawLabel(ctx, "Earth Worldline", 28, 37, "rgba(220, 245, 255, 0.95)");

  ctx.strokeStyle = "rgba(255, 120, 120, 0.9)";
  ctx.beginPath(); ctx.moveTo(10, 46); ctx.lineTo(25, 46); ctx.stroke();
  drawLabel(ctx, "Rocket Worldline", 28, 49, "rgba(220, 245, 255, 0.95)");
}

// ---------------------------------------------------------------------------
// Incremental piecewise Lorentz transform
//
// Converts an array of Earth-frame events [{x, ct, beta}, …] into S′
// coordinates by boosting each step individually and accumulating:
//
//   For step i:
//     Δx  = x_i  − x_{i−1}       (Earth-frame spatial step)
//     Δct = ct_i − ct_{i−1}       (Earth-frame time step)
//     Δx′  = γ_i (Δx  − β_i · Δct)
//     Δct′ = γ_i (Δct − β_i · Δx )
//     x′_i  = x′_{i−1}  + Δx′
//     ct′_i = ct′_{i−1} + Δct′
//
// Key behaviours:
//   • Rocket: Δx = β·Δct each step ⟹ Δx′ = 0,  stays at x′ ≈ 0.
//     ct′ accumulates as proper time  Δct′ = Δct/γ.
//   • Earth:  Δx = 0  ⟹  Δx′ = −γβ·Δct,  smooth diagonal at slope −β.
//   • Velocity changes produce slope changes, not backwards jumps.
//   • Turnaround (β flips sign) produces a kink, not a discontinuity.
// ---------------------------------------------------------------------------

function transformPoints(points) {
  if (points.length === 0) return [];
  const out = new Array(points.length);
  let xP = 0, ctP = 0;        // running S′ position (anchored to graph origin)
  const xPrimeDir = -1;       // keep S′ incremental x′ motion in desired screen direction

  // Anchor the first transformed event at (0,0) so Graph 2 starts at the
  // S′ axes intersection (top-left corner where the axes meet).
  out[0] = { x: 0, ct: 0 };
  let prevX = points[0].x;
  let prevCt = points[0].ct;
  for (let i = 1; i < points.length; i++) {
    const dx  = points[i].x  - prevX;   // Earth-frame spatial step
    const dct = points[i].ct - prevCt;   // Earth-frame time step
    const dp  = lorentzToPrime(dx, dct, points[i].beta);  // boost the step
    xP  += xPrimeDir * dp.x;             // Change S' position (direction-adjusted)
    ctP += dp.ct;
    out[i] = { x: xP, ct: ctP };
    prevX  = points[i].x;
    prevCt = points[i].ct;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Axis-scale computation
//
// Scans both worldline arrays to find the bounding box {xMin, xMax, ctMin, ctMax}.
// Handles negative coordinates that arise from Lorentz boosts in S′.
// estimatedCtMax optionally extends ctMax so the event vector doesn't hug
// the right edge during a run (progress-based projection from time-dilation.js).
// ---------------------------------------------------------------------------

function computeScale(earthPts, rocketPts, estimatedCtMax) {
  let xMin = 0, xMax = 0, ctMin = 0, ctMax = 0;
  for (let i = 0; i < earthPts.length; i++) {
    const p = earthPts[i];
    if (p.x  < xMin)  xMin  = p.x;
    if (p.x  > xMax)  xMax  = p.x;
    if (p.ct < ctMin) ctMin = p.ct;
    if (p.ct > ctMax) ctMax = p.ct;
  }
  for (let i = 0; i < rocketPts.length; i++) {
    const p = rocketPts[i];
    if (p.x  < xMin)  xMin  = p.x;
    if (p.x  > xMax)  xMax  = p.x;
    if (p.ct < ctMin) ctMin = p.ct;
    if (p.ct > ctMax) ctMax = p.ct;
  }
  if (estimatedCtMax > 0) ctMax = Math.max(ctMax, estimatedCtMax);
  if (xMax  - xMin  < 1) xMax  = xMin  + 1;
  if (ctMax - ctMin < 1) ctMax = ctMin + 1;
  return { xMin, xMax, ctMin, ctMax };
}

// ---------------------------------------------------------------------------
// Frame-specific rendering pipelines
// ---------------------------------------------------------------------------

// Graph 1: Earth frame S — both worldlines plotted directly from stored Earth-frame coordinates. 
function renderS(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx   = prepareGraphCanvas2D(canvas);
  const scale = graphState.sScale;
  const beta = window.speedScaleToBeta((window.motionState && window.motionState.displaySpeed) || 0);
  const gamma = window.gammaFromBeta(beta);
  drawGraphAxes(ctx, canvas, "S");
  drawBoostedAxes(ctx, canvas, beta, scale);
  drawLightCone(ctx,canvas,scale, false);
  drawPolyline(ctx, canvas, graphState.earthPoints, "rgba(143, 221, 255, 0.9)", scale, false);
  drawPolyline(ctx, canvas, graphState.rocketPoints, "rgba(255, 120, 120, 0.9)", scale, false);
  drawLegend(ctx, beta, gamma);
}

// Graph 2: Rocket comoving frame S′ — both worldlines are the incrementally Lorentz-transformed versions computed by redraw().  Origin at top-left (flipX), x′ down, ct′ right.
function renderSPrime(canvasId, earthPrime, rocketPrime) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx   = prepareGraphCanvas2D(canvas);
  const scale = graphState.spScale;
  const beta = window.speedScaleToBeta((window.motionState && window.motionState.displaySpeed) || 0);
  const gamma = window.gammaFromBeta(beta);
  drawGraphAxes(ctx, canvas, "S\u2032", true);
  drawLightCone(ctx, canvas, scale, true); 
  drawPolyline(ctx, canvas, earthPrime, "rgba(143, 221, 255, 0.9)", scale, true);
  drawPolyline(ctx, canvas, rocketPrime, "rgba(255, 120, 120, 0.9)", scale, true);
  drawLegend(ctx, beta, gamma);
}

// ---------------------------------------------------------------------------
// Unified redraw
//
// Called every frame.  Computes axis scales for both diagrams, runs the
// Lorentz transform pipeline for S′, then renders both canvases.
// ---------------------------------------------------------------------------

function redraw() {
  // S-frame scale: project ct extent from current data and progress,
  // recomputed each frame so the graph adapts as the run progresses.
  let estCtS = 0;
  const rPts = graphState.rocketPoints;
  if (rPts.length > 0 && graphState.lastProgress > 0) {
    estCtS = rPts[rPts.length - 1].ct / graphState.lastProgress;
  }
  graphState.sScale = computeScale(
    graphState.earthPoints, graphState.rocketPoints, estCtS
  );

  // Build S′ worldlines via incremental piecewise boost.
  const earthPrime  = transformPoints(graphState.earthPoints);
  const rocketPrime = transformPoints(graphState.rocketPoints);

  // Project S′ ct axis extent from progress so it doesn't auto-fit to "now".
  let estCtPrime = 0;
  if (rocketPrime.length > 0 && graphState.lastProgress > 0) {
    estCtPrime = rocketPrime[rocketPrime.length - 1].ct / graphState.lastProgress;
  }
  graphState.spScale = computeScale(earthPrime, rocketPrime, estCtPrime);

  renderS("spacetimeGraph1");
  renderSPrime("spacetimeGraph2", earthPrime, rocketPrime);
  updateMinkowskiNorms(rocketPrime);
}

// ---------------------------------------------------------------------------
// Minkowski norm display
//
// The spacetime interval (Minkowski norm) for the event vector from origin
// to the rocket's current event is:   s = √( (ct)² − x² )
// This equals the proper time along a straight (inertial) path to that event.
// Displayed beside each graph title so you can compare proper times directly.
// ---------------------------------------------------------------------------

function updateMinkowskiNorms(rocketPrime) {
  const elS  = document.getElementById("normS");
  const elSP = document.getElementById("normSPrime");
  if (!elS || !elSP) return;

  // S frame: use the last stored rocket event
  const rPts = graphState.rocketPoints;
  if (rPts.length === 0) {
    elS.textContent = "";
    elSP.textContent = "";
    return;
  }
  const lastS = rPts[rPts.length - 1];
  const s2 = lastS.ct * lastS.ct - lastS.x * lastS.x;
  const normS = Math.sqrt(Math.max(0, s2));

  // S′ frame: use the last transformed rocket event
  const lastSP = rocketPrime[rocketPrime.length - 1];
  const sp2 = lastSP.ct * lastSP.ct - lastSP.x * lastSP.x;
  const normSP = Math.sqrt(Math.max(0, sp2));

  elS.textContent  = "  \u2016s\u2016 = " + normS.toFixed(3);
  elSP.textContent = "  \u2016s\u2032\u2016 = " + normSP.toFixed(3);
}

// ---------------------------------------------------------------------------
// Per-frame update  (called from time-dilation.js animation loop)
//
// Receives a snapshot each frame:
//   { dt, isPlaying, speedScale, dirSign, xRocket, progress }
//
// When playing, it:
//   1. Computes β (signed — negative during bidirectional return leg).
//   2. Advances tEarth and tRocket (proper time = dt/γ).
//   3. Pushes new Earth-frame events with the current β attached.
//   4. Updates the progress-based ct estimate for axis scaling.
//   5. Triggers a full redraw.
// ---------------------------------------------------------------------------

function update(input) {
  if (input && typeof input.progress === "number") {
    graphState.lastProgress = Math.max(0, Math.min(1, input.progress));
  }
  if (!input || !input.isPlaying || input.dt <= 0) {
    // When paused or idle, still redraw (e.g. after resize), but don't push points.
    redraw();
    return;
  }

  // β is signed: positive outbound, negative on bidirectional return leg.
  const speed = window.speedScaleToBeta(input.speedScale);
  const beta  = speed * (input.dirSign !== undefined ? input.dirSign : 1);
  const gamma = window.gammaFromBeta(beta);

  graphState.tEarth  += input.dt;           // coordinate time advances by dt
  graphState.tRocket += input.dt / gamma;   // proper time advances by dt/γ
  const ct = graphState.c * graphState.tEarth;

  // Record Earth-frame events.  Each carries its β for the piecewise boost.
  // Earth is always at x = 0.  Rocket x is in c-normalised units (not pixels).
  graphState.earthPoints.push({ x: 0, ct, beta });
  graphState.rocketPoints.push({ x: input.xRocket, ct, beta });

  redraw();
}

// ---------------------------------------------------------------------------
// Functions exposed to time-dilation.js
// ---------------------------------------------------------------------------


window.TimeDilationGraph = {
  update,
  reset: resetGraphState,
  redraw,
  get tEarth() { return graphState.tEarth; },
  get tRocket() { return graphState.tRocket; },
};

redraw();

//END CODE.