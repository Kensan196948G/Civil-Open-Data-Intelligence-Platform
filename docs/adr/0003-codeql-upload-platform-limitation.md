# ADR 0003: CodeQL SARIF upload cannot be enabled on this GitHub plan

- 状態: Accepted（2026-08-12）
- 決定者: CTO代行（Issue #139 の環境制約調査に基づく）。人間による追認を推奨
- 関連: Issue #132 / #139 / PR #137

## 背景

Issue #132 の是正（`continue-on-error: true` の除去）により、CodeQL `analyze` の
**SARIFアップロード**が常に失敗していることが可視化された。

```text
[error] Code scanning is not enabled for this repository.
        Please enable code scanning in the repository settings.
```

## 調査結果（2026-08-12 実測）

| 確認項目 | 結果 |
| --- | --- |
| リポジトリ可視性 | `private: true`（personal account `Kensan196948G`） |
| repo 権限 | `admin: true`（所有者） |
| `GET /code-scanning/default-setup` | HTTP 403（機能自体が無効） |
| `PUT /code-scanning/default-setup` | HTTP 404（本プランでは設定API自体が存在しない） |
| CodeQL 解析本体 | 正常動作（250 TS / 45 JS / 6 Actions ファイルをスキャン、SARIF生成まで完了） |

GitHub の Code scanning（SARIFアップロード）は **GitHub Advanced Security (GHAS)** が必要で、
これは Organization + Enterprise プランのみで提供される。**personal account の private
repository では有効化できない**。したがって「リポジトリ設定で有効化すれば直る」ではなく、
構造的に不可能である。

## 決定

CodeQL ワークフローを「ローカル解析＋アーティファクト保存」構成へ変更する。

1. `github/codeql-action/analyze` に `upload: never` を指定（SARIFアップロードを試みない）
2. 解析自体の失敗（DB構築失敗・言語検出失敗等）は従来どおりジョブを失敗させる
3. SARIF は `codeql-sarif` artifact として14日間保持し、CIログと併せて確認可能にする

これにより:

- 「CodeQL が実行された」ことが**反証可能**になる（#132 の目的を維持）
- アップロード不能に起因する恒久 RED で全マージが止まる状態を解消する
- セキュリティは従来（`continue-on-error` で握り潰していた状態）より**低下しない**。
  アップロードは従来も 403 で失敗しており、実質一度も code-scanning へ記録されていない

## 制約と代替

| 手段 | 可否 | 備考 |
| --- | --- | --- |
| GitHub Code scanning 有効化 | ❌ | GHAS が必要。現プランでは不可能 |
| CodeQL CLI をCIで直接実行 | ⚠️ | private repo での CLI 使用にも GHAS ライセンスが必要とされ、同様に不可 |
| ローカル解析 + SARIF artifact（本決定） | ✅ | 解析ゲートと記録を維持。アラート管理UI（Security tab）は使えない |
| リポジトリを public 化 | ⚠️ | 公開不可の情報が無いことを確認できれば可能だが、本決定では選択しない |
| GitHub Team/Enterprise へ移行 | ⚠️ | 費用と組織判断が必要。必要なら人間が判断する |

## 将来の再評価

- GitHub プランを GHAS 対応へ変更した場合は、`upload: never` を外し通常の
  code-scanning アップロードへ戻す（本ADRを更新する）
- アラートの可視化が必要になった場合は、SARIF artifact を週次で集計する別基盤を検討する
