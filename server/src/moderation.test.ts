import assert from 'node:assert/strict';
import test from 'node:test';
import { moderateContent } from './moderation';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  STEPFUN_API_KEY: process.env.STEPFUN_API_KEY,
  STEPFUN_MODEL: process.env.STEPFUN_MODEL,
  STEPFUN_BASE_URL: process.env.STEPFUN_BASE_URL,
  STEPFUN_TIMEOUT_MS: process.env.STEPFUN_TIMEOUT_MS,
};

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
} as Response);

const restoreEnvironment = (): void => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

const useProviderEnvironment = (): void => {
  process.env.STEPFUN_API_KEY = 'test-only-key';
  process.env.STEPFUN_MODEL = 'step-3.7-flash';
  process.env.STEPFUN_BASE_URL = 'https://api.stepfun.com/v1';
  process.env.STEPFUN_TIMEOUT_MS = '1000';
};

test('returns safe for a valid text classification', async () => {
  try {
    useProviderEnvironment();
    let requestBody = '';
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://api.stepfun.com/v1/chat/completions');
      requestBody = String(init?.body);
      return jsonResponse({
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"verdict":"safe","categories":[],"severity":"low","reason":"clean"}' },
        }],
      });
    };

    const result = await moderateContent({ text: '校园里的晚风。', mediaType: 'none' });
    assert.equal(result.verdict, 'safe');
    assert.equal(result.model, 'step-3.7-flash');
    assert.match(requestBody, /"response_format"\s*:\s*\{\s*"type"\s*:\s*"json_object"/);
  } finally {
    restoreEnvironment();
  }
});

test('sends an image URL and preserves a flagged review result', async () => {
  try {
    useProviderEnvironment();
    let requestBody = '';
    globalThis.fetch = async (_input, init) => {
      requestBody = String(init?.body);
      return jsonResponse({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: '{"verdict":"review","categories":["violence"],"severity":"high","reason":"needs review"}',
          },
        }],
      });
    };

    const result = await moderateContent({
      text: '请查看附件',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.test/upload.jpg',
    });
    assert.equal(result.verdict, 'review');
    assert.deepEqual(result.categories, ['violence']);
    assert.match(requestBody, /image_url/);
    assert.ok(requestBody.includes('https://cdn.example.test/upload.jpg'));
  } finally {
    restoreEnvironment();
  }
});

test('fails closed without calling the model for an unconfirmed visual format', async () => {
  try {
    useProviderEnvironment();
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return jsonResponse({});
    };

    const result = await moderateContent({
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.test/upload.heic',
    });
    assert.equal(result.verdict, 'error');
    assert.deepEqual(result.categories, ['unsupported_media']);
    assert.equal(called, false);
  } finally {
    restoreEnvironment();
  }
});

test('fails closed when the model returns malformed JSON', async () => {
  try {
    useProviderEnvironment();
    globalThis.fetch = async () => jsonResponse({
      choices: [{ finish_reason: 'stop', message: { content: '{not-json' } }],
    });

    const result = await moderateContent({ text: 'test', mediaType: 'none' });
    assert.equal(result.verdict, 'error');
    assert.equal(result.severity, 'high');
  } finally {
    restoreEnvironment();
  }
});

test('routes contradictory safe output to human review', async () => {
  try {
    useProviderEnvironment();
    globalThis.fetch = async () => jsonResponse({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: '{"verdict":"safe","categories":["violence"],"severity":"high","reason":"conflict"}',
        },
      }],
    });

    const result = await moderateContent({ text: 'test', mediaType: 'none' });
    assert.equal(result.verdict, 'review');
    assert.equal(result.severity, 'high');
  } finally {
    restoreEnvironment();
  }
});

test('fails closed when finish_reason is absent', async () => {
  try {
    useProviderEnvironment();
    globalThis.fetch = async () => jsonResponse({
      choices: [{ message: { content: '{"verdict":"safe","categories":[],"severity":"low","reason":"clean"}' } }],
    });

    const result = await moderateContent({ text: 'test', mediaType: 'none' });
    assert.equal(result.verdict, 'error');
  } finally {
    restoreEnvironment();
  }
});

test('fails closed when required structured fields are missing', async () => {
  try {
    useProviderEnvironment();
    globalThis.fetch = async () => jsonResponse({
      choices: [{
        finish_reason: 'stop',
        message: { content: '{"verdict":"safe","categories":[],"severity":"low"}' },
      }],
    });

    const result = await moderateContent({ text: 'test', mediaType: 'none' });
    assert.equal(result.verdict, 'error');
  } finally {
    restoreEnvironment();
  }
});

test('fails closed when the provider returns a non-2xx response', async () => {
  try {
    useProviderEnvironment();
    globalThis.fetch = async () => jsonResponse({ error: { message: 'temporary outage' } }, 503);

    const result = await moderateContent({ text: 'test', mediaType: 'none' });
    assert.equal(result.verdict, 'error');
    assert.match(result.reason, /503/);
  } finally {
    restoreEnvironment();
  }
});

test('returns a configuration error without calling fetch when the key is missing', async () => {
  try {
    delete process.env.STEPFUN_API_KEY;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return jsonResponse({});
    };

    const result = await moderateContent({ text: 'test', mediaType: 'none' });
    assert.equal(result.verdict, 'error');
    assert.deepEqual(result.categories, ['configuration']);
    assert.equal(called, false);
  } finally {
    restoreEnvironment();
  }
});

test('transcribes confirmed MP3 audio with step-asr before classification', async () => {
  try {
    useProviderEnvironment();
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/audio/transcriptions')) {
        assert.equal(init?.method, 'POST');
        assert.match(String(init?.body), /FormData/);
        return jsonResponse({ text: '一段需要审核的录音' });
      }
      return jsonResponse({
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"verdict":"safe","categories":[],"severity":"low","reason":"clean"}' },
        }],
      });
    };

    const result = await moderateContent({
      mediaType: 'audio',
      mediaUrl: 'data:audio/mpeg;base64,YQ==',
    });
    assert.equal(result.verdict, 'safe');
    assert.deepEqual(calls, [
      'https://api.stepfun.com/v1/audio/transcriptions',
      'https://api.stepfun.com/v1/chat/completions',
    ]);
  } finally {
    restoreEnvironment();
  }
});
