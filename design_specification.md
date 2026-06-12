# ChildCompass 開発仕様設計書

## 1. 概要
育児ライフログ、施設検索、成長マイルストーン、AI相談機能を統合した育児支援Webアプリ。

## 2. システム構成
- **Frontend**: React + Tailwind CSS
- **Backend**: Google Apps Script (GAS)
- **Database**: Google Sheets (logs, facilities, milestones)

## 3. 機能仕様
### A. ライフログ (Data: logs)
- 項目: 日時(timestamp), カテゴリ(type), メモ(note), family_id, child_id
- 記録日時はユーザーが選択可能（datetime-local）
- 直近の授乳量・睡眠時間をサジェスト表示
- 次回授乳・睡眠の目安時刻（設定: 平均/前回/固定間隔）

### B. 施設検索
- OpenStreetMap Overpass API により現在地周辺の実在施設を動的取得
- 項目: 名称, 種別, 電話, 住所, 緯度経度

### C. 成長マイルストーン (Data: milestones, 200件以上)
- 非表示・ユーザー追加・Geminiによるカスタム追加

### D. AI相談 (Integration)
- ログ・マイルストーン・家族/子どもプロフィールを文脈に含めたパーソナライズ応答

### E. マルチ家族・複数子ども
- families / children シートで管理、ヘッダーで切替

## 4. APIエンドポイント (doGet/doPost)
- `GET ?action=get[Category]`: データ取得
- `POST {action: 'addLog', ...}`: ログ追加