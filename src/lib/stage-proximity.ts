// Stage proximity map for Coachella 2026 at Empire Polo Club
// Distances are approximate walking times in minutes between stages
// Based on the actual festival ground layout

import { type Stage } from "./coachella-data";

// Walking time in minutes between stages (symmetric)
const DISTANCE_MATRIX: Record<Stage, Record<Stage, number>> = {
  "Coachella Stage": {
    "Coachella Stage": 0,
    "Outdoor Theater": 3,
    Sonora: 8,
    Gobi: 5,
    Mojave: 5,
    Sahara: 10,
    Yuma: 12,
  },
  "Outdoor Theater": {
    "Coachella Stage": 3,
    "Outdoor Theater": 0,
    Sonora: 7,
    Gobi: 4,
    Mojave: 4,
    Sahara: 8,
    Yuma: 10,
  },
  Sonora: {
    "Coachella Stage": 8,
    "Outdoor Theater": 7,
    Sonora: 0,
    Gobi: 5,
    Mojave: 5,
    Sahara: 6,
    Yuma: 7,
  },
  Gobi: {
    "Coachella Stage": 5,
    "Outdoor Theater": 4,
    Sonora: 5,
    Gobi: 0,
    Mojave: 2,
    Sahara: 6,
    Yuma: 8,
  },
  Mojave: {
    "Coachella Stage": 5,
    "Outdoor Theater": 4,
    Sonora: 5,
    Gobi: 2,
    Mojave: 0,
    Sahara: 5,
    Yuma: 7,
  },
  Sahara: {
    "Coachella Stage": 10,
    "Outdoor Theater": 8,
    Sonora: 6,
    Gobi: 6,
    Mojave: 5,
    Sahara: 0,
    Yuma: 4,
  },
  Yuma: {
    "Coachella Stage": 12,
    "Outdoor Theater": 10,
    Sonora: 7,
    Gobi: 8,
    Mojave: 7,
    Sahara: 4,
    Yuma: 0,
  },
};

export function getWalkingTime(from: Stage, to: Stage): number {
  return DISTANCE_MATRIX[from]?.[to] ?? 10;
}

// Returns a human-friendly distance label
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
