import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './mcp-server.js';
import { apiKeyAuth } from './api-key.js';

// createMcpHandler はリクエストごとに createServer を呼ぶステートレス構成
const mcp = createMcpHandler(createServer, {
  // subscriptions/listen は通知を受け取るための長時間ストリームで、クライアントが
  // 繋いでいる間ずっと開いたままになる。Vercel の関数は実行上限 (300 秒) を過ぎると
  // 打ち切られるため、その上限まで居座ったうえでタイムアウトエラーになり、
  // 実行時間も浪費する。そのため受け付けない。
  // このサーバーはツール一覧が固定で通知を送らないため、失うものはない。
  maxSubscriptions: 0,
  onerror: (e) => {
    // 上記の拒否は想定どおりの動作なので、エラーとして記録しない
    if (e.message.includes('subscriptions/listen refused')) return;
    console.error(`[mcp] ハンドラー外のエラー: ${e.message}`);
  },
});

const app = new Hono();
app.use('/mcp', apiKeyAuth());
app.all('/mcp', (c) => mcp.fetch(c.req.raw));

export default app;
