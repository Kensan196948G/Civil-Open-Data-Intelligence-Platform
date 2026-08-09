# 🗄️ Civil-Terrain-Slope-Risk-Viewer 保全記録

## 🎯 リポジトリ情報

- 🌐 GitHub: `https://github.com/Kensan196948G/Civil-Terrain-Slope-Risk-Viewer`
- 🌿 既定ブランチ: `main`
- 📌 最終 HEAD: `b595125b02d937244c6d1e1d2488fe8d248811fb`
  (`Merge pull request #40 from Kensan196948G/test/analysis-tabs-e2e`)
- 🔢 コミット数: 55
- 🏷️ タグ: `v0.1.0`, `v0.2.0`
- 📅 最終 push: 2026-07-31T09:39:21Z

## 📦 保存物

| ファイル | 内容 |
| --- | --- |
| `civil-terrain-slope-risk-viewer.bundle` | `git bundle --all` (全ブランチ・全履歴) |
| `repo-meta.json` | GitHub リポジトリメタデータ |
| `issues.json` | Issue 全件 (state/labels/body 含む) |
| `prs.json` | Pull Request 全件 (state/body 含む) |
| `releases.json` | Release 一覧 |

## 🔐 機密情報の扱い

`repo-meta.json` は GitHub API の生メタデータを保存したもので、`temp_clone_token`
(一時クローン用トークン) を含んでいました。2026-08-09 にフィールドを除去し、
履歴上の旧コミットは `.gitleaks.toml` のスコープ付き allowlist で管理します
(トークンは一時的・クローン専用で失効済み)。

## 🔒 削除条件チェック

- [x] Git履歴・最終commit SHA・Issue・PR・リリース保存
- [x] 全機能インベントリ・移行分類 (inventory-terrain.md)
- [ ] 中核への機能統合完了 (地形: 完了 / 案件保存・Access RBAC: 中核側で設計統合)
- [ ] 旧URL・外部参照ゼロ確認
- [ ] 削除直前の対象名再確認
