// Web MIDI API wrapper — runs in the browser, talks to djay Pro

// Inline MIDI types so we don't depend on WebMidi namespace at build time
interface MIDIOutput {
  id: string | null;
  name: string | null;
  send(data: number[] | Uint8Array): void;
}

interface MIDIAccess {
  outputs: Map<string, MIDIOutput>;
}

export interface MidiPort {
  id: string;
  name: string;
  output: MIDIOutput;
}

class WebMidiController {
  private access: MIDIAccess | null = null;
  private output: MIDIOutput | null = null;
  private channel = 0;

  // CC mappings (match your djay Pro MIDI mapping)
  readonly CC = {
    crossfader: 1,
    volumeA: 2,
    volumeB: 3,
    eqLowA: 4,
    eqMidA: 5,
    eqHighA: 6,
    eqLowB: 7,
    eqMidB: 8,
    eqHighB: 9,
    filterA: 10,
    filterB: 11,
  };

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn("Web MIDI API not supported in this browser");
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      return true;
    } catch (err) {
      console.error("MIDI access denied:", err);
      return false;
    }
  }

  getOutputPorts(): MidiPort[] {
    if (!this.access) return [];
    const ports: MidiPort[] = [];
    this.access.outputs.forEach((output) => {
      ports.push({ id: output.id!, name: output.name || "Unknown", output });
    });
    return ports;
  }

  selectPort(portId: string): boolean {
    const ports = this.getOutputPorts();
    const port = ports.find((p) => p.id === portId);
    if (port) {
      this.output = port.output;
      return true;
    }
    return false;
  }

  // --- Low-level sends ---

  sendCC(control: number, value: number) {
    const clamped = Math.max(0, Math.min(127, Math.round(value)));
    if (this.output) {
      this.output.send([0xb0 | this.channel, control, clamped]);
    }
    console.log(`[MIDI] CC ${control} = ${clamped}`);
  }

  sendNoteOn(note: number, velocity = 127) {
    if (this.output) {
      this.output.send([0x90 | this.channel, note, velocity]);
    }
  }

  sendNoteOff(note: number) {
    if (this.output) {
      this.output.send([0x80 | this.channel, note, 0]);
    }
  }

  // --- DJ helpers ---

  setCrossfader(value: number) {
    this.sendCC(this.CC.crossfader, value);
  }

  setEQ(deck: "A" | "B", band: "low" | "mid" | "high", value: number) {
    const key = `eq${band.charAt(0).toUpperCase() + band.slice(1)}${deck}` as keyof typeof this.CC;
    this.sendCC(this.CC[key], value);
  }

  setFilter(deck: "A" | "B", value: number) {
    this.sendCC(deck === "A" ? this.CC.filterA : this.CC.filterB, value);
  }

  // --- Transition execution ---

  async executeTransition(
    style: string,
    durationS: number,
    fromDeck: "A" | "B" = "A",
    onProgress?: (t: number) => void
  ): Promise<void> {
    const steps = 32;
    const startVal = fromDeck === "A" ? 0 : 127;
    const endVal = fromDeck === "A" ? 127 : 0;
    const stepDelay = (durationS * 1000) / steps;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const xfadeVal = Math.round(startVal + (endVal - startVal) * t);

      if (style === "smooth") {
        this.setCrossfader(xfadeVal);
      } else if (style === "cut") {
        this.setCrossfader(t >= 0.5 ? endVal : startVal);
      } else if (style === "filter_sweep") {
        this.setCrossfader(xfadeVal);
        this.setFilter(fromDeck, Math.round(127 * (1 - t)));
        const toDeck = fromDeck === "A" ? "B" : "A";
        this.setFilter(toDeck, Math.round(127 * t));
      } else if (style === "echo_out") {
        this.setCrossfader(xfadeVal);
        this.setEQ(fromDeck, "high", Math.round(127 * (1 - t)));
      }

      onProgress?.(t);
      await new Promise((r) => setTimeout(r, stepDelay));
    }

    this.setCrossfader(endVal);
  }

  get isConnected(): boolean {
    return this.output !== null;
  }

  get connectedPortName(): string | null {
    return this.output?.name || null;
  }
}

// Singleton
export const midi = new WebMidiController();
