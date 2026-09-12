# CLAUDE.md

Google Health API の運動・安静時心拍数・睡眠データを返すローカル MCP サーバー。概要・必要な環境・セットアップ手順は README.md を参照。

## コマンド

```bash
npm test                       # vitest を 1 回実行
npx vitest run test/format.test.js -t '入眠'   # 単体で絞る場合
node src/fetch.js <path>       # 生 JSON を見る調査用。path は /v4/users/me/ 以降
```

初回認証（`npm run auth`）はブラウザでの同意操作が必要で、手順は README.md にある。

サーバー本体（`npm start`）は stdio トランスポートなので手で起動しても対話できない。動作確認は vitest か、登録済みの `ghealth` MCP ツール経由で行う。

## 構成の方針

- `src/server.js` はツール定義と入出力スキーマだけを持つ。API 呼び出しと整形は `src/health.js` に置く
- `src/health.js` の整形関数（`summarize`, `detail`, `restingHeartRate`, `sleepSession` など）は純粋関数として export し、テストから直接叩く。ネットワークを使う `list*` / `get*` は `../src/auth-client.js` を `vi.mock` して検証する
- 新しいデータ型を足すときは「フィルタ組み立て + ページング」の `list*` 関数と、dataPoint 1 件を整形する純粋関数に分ける

## Google Health API で踏みやすい点

- **単位変換はサーバー側で行う。** 生の `distanceMillimeters` や `averagePaceSecondsPerMeter` を返さない。モデルに計算させないのがこのプロジェクトの主目的
- **整数が文字列で来る。** `num()` を通す。`Number('')` は 0 になるので空文字を弾いてから変換する
- **duration は `"2400s"` / `"0.316s"` 形式。** `parseSeconds()` を通す
- **ローカル日付は `startUtcOffset` を足して組み立てる。** UTC のまま日付を切ると深夜・早朝のランがずれる（`toLocalDate()`）
- **`nextPageToken` を必ず辿る。** 指定しているページサイズは exercise 50、resting heart rate 100、sleep 25。上限だと確認できているのは sleep の 25 だけ
- **期間フィルタの対象フィールドはデータ型ごとに違う。** exercise は `interval.civil_start_time`、sleep は `interval.civil_end_time`（起床時刻）でしか絞れない。どちらも `to` を含めるため「翌日 0 時未満」（`T00:00:00` 付き）で切る。resting heart rate の `daily_resting_heart_rate.date` は日単位の値なので、時刻を付けずに「翌日未満」で切る
- **`summary.minutesToFallAsleep` は常に 0。** Fitbit 側が埋めていない。入眠潜時は `stages` 冒頭の `AWAKE` 区間から算出する（`sleepOnsetMinutes()`）
- 仕様の調査メモは `tmp/` にある（gitignore 済み）

## 認証情報の扱い

`client_secret.json` と `token.json` は読み取り禁止。`.claude/settings.json` の permissions deny と PreToolUse フックで、Read と Bash の両方をブロックしている。ファイル名を含む Bash コマンドはフックに弾かれるため、これらに触れる作業はヒアドキュメントではなく編集ツール側で行うか、ユーザーに依頼する。中身を確認する必要が出た場合も自分で読まず、ユーザーに聞くこと。

## 個人データの扱い

実 API から返ってきたヘルスデータ（運動・心拍数・睡眠の記録、GPS ログ、ユーザー ID）を、コード・テスト・コミットメッセージに入れない。リポジトリに残すのはレスポンスの**構造**だけで、値はすべて作り物にする。

- テストのフィクスチャは `test/fixtures.js` のように、実 API の形に合わせたダミー値で書く。実データをコピーして日付だけ変える、といったことはしない
- `node src/fetch.js` で取得した生 JSON は `tmp/`（gitignore 済み）に置く。調査メモも同様
- 実データを見て分かったことをドキュメントに書くときは、具体的な数値や日付ではなく仕様として書く
- 会話中に実データが出てきても、そのままファイルに書き出さない。必要ならユーザーに確認する

## 言語

コメント・ツールの説明文・テスト名・コミットメッセージはすべて日本語で書く。
