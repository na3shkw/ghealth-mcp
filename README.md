# ghealth-mcp

Google Health API に記録された運動・安静時心拍数・睡眠のデータを Claude から参照するための MCP サーバー。手元では stdio、Vercel 上では HTTP（ストリーマブル HTTP）で、同じツールを提供する。

単位変換や整形はサーバー側で済ませ、モデルにミリメートルや秒/メートルの計算をさせない方針。距離は km、時間は `M:SS`（1 時間を超えると `H:MM:SS`）、ペースは `M:SS/km` のように、そのまま読める形で返す。

## 必要なもの

- Node.js 24 以上（ESM、トップレベル await を使用）
- Google Cloud プロジェクトで有効化した Google Health API
- デスクトップアプリ型の OAuth クライアント

## セットアップ（手元で stdio として使う）

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

## リモート MCP として公開する（Vercel）

`src/index.js` が Hono アプリを export しており、`POST /mcp` でストリーマブル HTTP の MCP エンドポイントになる。ツールの実装は stdio 版と共通（`src/mcp-server.js`）。

Vercel には書き込めるファイルシステムが無いので、認証情報はファイルではなく環境変数で渡す。`GHEALTH_REFRESH_TOKEN` が設定されていれば自動的にこの経路になる。リフレッシュして得た access token はインスタンスのメモリに置くだけで保存しない（Google はリフレッシュ時に refresh_token を差し替えないため、これで足りる）。

設定する環境変数は 4 つ。いずれも JSON ではなく値そのもの（1 行の文字列）を入れる。

| 環境変数 | 値 | 取得元 |
| --- | --- | --- |
| `GHEALTH_CLIENT_ID` | OAuth クライアント ID | `client_secret.json` の `installed.client_id` |
| `GHEALTH_CLIENT_SECRET` | OAuth クライアントシークレット | `client_secret.json` の `installed.client_secret` |
| `GHEALTH_REFRESH_TOKEN` | リフレッシュトークン | `token.json` の `refresh_token` |
| `GHEALTH_MCP_TOKEN` | MCP クライアントに持たせる任意の秘密文字列 | 自分で生成する（例: `openssl rand -hex 32`） |

前 3 つは手元のセットアップで作られるファイルから取り出す。つまり、上の「セットアップ（手元で stdio として使う）」の手順 2（`client_secret.json` の配置）と手順 3（`npm run auth` による `token.json` の生成）を先に済ませておく必要がある。値の取り出しは次の通り。

```bash
jq -r '.installed.client_id'     client_secret.json   # GHEALTH_CLIENT_ID
jq -r '.installed.client_secret' client_secret.json   # GHEALTH_CLIENT_SECRET
jq -r '.refresh_token'           token.json           # GHEALTH_REFRESH_TOKEN
```

`token.json` に `refresh_token` が入っていない場合は、`npm run auth` をやり直して同意画面を通す（Google は初回の同意でしか refresh_token を返さないことがある）。

Vercel への登録は Vercel のダッシュボードか、CLI なら次の通り。

```bash
vercel env add GHEALTH_CLIENT_ID production   # 値はプロンプトに貼り付ける
```

`GHEALTH_CLIENT_SECRET` は、手元のファイル経路では `client_secret.json` の**パス**、この環境変数経路では**シークレットの値そのもの**という二役になっている。どちらの経路を使うかは `GHEALTH_REFRESH_TOKEN` の有無だけで決まる。

クライアントの認証は `x-api-key` ヘッダーと `GHEALTH_MCP_TOKEN` の定数時間比較。`GHEALTH_MCP_TOKEN` が未設定のときは設定漏れによる無認証公開を避けるため全て拒否する。401 に `WWW-Authenticate` は付けない（付けると claude.ai 側が OAuth の探索を始めてしまう）。

claude.ai のカスタムコネクタに登録するときは、認証方式を「サインインなし」にしたうえでリクエストヘッダーに `x-api-key` を設定する。「今すぐサインイン」を選ぶと、ヘッダーがあっても OAuth が始まって失敗する。

## ツール

### `list_exercises`

運動を新しい順に一覧する。

| 入力 | 説明 |
| --- | --- |
| `from` | 開始日（`YYYY-MM-DD`、ローカル日付）。省略時は `to` の 30 日前 |
| `to` | 終了日（この日を含む）。省略時は今日 |
| `limit` | 最大件数。既定 20、上限 200 |

`from` / `to` を省略したときの「今日」は日本時間で決まる（実行環境が UTC でもずれない）。この扱いは `get_resting_heart_rate` / `get_sleep` でも同じ。

返すフィールド: `id`, `localDate`, `exerciseType`, `displayName`, `distanceKm`, `duration`, `pacePerKm`, `avgHeartRate`, `calories`, `hasGps`

### `get_exercise`

運動 1 件の詳細を返す。`id` は `list_exercises` が返す値。

一覧の全項目に加えて、`splits`（距離ごとのラップ）、`steps`, `cadence`, `strideLengthCm`, `verticalOscillationCm`, `verticalRatio`, `groundContactTimeMs`, `elevationGainM`, `activeZoneMinutes`, `heartRateZones`（light / moderate / vigorous / peak の分数）。

`events` は記録された開始・停止の操作（`exerciseEvents`）で、入っているときだけ返す。

### `get_exercise_minutes`

運動 1 件を 1 分ごとに分解して返す。`id` は `list_exercises` / `get_exercise` が返す値。

`get_exercise` のサマリーは停止していた時間も均してしまうため、平均ピッチが実際には出していないピッチになる。信号待ちで止まっていた時間と遅く走っていた時間を見分けたいときにこちらを使う。

| 出力 | 説明 |
| --- | --- |
| `time` | ローカル時刻（`HH:MM`） |
| `distanceM` | その 1 分の移動距離（メートル） |
| `steps` | その 1 分の歩数 |
| `cadenceSpm` | ピッチ。60 秒区間なので `steps` と同値 |
| `paceSecPerKm` | その 1 分のペース（秒/km）。`distanceM` が 0 なら `null` |
| `strideCm` | ストライド。`steps` が 0 なら `null` |
| `avgBpm` / `maxBpm` / `minBpm` | その 1 分の心拍。サンプルが 1 件も無ければ `null` |

窓は運動の開始時刻を分単位に切り下げ、終了時刻を切り上げた範囲。距離が 0 の分はレコードごと返ってこないので `distanceM` / `steps` は 0 で埋めるが、心拍は 0 で埋めず `null` にする。

停止判定やフェーズ分割はサーバー側でしない。素のデータと自明な換算だけを返し、解析は呼び出し側に任せる。

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

HTTP 版は Hono アプリを default export しているだけなので、動作確認はテスト（`test/http.test.js`）から `app.request('/mcp', ...)` で直接叩ける。

API のレスポンスを生で確認したいときは調査用スクリプトを使う。

```bash
node src/fetch.js dataTypes/exercise/dataPoints
```

`https://health.googleapis.com/v4/users/me/` に続くパスを引数に取る。認証情報を相対パスで読むため、リポジトリ直下から実行すること。

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/mcp-server.js` | MCP のツール定義。入力スキーマと説明文に専念。stdio 版と HTTP 版の共通のファクトリー |
| `src/server.js` | stdio での起動（`serveStdio`） |
| `src/index.js` | HTTP での公開。Hono アプリを export する Vercel のエントリーポイント |
| `src/api-key.js` | `x-api-key` を検証する Hono ミドルウェア |
| `src/health.js` | Google Health API の呼び出しとレスポンスの整形 |
| `src/auth-client.js` | `OAuth2Client` を組み立てる。環境変数経路とファイル経路、リフレッシュ時の書き戻しを担当 |
| `src/auth.js` | 初回認証（ループバックサーバー + PKCE） |
| `src/fetch.js` | 生 JSON を出す調査用スクリプト |
| `test/` | 整形・フィルタ組み立て・HTTP エンドポイント・認証クライアントのテスト |

MCP SDK は v2（`@modelcontextprotocol/server`）に統一している。
