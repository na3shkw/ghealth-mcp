#!/usr/bin/env node
/**
 * 手元の認証情報ファイルから値を取り出し、Vercel の環境変数として設定する。
 *
 * 値は標準入力で vercel に渡す。`--value` だとコマンドライン（ps や履歴）に残るため。
 * 取り出した値は画面にも出さない。
 *
 * 使い方: npm run vercel:env -- --help
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 認証情報ファイルの場所。src/auth-client.js と同じ環境変数で上書きできる
const credentialPath = (envName, fallback) =>
  process.env[envName] ? path.resolve(process.env[envName]) : path.join(repoRoot, fallback);

const clientSecretPath = credentialPath('GHEALTH_CLIENT_SECRET', 'client_secret.json');
const tokenPath = credentialPath('GHEALTH_TOKEN', 'token.json');

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

const USAGE = `手元の認証情報ファイルから値を取り出して Vercel の環境変数に設定する。

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

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      env: { type: 'string', default: 'production' },
      force: { type: 'boolean', default: false },
      'mcp-token': { type: 'boolean', default: false },
      plain: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }));
} catch (e) {
  fail(`オプションの指定が不正です（--help で使い方を表示）: ${e.message}`);
}

if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

if (!fs.existsSync(path.join(repoRoot, '.vercel', 'project.json'))) {
  const message = 'Vercel プロジェクトに紐付いていません。先に vercel link を実行してください';
  // dry-run は何も変更しないので、警告だけにして残りの確認を続ける
  if (!opts['dry-run']) fail(message);
  console.warn(`警告: ${message}\n`);
}

/** 認証情報の JSON を読む。中身はどこにも表示しない */
function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') fail(`${label}の取得元が見つかりません: ${file}`);
    fail(`${file} の読み取りに失敗しました: ${e.message}`);
  }
}

/** 環境変数に入れられる 1 行の文字列であることを確かめる */
function field(value, label, file) {
  if (typeof value !== 'string' || value === '') fail(`${label}が ${file} に入っていません`);
  if (value.includes('\n')) fail(`${label}が複数行になっています: ${file}`);
  return value;
}

/** 値は標準入力で渡す。vercel は非対話のとき stdin から読む */
function putEnv(name, value) {
  const args = ['env', 'add', name, opts.env, '--yes'];
  if (opts.force) args.push('--force');
  if (!opts.plain) args.push('--sensitive');

  if (opts['dry-run']) {
    console.log(`  [dry-run] vercel ${args.join(' ')} <値は標準入力>`);
    return true;
  }

  const { status, error } = spawnSync('vercel', args, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (error?.code === 'ENOENT') fail('vercel が見つかりません。PATH を確認してください');
  if (status === 0) {
    console.log(`  ${name}: 設定しました`);
    return true;
  }

  console.error(`  ${name}: 失敗しました`);
  if (!opts.force) console.error('  既に同じ環境にある場合は --force を付けて実行してください');
  return false;
}

// 1 つでも欠けていたら何も設定せずに終わるよう、先に全部読む
const client = readJson(clientSecretPath, 'クライアント情報');
const token = readJson(tokenPath, 'トークン');

const entries = [
  ['GHEALTH_CLIENT_ID', field(client?.installed?.client_id, 'クライアント ID', clientSecretPath)],
  [
    'GHEALTH_CLIENT_SECRET',
    field(client?.installed?.client_secret, 'クライアントシークレット', clientSecretPath),
  ],
  ['GHEALTH_REFRESH_TOKEN', field(token?.refresh_token, 'リフレッシュトークン', tokenPath)],
];

let mcpToken;
if (opts['mcp-token']) {
  mcpToken = randomBytes(32).toString('hex');
  entries.push(['GHEALTH_MCP_TOKEN', mcpToken]);
}

console.log(`対象の環境: ${opts.env}`);
if (opts.plain) console.log('注意: --plain のため、値は機微な値として扱われません');
console.log();

const failed = entries.filter(([name, value]) => !putEnv(name, value)).map(([name]) => name);

if (mcpToken && !opts['dry-run']) {
  console.log('\n生成した GHEALTH_MCP_TOKEN（claude.ai のコネクタの x-api-key に設定する）:');
  console.log(`  ${mcpToken}`);
  console.log('この値はここでしか表示されない。');
}

console.log();
if (failed.length > 0) fail(`設定できなかった環境変数があります: ${failed.join(', ')}`);
console.log(
  opts['dry-run']
    ? 'dry-run のため何も変更していません。'
    : '完了。反映には再デプロイが必要: vercel --prod',
);
