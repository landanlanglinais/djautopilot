"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { midi, MidiPort } from "@/lib/midi";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface DeckInfo {
  name: string;
  artist: string;
  bpm: number;
  camelot: string;
  energy: number;
  uri: string;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [midiPorts, setMidiPorts] = useState<MidiPort[]>([]);
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiPortName, setMidiPortName] = useState<string | null>(null);
  const [transitionProgress, setTransitionProgress] = useState<number | null>(null);
  const [deckA, setDeckA] = useState<DeckInfo | null>(null);
  const [deckB, setDeckB] = useState<DeckInfo | null>(null);
  const [activeDeck, setActiveDeck] = useState<"A" | "B">("A");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<unknown[]>([]);

  // Init Web MIDI on mount
  useEffect(() => {
    midi.init().then((ok) => {
      if (ok) {
        setMidiPorts(midi.getOutputPorts());
      }
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const connectMidi = (portId: string) => {
    const success = midi.selectPort(portId);
    setMidiConnected(success);
    setMidiPortName(midi.connectedPortName);
  };

  const handleMidiActions = useCallback(
    async (actions: Record<string, unknown>[]) => {
      for (const action of actions) {
        if (action.action === "transition") {
          // Update deck state
          const newTrack: DeckInfo = {
            name: action.trackName as string,
            artist: action.trackArtist as string,
            bpm: 0,
            camelot: "?",
            energy: 0,
            uri: action.trackUri as string,
          };
          const toDeck = activeDeck === "A" ? "B" : "A";
          if (toDeck === "A") setDeckA(newTrack);
          else setDeckB(newTrack);

          setTransitionProgress(0);
          await midi.executeTransition(
            action.style as string,
            action.durationS as number,
            activeDeck,
            (t) => setTransitionProgress(t)
          );
          setTransitionProgress(null);
          setActiveDeck(toDeck);
        } else if (action.action === "midi_eq") {
          midi.setEQ(action.deck as "A" | "B", action.band as "low" | "mid" | "high", action.value as number);
        }
      }
    },
    [activeDeck]
  );

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const deckState: Record<string, DeckInfo | null> = { A: deckA, B: deckB };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          deckState,
          history: historyRef.current,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${data.error}` }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
        historyRef.current = data.history || [];
        if (data.midiActions?.length) {
          await handleMidiActions(data.midiActions);
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Connection error: ${err}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight">DJ Autopilot</h1>
        </div>
        {/* MIDI status */}
        <div className="flex items-center gap-3 text-sm">
          {midiConnected ? (
            <span className="text-emerald-400">MIDI: {midiPortName}</span>
          ) : midiPorts.length > 0 ? (
            <select
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
              defaultValue=""
              onChange={(e) => connectMidi(e.target.value)}
            >
              <option value="" disabled>
                Connect MIDI...
              </option>
              {midiPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-zinc-500">No MIDI ports</span>
          )}
        </div>
      </header>

      {/* Deck displays */}
      <div className="grid grid-cols-2 gap-4 px-6 py-4 border-b border-zinc-800">
        {(["A", "B"] as const).map((id) => {
          const deck = id === "A" ? deckA : deckB;
          const isActive = activeDeck === id;
          return (
            <div
              key={id}
              className={`rounded-lg p-4 ${
                isActive ? "bg-zinc-800 ring-1 ring-purple-500/50" : "bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-400">DECK {id}</span>
                {isActive && (
                  <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                    LIVE
                  </span>
                )}
              </div>
              {deck ? (
                <>
                  <p className="font-semibold truncate">{deck.name}</p>
                  <p className="text-sm text-zinc-400 truncate">{deck.artist}</p>
                  <div className="flex gap-3 mt-2 text-xs text-zinc-500">
                    {deck.bpm > 0 && <span>{deck.bpm} BPM</span>}
                    {deck.camelot !== "?" && <span>{deck.camelot}</span>}
                    {deck.energy > 0 && <span>E: {(deck.energy * 100).toFixed(0)}%</span>}
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-600 italic">Empty</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Transition progress bar */}
      {transitionProgress !== null && (
        <div className="px-6 py-2">
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-bar rounded-full"
              style={{ width: `${transitionProgress * 100}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-1">Transitioning... {(transitionProgress * 100).toFixed(0)}%</p>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 mt-20 space-y-2">
            <p className="text-lg">Type a command to get started</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {[
                "Find me something funky around 124 BPM",
                "Transition into something more energetic",
                "Search for deep house tracks",
                "Cut the bass on deck A",
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => setInput(example)}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-full text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-purple-600 text-white"
                  : "bg-zinc-800 text-zinc-200"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-zinc-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex gap-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell the autopilot what to do..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 placeholder-zinc-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
