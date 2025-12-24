import { Server } from "socket.io";
import http from "http";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = 8080;

const server = http.createServer();
const io = new Server(server, { cors: { origin: "*" } });

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
  httpOptions: { apiVersion: "v1alpha" },
});

io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  const model = "gemini-2.5-flash-native-audio-preview-12-2025";
  const config = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: {
      parts: [
        {
          text: "Bạn là trợ lý ảo Gemini. Hãy luôn giao tiếp và trả lời bằng Tiếng Việt một cách tự nhiên.",
        },
      ],
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
  const session = await ai.live.connect({
    model: model,
    config: config,
    callbacks: {
      onopen: () => console.log("Connected to Gemini Live API"),
      onmessage: (msg) => {
        // if (msg.serverContent) console.log("⚡ Gemini đã nhận data và đang phản hồi...");
        // Transcription lời user
        if (msg.serverContent?.inputTranscription?.text) {
          const userText = msg.serverContent.inputTranscription.text;
          // console.log("🧑 USER:", userText);
          socket.emit("user_transcript", userText);
        }

        // Audio output của AI + transcript
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              const audioChunk = Buffer.from(part.inlineData.data, "base64");
              socket.emit("audio", audioChunk);
            }
          }
        }
        // Transcript AI
        if (msg.serverContent?.outputTranscription?.text) {
          const aiText = msg.serverContent.outputTranscription.text;
          // console.log("🤖 AI:", aiText);
          socket.emit("ai_transcript", aiText);
        }

        // Khi lượt nói AI kết thúc
        if (msg.serverContent?.turnComplete) {
          console.log("Turn complete ✅");
        }
      },
      onerror: (err) => console.error("Gemini error:", err),
      onclose: (e) => console.log("Closed:", e.reason),
    },
  });

  socket.on("audio", (chunk) => {
    // console.log(`🎤 Đang gửi ${chunk.length} bytes lên Gemini`);
    session.sendRealtimeInput({
      audio: {
        data: Buffer.from(chunk).toString("base64"),
        mimeType: "audio/pcm;rate=16000",
      },
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    session.close?.();
  });
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
