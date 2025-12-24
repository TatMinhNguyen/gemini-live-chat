import { Server } from "socket.io";
import http from "http";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import PromptText from "./prompt.js";

import pkg from "wavefile";
const { WaveFile } = pkg;
import fs from "fs";

dotenv.config();

const PORT = 8080;

const server = http.createServer();
const io = new Server(server, { cors: { origin: "*" } });

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
  httpOptions: { apiVersion: "v1alpha" },
});

function saveWav(filename, pcmBuffers, sampleRate) {
  const wav = new WaveFile();
  const pcm = Buffer.concat(pcmBuffers);

  wav.fromScratch(1, sampleRate, "16", pcm);
  fs.writeFileSync(filename, wav.toBuffer());
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  let session;
  let userAudioBuffers = [];
  let aiAudioBuffers = [];

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
          onmessage: (msg) => {
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
              saveWav(
                `records/user-${Date.now()}.wav`,
                userAudioBuffers,
                16000
              );

              saveWav(`records/ai-${Date.now()}.wav`, aiAudioBuffers, 24000);

              userAudioBuffers = [];
              aiAudioBuffers = [];
              console.log("Turn complete ✅");
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
    userAudioBuffers.push(Buffer.from(chunk));
    if (session) {
      session.sendRealtimeInput({
        audio: {
          data: Buffer.from(chunk).toString("base64"),
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
