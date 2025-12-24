import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

function App() {
  const [recording, setRecording] = useState(false);
  const [transcripts, setTranscripts] = useState([]);

  const socketRef = useRef(null);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);

  const playbackContextRef = useRef(null);
  const nextStartTimeRef = useRef(0);

  const geminiSessionActiveRef = useRef(false);

  /* ================= STOP ================= */
  const stopRecording = useCallback(() => {
    console.log("🛑 stopRecording");

    setRecording(false);
    geminiSessionActiveRef.current = false;

    socketRef.current?.emit("stop-gemini-session");

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  /* ================= SOCKET ================= */
  useEffect(() => {
    socketRef.current = io("http://localhost:8080");

    // AudioContext để PHÁT tiếng Gemini
    playbackContextRef.current = new AudioContext();

    socketRef.current.on("audio", async (chunk) => {
      const buffer = chunk instanceof ArrayBuffer ? chunk : await chunk.arrayBuffer();
      const ctx = playbackContextRef.current;
      if (!ctx) return;

      // PCM Int16 → Float32
      const int16 = new Int16Array(buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      // Gemini trả về ~24000Hz
      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      if (nextStartTimeRef.current < ctx.currentTime) {
        nextStartTimeRef.current = ctx.currentTime;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    });

    socketRef.current.on("user_transcript", (text) => {
      setTranscripts((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.sender === "User") {
          const newTranscripts = [...prev];
          newTranscripts[newTranscripts.length - 1] = { ...lastMsg, text: lastMsg.text + text };
          return newTranscripts;
        }
        return [...prev, { sender: "User", text }];
      });
    });

    socketRef.current.on("ai_transcript", (text) => {
      setTranscripts((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.sender === "Gemini") {
          const newTranscripts = [...prev];
          newTranscripts[newTranscripts.length - 1] = { ...lastMsg, text: lastMsg.text + text };
          return newTranscripts;
        }
        return [...prev, { sender: "Gemini", text }];
      });
    });

    socketRef.current.on("gemini-session-started", () => {
      console.log("✅ Gemini session started");
      geminiSessionActiveRef.current = true;
    });

    socketRef.current.on("gemini-session-error", (err) => {
      alert(err);
      stopRecording();
    });

    return () => socketRef.current.disconnect();
  }, [stopRecording]);

  /* ================= START ================= */
  const startRecording = async () => {
    console.log("🎙 startRecording");

    setRecording(true);
    socketRef.current.emit("start-gemini-session");

    try {
      // 🎤 Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // AudioContext cho GHI (16kHz – Gemini yêu cầu)
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      // 🔥 Load AudioWorklet
      await ctx.audioWorklet.addModule("/pcm-processor.js");

      const source = ctx.createMediaStreamSource(stream);

      const workletNode = new AudioWorkletNode(ctx, "pcm-processor");
      workletNodeRef.current = workletNode;

      // Nhận PCM từ worklet → gửi server
      workletNode.port.onmessage = (e) => {
        if (!geminiSessionActiveRef.current) return;
        socketRef.current.emit("audio", e.data);
      };

      source.connect(workletNode);
    } catch (err) {
      console.error("❌ startRecording error:", err);
      stopRecording();
    }
  };

  /* ================= UI ================= */
  return (
    <div style={{ padding: 20 }}>
      <h1>Gemini Voice Chat (AudioWorklet)</h1>

      <button
        onClick={() => (recording ? stopRecording() : startRecording())}
        style={{ padding: 20, fontSize: 16 }}
      >
        {recording ? "Recording..." : "Click to Talk"}
      </button>

      <div
        style={{
          marginTop: 20,
          border: "1px solid #ccc",
          padding: 10,
          height: 400,
          overflowY: "auto",
        }}
      >
        {transcripts.map((m, i) => (
          <div
            key={i}
            style={{
              textAlign: m.sender === "User" ? "right" : "left",
              color: m.sender === "User" ? "#007bff" : "#333",
              marginBottom: 8,
            }}
          >
            <b>{m.sender}:</b> {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
