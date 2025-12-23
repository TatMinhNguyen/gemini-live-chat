import { Server } from "socket.io";
import http from "http";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = 8080;

const server = http.createServer();
const io = new Server(server, { cors: { origin: "*" } });

const ai = new GoogleGenAI({
  apiKey: 'AIzaSyAmTyNpJLVWG9X1IwQSg6hzLgUXkrl9krc'
});

io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  const model = "gemini-2.0-flash-exp";
  const session = await ai.live.connect({
    model,
    config: {
      generationConfig: {
        responseModalities: [Modality.AUDIO]
      }
    },
    callbacks: {
      onmessage: (msg) => {
        // console.log(msg)
        // if (msg.serverContent) console.log("⚡ Gemini đã nhận data và đang phản hồi...");
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              const audioChunk = Buffer.from(part.inlineData.data, "base64");
              console.log(`🎤 Đang gửi ${audioChunk.length} bytes lên Client`);
              socket.emit("audio", audioChunk);
            }
          }
        }
      },
      onerror: (err) => console.error("Gemini error:", err)
    }
  });

  socket.on("audio", (chunk) => {
    // console.log(`🎤 Đang gửi ${chunk.length} bytes lên Gemini`);
    session.sendRealtimeInput({
      audio: { data: Buffer.from(chunk).toString("base64"), mimeType: "audio/pcm;rate=16000" }
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    session.close?.();
  });
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
