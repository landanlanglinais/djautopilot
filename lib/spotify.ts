// Server-side Spotify API client (used in API routes only)

import { TrackInfo } from "./types";
import { spotifyKeyToCamelot } from "./music-theory";

let accessToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken!;
}

async function spotifyFetch(endpoint: string): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify API error: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

export async function searchTracks(query: string, limit = 10): Promise<TrackInfo[]> {
  const data = (await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
  )) as { tracks: { items: SpotifyTrackItem[] } };

  return data.tracks.items.map((item) => ({
    trackId: item.id,
    name: item.name,
    artist: item.artists.map((a) => a.name).join(", "),
    album: item.album.name,
    durationMs: item.duration_ms,
    uri: item.uri,
  }));
}

export async function enrichTracks(tracks: TrackInfo[]): Promise<TrackInfo[]> {
  if (tracks.length === 0) return tracks;

  // Audio features endpoint may be restricted for new Spotify apps.
  // If it fails, return tracks without audio features — search still works.
  try {
    const ids = tracks.map((t) => t.trackId).join(",");
    const data = (await spotifyFetch(`/audio-features?ids=${ids}`)) as {
      audio_features: (SpotifyAudioFeatures | null)[];
    };

    for (let i = 0; i < tracks.length; i++) {
      const feat = data.audio_features[i];
      if (feat) {
        tracks[i].bpm = feat.tempo;
        tracks[i].key = feat.key;
        tracks[i].mode = feat.mode;
        tracks[i].energy = feat.energy;
        tracks[i].danceability = feat.danceability;
        tracks[i].valence = feat.valence;
        tracks[i].loudness = feat.loudness;
        tracks[i].camelot = spotifyKeyToCamelot(feat.key, feat.mode) || undefined;
      }
    }
  } catch (err) {
    console.warn("Audio features unavailable (Spotify may restrict this for new apps):", err);
    // Continue without audio features
  }

  return tracks;
}

// Spotify API response types (minimal)
interface SpotifyTrackItem {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string };
  duration_ms: number;
  uri: string;
}

interface SpotifyAudioFeatures {
  tempo: number;
  key: number;
  mode: number;
  energy: number;
  danceability: number;
  valence: number;
  loudness: number;
}
