import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../src/auth-client.js', () => ({ createAuthClient: () => ({ request }) }));

const app = (await import('../src/index.js')).default;

const TOKEN = 'test-token-not-a-real-secret';

const rpc = (method, params = {}, headers = {}) =>
  app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const initialize = (headers) =>
  rpc(
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    },
    headers,
  );

describe('/mcp の認証', () => {
  beforeEach(() => {
    process.env.GHEALTH_MCP_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.GHEALTH_MCP_TOKEN;
  });

  it('x-api-key が無ければ 401 を返す', async () => {
    const res = await initialize();
    expect(res.status).toBe(401);
  });

  it('x-api-key が違えば 401 を返す', async () => {
    const res = await initialize({ 'x-api-key': 'wrong' });
    expect(res.status).toBe(401);
  });

  it('401 には OAuth の探索を始めさせる WWW-Authenticate を付けない', async () => {
    const res = await initialize();
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('環境変数が未設定なら、空のヘッダーでも 401 を返す', async () => {
    delete process.env.GHEALTH_MCP_TOKEN;
    const res = await initialize({ 'x-api-key': '' });
    expect(res.status).toBe(401);
  });

  it('x-api-key が正しければ initialize に応答する', async () => {
    const res = await initialize({ 'x-api-key': TOKEN });
    expect(res.status).toBe(200);
  });
});

describe('/mcp のツール', () => {
  beforeEach(() => {
    process.env.GHEALTH_MCP_TOKEN = TOKEN;
    request.mockReset();
  });
  afterEach(() => {
    delete process.env.GHEALTH_MCP_TOKEN;
  });

  it('5 つのツールが tools/list に載る', async () => {
    const res = await rpc('tools/list', {}, { 'x-api-key': TOKEN });
    expect(res.status).toBe(200);

    const text = await res.text();
    for (const name of [
      'list_exercises',
      'get_exercise',
      'get_exercise_minutes',
      'get_resting_heart_rate',
      'get_sleep',
    ]) {
      expect(text).toContain(`"${name}"`);
    }
  });

  it('tools/call で整形済みの結果を返す', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });

    const res = await rpc(
      'tools/call',
      { name: 'list_exercises', arguments: { from: '2026-03-01', to: '2026-03-02' } },
      { 'x-api-key': TOKEN },
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('[]');
    expect(request).toHaveBeenCalled();
  });

  it('ツールが投げた例外は isError の結果になる', async () => {
    request.mockRejectedValue(new Error('ダミーの失敗'));

    const res = await rpc(
      'tools/call',
      { name: 'list_exercises', arguments: {} },
      { 'x-api-key': TOKEN },
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('ダミーの失敗');
    expect(text).toContain('isError');
  });
});
