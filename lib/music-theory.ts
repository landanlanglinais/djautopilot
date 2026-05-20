// Camelot wheel, key compatibility, BPM matching, transition scoring

import { TrackInfo, TransitionScore } from "./types";

// Spotify key (pitch-class) + mode → Camelot code
const CAMELOT_MAP: Record<string, string> = {
  // Major (B column)
  "0-1": "8B",  "1-1": "3B",  "2-1": "10B", "3-1": "5B",
  "4-1": "12B", "5-1": "7B",  "6-1": "2B",  "7-1": "9B",
  "8-1": "4B",  "9-1": "11B", "10-1": "6B", "11-1": "1B",
  // Minor (A column)
  "0-0": "5A",  "1-0": "12A", "2-0": "7A",  "3-0": "2A",
  "4-0": "9A",  "5-0": "4A",  "6-0": "11A", "7-0": "6A",
  "8-0": "1A",  "9-0": "8A",  "10-0": "3A", "11-0": "10A",
};

export function spotifyKeyToCamelot(key: number, mode: number): string | null {
  return CAMELOT_MAP[`${key}-${mode}`] || null;
}

function parseCamelot(code: string): { number: number; letter: string } {
  const letter = code.slice(-1);
  const number = parseInt(code.slice(0, -1), 10);
  return { number, letter };
}

export function camelotCompatible(codeA: string, codeB: string): boolean {
  const a = parseCamelot(codeA);
  const b = parseCamelot(codeB);

  // Same code
  if (codeA === codeB) return true;
  // Adjacent on wheel (same column), wraps 12→1
  if (a.letter === b.letter && (Math.abs(a.number - b.number) === 1 || Math.abs(a.number - b.number) === 11))
    return true;
  // Relative major/minor
  if (a.number === b.number && a.letter !== b.letter) return true;

  return false;
}

function bpmDistance(bpmA: number, bpmB: number): number {
  if (bpmA <= 0 || bpmB <= 0) return 1.0;
  const ratio = bpmA / bpmB;
  const candidates = [ratio, ratio * 2, ratio / 2];
  const best = candidates.reduce((prev, curr) =>
    Math.abs(curr - 1.0) < Math.abs(prev - 1.0) ? curr : prev
  );
  return Math.abs(best - 1.0);
}

export function scoreTransition(trackA: TrackInfo, trackB: TrackInfo): TransitionScore {
  // BPM
  const bpmDist = bpmDistance(trackA.bpm || 0, trackB.bpm || 0);
  const bpmScore = Math.max(0, 1.0 - bpmDist * 10);

  // Key / Camelot
  const camA = trackA.key != null ? spotifyKeyToCamelot(trackA.key, trackA.mode || 0) : null;
  const camB = trackB.key != null ? spotifyKeyToCamelot(trackB.key, trackB.mode || 0) : null;
  let keyScore = 0.5;
  if (camA && camB) {
    keyScore = camelotCompatible(camA, camB) ? 1.0 : 0.3;
  }

  // Energy
  const energyA = trackA.energy ?? 0.5;
  const energyB = trackB.energy ?? 0.5;
  const energyDelta = energyB - energyA;

  // Overall weighted score
  const overall = bpmScore * 0.45 + keyScore * 0.40 + (1.0 - Math.abs(energyDelta)) * 0.15;

  let quality: TransitionScore["quality"];
  if (overall >= 0.85) quality = "perfect";
  else if (overall >= 0.65) quality = "good";
  else if (overall >= 0.45) quality = "acceptable";
  else quality = "risky";

  const notesParts: string[] = [];
  if (bpmScore < 0.5) notesParts.push(`BPM gap: ${Math.round(trackA.bpm || 0)}→${Math.round(trackB.bpm || 0)}`);
  if (keyScore < 0.5) notesParts.push(`key clash: ${camA}→${camB}`);

  return {
    overall: Math.round(overall * 1000) / 1000,
    bpmScore: Math.round(bpmScore * 1000) / 1000,
    keyScore: Math.round(keyScore * 1000) / 1000,
    energyDelta: Math.round(energyDelta * 1000) / 1000,
    quality,
    camelotA: camA || undefined,
    camelotB: camB || undefined,
    notes: notesParts.join("; "),
  };
}

export function rankCandidates(
  current: TrackInfo,
  candidates: TrackInfo[],
  minQuality: TransitionScore["quality"] = "acceptable"
): { track: TrackInfo; score: TransitionScore }[] {
  const qualityOrder = { perfect: 4, good: 3, acceptable: 2, risky: 1 };
  const threshold = qualityOrder[minQuality];

  const scored = candidates
    .map((track) => ({ track, score: scoreTransition(current, track) }))
    .filter((item) => qualityOrder[item.score.quality] >= threshold)
    .sort((a, b) => b.score.overall - a.score.overall);

  return scored;
}
