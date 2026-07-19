# Cloudflare Access Terraform テンプレート

CODIP の preview/production Worker を Cloudflare Access で保護するための Terraform テンプレート。

Production Access application の対象FQDNは `civilopendata.mirai-dx-platform.com` とする。

## 前提

- Terraform >= 1.8
- Cloudflare Terraform provider v5 (`cloudflare/cloudflare ~> 5.0`)
- `CLOUDFLARE_API_TOKEN` 環境変数 (Access: Apps and Policies Write 権限)

## 使い方 (人間が手動実行)

このディレクトリの内容は CTO/Supervisor が自律生成できるが、**実際の `terraform apply` は必ず人間が実行する**
(Cloudflare アカウント上に実リソースを作成する操作は Human Final Decision Boundary の対象)。

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を実際の account_id / domain / 許可メール等で編集する
export CLOUDFLARE_API_TOKEN="..."
terraform init
terraform plan
terraform apply
```

`terraform.tfvars.example` は production の `civilopendata.mirai-dx-platform.com` をサンプルとしている。Access allowlist (`allowed_emails` / `allowed_email_domains`) は実際に運用するメールアドレスまたはメールドメインへ必ず置換する。previewを別に作る場合は、同じzone配下の別サブドメインを人間承認後に決め、DNS/Access変更の証跡をRunbookへ追記する。

## 構成

| ファイル | 内容 |
|---|---|
| `versions.tf` | provider バージョン制約、認証は環境変数経由 |
| `variables.tf` | account_id / environment / domain / セッション期間 / 許可メール・ドメイン |
| `access.tf` | `cloudflare_zero_trust_access_application` (self_hosted) + `cloudflare_zero_trust_access_policy` (allow) |
| `terraform.tfvars.example` | 変数のサンプル値 (実値は `terraform.tfvars` へ、gitignore 対象) |

## 適用先を変える場合

`environment` を `"preview"` / `"production"` に切り替えて2回 apply するか、
workspace を分けて preview/production を独立管理する。
