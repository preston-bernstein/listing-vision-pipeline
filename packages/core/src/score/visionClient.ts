import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Vision scoring client.
 *
 * Reads a fixture image off disk, base64-encodes it, sends it to a vision-capable
 * chat endpoint (Ollama-native or OpenAI-compatible, selected by VISION_API_STYLE),
 * and parses a 0-100 desirability/quality score out of the model's free-text reply.
 *
 * `OLLAMA_HOST` is validated as a well-formed http:// or https:// URL on every call,
 * per the plan's SSRF mitigation requirement (a malformed/malicious env value must
 * not be usable to reach an arbitrary scheme, e.g. file:// or gopher://).
 */

const VISION_SCORE_PROMPT =
  'Rate this listing photo for overall desirability and quality on a scale from ' +
  '0 to 100, where 0 is unusable/unappealing and 100 is excellent. ' +
  'Respond with only the number, no other text.';

const DEFAULT_MODEL = 'llava';

/** Directory this module lives in — used to derive a default fixtures root. */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default fixtures root: `<repo root>/fixtures`.
 * This file lives at `packages/core/src/score/`, so the repo root is four levels up.
 */
const DEFAULT_FIXTURES_ROOT = path.resolve(MODULE_DIR, '../../../../fixtures');

/** Ollama's native `/api/chat` response shape (the subset we rely on). */
const OllamaChatResponseSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
});

/** OpenAI-compatible `/v1/chat/completions` response shape (the subset we rely on). */
const OpenAiChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1, 'choices must contain at least one entry'),
});

/** Final, validated vision score: an integer-or-float 0-100. */
const VisionScoreSchema = z.number().min(0).max(100);

type VisionApiStyle = 'ollama' | 'openai';

/**
 * Validates that a string is a well-formed http:// or https:// URL.
 * Throws if the scheme is anything else (including no scheme at all), mitigating
 * SSRF from a malformed or malicious OLLAMA_HOST value (e.g. file://, gopher://).
 */
function assertHttpUrl(value: string, envVarName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envVarName} must be a well-formed URL, got: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `${envVarName} must use http:// or https://, got scheme: ${parsed.protocol}`,
    );
  }
  return parsed;
}

/** Reads and validates OLLAMA_HOST from the environment. */
function getOllamaHost(): string {
  const raw = process.env.OLLAMA_HOST;
  if (!raw) {
    throw new Error('OLLAMA_HOST environment variable is not set');
  }
  const url = assertHttpUrl(raw, 'OLLAMA_HOST');
  // Strip any trailing slash so we can safely concatenate path suffixes below.
  return url.toString().replace(/\/+$/, '');
}

/** Reads VISION_API_STYLE from the environment. */
function getVisionApiStyle(): VisionApiStyle {
  const raw = process.env.VISION_API_STYLE;
  if (raw !== 'ollama' && raw !== 'openai') {
    throw new Error(
      `VISION_API_STYLE must be 'ollama' or 'openai', got: ${String(raw)}`,
    );
  }
  return raw;
}

/** Reads OLLAMA_MODEL from the environment, falling back to a sensible default. */
function getModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Extracts the first number-like substring from free-text model output and clamps
 * it to the 0-100 range. Throws if no number can be found.
 */
function parseScoreFromText(text: string): number {
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) {
    throw new Error(`Could not parse a numeric score out of model response: ${text}`);
  }
  const value = Number.parseFloat(match[0]);
  if (Number.isNaN(value)) {
    throw new Error(`Could not parse a numeric score out of model response: ${text}`);
  }
  return Math.min(100, Math.max(0, value));
}

/** Reads the image at `path.join(fixturesRoot, imagePath)` and base64-encodes it. */
async function readImageAsBase64(imagePath: string, fixturesRoot: string): Promise<string> {
  const fullPath = path.join(fixturesRoot, imagePath);
  const bytes = await readFile(fullPath);
  return bytes.toString('base64');
}

async function callOllama(host: string, model: string, imageBase64: string): Promise<string> {
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: VISION_SCORE_PROMPT,
          images: [imageBase64],
        },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Vision request to ${host}/api/chat failed with status ${response.status}`,
    );
  }

  const json = await response.json();
  const parsed = OllamaChatResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Unexpected Ollama vision response shape: ${parsed.error.message}`,
    );
  }
  return parsed.data.message.content;
}

async function callOpenAiCompatible(
  host: string,
  model: string,
  imageBase64: string,
): Promise<string> {
  const response = await fetch(`${host}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_SCORE_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Vision request to ${host}/v1/chat/completions failed with status ${response.status}`,
    );
  }

  const json = await response.json();
  const parsed = OpenAiChatResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Unexpected OpenAI-compatible vision response shape: ${parsed.error.message}`,
    );
  }
  return parsed.data.choices[0].message.content;
}

/**
 * Scores a fixture image for listing desirability/quality (0-100).
 *
 * @param imagePath - fixture-relative image path (e.g. "thriftly/images/listing-001.jpg"),
 *   as stored on `NormalizedListing.imagePath`.
 * @param fixturesRoot - directory that `imagePath` is resolved against. Defaults to
 *   `<repo root>/fixtures`, derived from this module's own location via
 *   `import.meta.url` (this file lives at `packages/core/src/score/`, four levels
 *   below the repo root).
 */
export async function scoreImage(
  imagePath: string,
  fixturesRoot: string = DEFAULT_FIXTURES_ROOT,
): Promise<number> {
  const host = getOllamaHost();
  const style = getVisionApiStyle();
  const model = getModel();

  const imageBase64 = await readImageAsBase64(imagePath, fixturesRoot);

  const content =
    style === 'ollama'
      ? await callOllama(host, model, imageBase64)
      : await callOpenAiCompatible(host, model, imageBase64);

  const score = parseScoreFromText(content);
  return VisionScoreSchema.parse(score);
}
