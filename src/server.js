#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './mcp-server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `git wt` の既定の基本ディレクトリ */
const WORKTREE_BASE = '.wt';

/**
 * 起動先の worktree 名を返す。実際の環境変数を優先し、無ければ .env から読む。
 * .env のほかの変数（GHEALTH_TZ など）は取り込まない。起動の仕方で挙動が変わらないようにするため
 */
export function worktreeName({ env, readFile, root }) {
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

/** worktree の mcp-server.js の絶対パス。基本ディレクトリの外を指す名前は受け付けない */
export function worktreeModulePath(root, name) {
  const base = path.join(root, WORKTREE_BASE);
  const dir = path.resolve(base, name);
  const rel = path.relative(base, dir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`GHEALTH_WORKTREE には ${WORKTREE_BASE}/ 直下の worktree 名を指定してください: ${name}`);
  }
  return path.join(dir, 'src', 'mcp-server.js');
}

const defaultDeps = () => ({
  root: repoRoot,
  env: process.env,
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  exists: (file) => fs.existsSync(file),
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

  const name = worktreeName(deps);
  if (!name) {
    deps.log('GHEALTH_WORKTREE が未設定のため、このリポジトリのツール定義で起動します');
    return deps.serve(createServer);
  }

  // 指定を誤ったまま黙ってこのリポジトリで起動すると、古いコードを確かめていることに気付けない
  const modulePath = worktreeModulePath(deps.root, name);
  if (!deps.exists(modulePath)) throw new Error(`worktree が見つかりません: ${modulePath}`);

  // worktree には認証情報ファイルを置かない。worktree 側の auth-client.js は
  // 自分のリポジトリ直下を読みに行くため、こちらで読んだ値を環境変数の経路で渡す
  const { credentialEntries, credentialPaths, readJson } = await import(
    '../scripts/set-vercel-env.js'
  );
  const { clientSecretPath, tokenPath } = credentialPaths(deps.root);
  const client = readJson(clientSecretPath, 'クライアント情報', deps.readFile);
  const token = readJson(tokenPath, 'トークン', deps.readFile);
  for (const [key, value] of credentialEntries(client, token, clientSecretPath, tokenPath)) {
    deps.env[key] = value;
  }

  const mod = await deps.importModule(pathToFileURL(modulePath).href);
  if (typeof mod.createServer !== 'function') {
    throw new Error(`createServer が export されていません: ${modulePath}`);
  }
  deps.log(`worktree ${name} のツール定義で起動します`);
  return deps.serve(mod.createServer);
}

// 直接実行されたときだけ走らせる。npm の bin はシンボリックリンク越しに起動するので実体で比べる
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
