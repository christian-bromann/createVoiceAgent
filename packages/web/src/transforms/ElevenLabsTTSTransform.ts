import WebSocket from "ws";

interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

export class ElevenLabsTTSTransform extends TransformStream<string, Buffer> {
  constructor(options: ElevenLabsOptions) {
    let ws: WebSocket | null = null;
    let connectionPromise: Promise<void> | null = null;
    let activeController: TransformStreamDefaultController<Buffer> | null =
      null;
    let isShuttingDown = false;

    // Promise that resolves when isFinal is received (for flush)
    let finalResolve: (() => void) | null = null;
    let finalPromise: Promise<void> | null = null;

    const resetFinalPromise = () => {
      finalPromise = new Promise((resolve) => {
        finalResolve = resolve;
      });
    };

    const getWebSocketUrl = () => {
      const modelId = options.modelId || "eleven_monolingual_v1";
      return `wss://api.elevenlabs.io/v1/text-to-speech/${options.voiceId}/stream-input?model_id=${modelId}&output_format=pcm_16000`;
    };

    const createConnection = (): Promise<void> => {
      resetFinalPromise();

      return new Promise((resolve, reject) => {
        const url = getWebSocketUrl();
        console.log(`ElevenLabs: Connecting...`);
        const newWs = new WebSocket(url);

        newWs.on("open", () => {
          console.log("ElevenLabs: WebSocket connected");
          // BOS (Beginning of Stream) message
          const bosMessage = {
            text: " ",
            voice_settings: {
              stability: options.stability || 0.5,
              similarity_boost: options.similarityBoost || 0.75,
            },
            xi_api_key: options.apiKey,
          };
          newWs.send(JSON.stringify(bosMessage));
          ws = newWs;
          resolve();
        });

        newWs.on("message", (data: Buffer) => {
          try {
            const msgStr = data.toString();
            const response = JSON.parse(msgStr);

            if (response.audio) {
              const chunk = Buffer.from(response.audio, "base64");
              if (activeController) {
                activeController.enqueue(chunk);
              }
            }
            if (response.isFinal) {
              if (finalResolve) {
                finalResolve();
                finalResolve = null;
              }
            }
            if (response.error) {
              console.error(
                "ElevenLabs: Server returned error:",
                response.error
              );
            }
          } catch (e) {
            console.error("ElevenLabs: Error parsing message:", e);
          }
        });

        newWs.on("error", (err) => {
          console.error("ElevenLabs WS Error:", err);
          if (ws === newWs) {
            ws = null;
            connectionPromise = null;
          }
          reject(err);
        });

        newWs.on("close", (code, reason) => {
          console.log(
            `ElevenLabs: WebSocket closed (code: ${code}, reason: ${reason})`
          );
          if (ws === newWs) {
            ws = null;
            connectionPromise = null;
          }
          // Resolve any pending final promise
          if (finalResolve) {
            finalResolve();
            finalResolve = null;
          }
        });
      });
    };

    const ensureConnection = async (): Promise<void> => {
      // Check if current connection is usable
      if (ws && ws.readyState === WebSocket.OPEN) {
        return;
      }
      // Wait for pending connection
      if (connectionPromise) {
        await connectionPromise;
        if (ws && ws.readyState === WebSocket.OPEN) {
          return;
        }
      }
      // Create new connection
      connectionPromise = createConnection();
      await connectionPromise;
    };

    super({
      start(controller) {
        activeController = controller;
      },
      async transform(token) {
        if (isShuttingDown) return;

        try {
          await ensureConnection();
          if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = { text: token, try_trigger_generation: true };
            ws.send(JSON.stringify(payload));
          } else {
            console.warn(
              "ElevenLabs: WebSocket not open, dropping token:",
              token
            );
          }
        } catch (err) {
          console.error("ElevenLabs: Error in transform:", err);
        }
      },
      async flush() {
        console.log("ElevenLabs: Flushing stream...");
        isShuttingDown = true;

        if (ws && ws.readyState === WebSocket.OPEN) {
          // Send EOS (end of stream)
          ws.send(JSON.stringify({ text: "" }));

          // Wait for final audio with timeout
          const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
              console.log("ElevenLabs: Flush timeout reached");
              resolve();
            }, 5000);
          });

          await Promise.race([finalPromise, timeoutPromise]);

          // Close connection
          try {
            ws.close();
          } catch {
            // Ignore close errors
          }
          ws = null;
        }
        connectionPromise = null;
      },
    });
  }
}
