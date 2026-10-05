#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './mcp-server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 起動先の worktree のパスを返す。実際の環境変数を優先し、無ければ .env から読む。
 * 起動の仕方で挙動が変わらないようにするため .env のほかの変数は取り込まない。
 */
export function worktreePath({ env, readFile, root }) {
  if (env.GHEALTH_WORKTREE) return env.GHEALTH_WORKTREE;

  let text;
  try {
    text = readFile(path.join(root, '.env'));
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
  return parseEnv(text).GHEALTH_WORKTREE || undefined;
}

const defaultDeps = () => ({
  root: repoRoot,
  env: process.env,
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  importModule: (url) => import(url),
  serve: serveStdio,
  // 標準出力は MCP の通信路なので、ログは必ず標準エラーに出す
  log: console.error,
});

/**
 * --worktree を付けると、GHEALTH_WORKTREE が指す worktree のツール定義で起動する。
 * Claude Desktop などに登録した起動パスを書き換えずに、ブランチの動作を確かめるための開発用。
 */
export async function main(argv, deps = defaultDeps()) {
  if (!argv.includes('--worktree')) return deps.serve(createServer);

  const worktree = worktreePath(deps);
  if (!worktree) {
    deps.log('GHEALTH_WORKTREE が未設定のため、このリポジトリのツール定義で起動します');
    return deps.serve(createServer);
  }

  // 相対パスは起動時のカレントディレクトリではなく、このリポジトリ直下を起点にする
  const modulePath = path.resolve(deps.root, worktree, 'src', 'mcp-server.js');

  const mod = await deps.importModule(pathToFileURL(modulePath).href);
  if (typeof mod.createServer !== 'function') {
    throw new Error(`createServer が export されていません: ${modulePath}`);
  }
  deps.log(`worktree のツール定義で起動します: ${modulePath}`);
  return deps.serve(mod.createServer);
}

// 直接実行されたときだけ走らせる。npm の bin はシンボリックリンク越しに起動するので実体で比べる
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
