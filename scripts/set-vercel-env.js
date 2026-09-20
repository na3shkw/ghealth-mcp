#!/usr/bin/env node
/**
 * 手元の認証情報ファイルから値を取り出し、Vercel の環境変数として設定する。
 *
 * 値は標準入力で vercel に渡す。`--value` だとコマンドライン（ps や履歴）に残るため。
 * 取り出した値は画面にも出さない。
 *
 * 使い方: npm run vercel:env -- --help
 *
 * テストから叩けるよう、副作用（ファイル・プロセス・出力）は main() の deps 経由にしてある。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 使い方の誤りを表す。想定外の例外と区別してメッセージだけ出すために使う */
export class UserError extends Error {}

export const usage = (clientSecretPath, tokenPath) =>
  `手元の認証情報ファイルから値を取り出して Vercel の環境変数に設定する。

  npm run vercel:env -- [オプション]

設定される環境変数:
  GHEALTH_CLIENT_ID       ${path.basename(clientSecretPath)} の installed.client_id
  GHEALTH_CLIENT_SECRET   ${path.basename(clientSecretPath)} の installed.client_secret
  GHEALTH_REFRESH_TOKEN   ${path.basename(tokenPath)} の refresh_token
  GHEALTH_MCP_TOKEN       --mcp-token を付けたときだけ。新しく生成する

オプション:
  --env <targets>  対象の環境。カンマ区切り (既定: production)
  --force          同じ環境に既にある値を上書きする
  --mcp-token      GHEALTH_MCP_TOKEN を新しく生成して設定する。値は一度だけ画面に出るので、
                   claude.ai のコネクタの x-api-key にも同じ値を設定すること
  --plain          機微な値 (Secret) ではなく通常の値として登録する
  --dry-run        実際には設定せず、何をするかだけ表示する
  -h, --help       この使い方を表示する

前提:
  - 手元のセットアップ (クライアント情報の配置と npm run auth) が済んでいること
  - vercel link 済みで、vercel に PATH が通っていること
`;

/** 認証情報ファイルの場所。src/auth-client.js と同じ環境変数で上書きできる */
export function credentialPaths(env = process.env, root = repoRoot) {
  const resolve = (envName, fallback) =>
    env[envName] ? path.resolve(env[envName]) : path.join(root, fallback);
  return {
    clientSecretPath: resolve('GHEALTH_CLIENT_SECRET', 'client_secret.json'),
    tokenPath: resolve('GHEALTH_TOKEN', 'token.json'),
  };
}

export function parseOptions(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        env: { type: 'string', default: 'production' },
        force: { type: 'boolean', default: false },
        'mcp-token': { type: 'boolean', default: false },
        plain: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
    return values;
  } catch (e) {
    throw new UserError(`オプションの指定が不正です（--help で使い方を表示）: ${e.message}`);
  }
}

/** vercel env add に渡す引数を組み立てる。値は含めない（標準入力で渡すため） */
export function vercelArgs(name, opts) {
  const args = ['env', 'add', name, opts.env, '--yes'];
  if (opts.force) args.push('--force');
  if (!opts.plain) args.push('--sensitive');
  return args;
}

/** 認証情報の JSON を読む。中身はどこにも表示しない */
export function readJson(file, label, readFile) {
  let text;
  try {
    text = readFile(file);
  } catch (e) {
    if (e.code === 'ENOENT') throw new UserError(`${label}の取得元が見つかりません: ${file}`);
    throw new UserError(`${file} の読み取りに失敗しました: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UserError(`${file} の読み取りに失敗しました: ${e.message}`);
  }
}

/** 環境変数に入れられる 1 行の文字列であることを確かめる */
export function field(value, label, file) {
  if (typeof value !== 'string' || value === '') {
    throw new UserError(`${label}が ${file} に入っていません`);
  }
  if (value.includes('\n')) {
    throw new UserError(`${label}が複数行になっています: ${file}`);
  }
  return value;
}

/** 設定する [名前, 値] の組を作る。1 つでも欠けていればここで失敗する */
export function credentialEntries(client, token, clientSecretPath, tokenPath) {
  return [
    ['GHEALTH_CLIENT_ID', field(client?.installed?.client_id, 'クライアント ID', clientSecretPath)],
    [
      'GHEALTH_CLIENT_SECRET',
      field(client?.installed?.client_secret, 'クライアントシークレット', clientSecretPath),
    ],
    ['GHEALTH_REFRESH_TOKEN', field(token?.refresh_token, 'リフレッシュトークン', tokenPath)],
  ];
}

const defaultDeps = () => ({
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  exists: (file) => fs.existsSync(file),
  spawn: spawnSync,
  log: console.log,
  warn: console.warn,
  error: console.error,
  randomToken: () => randomBytes(32).toString('hex'),
  env: process.env,
  root: repoRoot,
});

/** 終了コードを返す。プロセスは終わらせない（テストから呼べるように） */
export function main(argv = [], overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };

  try {
    return run(argv, deps);
  } catch (e) {
    if (e instanceof UserError) {
      deps.error(`エラー: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

function run(argv, deps) {
  const opts = parseOptions(argv);
  const { clientSecretPath, tokenPath } = credentialPaths(deps.env, deps.root);

  if (opts.help) {
    deps.log(usage(clientSecretPath, tokenPath));
    return 0;
  }

  if (!deps.exists(path.join(deps.root, '.vercel', 'project.json'))) {
    const message = 'Vercel プロジェクトに紐付いていません。先に vercel link を実行してください';
    // dry-run は何も変更しないので、警告だけにして残りの確認を続ける
    if (!opts['dry-run']) throw new UserError(message);
    deps.warn(`警告: ${message}\n`);
  }

  // 1 つでも欠けていたら 1 件も設定せずに終わるよう、先に全部読んで検証する
  const client = readJson(clientSecretPath, 'クライアント情報', deps.readFile);
  const token = readJson(tokenPath, 'トークン', deps.readFile);
  const entries = credentialEntries(client, token, clientSecretPath, tokenPath);

  let mcpToken;
  if (opts['mcp-token']) {
    mcpToken = deps.randomToken();
    entries.push(['GHEALTH_MCP_TOKEN', mcpToken]);
  }

  deps.log(`対象の環境: ${opts.env}`);
  if (opts.plain) deps.log('注意: --plain のため、値は機微な値として扱われません');
  deps.log();

  const failed = entries
    .filter(([name, value]) => !putEnv(name, value, opts, deps))
    .map(([name]) => name);

  if (mcpToken && !opts['dry-run']) {
    deps.log('\n生成した GHEALTH_MCP_TOKEN（claude.ai のコネクタの x-api-key に設定する）:');
    deps.log(`  ${mcpToken}`);
    deps.log('この値はここでしか表示されない。');
  }

  deps.log();
  if (failed.length > 0) {
    throw new UserError(`設定できなかった環境変数があります: ${failed.join(', ')}`);
  }
  deps.log(
    opts['dry-run']
      ? 'dry-run のため何も変更していません。'
      : '完了。反映には再デプロイが必要: vercel --prod',
  );
  return 0;
}

/** 値は標準入力で渡す。vercel は非対話のとき stdin から読む */
function putEnv(name, value, opts, deps) {
  const args = vercelArgs(name, opts);

  if (opts['dry-run']) {
    deps.log(`  [dry-run] vercel ${args.join(' ')} <値は標準入力>`);
    return true;
  }

  const { status, error } = deps.spawn('vercel', args, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (error?.code === 'ENOENT') {
    throw new UserError('vercel が見つかりません。PATH を確認してください');
  }
  if (status === 0) {
    deps.log(`  ${name}: 設定しました`);
    return true;
  }

  deps.error(`  ${name}: 失敗しました`);
  if (!opts.force) deps.error('  既に同じ環境にある場合は --force を付けて実行してください');
  return false;
}

// 直接実行されたときだけ走らせる。import 時は何もしない
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
