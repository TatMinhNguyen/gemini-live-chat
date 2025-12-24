import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

function App() {
  const [recording, setRecording] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const socketRef = useRef(null);
  const recordingContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const nextStartTimeRef = useRef(0);

  const geminiSessionActiveRef = useRef(false);

  const stopRecording = useCallback(() => {
    console.log("stopRecording");
    setRecording(false);
    geminiSessionActiveRef.current = false;

    if (socketRef.current?.connected) {
      socketRef.current.emit("stop-gemini-session");
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (recordingContextRef.current) {
      recordingContextRef.current.close();
      recordingContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    socketRef.current = io("http://localhost:8080");

    // Setup Web Audio API
    audioContextRef.current = new (window.AudioContext ||
      window.webkitAudioContext)();

    socketRef.current.on("audio", async (chunk) => {
      const arrayBuffer = (await chunk.arrayBuffer?.()) || chunk;

      const audioCtx = audioContextRef.current;
      if (!audioCtx) return;

      // 1. Chuyển đổi PCM Int16 (từ Gemini) sang Float32 (cho Web Audio)
      const int16Data = new Int16Array(arrayBuffer);
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }

      // 2. Tạo AudioBuffer (Gemini 2.0 thường trả về 24000Hz)
      const buffer = audioCtx.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);

      // 3. Phát âm thanh nối tiếp nhau (tránh bị chồng chéo hoặc ngắt quãng)
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);

      const currentTime = audioCtx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;
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
      console.log("Gemini session has started.");
      geminiSessionActiveRef.current = true;
    });

    socketRef.current.on("gemini-session-error", (error) => {
      console.error("Gemini session error:", error);
      alert(error);
      stopRecording();
    });

    return () => socketRef.current.disconnect();
  }, [stopRecording]);

  const startRecording = async () => {
    console.log("startRecording");
    setRecording(true);
    socketRef.current.emit("start-gemini-session");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Khởi tạo AudioContext với sampleRate 16000Hz (chuẩn của Gemini)
      const context = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      recordingContextRef.current = context;

      const source = context.createMediaStreamSource(stream);
      // Sử dụng ScriptProcessor để lấy dữ liệu raw
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!geminiSessionActiveRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Tính toán âm lượng trung bình (RMS) để debug
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        if (rms > 0.01) {
          console.log("🔊 Volume:", rms.toFixed(4));
        }

        // Chuyển đổi Float32 (Web Audio) sang Int16 (PCM)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        socketRef.current.emit("audio", pcmData.buffer);
      };

      source.connect(processor);
      processor.connect(context.destination);
    } catch (err) {
      console.error("Lỗi khởi tạo ghi âm:", err);
      stopRecording();
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Push-to-Talk Voice Chat with Gemini</h1>
      <button
        onClick={() => {
          if (recording) {
            stopRecording();
          } else {
            startRecording();
          }
        }}
        style={{ padding: "20px", fontSize: "16px" }}
      >
        {recording ? "Recording..." : "Click to Talk"}
      </button>

      <div style={{ marginTop: "20px", border: "1px solid #ccc", padding: "10px", height: "400px", overflowY: "auto" }}>
        {transcripts.map((msg, index) => (
          <div
            key={index}
            style={{
              textAlign: msg.sender === "User" ? "right" : "left",
              marginBottom: "10px",
              color: msg.sender === "User" ? "#007bff" : "#333",
            }}
          >
            <strong>{msg.sender}:</strong> {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
