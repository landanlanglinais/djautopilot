// Shared types for DJ Autopilot

export interface TrackInfo {
  trackId: string;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
  uri: string;
  // Audio features (populated after enrich)
  bpm?: number;
  key?: number;       // Spotify pitch-class 0=C … 11=B
  mode?: number;      // 0=minor, 1=major
  energy?: number;    // 0.0–1.0
  danceability?: number;
  valence?: number;
  loudness?: number;
  camelot?: string;   // e.g. "8B"
}

export interface TransitionScore {
  overall: number;
  bpmScore: number;
  keyScore: number;
  energyDelta: number;
  quality: "perfect" | "good" | "acceptable" | "risky";
  camelotA?: string;
  camelotB?: string;
  notes: string;
}

export interface DeckState {
  track: TrackInfo | null;
  isPlaying: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface TransitionPlan {
  style: "smooth" | "cut" | "filter_sweep" | "echo_out";
  durationS: number;
  steps: number;
}
