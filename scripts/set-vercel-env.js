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
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 認証情報ファイルの場所。src/auth-client.js と同じ環境変数で上書きできる
const clientSecretPath = process.env.GHEALTH_CLIENT_SECRET
  ? path.resolve(process.env.GHEALTH_CLIENT_SECRET)
  : path.join(repoRoot, 'client_secret.json');
const tokenPath = process.env.GHEALTH_TOKEN
  ? path.resolve(process.env.GHEALTH_TOKEN)
  : path.join(repoRoot, 'token.json');

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
  - vercel link 済みであること
`;

class UserError extends Error {}

function parseArgs(argv) {
  const options = {
    targets: 'production',
    force: false,
    mcpToken: false,
    sensitive: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--env':
        if (!argv[++i]) throw new UserError('--env には対象の環境を指定してください');
        options.targets = argv[i];
        break;
      case '--force':
        options.force = true;
        break;
      case '--mcp-token':
        options.mcpToken = true;
        break;
      case '--plain':
        options.sensitive = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-h':
      case '--help':
        return null;
      default:
        throw new UserError(`知らないオプションです: ${argv[i]}（--help で使い方を表示）`);
    }
  }
  return options;
}

/** JSON から 1 つのフィールドを取り出す。値そのものは表示しない */
function readField(file, pick, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new UserError(`${label} の取得元が見つかりません: ${file}`);
    throw new UserError(`${file} の読み取りに失敗しました: ${e.message}`);
  }

  const value = pick(parsed);
  if (typeof value !== 'string' || value === '') {
    throw new UserError(`${label} が ${file} に入っていません`);
  }
  if (value.includes('\n')) {
    throw new UserError(`${label} が複数行になっています: ${file}`);
  }
  return value;
}

/** 値は標準入力で渡す。vercel は非対話のとき stdin から読む */
function putEnv(options, name, value) {
  const args = ['env', 'add', name, options.targets, '--yes'];
  if (options.force) args.push('--force');
  if (options.sensitive) args.push('--sensitive');

  if (options.dryRun) {
    console.log(`  [dry-run] vercel ${args.join(' ')} <値は標準入力>`);
    return true;
  }

  const result = spawnSync('vercel', args, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (result.error?.code === 'ENOENT') {
    throw new UserError('vercel が見つかりません。PATH を確認してください');
  }

  if (result.status === 0) {
    console.log(`  ${name}: 設定しました`);
    return true;
  }

  console.error(`  ${name}: 失敗しました`);
  if (!options.force) {
    console.error('  既に同じ環境にある場合は --force を付けて実行してください');
  }
  return false;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    console.log(USAGE);
    return;
  }

  if (!fs.existsSync(path.join(repoRoot, '.vercel', 'project.json'))) {
    const message = 'Vercel プロジェクトに紐付いていません。先に vercel link を実行してください';
    // dry-run は何も変更しないので、警告だけにして残りの確認を続ける
    if (!options.dryRun) throw new UserError(message);
    console.warn(`警告: ${message}\n`);
  }

  // 1 つでも欠けていたら何も設定せずに終わるよう、先に全部読む
  const values = [
    ['GHEALTH_CLIENT_ID', readField(clientSecretPath, (j) => j?.installed?.client_id, 'クライアント ID')],
    [
      'GHEALTH_CLIENT_SECRET',
      readField(clientSecretPath, (j) => j?.installed?.client_secret, 'クライアントシークレット'),
    ],
    [
      'GHEALTH_REFRESH_TOKEN',
      readField(tokenPath, (j) => j?.refresh_token, 'リフレッシュトークン'),
    ],
  ];

  let mcpToken;
  if (options.mcpToken) {
    mcpToken = randomBytes(32).toString('hex');
    values.push(['GHEALTH_MCP_TOKEN', mcpToken]);
  }

  console.log(`対象の環境: ${options.targets}`);
  if (!options.sensitive) console.log('注意: --plain のため、値は機微な値として扱われません');
  console.log();

  const failed = values.filter(([name, value]) => !putEnv(options, name, value));

  if (mcpToken && !options.dryRun) {
    console.log();
    console.log('生成した GHEALTH_MCP_TOKEN（claude.ai のコネクタの x-api-key に設定する）:');
    console.log(`  ${mcpToken}`);
    console.log('この値はここでしか表示されない。');
  }

  console.log();
  if (failed.length > 0) {
    throw new UserError(`設定できなかった環境変数があります: ${failed.map(([n]) => n).join(', ')}`);
  }
  if (options.dryRun) {
    console.log('dry-run のため何も変更していません。');
  } else {
    console.log('完了。反映には再デプロイが必要: vercel --prod');
  }
}

try {
  main();
} catch (e) {
  if (e instanceof UserError) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
