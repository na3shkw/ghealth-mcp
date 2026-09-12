# ghealth-mcp

Google Health API に記録された運動・安静時心拍数・睡眠のデータを Claude から参照するためのローカル MCP サーバー。

単位変換や整形はサーバー側で済ませ、モデルにミリメートルや秒/メートルの計算をさせない方針。距離は km、時間は `M:SS`（1 時間を超えると `H:MM:SS`）、ペースは `M:SS/km` のように、そのまま読める形で返す。

## 必要なもの

- Node.js 24 以上（ESM、トップレベル await を使用）
- Google Cloud プロジェクトで有効化した Google Health API
- デスクトップアプリ型の OAuth クライアント

## セットアップ

1. 依存をインストールする。

   ```bash
   npm install
   ```

2. Google Cloud Console でデスクトップアプリ型の OAuth クライアントを作成し、JSON をリポジトリ直下に `client_secret.json` として置く。

3. 認証してトークンを取得する。

   ```bash
   npm run auth
   ```

   認証 URL が標準出力に出るのでブラウザで開き、同意する。環境変数 `BROWSER` にブラウザのパスが設定されていれば自動で開く。完了すると `token.json` が書き出される。

   要求するスコープ（すべて readonly）:

   - `googlehealth.activity_and_fitness.readonly`
   - `googlehealth.location.readonly`
   - `googlehealth.health_metrics_and_measurements.readonly`
   - `googlehealth.sleep.readonly`

4. MCP サーバーとして登録する。

   ```bash
   claude mcp add ghealth -- node "$(pwd)/src/server.js"
   ```

認証情報の 2 ファイルは gitignore 済み。MCP サーバーは環境変数 `GHEALTH_CLIENT_SECRET` / `GHEALTH_TOKEN` でパスを指定でき、指定がなければリポジトリ直下を見るため作業ディレクトリに関係なく動く。ただし初回認証（`npm run auth`）と調査用の `src/fetch.js` はリポジトリ直下の固定パスを読み書きするので、この 2 つは環境変数を見ない。

## ツール

### `list_exercises`

運動を新しい順に一覧する。

| 入力 | 説明 |
| --- | --- |
| `from` | 開始日（`YYYY-MM-DD`、ローカル日付）。省略時は `to` の 30 日前 |
| `to` | 終了日（この日を含む）。省略時は今日 |
| `limit` | 最大件数。既定 20、上限 200 |

返すフィールド: `id`, `localDate`, `exerciseType`, `displayName`, `distanceKm`, `duration`, `pacePerKm`, `avgHeartRate`, `calories`, `hasGps`

### `get_exercise`

運動 1 件の詳細を返す。`id` は `list_exercises` が返す値。

一覧の全項目に加えて、`splits`（距離ごとのラップ）、`steps`, `cadence`, `strideLengthCm`, `verticalOscillationCm`, `verticalRatio`, `groundContactTimeMs`, `elevationGainM`, `activeZoneMinutes`, `heartRateZones`（light / moderate / vigorous / peak の分数）。

### `get_resting_heart_rate`

日ごとの安静時心拍数を日付の昇順で返す。入力は `from` / `to`。予備心拍数（最大心拍数 − 安静時心拍数）を出して心拍ゾーンを評価するときに使う。

返すフィールド: `localDate`, `bpm`

### `get_sleep`

睡眠セッションを就寝時刻の昇順で返す。入力は `from` / `to`。睡眠は日をまたぐため、期間の指定も `localDate` も**起床日**が基準。

返すフィールド: `id`, `localDate`, `bedtime`, `wakeTime`, `type`, `isMainSleep`, `timeInBed`, `timeAsleep`, `awakeMinutes`, `minutesToFallAsleep`, `sleepOnsetMinutes`, `shortAwakenings`, `efficiencyPercent`, `stageMinutes`（deep / light / rem / awake ほか）

`sleepOnsetMinutes` は入眠潜時。API の `summary.minutesToFallAsleep` は Fitbit 側が埋めておらず常に 0 で来るため、セッション冒頭に連続する `AWAKE` 区間の長さから算出している（`minutesToFallAsleep` は 0 以外が入っていたときだけ返す）。起点は「布団に入った時刻」ではなく「デバイスが睡眠セッションを検出した時刻」なので、体感の寝付きの悪さより短く出る。

## 開発

```bash
npm test          # vitest を 1 回実行
npm run test:watch
npm start         # stdio で MCP サーバーを起動（通常は Claude 側から起動される）
```

API のレスポンスを生で確認したいときは調査用スクリプトを使う。

```bash
node src/fetch.js dataTypes/exercise/dataPoints
```

`https://health.googleapis.com/v4/users/me/` に続くパスを引数に取る。認証情報を相対パスで読むため、リポジトリ直下から実行すること。

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/server.js` | MCP のツール定義。入力スキーマと説明文に専念 |
| `src/health.js` | Google Health API の呼び出しとレスポンスの整形 |
| `src/auth-client.js` | 保存済みトークンから `OAuth2Client` を組み立てる。リフレッシュ時の書き戻しも担当 |
| `src/auth.js` | 初回認証（ループバックサーバー + PKCE） |
| `src/fetch.js` | 生 JSON を出す調査用スクリプト |
| `test/` | `health.js` の整形・フィルタ組み立てのテスト |
