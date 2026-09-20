# CLAUDE.md

Google Health API の運動・安静時心拍数・睡眠データを返す MCP サーバー。手元では stdio、Vercel 上では HTTP で同じツールを提供する。概要・必要な環境・セットアップ手順は README.md を参照。

## コマンド

```bash
npm test                       # vitest を 1 回実行
npx vitest run test/format.test.js -t '入眠'   # 単体で絞る場合
node src/fetch.js <path>       # 生 JSON を見る調査用。path は /v4/users/me/ 以降
npm run vercel:env -- --dry-run   # Vercel の環境変数に何を設定するか確認する
```

初回認証（`npm run auth`）はブラウザでの同意操作が必要で、手順は README.md にある。

サーバー本体（`npm start`）は stdio トランスポートなので手で起動しても対話できない。動作確認は vitest か、登録済みの `ghealth` MCP ツール経由で行う。JSON-RPC を直接流し込みたい場合は、`initialize` → `notifications/initialized` → 本命のリクエストを 1 行ずつ `node src/server.js` にパイプする。

HTTP 版（`src/index.js`）は Hono アプリを default export しているだけなので、テストからは `app.request('/mcp', ...)` で直接叩ける。サーバーを立てる必要はない。

## 構成の方針

- ツール定義と入出力スキーマは `src/mcp-server.js` の `createServer()` に集約する。`src/server.js`（stdio）と `src/index.js`（HTTP）は、このファクトリーを起動方法に繋ぐだけ。API 呼び出しと整形は `src/health.js` に置く
- `createServer()` は HTTP 版ではリクエストごとに呼ばれる。インスタンス間で状態を持たせない
- MCP SDK は v2（`@modelcontextprotocol/server`）に統一済み。v1（`@modelcontextprotocol/sdk`）は使わない。`inputSchema` は v2 で素のオブジェクトが非推奨なので `z.object({ ... })` で包む
- `src/health.js` の整形関数（`summarize`, `detail`, `restingHeartRate`, `sleepSession` など）は純粋関数として export し、テストから直接叩く。ネットワークを使う `list*` / `get*` は `../src/auth-client.js` を `vi.mock` して検証する
- 新しいデータ型を足すときは「フィルタ組み立て + ページング」の `list*` 関数と、dataPoint 1 件を整形する純粋関数に分ける
- 実行環境のタイムゾーンに依存しない。Vercel は UTC で動くので、`from` / `to` 省略時の「今日」は `todayInTokyo()` で日本時間に固定している。日時の組み立ては API が返す UTC オフセットか epoch 値から行い、`getFullYear()` などローカル時刻を読む API は使わない

## Google Health API で踏みやすい点

- **単位変換はサーバー側で行う。** 生の `distanceMillimeters` や `averagePaceSecondsPerMeter` を返さない。モデルに計算させないのがこのプロジェクトの主目的
- **整数が文字列で来る。** `num()` を通す。`Number('')` は 0 になるので空文字を弾いてから変換する
- **duration は `"2400s"` / `"0.316s"` 形式。** `parseSeconds()` を通す
- **ローカル日付は `startUtcOffset` を足して組み立てる。** UTC のまま日付を切ると深夜・早朝のランがずれる（`toLocalDate()`）
- **`nextPageToken` を必ず辿る。** 指定しているページサイズは exercise 50、resting heart rate 100、sleep 25、distance / steps 100、heart-rate 1000。上限だと確認できているのは sleep の 25 だけ。heart-rate は数秒間隔で返るので 1 回の運動でも複数ページになる
- **期間フィルタの対象フィールドはデータ型ごとに違う。** exercise は `interval.civil_start_time`、sleep は `interval.civil_end_time`（起床時刻）でしか絞れない。どちらも `to` を含めるため「翌日 0 時未満」（`T00:00:00` 付き）で切る。resting heart rate の `daily_resting_heart_rate.date` は日単位の値なので、時刻を付けずに「翌日未満」で切る
- **Interval 型と Sample 型でフィルタの構文が違う。** distance / steps は `<型>.interval.start_time`、heart-rate は `heart_rate.sample_time.physical_time` で絞る
- **distance / steps には複数のソースが混ざる。** 時計由来は区間長が 60 秒ちょうどで `dataSource.device` を持ち、スマホ由来は区間長がばらばらで `device` が無い。両方足すと二重計上になるので、「60 秒ちょうど かつ `device` あり」だけを採用する（`isWatchMinute()`）
- **距離や歩数が 0 の区間はレコードごと返ってこない。** 値 0 のレコードは存在しないので、時間窓の側から分を並べて欠落を 0 で埋める。一方、心拍サンプルが無い分を 0 で埋めると安静時心拍と区別できなくなるため `null` にする
- **運動の `activeDuration` はオートポーズ分が抜けている。** 時間窓を組むときは duration ではなく `interval.endTime` を使う
- **`exercise.exerciseEvents` はあったり無かったりする。** 観測できたのは `START` / `STOP` の 2 件だけで、値は `interval` の開始・終了と一致する。ドキュメントにある pause / resume は実データでは確認できていないので、秒精度の停止検出には使えない
- **`summary.minutesToFallAsleep` は常に 0。** Fitbit 側が埋めていない。入眠潜時は `stages` 冒頭の `AWAKE` 区間から算出する（`sleepOnsetMinutes()`）
- 仕様の調査メモは `tmp/` にある（gitignore 済み）

## 認証情報の扱い

`src/auth-client.js` は 2 つの経路を持つ。`GHEALTH_REFRESH_TOKEN` があれば環境変数から `OAuth2Client` を組み立て（access token はメモリのみ、書き戻しなし）、無ければ手元のファイルから読む。リモート（Vercel）は前者、手元は後者。`GHEALTH_CLIENT_SECRET` は環境変数の経路ではシークレットの値そのもの、ファイルの経路ではクライアント情報 JSON のパスという二役になっているので混同しないこと。

Vercel への環境変数の設定は `scripts/set-vercel-env.js`（`npm run vercel:env`）が担う。このスクリプトは認証情報ファイルを読むが、取り出した値は画面に出さず、`vercel` へは標準入力で渡す（`--value` だとコマンドラインに残る）。値の確認が必要なときもスクリプトに出力を足さず、ユーザーに聞くこと。この 2 つ（値を出さない・標準入力で渡す）は `test/set-vercel-env.test.js` で検証しているので、壊さないこと。

スクリプトの副作用（ファイル読み込み・プロセス起動・出力）は `main(argv, deps)` の `deps` 経由にしてある。テストは実ファイルにも `vercel` にも触らず、`deps` を差し替えて検証する。

`client_secret.json` と `token.json` は読み取り禁止。`.claude/settings.json` の permissions deny と PreToolUse フックで、Read と Bash の両方をブロックしている。ファイル名を含む Bash コマンドはフックに弾かれるため、これらに触れる作業はヒアドキュメントではなく編集ツール側で行うか、ユーザーに依頼する。中身を確認する必要が出た場合も自分で読まず、ユーザーに聞くこと。

## 個人データの扱い

実 API から返ってきたヘルスデータ（運動・心拍数・睡眠の記録、GPS ログ、ユーザー ID）を、コード・テスト・コミットメッセージに入れない。リポジトリに残すのはレスポンスの**構造**だけで、値はすべて作り物にする。

- テストのフィクスチャは `test/fixtures.js` のように、実 API の形に合わせたダミー値で書く。実データをコピーして日付だけ変える、といったことはしない
- `node src/fetch.js` で取得した生 JSON は `tmp/`（gitignore 済み）に置く。調査メモも同様
- 実データを見て分かったことをドキュメントに書くときは、具体的な数値や日付ではなく仕様として書く
- 会話中に実データが出てきても、そのままファイルに書き出さない。必要ならユーザーに確認する

## 言語

コメント・ツールの説明文・テスト名・コミットメッセージはすべて日本語で書く。
