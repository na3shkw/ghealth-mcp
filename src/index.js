import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './mcp-server.js';
import { apiKeyAuth } from './api-key.js';

// createMcpHandler はリクエストごとに createServer を呼ぶステートレス構成
const mcp = createMcpHandler(createServer, {
  onerror: (e) => console.error(`[mcp] ハンドラー外のエラー: ${e.message}`),
});

/**
 * JSON-RPC のメソッド名だけを覗く。
 * 引数とレスポンスは個人データを含むので触らない。tools/call だけは
 * どのツールかまで分かると切り分けに役立つので、ツール名も返す。
 */
async function peekMethod(request) {
  if (request.method !== 'POST') return '-';
  try {
    const { method, params } = await request.clone().json();
    if (method === 'tools/call' && params?.name) return `tools/call:${params.name}`;
    return method ?? '?';
  } catch {
    return '?';
  }
}

/**
 * どのリクエストが 300 秒の実行上限まで居座っているかを突き止めるための診断ログ。
 * ヘッダーが返った時点と、本文のストリームが閉じた時点を別々に記録する。
 * 原因が分かったら外す。
 */
let seq = 0;
async function logMcp(c) {
  const id = ++seq;
  const method = await peekMethod(c.req.raw);
  const started = Date.now();
  console.log(`[mcp#${id}] 開始 ${c.req.method} ${method}`);

  const res = await mcp.fetch(c.req.raw);
  console.log(`[mcp#${id}] 応答 ${res.status} ${Date.now() - started}ms ${method}`);

  if (!res.body) {
    console.log(`[mcp#${id}] 本文なし ${method}`);
    return res;
  }

  // ストリームが閉じた時点を知りたい。閉じなければこのログは出ない
  const body = res.body.pipeThrough(
    new TransformStream({
      flush() {
        console.log(`[mcp#${id}] 終了 ${Date.now() - started}ms ${method}`);
      },
    }),
  );
  return new Response(body, { status: res.status, headers: res.headers });
}

const app = new Hono();
app.use('/mcp', apiKeyAuth());
app.all('/mcp', logMcp);

export default app;
