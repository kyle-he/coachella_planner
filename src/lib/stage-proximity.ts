// Stage-to-stage walking estimates for Coachella at Empire Polo Club (Indio, CA).
//
// HOW THIS WORKS
// --------------
// 1. **Ground truth** is approximate *path distance* between stage areas (miles), not drive distance.
//    Values are calibrated to common attendee reports (e.g. main field ↔ Sahara often cited as ~12–20 min
//    depending on crowds) and typical festival maps. They are still **estimates** — real time varies with
//    crowd flow, route choice, and heat.
// 2. **Minutes** are derived from distance ÷ `FESTIVAL_WALK_MPH` (crowded festival walking pace ~2.5 mph).
//    So time and distance always stay mathematically consistent.
// 3. If a stage name is missing from the matrix, we fall back to a conservative default segment.
//
// For authoritative routing, use official festival maps when on-site.

import { type Stage } from "./coachella-data";

/** Crowded festival walking speed used to convert path miles → minutes (mph). */
export const FESTIVAL_WALK_MPH = 2.5;

/**
 * Approximate walking path length between stage areas (miles), symmetric.
 * Diagonal = same as reverse. Tune against on-site experience over time.
 */
const MILES_BETWEEN: Record<Stage, Record<Stage, number>> = {
  "Coachella Stage": {
    "Coachella Stage": 0,
    "Outdoor Theater": 0.12,
    Sonora: 0.42,
    Gobi: 0.34,
    Mojave: 0.32,
    Sahara: 0.78,
    Yuma: 0.82,
  },
  "Outdoor Theater": {
    "Coachella Stage": 0.12,
    "Outdoor Theater": 0,
    Sonora: 0.38,
    Gobi: 0.28,
    Mojave: 0.26,
    Sahara: 0.7,
    Yuma: 0.74,
  },
  Sonora: {
    "Coachella Stage": 0.42,
    "Outdoor Theater": 0.38,
    Sonora: 0,
    Gobi: 0.22,
    Mojave: 0.2,
    Sahara: 0.52,
    Yuma: 0.56,
  },
  Gobi: {
    "Coachella Stage": 0.34,
    "Outdoor Theater": 0.28,
    Sonora: 0.22,
    Gobi: 0,
    Mojave: 0.06,
    Sahara: 0.4,
    Yuma: 0.44,
  },
  Mojave: {
    "Coachella Stage": 0.32,
    "Outdoor Theater": 0.26,
    Sonora: 0.2,
    Gobi: 0.06,
    Mojave: 0,
    Sahara: 0.38,
    Yuma: 0.42,
  },
  Sahara: {
    "Coachella Stage": 0.78,
    "Outdoor Theater": 0.7,
    Sonora: 0.52,
    Gobi: 0.4,
    Mojave: 0.38,
    Sahara: 0,
    Yuma: 0.1,
  },
  Yuma: {
    "Coachella Stage": 0.82,
    "Outdoor Theater": 0.74,
    Sonora: 0.56,
    Gobi: 0.44,
    Mojave: 0.42,
    Sahara: 0.1,
    Yuma: 0,
  },
};

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
  main: ["Coachella Stage", "Outdoor Theater"] as Stage[],
  middle: ["Gobi", "Mojave", "Sonora"] as Stage[],
  far: ["Sahara", "Yuma"] as Stage[],
};
