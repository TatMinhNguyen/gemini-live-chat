import { Server } from "socket.io";
import http from "http";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import PromptText from "./prompt.js";
import { createAudioSessionFile } from "./createAudioSessionFile.js";

dotenv.config();

const PORT = 8080;

const server = http.createServer();
const io = new Server(server, { cors: { origin: "*" } });

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
  httpOptions: { apiVersion: "v1alpha" },
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  let session;
  let userAudioBuffers = [];
  let aiAudioBuffers = [];
  let silenceCount = 0;

  socket.on("start-gemini-session", async () => {
    console.log("Starting Gemini session for:", socket.id);
    if (session) {
      console.log("Session already exists.");
      return;
    }

    try {
      const model = "gemini-2.5-flash-native-audio-preview-12-2025";
      const config = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
        },
        systemInstruction: {
          parts: [
            {
              text: PromptText,
            },
          ],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };
      session = await ai.live.connect({
        model: model,
        config: config,
        callbacks: {
          onopen: () => {
            console.log("Connected to Gemini Live API");
            socket.emit("gemini-session-started");
          },
          onmessage: async (msg) => {
            if (msg.serverContent?.inputTranscription?.text) {
              const userText = msg.serverContent.inputTranscription.text;
              socket.emit("user_transcript", userText);
            }

            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const audioChunk = Buffer.from(
                    part.inlineData.data,
                    "base64"
                  );
                  aiAudioBuffers.push(audioChunk);
                  socket.emit("audio", audioChunk);
                }
              }
            }

            if (msg.serverContent?.outputTranscription?.text) {
              const aiText = msg.serverContent.outputTranscription.text;
              socket.emit("ai_transcript", aiText);
            }

            if (msg.serverContent?.turnComplete) {
              console.log("Turn complete ✅ – saving audio");

              try {
                // 🔹 Lưu audio user
                const userAudioResult = await createAudioSessionFile({
                  audioChunks: userAudioBuffers,
                  userId: socket.id, // hoặc userId thật
                  baseOutputFileName: `user_${socket.id}_${Date.now()}`,
                  clientAudioFormat: {
                    sampleRate: 16000,
                    channels: 1,
                    bitDepth: 16,
                  },
                  storageFolder: "records",
                });

                // 🔹 Lưu audio AI
                const aiAudioResult = await createAudioSessionFile({
                  audioChunks: aiAudioBuffers,
                  userId: "ai",
                  baseOutputFileName: `ai_${socket.id}_${Date.now()}`,
                  clientAudioFormat: {
                    sampleRate: 24000, // Gemini audio output
                    channels: 1,
                    bitDepth: 16,
                  },
                  storageFolder: "records",
                });

                console.log("User audio saved:", userAudioResult);
                console.log("AI audio saved:", aiAudioResult);

                // socket.emit("audio_saved", {
                //   userAudio: userAudioResult,
                //   aiAudio: aiAudioResult,
                // });
              } catch (err) {
                console.error("Error saving audio:", err);
                socket.emit("audio_save_error", "Failed to save audio");
              } finally {
                userAudioBuffers = [];
                aiAudioBuffers = [];
                silenceCount = 0;
              }
            }
          },
          onerror: (err) => console.error("Gemini error:", err),
          onclose: (e) => {
            console.log("Closed:", e.reason);
            session = null;
          },
        },
      });
    } catch (error) {
      console.error("Failed to connect to Gemini:", error);
      socket.emit("gemini-session-error", "Failed to connect to Gemini.");
    }
  });

  socket.on("stop-gemini-session", () => {
    if (session) {
      console.log("Stopping Gemini session for:", socket.id);
      session.close();
      session = null;
    }
  });

  socket.on("audio", (chunk) => {
    const bufferChunk = Buffer.from(chunk);

    // Tính toán năng lượng âm thanh (RMS) để lọc khoảng lặng
    const int16Data = new Int16Array(
      bufferChunk.buffer,
      bufferChunk.byteOffset,
      bufferChunk.length / 2
    );
    let sum = 0;
    for (let i = 0; i < int16Data.length; i++) {
      const sample = int16Data[i] / 32768.0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / int16Data.length);

    // Chỉ lưu vào buffer nếu có tiếng nói (RMS > 0.02) hoặc giữ lại một chút đuôi (silenceCount < 5)
    if (rms > 0.01) {
      silenceCount = 0;
      userAudioBuffers.push(bufferChunk);
    } else if (userAudioBuffers.length > 0 && silenceCount < 10) {
      userAudioBuffers.push(bufferChunk);
      silenceCount++;
    }

    if (session) {
      session.sendRealtimeInput({
        audio: {
          data: bufferChunk.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (session) {
      session.close?.();
      session = null;
    }
  });
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
