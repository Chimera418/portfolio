// Core simulation tunables shared across the physics modules. Constants that
// belong to one concept (rest detection, cup/rail/cannon/stage geometry, the
// win-screen sandbox) live in that concept's own file.

export const GRAVITY = 2200; // px/s²
export const RESTITUTION = 0.55; // softer bounce → less jitter, smoother settle
export const TANGENT_KEEP = 0.99; // slightly more slide for fluid motion
export const MAX_SUBSTEPS = 16; // anti-tunnelling cap (covers fast balls and a fast-dragged rail)
// Fixed simulation step. Stepping at a constant dt (rather than the variable
// frame time) makes the sim frame-rate independent AND repeatable, so the
// trajectory preview matches the real ball through every bounce. Visual
// smoothness comes from render-time interpolation between steps (see
// ball.prevPos in scene.svelte), not from a tiny step — halving this doubles
// the cost of every consumer (the sim, and both ghost-ball predictors), so
// keep it as large as the collision fidelity allows.
export const FIXED_DT = 1 / 60;

export const BALL_RADIUS = 10;
// Hard cap on simultaneous balls, used by the post-win free-play sandbox. The
// only superlinear sim cost is the O(n²) ball-ball pass, so this bounds it;
// ~150 stays smooth without spatial partitioning.
export const MAX_BALLS = 150;
