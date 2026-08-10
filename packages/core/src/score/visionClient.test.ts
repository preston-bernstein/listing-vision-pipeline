import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreImage } from './visionClient.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(MODULE_DIR, '../../../../fixtures');
const REAL_IMAGE_PATH = 'thriftly/images/listing-001.jpg';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('scoreImage', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.VISION_API_STYLE = 'ollama';
    delete process.env.OLLAMA_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('scores via Ollama-style /api/chat, sending base64 image bytes and stream:false', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ message: { content: '82' } }));

    const score = await scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT);

    expect(score).toBe(82);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stream).toBe(false);
    expect(Array.isArray(body.messages[0].images)).toBe(true);
    expect(typeof body.messages[0].images[0]).toBe('string');
    expect(body.messages[0].images[0].length).toBeGreaterThan(0);
  });

  it('scores via OpenAI-compatible /v1/chat/completions, sending a data: URL image', async () => {
    process.env.VISION_API_STYLE = 'openai';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'Score: 91 out of 100' } }] }),
    );

    const score = await scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT);

    expect(score).toBe(91);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    const imageContent = body.messages[0].content.find(
      (c: { type: string }) => c.type === 'image_url',
    );
    expect(imageContent.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('clamps an out-of-range score to the 0-100 bounds', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ message: { content: '150' } }));
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).resolves.toBe(100);

    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ message: { content: '-5' } }));
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).resolves.toBe(0);
  });

  it('throws when the model reply has no parseable number', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ message: { content: 'I cannot rate this image.' } }),
    );
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(
      /Could not parse a numeric score/,
    );
  });

  it('throws on a non-ok HTTP response instead of silently returning a bad score', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, false, 500));
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(/status 500/);
  });

  it('throws on a malformed Ollama response shape (missing message.content)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ unexpected: true }));
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(
      /Unexpected Ollama vision response shape/,
    );
  });

  it('throws on a malformed OpenAI-compatible response shape (empty choices)', async () => {
    process.env.VISION_API_STYLE = 'openai';
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(
      /Unexpected OpenAI-compatible vision response shape/,
    );
  });

  it('rejects a non-http(s) OLLAMA_HOST scheme (SSRF mitigation)', async () => {
    process.env.OLLAMA_HOST = 'file:///etc/passwd';
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(
      /must use http:\/\/ or https:\/\//,
    );
  });

  it('rejects a malformed OLLAMA_HOST value', async () => {
    process.env.OLLAMA_HOST = 'not a url';
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(
      /must be a well-formed URL/,
    );
  });

  it('rejects an invalid VISION_API_STYLE', async () => {
    process.env.VISION_API_STYLE = 'anthropic';
    await expect(scoreImage(REAL_IMAGE_PATH, FIXTURES_ROOT)).rejects.toThrow(
      /VISION_API_STYLE must be 'ollama' or 'openai'/,
    );
  });

  it('throws when reading a nonexistent image path', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ message: { content: '50' } }));
    await expect(
      scoreImage('thriftly/images/does-not-exist.jpg', FIXTURES_ROOT),
    ).rejects.toThrow();
  });
});
