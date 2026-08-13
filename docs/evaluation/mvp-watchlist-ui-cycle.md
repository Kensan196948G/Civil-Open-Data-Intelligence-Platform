# MVP 強化サイクル評価報告（2026-08-13: ウォッチリストUI + エスカレーションPR群統合）

> 🎯 対象: /goal「本リポジトリを精査し、既存変更を保護しつつ、実際に操作・評価できるMVPまで
> 自律的に完成させる（本番運用化は対象外）」
> 👔 実行ロール: CTO 兼 実装責任者（委任レビューは不発のため主任が順次実行）
> 📅 期間: 2026-08-13（Asia/Tokyo）

## 📌 1. 総合評価（実コード・実画面・API・DB・CIを根拠とする）

| 軸 | 判定 | 根拠 |
| --- | --- | --- |
| 主要ユースケース実動作 | ✅ | `/watchlist` の登録・一時停止・再開・解除、現場一覧トグル、seed 済み一覧を API 実測（201/200/401/404/409）で確認 |
| ダミーデータ | ✅ | `prisma db seed` で100データソース＋デモRBAC割当2件＋ウォッチリスト2件を再生成可能に投入・保持 |
| UI/API/DB整合 | ✅ | OpenAPI に PATCH 追記、route coverage 契約 OK、AuditLog に add/toggle/remove を実測確認 |
| テスト | ✅ | 単体 787→791、`release:gate` OK（lint/型/契約/build 含む）。E2E は CI 実行（ローカル Chromium は既知の SIGTRAP 制約） |
| セキュリティ | ✅ | CSRF Origin 必須（Origin 無し POST 401 を実測）、RBAC＋ユーザースコープ、デモ識別子は fail-closed opt-in、本番は validate-env で拒否 |
| P0 | ✅ ゼロ | security_critical=0 を維持 |

## 📌 2. Monitor / Assessment で確定した現状

- main は PR #160 まで統合済み（単体 779 pass / CI green）。ローカル main と origin/main は
  同一ツリーで SHA のみ異なっていた（squash merge 由来）ため、マージで整列
- 引き継ぎ点: エスカレーションPR群 #143-#158 のレビュー/マージ判断、ウォッチリストUI 未実装
- 制約: branch protection は strict（head が base と一致必須）。auto-merge はリポジトリで無効だった

## 📌 3. Gap / Feature Discovery → Prioritization

| ID | 内容 | 優先度 | 判定 |
| --- | --- | --- | --- |
| W1 | ウォッチリストUI（/watchlist・トグル） | P2→実装 | API/通知は既存。UI とデモ識別子・seed が欠落 |
| W2 | PATCH による enabled 切替 | P2→実装 | 一覧に無効登録を表示するために必要 |
| W3 | デモ環境の個人識別子 | P2→実装 | Access 不在の preview で操作可能にするため必須 |
| E1 | PR #149/#151 の main 統合後テスト不整合 | P1→解消 | #160 の seed/workflow 追加が期待値表・棚卸しと衝突 |
| E2 | PR #146 は #149 に完全包含 | P2→superseded | マージすると #149 の host-match リファクタを巻き戻す |
| E3 | GIS ポリゴン/時系列UI・GeoPackage/PDF・LLM/RAG・e-Stat/河川コネクタ | P2 | バックログ継続（docs/14-roadmap.md） |
| H1 | PR #144（Neon 復旧訓練・APIキー決裁） | 人間決裁 | 期限超過のため最終報告で明示 |
| H2 | Cloudflare staging Hyperdrive 権限・本番 Secrets | 人間決裁 | 対象外（本番運用化はスコープ外） |

## 📌 4. Development / Verify / Review

- **ウォッチリスト垂直スライス**（feat/watchlist-ui-demo）:
  UI（/watchlist・WatchToggle・ナビ）→ API（GET 拡張・PATCH 追加）→ DB（seed 拡張）→
  テスト（単体 8件追加・E2E 4本）→ 文書（README・rbac-design・release-notes）の一連で実動作
- **環境ガード**: `validate-env` にデモ識別子のペア必須・本番拒否を追加（単体 3件）
- **E2E 環境**: Playwright のポート上書きを追加（ローカル :3000 が別ワークツリー占有のため）
- **統合競合の是正**:
  - #149: 台帳振り分け期待値表へ #160 の e-Stat 2.1 / JMA XML eqvol・extra を反映
  - #151: `unpairedContinueOnError` がコメント行を数える欠陥を修正、load-test/sla-monitor を
    棚卸しへ追加、review-role-assignments.js を等級2（unwired・既定 strict=false）として登録
  - #146: superseded 判定でクローズ（#149 に包含済み）

## 📌 5. Re-assessment / 残バックログ

| 優先度 | 項目 | 状態 |
| --- | --- | --- |
| 人間決裁 | PR #144 承認（Neon 復旧訓練・CODIP_NEON_API_KEY 決裁、期限 08-12T18:17Z 超過） | 保留 |
| 人間決裁 | Cloudflare staging Hyperdrive 権限追加（code 10000） | 保留 |
| 本番 | デプロイ→seed-jobs 段階的有効化→SLA/digest 監視 | 対象外 |
| P2 | 通知ダイジェストの UI 表示（現在は workflow 発行） | バックログ |
| P2 | GIS ポリゴン/時系列スライダーUI、GeoPackage/PDF | バックログ |
| P2 | LLM/RAG・AI品質監視・コネクタ自動生成 | バックログ |
| P2 | e-Stat キー投入・河川水位XML/水文水質CSV コネクタ | バックログ（人間の Secret 投入が必要） |
| P2 | De-dockerization（Issue #35）・Workers 専用 egress（Issue #101） | バックログ |

## 📌 6. 検証証跡

- 単体: `npx vitest run` 全 pass（feat ブランチ 791 / 統合後 main は CI で確認）
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run release:gate` OK
- API 実測: セッション開始→GET（identity+2 entries）→POST 201→PATCH 200×2→DELETE 200→401/409 異常系
- 監査: AuditLog に watchlist.add/toggle/remove（user=…・level=info）を実測
- CI: 各PRの required checks（verify/e2e/postgresql-compat/docker-preview/docker-image-security/analyze）green を確認してからマージ

## 📌 7. MVP / Prototype 判定

**🟢 GO**（P0 ゼロ・主要ユースケース実動作・ダミーデータ保持・UI/API/DB 整合・テスト/CI 成功・PR マージ完了）。
人間決裁事項 2 件（#144・Hyperdrive 権限）は本番運用化のスコープ外であり、バックログとして明示。
