import { createThinkingFillerMiddleware } from 'create-voice-agent'

/**
 * Factory function to create a fresh filler middleware instance.
 * This must be called for each new call/session because TransformStreams
 * can only be piped once.
 */
export function createFillerMiddleware() {
  return createThinkingFillerMiddleware({
    thresholdMs: 1200,
    fillerPhrases: [
      'Let me see here...',
      'Hmm, one moment...',
      'Ah, let me check...',
      'Just a second...',
    ],
    maxFillersPerTurn: 1,
  })
}
