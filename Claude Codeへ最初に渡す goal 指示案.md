/goal
Civil Open Data Intelligence Platform（土木建設オープンデータ統合分析基盤）のMVPを実装する。

前提:
- Windows 11上で開発する。
- TypeScript / Next.js / SQLite / Prisma / Tailwind CSS を基本構成とする。
- 会社資産・社内データ・社内認証情報は使用しない。
- 公開API・公開データのみを対象にする。
- APIキーや秘密情報は .env にのみ保存し、GitHubへコミットしない。
- AI機能は補助扱いとし、利用可否・安全可否・施工可否の最終判断は人間が行う。

実装範囲:
1. API・公開データ台帳
2. データソース一覧・検索
3. データソース詳細
4. データソース登録・編集
5. 接続確認
6. サンプルレスポンス取得
7. 取得ログ保存・表示
8. タグ管理
9. データ品質スコア表示
10. ダッシュボード
11. 初期seedデータ10件
12. READMEとdocs整備
13. 単体テストと最低限のE2Eテスト

初期seedデータ:
- 国土数値情報
- PLATEAU
- xROAD
- 道路データプラットフォーム
- 国土交通省交通量API
- 国土地理院 地理院タイル
- 国土地理院 標高取得
- 気象庁 防災情報XML
- e-Stat API
- OpenStreetMap

禁止事項:
- .env のコミット
- APIキーのログ出力
- 任意URLへの無制限アクセス
- localhost / private IP / 社内IPへの外部取得処理
- 取得データの再配布前提の実装
- AIによる利用可否の断定

終点:
- npm install 後に npm run dev で起動できる。
- npx prisma migrate dev と seed が成功する。
- 初期データ10件が画面に表示される。
- データソースを登録・検索・詳細表示できる。
- 接続確認を実行し、fetch_logs に保存できる。
- サンプルレスポンスプレビューを保存できる。
- ダッシュボードに登録件数、成功件数、失敗件数、要確認件数が表示される。
- npm run build が成功する。
- npm run test が成功する。
- README.md、docs/requirements.md、docs/detailed-design.md、docs/security-checklist.md、docs/data-quality-policy.md が存在する。