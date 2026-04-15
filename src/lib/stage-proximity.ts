// Stage-to-stage walking estimates for Coachella at Empire Polo Club (Indio, CA).
//
// HOW THIS WORKS
// --------------
// 1. Ground truth is approximate path distance between stage areas (miles), not drive distance.
// 2. Base connections were re-tuned from the official 2026 venue map plus attendee-reported walk times
//    for major legs like Main ↔ Outdoor, Gobi ↔ Mojave, and Main/Outdoor ↔ Sahara.
// 3. We model the grounds as a graph of common walking corridors, then derive a full all-stages matrix
//    with shortest paths. That keeps the data internally consistent as stages move around year to year.
//
// These are still estimates: crowd density, closed lanes, and your actual route can move the real walk a lot.

import { STAGES, type Stage } from "./coachella-data";

/** Crowded festival walking speed used to convert path miles → minutes (mph). */
export const FESTIVAL_WALK_MPH = 2.5;

type StageEdge = readonly [from: Stage, to: Stage, miles: number];

// Approximate corridor legs from the 2026 venue map.
// Calibration notes:
// - Main ↔ Outdoor is a short cross-field move (~5 min).
// - Gobi ↔ Mojave is essentially adjacent (~1-2 min).
// - Main/Outdoor ↔ Sahara is one of the longest common walks on the grounds.
const STAGE_EDGES: readonly StageEdge[] = [
  ["Coachella Stage", "Outdoor Theater", 0.12],
  ["Coachella Stage", "Sonora", 0.24],
  ["Coachella Stage", "Gobi", 0.3],
  ["Coachella Stage", "Yuma", 0.24],
  ["Outdoor Theater", "Sonora", 0.16],
  ["Outdoor Theater", "Gobi", 0.22],
  ["Outdoor Theater", "Heineken House", 0.18],
  ["Outdoor Theater", "Yuma", 0.2],
  ["Sonora", "Gobi", 0.14],
  ["Sonora", "Mojave", 0.18],
  ["Sonora", "Heineken House", 0.1],
  ["Sonora", "Yuma", 0.28],
  ["Gobi", "Mojave", 0.06],
  ["Gobi", "Heineken House", 0.1],
  ["Gobi", "Quasar", 0.22],
  ["Mojave", "Heineken House", 0.16],
  ["Mojave", "Quasar", 0.18],
  ["Quasar", "Do LaB", 0.16],
  ["Quasar", "Sahara", 0.3],
  ["Do LaB", "The Bunker", 0.07],
  ["Do LaB", "Sahara", 0.2],
  ["The Bunker", "Sahara", 0.1],
] as const;

function buildMilesBetween(): Record<Stage, Record<Stage, number>> {
  const matrix = Object.fromEntries(
    STAGES.map((from) => [
      from,
      Object.fromEntries(
        STAGES.map((to) => [to, from === to ? 0 : Number.POSITIVE_INFINITY])
      ),
    ])
  ) as Record<Stage, Record<Stage, number>>;

  for (const [from, to, miles] of STAGE_EDGES) {
    matrix[from][to] = Math.min(matrix[from][to], miles);
    matrix[to][from] = Math.min(matrix[to][from], miles);
  }

  for (const via of STAGES) {
    for (const from of STAGES) {
      for (const to of STAGES) {
        const throughVia = matrix[from][via] + matrix[via][to];
        if (throughVia < matrix[from][to]) matrix[from][to] = throughVia;
      }
    }
  }

  return matrix;
}

const MILES_BETWEEN = buildMilesBetween();

const FALLBACK_LEG_MILES = 0.35;

function milesBetween(from: Stage, to: Stage): number {
  const a = MILES_BETWEEN[from]?.[to];
  if (typeof a === "number" && !Number.isNaN(a)) return a;
  return FALLBACK_LEG_MILES;
}

/** Walking time in whole minutes, derived from path miles ÷ festival walk pace. */
export function getWalkingTime(from: Stage, to: Stage): number {
  const mi = milesBetween(from, to);
  if (mi < 0.001) return 0;
  return Math.max(1, Math.round((mi / FESTIVAL_WALK_MPH) * 60));
}

/** Approximate path distance for one leg (miles). */
export function getWalkingDistanceMiles(from: Stage, to: Stage): number {
  return milesBetween(from, to);
}

/** One-line label for a leg, e.g. "0.7 mi". */
export function formatLegDistanceMiles(miles: number): string {
  const mi = Math.max(0, miles);
  if (mi < 0.001) return "same spot";
  if (mi < 0.1) {
    const ft = Math.round(mi * 5280);
    return `${ft} ft`;
  }
  return `${mi.toFixed(2).replace(/\.?0+$/, "")} mi`;
}

/** Compact miles for summary bars. */
export function formatTotalWalkDistance(miles: number): string {
  if (miles < 0.01) return "0 mi";
  return `${miles.toFixed(2).replace(/\.?0+$/, "")} mi`;
}

// Returns a human-friendly distance label (legacy — based on minutes)
export function getDistanceLabel(minutes: number): string {
  if (minutes === 0) return "Same stage";
  if (minutes <= 3) return "Right next door";
  if (minutes <= 5) return "Short walk";
  if (minutes <= 8) return "Moderate walk";
  return "Long walk";
}

// Returns a color class based on walking time
export function getDistanceColor(minutes: number): string {
  if (minutes === 0) return "text-green-400";
  if (minutes <= 3) return "text-green-400";
  if (minutes <= 5) return "text-yellow-400";
  if (minutes <= 8) return "text-orange-400";
  return "text-red-400";
}

// Nearby stage groups for quick reference
export const STAGE_CLUSTERS = {
  main: ["Coachella Stage", "Outdoor Theater", "Yuma"] as Stage[],
  middle: ["Sonora", "Gobi", "Mojave", "Heineken House"] as Stage[],
  south: ["Quasar", "Do LaB", "The Bunker", "Sahara"] as Stage[],
};
