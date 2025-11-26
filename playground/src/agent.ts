import { AssemblyAISpeechToText } from '@create-voice-agent/assemblyai'
import { ElevenLabsTextToSpeech } from '@create-voice-agent/elevenlabs'
import { HumeTextToSpeech } from '@create-voice-agent/hume'
import { OpenAISpeechToText, OpenAITextToSpeech } from '@create-voice-agent/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { MemorySaver } from '@langchain/langgraph'
import { createVoiceAgent } from 'create-voice-agent'

import { createFillerMiddleware } from './middleware.js'
import { addToOrder, confirmOrder, hangUp } from './tools.js'

const SYSTEM_PROMPT = `
You are a helpful sandwich shop assistant. Your goal is to take the user's order. 
Be concise and friendly. 

Available options:
- Meats: turkey, ham, roast beef
- Cheeses: swiss, cheddar, provolone
- Toppings: lettuce, tomato, onion, pickles, mayo, mustard

IMPORTANT: Call the hang_up tool when:
- After confirming an order and the customer is done
- When the customer says goodbye or thanks you
- When the customer says "that's it", "that's all", "bye", etc.
`

let pendingHangUp: string | null = null

// Provider type definitions
export type STTProvider = 'assemblyai' | 'openai'
export type TTSProvider = 'elevenlabs' | 'hume' | 'openai'

export interface ProviderConfig {
  sttProvider: STTProvider
  ttsProvider: TTSProvider
}

interface CreateVoiceAgentParams {
  closeConnection?: (reason: string) => void
  /** Additional callback to run when speech starts (for barge-in handling). */
  onSpeechStart?: () => void
  /** Provider configuration */
  providers?: ProviderConfig
}

/**
 * Create the STT provider based on user selection
 */
function createSTTProvider(provider: STTProvider, onSpeechStart?: () => void) {
  switch (provider) {
    case 'assemblyai':
      return new AssemblyAISpeechToText({
        apiKey: process.env.ASSEMBLYAI_API_KEY!,
        sampleRate: 16000,
        onSpeechStart,
      })
    case 'openai':
      return new OpenAISpeechToText({
        apiKey: process.env.OPENAI_API_KEY!,
        onSpeechStart,
      })
    default:
      throw new Error(`Unknown STT provider: ${provider}`)
  }
}

/**
 * Create the TTS provider based on user selection
 */
function createTTSProvider(provider: TTSProvider, onAudioComplete?: () => void) {
  switch (provider) {
    case 'elevenlabs':
      return new ElevenLabsTextToSpeech({
        apiKey: process.env.ELEVENLABS_API_KEY!,
        voiceId: process.env.ELEVENLABS_VOICE_ID!,
        onAudioComplete,
      })
    case 'hume':
      return new HumeTextToSpeech({
        apiKey: process.env.HUME_API_KEY!,
        onAudioComplete,
      })
    case 'openai':
      return new OpenAITextToSpeech({
        apiKey: process.env.OPENAI_API_KEY!,
        onAudioComplete,
      })
    default:
      throw new Error(`Unknown TTS provider: ${provider}`)
  }
}

/**
 * Get available providers based on environment configuration
 */
export function getAvailableProviders(): {
  stt: { id: STTProvider; name: string; available: boolean }[]
  tts: { id: TTSProvider; name: string; available: boolean }[]
} {
  return {
    stt: [
      {
        id: 'assemblyai',
        name: 'AssemblyAI',
        available: !!process.env.ASSEMBLYAI_API_KEY,
      },
      {
        id: 'openai',
        name: 'OpenAI Whisper',
        available: !!process.env.OPENAI_API_KEY,
      },
    ],
    tts: [
      {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        available: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
      },
      {
        id: 'hume',
        name: 'Hume AI',
        available: !!process.env.HUME_API_KEY,
      },
      {
        id: 'openai',
        name: 'OpenAI TTS',
        available: !!process.env.OPENAI_API_KEY,
      },
    ],
  }
}

export function createSandwichShopVoiceAgent(params: CreateVoiceAgentParams) {
  const {
    closeConnection,
    onSpeechStart,
    providers = { sttProvider: 'assemblyai', ttsProvider: 'elevenlabs' },
  } = params

  console.log(
    `Creating voice agent with STT: ${providers.sttProvider}, TTS: ${providers.ttsProvider}`
  )

  const stt = createSTTProvider(providers.sttProvider, onSpeechStart)
  const tts = createTTSProvider(providers.ttsProvider, () => {
    if (pendingHangUp && closeConnection) {
      closeConnection(pendingHangUp)
      pendingHangUp = null
    }
  })

  return createVoiceAgent({
    // LangChain agent configuration
    model: new ChatGoogleGenerativeAI({ model: 'gemini-2.5-flash' }),
    tools: [addToOrder, confirmOrder, hangUp],
    systemPrompt: SYSTEM_PROMPT,
    checkpointer: new MemorySaver(),

    // Voice configuration
    stt,
    tts,
    middleware: [createFillerMiddleware()],

    // Callbacks
    onInterrupt: (value: unknown) => {
      console.log('[VoiceAgent] Interrupt:', value)
    },
    onHangUp: (reason: string) => {
      console.log('[VoiceAgent] Hang up requested:', reason)
      pendingHangUp = reason
    },
  })
}
