"use strict";

// ---------------------------------------------------------------------------
// time-dilation.js
// Main runtime controller for:
// 1) rocket motion state + animation loop,
// 2) control-panel interactions,
// 3) passing per-frame snapshots to the graph module.
// ---------------------------------------------------------------------------

//------------------------------------------------------
// SECTION 1: DOM Handles, Helpers, and State
//------------------------------------------------------
const navbar = document.getElementById("navbar");
const rocketShip = document.getElementById("rocketShip");
const rocketTrack = document.getElementById("rocketTrack");
const speedSlider = document.getElementById("speed");
const pathLengthText = document.getElementById("pathLengthText"); 
const PX_PER_C = 140; // pixels travelled per second at 1.0c
const PX_PER_C_BI = 140 * 2; // pixels travelled per second at 1.0c for bidirectional mode
const ROSE_DEATH_SLOWDOWN = 9.5; // slowdown factor for the rose death animation

const motionState = {
  // How speed approaches target: snap ("instant") or lerp ("linear").
  accelMode: "linear",
  targetSpeed: 0,
  displaySpeed: 0,
  pathMode: "uni",
  biReturning: false,
  posPx: 0,
  lastTs: 0,
};

window.motionState = motionState; // Exposes motionState to the time-dilation-graph.js module

// Playback state for a single run (one-way or out-and-back).
let isPlaying = false;
let roundComplete = false;
const roseState = {
  earthSeconds: 0,
  rocketProperSeconds: 0,
};
const roseAnimations = new WeakMap();

window.addEventListener("load", () => {
  const modal = document.getElementById("welcome-modal");
  if (!modal) return;
  modal.removeAttribute("hidden");
});
function closeWelcomeModal() {
  const modal = document.getElementById("welcome-modal");
  if (modal) modal.setAttribute("hidden", "");
}
document.getElementById("welcome-modal-close")?.addEventListener("click", closeWelcomeModal);

function openNav() {
  navbar.style.width = "250px";
}

function closeNav() {
  navbar.style.width = "0";
}

//------------------------------------------------------
// SECTION 2: Control Panel Handlers + Logic
//------------------------------------------------------

function acceleration(_event, mode) {
  motionState.accelMode = mode === "instant" ? "instant" : "linear";
  updatePathLengthLabel();
  syncButtonsPressed(".accel-row .accel-btn", "data-mode", motionState.accelMode);
}

/** Generic `aria-pressed` sync for button groups keyed by a data attribute. */
function syncButtonsPressed(selector, keyAttr, activeValue) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute(keyAttr) === activeValue ? "true" : "false");
  });
}

function syncSpeedFromSlider() {
  // Slider is the target; actual speed may lag in linear mode.
  motionState.targetSpeed = speedSlider.valueAsNumber; 
}

function updatePathLengthLabel() {
  if (!pathLengthText) return;
  pathLengthText.textContent = motionState.pathMode === "uni" ? "2 light-years" : "1 light-year";
}

function setPlayButtonLabel(playing) {
  const btn = document.querySelector(".play-pause-btn");
  if (!btn) return;
  btn.textContent = playing ? "Pause" : "Start";
}

function resetRoundMotion() {
  // Reset only trajectory-related state; keep selected mode/settings.
  motionState.posPx = 0;
  motionState.biReturning = false;
  motionState.lastTs = 0;
  roundComplete = false;
  roseState.earthSeconds = 0;
  roseState.rocketProperSeconds = 0;
  scrubRose(document.getElementById("earthRose"), 0);
  scrubRose(document.getElementById("rocketRose"), 0);
}

/** Velocity sign for bi mode: outbound +1, return −1; uni always +1. */
function motionDirSign() {
  return motionState.pathMode === "bi" && motionState.biReturning ? -1 : 1;
}

function bindPathButtons() {
  document.querySelectorAll(".path-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      motionState.pathMode = btn.getAttribute("data-path");
      syncButtonsPressed(".path-btn", "data-path", motionState.pathMode);
      updatePathLengthLabel();
      resetRoundMotion(); //Resets motion and graph state when any path mode is changed
      isPlaying = false;
      setPlayButtonLabel(false);
      // Graph run is tied to motion run; reset both together.
      if (window.TimeDilationGraph) window.TimeDilationGraph.reset();
    });
  });
}

//------------------------------------------------------
// SECTION 3: Motion Calculations and Animation Loop
//------------------------------------------------------

function maxTravelPx() {
  if (!rocketTrack || !rocketShip) return 0;
  const tw = rocketTrack.clientWidth;
  const rw = rocketShip.getBoundingClientRect().width;
  return Math.max(0, tw - rw * 1.3641);
}


function runProgress(maxX) {
  if (motionState.pathMode === "bi") { // Bidirectional run maps to 0..1 over out-and-back.
    if (!motionState.biReturning) { // Outbound leg occupies first half of normalized progress.
      return Math.min(1, Math.max(0, 0.5 * (motionState.posPx / maxX))); // Clamp to [0,1].
    }
    return Math.min(1, Math.max(0, 0.5 + 0.5 * ((maxX - motionState.posPx) / maxX))); // Return leg fills second half.
  }
  return Math.min(1, Math.max(0, motionState.posPx / maxX)); // Unidirectional progress is simply x/maxX.
}

function playPause() {
  // Toggle play state. If a run already finished, start from origin again.
  if (isPlaying) {
    isPlaying = false;
    setPlayButtonLabel(false);
    return;
  }

  const maxX = maxTravelPx(); 
  const atFarEndUni = motionState.pathMode === "uni" && motionState.posPx >= maxX - 0.5; //
  if (roundComplete || atFarEndUni) {
    // Starting a new run after completion should start from origin.
    resetRoundMotion();
    if (window.TimeDilationGraph) window.TimeDilationGraph.reset();
  }

  isPlaying = true;
  motionState.lastTs = 0;
  setPlayButtonLabel(true);
}

function reset() {
  // Hard reset of motion + display + graph history. 
  resetRoundMotion();
  motionState.displaySpeed = 0;
  speedSlider.value = "0";
  motionState.targetSpeed = 0;
  isPlaying = false;
  setPlayButtonLabel(false);
  if (window.TimeDilationGraph) window.TimeDilationGraph.reset();
}


function getRoseAnimations(theRoseItself) {
  if (!theRoseItself) return [];
  if (roseAnimations.has(theRoseItself)) return roseAnimations.get(theRoseItself);
  const targets = theRoseItself.querySelectorAll(
    ".rose-stem, .rose-leaf, .rose-petal, .rose-fallen-petal, .rose-center"
  );
  const list = [];
  for (let i = 0; i < targets.length; i++) {
    const anims = targets[i].getAnimations();
    for (let j = 0; j < anims.length; j++) {
      anims[j].pause();
      anims[j].currentTime = 0;
      list.push(anims[j]);
    }
  }
  roseAnimations.set(theRoseItself, list);
  return list;
}
// Scrub all paused CSS wilting animations on a rose element to a given
// progress (0 = fresh, 1 = fully wilted).
function scrubRose(theRoseItself, progress) {
  if (!theRoseItself) return;
  const p = Math.max(0, Math.min(1, progress));
  const t = p * 1000; // 1000ms = 1s
  const anims = getRoseAnimations(theRoseItself);
  for (let i = 0; i < anims.length; i++) {
    anims[i].currentTime = t;
  }
}

function autoRoseDeathSeconds() {
  const pxPerC = motionState.pathMode === "bi" ? PX_PER_C_BI : PX_PER_C;
  const baselineSecondsAtOneC = (2 * pxPerC) / Math.max(1,PX_PER_C);
  return ROSE_DEATH_SLOWDOWN * baselineSecondsAtOneC;
}
function speedScaleToBeta(speedScale) {
  return Math.max(0, speedScale / 10);
}
function gammaFromBeta(beta) {
  const b = Math.min(Math.abs(beta), 0.99999);
  return 1 / Math.sqrt(1 - b * b);
}
window.gammaFromBeta = gammaFromBeta;
window.speedScaleToBeta = speedScaleToBeta;
function tick(ts) {
  // Single source-of-truth animation loop (requestAnimationFrame cadence).
  if (!rocketShip || !rocketTrack) {
    motionState.lastTs = ts;
    requestAnimationFrame(tick);
    return;
  }

  // dt = elapsed seconds since previous frame.
  const dt = motionState.lastTs ? (ts - motionState.lastTs) / 1000 : 0;
  motionState.lastTs = ts;

  const target = motionState.targetSpeed;
  if (motionState.accelMode === "instant") {
    motionState.displaySpeed = target;
  } else {
    // Smooth acceleration/deceleration toward target speed.
    const k = Math.min(1, dt * 3.5);
    motionState.displaySpeed += (target - motionState.displaySpeed) * k;
  }

  const maxX = maxTravelPx(); // Called again to prevent stale value being used.
  // Convert slider scale (0..10) into pixels/second for stage motion.
  const betaMagnitude = speedScaleToBeta(motionState.displaySpeed);
  const v = betaMagnitude * PX_PER_C;
  const signedBeta = betaMagnitude * motionDirSign();
  const gamma = gammaFromBeta(signedBeta);

  if (isPlaying && dt > 0 && maxX > 0) {
    roseState.earthSeconds += dt;
    roseState.rocketProperSeconds += dt / gamma;
    if (motionState.pathMode === "bi") {
      // Bidirectional: travel out, bounce, then return to origin.
      motionState.posPx += v * motionDirSign() * dt;
      if (!motionState.biReturning) {
        if (motionState.posPx >= maxX) {
          motionState.posPx = maxX;
          motionState.biReturning = true;
        }
      } else if (motionState.posPx <= 0) {
        motionState.posPx = 0;
        motionState.biReturning = false;
        isPlaying = false;
        roundComplete = true;
        setPlayButtonLabel(false);
      }
    } else {
      // Unidirectional: move right once and stop at far edge.
      motionState.posPx += v * dt;
      if (motionState.posPx >= maxX) {
        motionState.posPx = maxX;
        isPlaying = false;
        roundComplete = true;
        setPlayButtonLabel(false);
      }
    }
  }

  const x = Math.min(maxX, Math.max(0, motionState.posPx));
  const flip = motionState.pathMode === "bi" && motionState.biReturning;
  rocketShip.style.transform = flip
    ? `translateY(-50%) translateX(${x}px) scaleX(-1)`
    : `translateY(-50%) translateX(${x}px)`;

  if (window.TimeDilationGraph) {
    // Push a minimal snapshot; graph module owns plotting/history logic.
    window.TimeDilationGraph.update({
      dt,
      isPlaying,
      speedScale: motionState.displaySpeed,
      dirSign: motionDirSign(),
      xRocket: motionState.posPx / PX_PER_C,
      progress: runProgress(maxX),
      runComplete: roundComplete,
    });

  }
  // Roses use motion-owned timing (Earth coordinate time vs rocket proper time).
  const deathSeconds = Math.max(0.001, autoRoseDeathSeconds());
  scrubRose(document.getElementById("earthRose"),  Math.min(1, roseState.earthSeconds / deathSeconds));
  scrubRose(document.getElementById("rocketRose"), Math.min(1, roseState.rocketProperSeconds / deathSeconds));

  requestAnimationFrame(tick);
}

//------------------------------------------------------
// SECTION 4: Event Handlers and Initialization
//------------------------------------------------------

function bindScrollHint() { 
  const btn = document.getElementById("scrollToExplanation");
  const target = document.getElementById("explanation");
  if (!btn || !target) return;
  btn.addEventListener("click", () => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  });
}

function bindPrimaryControls() {
  const openBtn = document.querySelector(".openbtn");
  const closeBtn = document.querySelector(".closebtn");
  const playBtn = document.querySelector(".play-pause-btn");
  const resetBtn = document.querySelector(".reset-btn");
  if (openBtn) openBtn.addEventListener("click", openNav);
  if (closeBtn) closeBtn.addEventListener("click", closeNav);
  if (playBtn) playBtn.addEventListener("click", playPause);
  if (resetBtn) resetBtn.addEventListener("click", reset);
}

const EXPLANATION_AUDIENCE = {
  beginner:
    "For readers at about average high school / H2 physics: intuitive frames and clocks; γ is named when you move up a level.",
  intermediate:
    "For readers at about entry undergrad / H3 (or strong H2): intervals, γ and β, twin geometry, and how to read Graph 1 vs S′ in this sim.",
  advanced:
    "For readers at about late undergrad / early graduate level: charts as maps, metric, rapidity, and why piecewise S′ needs the intermediate caveat.",
};

function bindExplanationDifficulty() {
  const section = document.getElementById("explanation");
  const select = document.getElementById("difficulty-level");
  const hint = document.getElementById("difficulty-audience-hint");
  if (!section || !select || !hint) return;

  function applyLevel(level) {
    const panels = section.querySelectorAll(".explanation-panel");
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const match = panel.getAttribute("data-level") === level;
      if (match) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    }
    section.setAttribute("data-explanation-level", level);
    hint.textContent = EXPLANATION_AUDIENCE[level] || "";
  }

  select.addEventListener("change", () => applyLevel(select.value));
  applyLevel(select.value);
}

// Keep slider target synced in real time and on commit.
speedSlider.addEventListener("input", syncSpeedFromSlider);
speedSlider.addEventListener("change", syncSpeedFromSlider);

//------------------------------------------------------
// SECTION 5: Initialization and Event Binding
//------------------------------------------------------
bindPathButtons();
bindPrimaryControls();
syncButtonsPressed(".accel-row .accel-btn", "data-mode", motionState.accelMode);
syncSpeedFromSlider();
updatePathLengthLabel();
bindScrollHint();
bindExplanationDifficulty();
window.addEventListener('resize', () => {
  if (window.TimeDilationGraph) window.TimeDilationGraph.redraw();
});
// Boot the animation loop once all handlers are attached and initialized.
requestAnimationFrame(tick);
