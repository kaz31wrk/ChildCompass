# ChildCompass プロジェクトメモ

## プロジェクト概要
- 育児ライフログ、施設検索、成長マイルストーン、AI相談機能を統合した育児支援Webアプリ。
- Google Apps Script (GAS) で構築。
- ローカル環境: `/Users/dev/Library/Mobile Documents/com~apple~CloudDocs/Documents/dev/GASProject/ChildCompass`
- `clasp` を使用して管理。

## 運用ルール (重要)
1. **指示を受けた際は必ずこのファイルを最初に参照すること。**
2. **コードの修正を依頼された場合は、必ず以下のデプロイ作業まで実施し、Webアプリを上書きすること。**
   - ファイルの修正完了後、以下のコマンドでプッシュおよびデプロイを実行する：
     ```bash
     npx @google/clasp push
     npx @google/clasp deploy -i AKfycbwczk4hGoCM2d0SIA_MZbdPlg452xqmYSske15AjxxsDEAIY7jWmhoJUWUSzi9koYw -d "デプロイ説明（日付等）"
     ```
   - **デプロイID (上書き用)**: `AKfycbwczk4hGoCM2d0SIA_MZbdPlg452xqmYSske15AjxxsDEAIY7jWmhoJUWUSzi9koYw`
   - **WebアプリURL**: `https://script.google.com/macros/s/AKfycbwczk4hGoCM2d0SIA_MZbdPlg452xqmYSske15AjxxsDEAIY7jWmhoJUWUSzi9koYw/exec`
3. **コードを編集した後は、必ず「過去の重要な修正」セクションに日付と内容を追記すること。**

## 過去の重要な修正
- **2026-06-05: ChildCompass V3 大規模機能拡張**
  - 記録: 日時選択、直近値サジェスト、次回授乳/睡眠予測（設定で平均/前回/固定）
  - 施設: ダミー施設を廃止し Overpass API で実在施設を動的取得
  - マイルストーン: 200件超に拡充、非表示・手動追加・Geminiカスタマイズ
  - AI: ログ・マイルストーン・子ども情報を文脈に含むパーソナライズ相談
  - 複数家族・複数子ども対応（families/children/settings シート）
  - `MilestonesData.js` を新設
- **2026-06-05: ChildCompass V2 機能拡張およびデプロイ（バージョン8）**
  - `Code.js`: facilitiesシートに緯度経度列（lat/lng）を追加、児童館・保育園・授乳室カテゴリを追加。マイルストーンを0歳〜6歳の28項目に大幅拡充、category列を追加。
  - `Index.html`: 授乳ログに量（0〜500ml/10ml単位）・時間（5分単位）セレクトボックスを追加。睡眠ログに時間セレクトを追加。「今日の合計」カード（授乳量ml・睡眠分）を新設。マイルストーンを年齢別アコーディオン形式に変更。施設タブにLeaflet.jsによる地図を組み込み、GPSで現在地取得・周辺施設ピン表示機能を実装。
- **2026-06-05: ChildCompass アプリケーションの実装および上書きデプロイ**
  - `Code.js`: スプレッドシート自動初期化、APIルーティング（doGet, doPost / executeActionFromRun）、Gemini API連携（AI相談・ログ要約）を含むバックエンドを全面実装。
  - `Index.html`: React & Tailwind CSS を使用し、タイムライン、施設検索（フィルタ機能付き）、マイルストーン管理、AI相談チャットを統合したモダンなSPAフロントエンドを構築。
  - **バグ修正**: `Index.html`内の文字リテラルに誤ってGASテンプレート用トークン `<?=` が含まれており、`evaluate()` 時に `SyntaxError` になっていた問題を修正。
  - デプロイを実行し、Webアプリ（デプロイID: `AKfycbwczk4hGoCM2d0SIA_MZbdPlg452xqmYSske15AjxxsDEAIY7jWmhoJUWUSzi9koYw`）をバージョン7として上書き。
- **2026-06-05: Clasp同期の初期設定および運用ルールの追加**
  - プロジェクトを `clasp clone` し、ローカルと同期。
  - デプロイ自動化のための `GEMINI.md` を作成し、上書きデプロイ用ルールを追加。
