// 2D vector math in screen space: pixels for distance, +y points down.

export type Vec = { x: number; y: number };

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
// sqrt(x²+y²) rather than Math.hypot: hypot's overflow/underflow-safe scaling
// is needless overhead at pixel-scale coordinates, and this is the hottest
// function in the sim (called from every collision check, every frame).
export const len = (a: Vec): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
