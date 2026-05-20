// POST /api/chat — Claude brain with DJ tool use

import Anthropic from "@anthropic-ai/sdk";
import { searchTracks, enrichTracks } from "@/lib/spotify";
import { rankCandidates, spotifyKeyToCamelot } from "@/lib/music-theory";
import { TrackInfo } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const DJ_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_tracks",
    description:
      "Search Spotify for tracks matching a query. Use when the DJ wants to find new music by genre, mood, artist, or vibe.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Spotify search query" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_transition",
    description:
      "Find the best next track to transition into from the currently playing track, scored by BPM, key (Camelot wheel), and energy.",
    input_schema: {
      type: "object" as const,
      properties: {
        mood: {
          type: "string",
          description: "Desired direction: more_energetic, chill_down, same_vibe, darker, uplifting",
        },
        genre_hint: { type: "string", description: "Optional genre/style hint" },
      },
      required: ["mood"],
    },
  },
  {
    name: "execute_transition",
    description: "Execute a crossfade transition to a track. Returns MIDI instructions for the client.",
    input_schema: {
      type: "object" as const,
      properties: {
        track_uri: { type: "string", description: "Spotify URI of the incoming track" },
        track_name: { type: "string", description: "Track name for display" },
        track_artist: { type: "string", description: "Artist name for display" },
        style: {
          type: "string",
          enum: ["smooth", "cut", "filter_sweep", "echo_out"],
          description: "Transition style",
        },
        duration_s: { type: "number", description: "Duration in seconds (default 8)" },
      },
      required: ["track_uri", "track_name", "track_artist"],
    },
  },
  {
    name: "set_eq",
    description: "Adjust EQ on a deck. Values 0–127, 64 is noon/flat.",
    input_schema: {
      type: "object" as const,
      properties: {
        deck: { type: "string", enum: ["A", "B"] },
        band: { type: "string", enum: ["low", "mid", "high"] },
        value: { type: "number", minimum: 0, maximum: 127 },
      },
      required: ["deck", "band", "value"],
    },
  },
];

const SYSTEM_PROMPT = `You are an AI DJ assistant in DJ Autopilot, a live performance tool.
You interpret natural language and execute actions through tools.

Rules:
- When asked to transition, use find_transition first to score candidates, then execute_transition with the best match.
- Prioritise harmonic mixing: Camelot-compatible keys, then BPM proximity.
- For energy shifts, adjust gradually.
- Translate vague requests ("something funky") into concrete search queries.
- Be concise — the DJ is performing live.
- Warn about risky transitions (key clash, BPM gap).`;

interface RequestBody {
  message: string;
  deckState: Record<string, unknown>;
  history?: Anthropic.MessageParam[];
}

async function handleTool(
  name: string,
  args: Record<string, unknown>,
  deckState: Record<string, unknown>
): Promise<unknown> {
  if (name === "search_tracks") {
    const tracks = await searchTracks(args.query as string, (args.limit as number) || 5);
    const enriched = await enrichTracks(tracks);
    return enriched.map((t) => ({
      name: t.name,
      artist: t.artist,
      bpm: t.bpm ? Math.round(t.bpm) : null,
      camelot: t.camelot,
      energy: t.energy,
      uri: t.uri,
    }));
  }

  if (name === "find_transition") {
    const currentDeck = deckState.A || deckState.B;
    if (!currentDeck) return { error: "No track currently playing." };

    const mood = args.mood as string;
    const genre = (args.genre_hint as string) || "";
    const moodQueries: Record<string, string> = {
      more_energetic: "energetic upbeat",
      chill_down: "chill downtempo mellow",
      same_vibe: "",
      darker: "dark underground",
      uplifting: "uplifting euphoric",
    };
    const query = [moodQueries[mood] || mood, genre].filter(Boolean).join(" ") || "popular";

    const candidates = await searchTracks(query, 15);
    const enriched = await enrichTracks(candidates);
    const current = currentDeck as unknown as TrackInfo;
    const ranked = rankCandidates(current, enriched);

    return ranked.slice(0, 5).map(({ track, score }) => ({
      name: track.name,
      artist: track.artist,
      bpm: track.bpm ? Math.round(track.bpm) : null,
      camelot: score.camelotB,
      energy: track.energy,
      uri: track.uri,
      transition_score: score.overall,
      quality: score.quality,
      energy_delta: score.energyDelta,
      notes: score.notes,
    }));
  }

  if (name === "execute_transition") {
    // Return the transition plan — the client will execute it via Web MIDI
    return {
      action: "transition",
      trackUri: args.track_uri,
      trackName: args.track_name,
      trackArtist: args.track_artist,
      style: args.style || "smooth",
      durationS: args.duration_s || 8,
    };
  }

  if (name === "set_eq") {
    return {
      action: "midi_eq",
      deck: args.deck,
      band: args.band,
      value: args.value,
    };
  }

  return { error: `Unknown tool: ${name}` };
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();
    const { message, deckState, history = [] } = body;

    // Build context
    const contextLines = ["## Current deck state"];
    for (const deckId of ["A", "B"]) {
      const info = deckState[deckId] as Record<string, unknown> | null;
      if (info) {
        contextLines.push(
          `Deck ${deckId}: ${info.name} by ${info.artist} | BPM ${info.bpm} | Key ${info.camelot} | Energy ${info.energy}`
        );
      } else {
        contextLines.push(`Deck ${deckId}: empty`);
      }
    }

    const fullMessage = contextLines.join("\n") + "\n\n" + message;
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user", content: fullMessage },
    ];

    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: DJ_TOOLS,
      messages,
    });

    // Collect any MIDI actions to send back to the client
    const midiActions: unknown[] = [];

    // Agentic tool loop
    while (response.stop_reason === "tool_use") {
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolBlocks) {
        const result = await handleTool(block.name, block.input, deckState);
        // If it's a MIDI action, collect it
        if (result && typeof result === "object" && "action" in (result as Record<string, unknown>)) {
          midiActions.push(result);
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: DJ_TOOLS,
        messages,
      });
    }

    // Extract final text
    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);

    return NextResponse.json({
      reply: textParts.join("\n"),
      midiActions,
      history: messages.concat([{ role: "assistant", content: response.content }]),
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
