# 🗄️ wmcdss 保全記録

## 🎯 リポジトリ情報

- 🌐 GitHub: `https://github.com/Kensan196948G/wmcdss`
- 🌿 既定ブランチ: `main`
- 📌 最終 HEAD: `b08792166571a5d958a47fda8e07f331c13786b2`
  (`fix(ops): make DB restore idempotent with pg_dump --clean --if-exists (#68)`)
- 🔢 コミット数: 179
- 🏷️ タグ: なし
- 📅 最終 push: 2026-08-08T18:08:05Z

## 📦 保存物

| ファイル | 内容 |
| --- | --- |
| `wmcdss.bundle` | `git bundle --all` (全ブランチ・全履歴) |
| `repo-meta.json` | GitHub リポジトリメタデータ |
| `issues.json` | Issue 全件 |
| `prs.json` | Pull Request 全件 |
| `releases.json` | Release 一覧 (0件) |

## 🔐 機密情報の扱い

`repo-meta.json` は GitHub API の生メタデータを保存したもので、`temp_clone_token`
(一時クローン用トークン) を含んでいました。2026-08-09 にフィールドを除去し、
履歴上の旧コミットは `.gitleaks.toml` のスコープ付き allowlist で管理します
(トークンは一時的・クローン専用で失効済み)。

## 🔒 削除条件チェック

- [x] Git履歴・最終commit SHA・Issue・PR・リリース保存
- [x] 全機能インベントリ・移行分類 (inventory-wmcdss.md)
- [ ] 中核への機能統合完了 (気象・海象・判定・ETL・レポート)
- [ ] 旧URL・外部参照ゼロ確認
- [ ] 削除直前の対象名再確認
