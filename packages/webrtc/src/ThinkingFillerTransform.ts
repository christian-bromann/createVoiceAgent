/**
 * ThinkingFillerTransform
 *
 * A TransformStream that emits "filler" phrases (e.g., "Let me see...", "Hmm, one moment...")
 * when the upstream agent takes longer than a specified threshold to respond.
 * This creates a more natural, conversational experience for voice applications.
 *
 * Input: string (text from AIMessageChunkTransform)
 * Output: string (original text + optional filler phrases)
 */

export interface ThinkingFillerOptions {
  /**
   * Time in milliseconds before emitting a filler phrase.
   * @default 1000
   */
  thresholdMs?: number;

  /**
   * Array of filler phrases to randomly choose from.
   * @default ["Let me see here...", "Hmm, one moment...", "Ah, let me think..."]
   */
  fillerPhrases?: string[];

  /**
   * Whether the filler functionality is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum number of fillers to emit per turn (before real response arrives).
   * @default 1
   */
  maxFillersPerTurn?: number;

  /**
   * Delay in milliseconds between consecutive filler phrases if maxFillersPerTurn > 1.
   * @default 2000
   */
  fillerIntervalMs?: number;

  /**
   * Callback when a filler phrase is emitted.
   */
  onFillerEmitted?: (phrase: string) => void;
}

export class ThinkingFillerTransform extends TransformStream<string, string> {
  private controller: TransformStreamDefaultController<string> | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private fillersEmittedThisTurn = 0;
  private isProcessing = false;
  private hasReceivedResponse = false;

  private readonly thresholdMs: number;
  private readonly fillerPhrases: string[];
  private readonly enabled: boolean;
  private readonly maxFillersPerTurn: number;
  private readonly fillerIntervalMs: number;
  private readonly onFillerEmitted?: (phrase: string) => void;

  constructor(options: ThinkingFillerOptions = {}) {
    const {
      thresholdMs = 1000,
      fillerPhrases = [
        "Let me see here...",
        "Hmm, one moment...",
        "Ah, let me think...",
        "Just a second...",
        "Mhm, okay...",
      ],
      enabled = true,
      maxFillersPerTurn = 1,
      fillerIntervalMs = 2000,
      onFillerEmitted,
    } = options;

    // We need to bind methods before calling super() since we reference them
    const self = {
      thresholdMs,
      fillerPhrases,
      enabled,
      maxFillersPerTurn,
      fillerIntervalMs,
      onFillerEmitted,
      controller: null as TransformStreamDefaultController<string> | null,
      timeoutId: null as ReturnType<typeof setTimeout> | null,
      intervalId: null as ReturnType<typeof setInterval> | null,
      fillersEmittedThisTurn: 0,
      isProcessing: false,
      hasReceivedResponse: false,
    };

    super({
      start(controller) {
        self.controller = controller;
      },

      transform(chunk, controller) {
        // Real text arrived - cancel any pending filler timers
        if (self.timeoutId) {
          clearTimeout(self.timeoutId);
          self.timeoutId = null;
        }
        if (self.intervalId) {
          clearInterval(self.intervalId);
          self.intervalId = null;
        }

        self.hasReceivedResponse = true;
        self.isProcessing = false;

        // Pass through the actual response
        controller.enqueue(chunk);
      },

      flush() {
        // Clean up any timers on stream close
        if (self.timeoutId) {
          clearTimeout(self.timeoutId);
          self.timeoutId = null;
        }
        if (self.intervalId) {
          clearInterval(self.intervalId);
          self.intervalId = null;
        }
      },
    });

    // Store references for external access
    this.thresholdMs = thresholdMs;
    this.fillerPhrases = fillerPhrases;
    this.enabled = enabled;
    this.maxFillersPerTurn = maxFillersPerTurn;
    this.fillerIntervalMs = fillerIntervalMs;
    this.onFillerEmitted = onFillerEmitted;

    // Store self reference for method access
    (this as unknown as { _self: typeof self })._self = self;
  }

  /**
   * Call this method when the agent starts processing a user request.
   * This starts the filler timer.
   */
  notifyProcessingStarted(): void {
    if (!this.enabled) return;

    const self = (this as unknown as { _self: ReturnType<typeof this.getSelf> })
      ._self;

    // Reset state for new turn
    self.fillersEmittedThisTurn = 0;
    self.isProcessing = true;
    self.hasReceivedResponse = false;

    // Clear any existing timers
    if (self.timeoutId) {
      clearTimeout(self.timeoutId);
    }
    if (self.intervalId) {
      clearInterval(self.intervalId);
    }

    // Start the filler timer
    self.timeoutId = setTimeout(() => {
      this.emitFiller(self);

      // If we can emit more fillers, set up interval
      if (this.maxFillersPerTurn > 1) {
        self.intervalId = setInterval(() => {
          if (
            self.fillersEmittedThisTurn < this.maxFillersPerTurn &&
            !self.hasReceivedResponse
          ) {
            this.emitFiller(self);
          } else {
            if (self.intervalId) {
              clearInterval(self.intervalId);
              self.intervalId = null;
            }
          }
        }, this.fillerIntervalMs);
      }
    }, this.thresholdMs);
  }

  /**
   * Call this method to cancel any pending filler.
   * Useful when the user interrupts or the turn is cancelled.
   */
  cancelPendingFiller(): void {
    const self = (this as unknown as { _self: ReturnType<typeof this.getSelf> })
      ._self;

    if (self.timeoutId) {
      clearTimeout(self.timeoutId);
      self.timeoutId = null;
    }
    if (self.intervalId) {
      clearInterval(self.intervalId);
      self.intervalId = null;
    }

    self.isProcessing = false;
  }

  private getSelf() {
    return (this as unknown as { _self: unknown })._self as {
      thresholdMs: number;
      fillerPhrases: string[];
      enabled: boolean;
      maxFillersPerTurn: number;
      fillerIntervalMs: number;
      onFillerEmitted?: (phrase: string) => void;
      controller: TransformStreamDefaultController<string> | null;
      timeoutId: ReturnType<typeof setTimeout> | null;
      intervalId: ReturnType<typeof setInterval> | null;
      fillersEmittedThisTurn: number;
      isProcessing: boolean;
      hasReceivedResponse: boolean;
    };
  }

  private emitFiller(self: ReturnType<typeof this.getSelf>): void {
    if (
      !self.controller ||
      self.hasReceivedResponse ||
      self.fillersEmittedThisTurn >= this.maxFillersPerTurn
    ) {
      return;
    }

    // Pick a random filler phrase
    const phrase =
      this.fillerPhrases[Math.floor(Math.random() * this.fillerPhrases.length)];

    console.log(`[ThinkingFiller] Emitting filler: "${phrase}"`);

    // Emit the filler phrase
    self.controller.enqueue(phrase);
    self.fillersEmittedThisTurn++;

    // Call the callback if provided
    this.onFillerEmitted?.(phrase);
  }
}

