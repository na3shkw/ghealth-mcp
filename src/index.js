import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './mcp-server.js';
import { apiKeyAuth } from './api-key.js';

// createMcpHandler はリクエストごとに createServer を呼ぶステートレス構成
const mcp = createMcpHandler(createServer);

const app = new Hono();
app.use('/mcp', apiKeyAuth());
app.all('/mcp', (c) => mcp.fetch(c.req.raw));

export default app;
