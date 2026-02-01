/**
 * @file Simple Platform AI SDK
 *
 * This module provides a high-level, developer-friendly interface for interacting
 * with the platform's powerful, asynchronous AI engine. It abstracts away the
 * underlying complexity of calling the trusted `ai-orchestrator` primitive,
 * handling payload construction and response transformation automatically.
 *
 * This makes AI a first-class, reusable primitive, available to any developer
 * in any logic module they build on the Simple platform.
 */
import type { Context, DocumentHandle } from './types'

import { execute as hostExecute } from './host'

// ============================================================================
// AI API Types (The Developer-Facing Contract)
// ============================================================================

// --- JSON Schema Type System (Discriminated Union) ---

/**
 * Base properties common to all JSON Schema definitions.
 */
interface JSONSchemaBase {
  description?: string
}

/**
 * JSON Schema definition for a string type.
 */
export interface JSONSchemaString extends JSONSchemaBase {
  format?: 'date' | 'date-time' | 'email' | 'uri'
  maxLength?: number
  minLength?: number
  pattern?: string
  type: 'string'
}

/**
 * JSON Schema definition for a number or integer type.
 */
export interface JSONSchemaNumber extends JSONSchemaBase {
  exclusiveMaximum?: number
  exclusiveMinimum?: number
  maximum?: number
  minimum?: number
  multipleOf?: number
  type: 'integer' | 'number'
}

/**
 * JSON Schema definition for a boolean type.
 */
export interface JSONSchemaBoolean extends JSONSchemaBase {
  type: 'boolean'
}

/**
 * JSON Schema definition for an object type.
 */
export interface JSONSchemaObject extends JSONSchemaBase {
  properties: Record<string, JSONSchema>
  required?: string[]
  type: 'object'
}

/**
 * JSON Schema definition for an array type.
 */
export interface JSONSchemaArray extends JSONSchemaBase {
  items: JSONSchema
  maxItems?: number
  minItems?: number
  type: 'array'
}

/**
 * A discriminated union representing a complete and strongly-typed JSON Schema.
 * This provides developers with precise autocompletion and type-checking.
 */
export type JSONSchema
  = | JSONSchemaArray
    | JSONSchemaBoolean
    | JSONSchemaNumber
    | JSONSchemaObject
    | JSONSchemaString

/**
 * A set of common configuration options shared across all AI operations.
 * This adheres to the DRY principle, ensuring a consistent API surface.
 */
export interface AICommonOptions {
  /**
   * The kind of model to use for this execution.
   * Example: "medium", "large".
   * If omitted, the platform chooses a sensible default model.
   */
  model?: 'large' | 'lite' | 'medium' | 'xl'

  /** A natural language prompt to guide the AI's process. */
  prompt: string

  /**
   * If true, forces the AI to provide a detailed, multi-step reasoning
   * process in the generated output. Defaults to true.
   */
  reasoning?: boolean

  /**
   * The maximum number of tokens to spend on the reasoning process.
   * If omitted, the platform chooses a sensible default.
   * Ignored if `reasoning` is false.
   */
  reasoningBudget?: number

  /**
   * If true, forces the AI to re-process the input, ignoring
   * any previously cached results in the AI Memcache. Defaults to false.
   */
  regenerate?: boolean

  /**
   * (Optional) A system prompt to define the AI's role, personality, or
   * high-level instructions for the entire task.
   */
  systemPrompt?: string

  /**
   * (Optional) Controls the creativity of the model. A value from 0.0 (most
   * deterministic) to 1.0 (most creative). Defaults to the model's standard.
   */
  temperature?: number

  /**
   * (Optional) The maximum time in milliseconds to wait for the AI operation.
   * If this timeout is exceeded, the promise will reject. Defaults to 30,000ms.
   */
  timeout?: number
}

/**
 * The configuration options for an AI `extract` operation.
 * Extends the common options with a required `schema`.
 */
export interface AIExtractOptions extends AICommonOptions {
  /**
   * The desired JSON schema of the output. This provides a strong contract
   * for the AI to follow when generating its response.
   */
  schema: JSONSchema
}

/**
 * The configuration options for an AI `summarize` operation.
 * Extends the common options. No additional properties are needed.
 */
export interface AISummarizeOptions extends AICommonOptions { }

/**
 * Configuration options for audio/video transcription.
 * Extends common options but excludes `prompt` as it's generated internally.
 */
export interface AITranscribeOptions extends Omit<AICommonOptions, 'prompt'> {
  /**
   * If true, includes timestamps in the transcript (format: [MM:SS]).
   * Only applicable when `includeTranscript` is true.
   */
  includeTimestamps?: boolean

  /**
   * If true, includes the full transcript in the response.
   * At least one of `includeTranscript` or `summarize` must be true.
   */
  includeTranscript?: boolean

  /**
   * Participant identification configuration:
   * - `true`: Auto-detect participants and label as "Participant 1", "Participant 2", etc.
   * - `string[]`: Array of participant names/roles to identify (e.g., ['Customer', 'Agent'])
   * - `undefined`: No participant identification (default)
   *
   * When provided, the transcript will include participant labels for each segment.
   */
  participants?: boolean | string[]

  /**
   * If true, includes a summary of the audio/video content.
   * At least one of `includeTranscript` or `summarize` must be true.
   */
  summarize?: boolean
}

/**
 * The response structure from a successful AI `extract` or `summarize` operation.
 */
export interface AIExecutionResult {
  /**
   * The primary data returned by the AI. For `extract`, this is the structured
   * object matching the requested schema. For `summarize`, it's the summary string.
   */
  data: any

  /**
   * Rich metadata about the AI execution, useful for auditing, debugging, and
   * providing context to the user.
   */
  metadata: {
    /** The number of tokens in the input prompt. */
    inputTokens: number

    /** The number of tokens in the generated output. */
    outputTokens: number

    /** A summary of the AI's internal reasoning process, if provided. */
    reasoning?: string

    /** The number of tokens used for internal "thinking", if applicable. */
    reasoningTokens?: number
  }
}

// ============================================================================
// Internal Implementation
// ============================================================================

/**
 * Recursively processes an object to detect and upload pending files.
 * When a pending DocumentHandle is detected (has `pending: true` and `file_hash`),
 * it calls the ephemeral upload host function and replaces the pending handle
 * with the ephemeral handle returned from the upload.
 *
 * @internal
 */
async function _uploadPendingFiles(obj: any, context: Context): Promise<any> {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj.pending === true && obj.file_hash) {
    const response = await hostExecute('action:documents/upload-ephemeral', obj, context)

    if (!response.ok) {
      throw new Error(response.error?.message || 'Failed to upload pending file')
    }

    return response.data
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => _uploadPendingFiles(item, context)))
  }

  return obj
}

/**
 * The internal, shared logic for executing any AI operation. This function
 * is not exported and serves as the single, DRY implementation for all
 * public-facing AI functions.
 *
 * @internal
 */
async function _executeAIOperation(
  operation: 'extract' | 'summarize',
  input: DocumentHandle | object | string,
  options: AIExtractOptions | AISummarizeOptions,
  context: Context,
): Promise<AIExecutionResult> {
  const {
    model,
    prompt,
    reasoning = true,
    reasoningBudget,
    regenerate = false,
    systemPrompt,
    temperature,
    timeout,
  } = options

  const processedInput = await _uploadPendingFiles(input, context)

  // 1. Construct the universal options payload for caching and execution.
  const universalOptions = {
    ...(temperature !== undefined && { temperature }),
    ...(reasoningBudget !== undefined && { reasoningBudget }),
    ...({ reasoning }),
  }

  // 2. Construct the full payload for the `ai-orchestrator` Go primitive.
  //    This includes the operation-specific `schema` if it exists.
  const payload = {
    input: processedInput,
    model,
    operation,
    options: universalOptions,
    prompt,
    regenerate,
    schema: (options as AIExtractOptions).schema, // Will be undefined for summarize, which is correct
    systemPrompt,
    timeout,
  }

  // 3. Call the trusted primitive. The SDK's `hostExecute` handles the complexity
  //    of the underlying `logic:` call and the async execution.
  const response = await hostExecute('logic:dev.simple.system/ai-orchestrator', payload, context)

  if (!response.ok) {
    throw new Error(response.error?.message || `AI '${operation}' operation failed.`)
  }

  // 4. Transform the raw backend response into the clean, developer-facing API contract.
  const aioData = response.data as any
  const data = aioData?.data
  const metadata = aioData?.metadata || {}

  return {
    data,
    metadata: {
      inputTokens: metadata.input_tokens,
      outputTokens: metadata.output_tokens,
      reasoning: metadata.reasoning,
      reasoningTokens: metadata.reasoning_tokens,
    },
  }
}

// ============================================================================
// Public SDK Functions
// ============================================================================

/**
 * Extracts structured data from a given input using the Simple AI engine.
 *
 * @param input The source data for the extraction (string, document handle, or object).
 * @param options The configuration for the extraction operation.
 * @param context The execution context provided by the host.
 * @returns A promise that resolves to an `AIExecutionResult` object.
 * @throws Will throw an error if the operation fails or inputs are invalid.
 */
export async function extract(
  input: DocumentHandle | object | string,
  options: AIExtractOptions,
  context: Context,
): Promise<AIExecutionResult> {
  // Perform client-side validation specific to the `extract` operation.
  if (!input) {
    throw new Error('The `input` parameter is required for `extract`.')
  }

  if (!options.schema || typeof options.schema !== 'object') {
    throw new Error('The `schema` parameter must be a valid JSONSchema object for `extract`.')
  }

  if (!options.prompt || typeof options.prompt !== 'string') {
    throw new Error('The `prompt` parameter must be a non-empty string for `extract`.')
  }

  // Delegate to the shared internal execution logic.
  return _executeAIOperation('extract', input, options, context)
}

/**
 * Generates a summary for a given input using the Simple AI engine.
 *
 * @param input The source data for the summarization (string, document handle, or object).
 * @param options The configuration for the summarization operation.
 * @param context The execution context provided by the host.
 * @returns A promise that resolves to an `AIExecutionResult` object containing the summary.
 * @throws Will throw an error if the operation fails or inputs are invalid.
 */
export async function summarize(
  input: DocumentHandle | object | string,
  options: AISummarizeOptions,
  context: Context,
): Promise<AIExecutionResult> {
  // Perform client-side validation specific to the `summarize` operation.
  if (!input) {
    throw new Error('The `input` parameter is required for `summarize`.')
  }

  if (!options.prompt || typeof options.prompt !== 'string') {
    throw new Error('The `prompt` parameter must be a non-empty string for `summarize`.')
  }

  // Delegate to the shared internal execution logic.
  return _executeAIOperation('summarize', input, options, context)
}

/**
 * Transcribes audio or video from a document handle using the Simple AI engine.
 *
 * This function internally uses the `extract` operation with a dynamically generated
 * schema based on the requested options. It supports participant identification,
 * timestamps, and summarization.
 *
 * @param input The audio or video file as a DocumentHandle.
 * @param options The configuration for the transcription operation.
 * @param context The execution context provided by the host.
 * @returns A promise that resolves to an `AIExecutionResult` with structured transcription data.
 * @throws Will throw an error if the operation fails or inputs are invalid.
 *
 * @example
 * // Basic transcript
 * const result = await transcribe(audioHandle, { includeTranscript: true }, context)
 * // Returns: { language: "en", transcript: "..." }
 *
 * @example
 * // Transcript with participant identification
 * const result = await transcribe(audioHandle, {
 *   includeTranscript: true,
 *   participants: ['Customer', 'Support Agent']
 * }, context)
 * // Returns: { language: "en", transcript: "Customer: Hello...\nSupport Agent: Hi...", participants: [...] }
 *
 * @example
 * // Summary with auto-detected participants
 * const result = await transcribe(videoHandle, {
 *   summarize: true,
 *   participants: true
 * }, context)
 * // Returns: { language: "en", summary: "...", participants: ["Participant 1", "Participant 2"] }
 */
export async function transcribe(
  input: DocumentHandle,
  options: AITranscribeOptions,
  context: Context,
): Promise<AIExecutionResult> {
  // Validation
  if (!input || typeof input !== 'object' || !input.file_hash) {
    throw new Error('The `input` parameter must be a valid DocumentHandle for `transcribe`.')
  }

  const {
    includeTimestamps = false,
    includeTranscript = false,
    participants,
    summarize = false,
  } = options

  if (!includeTranscript && !summarize) {
    throw new Error('At least one of `includeTranscript` or `summarize` must be true for `transcribe`.')
  }

  // Validate mime type is audio or video
  const mimeType = input.mime_type?.toLowerCase() || ''
  if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
    throw new Error('The input file must be an audio or video file for `transcribe`.')
  }

  // Build the dynamic schema based on user options
  const schemaProperties: Record<string, JSONSchema> = {
    language: {
      description: 'The detected language of the audio (ISO 639-1 code, e.g., "en", "es")',
      type: 'string',
    },
  }

  const requiredFields = ['language']

  if (includeTranscript) {
    let transcriptDesc = 'The full transcript of the audio'

    if (participants) {
      if (includeTimestamps) {
        transcriptDesc = 'The full transcript with participant labels and timestamps. Format: [MM:SS] Participant Name: text'
      }
      else {
        transcriptDesc = 'The full transcript with participant labels. Format: Participant Name: text'
      }
    }
    else if (includeTimestamps) {
      transcriptDesc = 'The full transcript with timestamps. Format: [MM:SS] text'
    }

    schemaProperties.transcript = {
      description: transcriptDesc,
      type: 'string',
    }

    requiredFields.push('transcript')
  }

  if (summarize) {
    schemaProperties.summary = {
      description: participants
        ? 'A concise summary of the audio content, including key points from each participant'
        : 'A concise summary of the audio content',
      type: 'string',
    }

    requiredFields.push('summary')
  }

  // Add participants array to schema if participant identification is requested
  if (participants) {
    schemaProperties.participants = {
      description: 'List of identified participants in the audio',
      items: { type: 'string' },
      type: 'array',
    }

    requiredFields.push('participants')
  }

  const schema: JSONSchema = {
    properties: schemaProperties,
    required: requiredFields,
    type: 'object',
  }

  // Build the prompt
  let prompt = 'Analyze this audio/video file and provide:\n'

  if (includeTranscript) {
    if (participants) {
      if (Array.isArray(participants)) {
        prompt += `- A complete transcript identifying these participants: ${participants.join(', ')}. `
      }
      else {
        prompt += '- A complete transcript with participant identification (label participants as Participant 1, Participant 2, etc.). '
      }

      if (includeTimestamps) {
        prompt += 'Include timestamps in [MM:SS] format before each participant segment.\n'
      }
      else {
        prompt += 'Format each line as "Participant Name: text".\n'
      }
    }
    else {
      prompt += includeTimestamps
        ? '- A complete transcript with timestamps in [MM:SS] format before each segment\n'
        : '- A complete transcript of all spoken content\n'
    }
  }

  if (summarize) {
    prompt += participants
      ? '- A concise summary highlighting key points from each participant\n'
      : '- A concise summary of the main points and key information\n'
  }

  if (participants) {
    if (Array.isArray(participants)) {
      prompt += `- Identify and distinguish between these participants: ${participants.join(', ')}\n`
    }
    else {
      prompt += '- Identify and list all distinct participants in the audio\n'
    }
  }

  prompt += '- The detected language code (ISO 639-1 format)\n'

  // Delegate to extract with our generated schema
  return extract(
    input,
    {
      ...options,
      prompt,
      schema,
    },
    context,
  )
}
