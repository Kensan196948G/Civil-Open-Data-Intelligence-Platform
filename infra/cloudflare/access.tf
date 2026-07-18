# CODIP: Cloudflare Access による Worker 保護 (Terraform provider v5)
# 適用対象: preview/production の workers.dev または独自ドメイン。
# 注意: このディレクトリは「テンプレート」であり、人間が terraform.tfvars を用意して
#       手動で `terraform plan` / `terraform apply` を実行するまで一切のリソースは作成されない。
#       CTO/Supervisor はこのディレクトリの内容を自律生成できるが、適用 (apply) は行わない
#       (Human Final Decision Boundary: 外部サービスのリソース作成は人間が実行)。

resource "cloudflare_zero_trust_access_policy" "codip_allow" {
  account_id = var.cloudflare_account_id
  name       = "codip-${var.environment}-allow"
  decision   = "allow"

  # v5 の include は Attributes Set (list of object)。email/email_domain は
  # それぞれ { email = { email = "..." } } / { email_domain = { domain = "..." } }
  # という入れ子構造を取る (公式スキーマ: zero_trust_access_policy.md)。
  include = concat(
    [for email in var.allowed_emails : { email = { email = email } }],
    [for domain in var.allowed_email_domains : { email_domain = { domain = domain } }]
  )
}

resource "cloudflare_zero_trust_access_application" "codip" {
  account_id                = var.cloudflare_account_id
  name                      = "codip-${var.environment}"
  type                      = "self_hosted"
  domain                    = var.application_domain
  session_duration          = var.session_duration
  auto_redirect_to_identity = false

  # v5 ではアプリケーション側が policies (Attributes List) でポリシーIDを列挙する
  # (v4 の application_id によるポリシー→アプリ参照から仕様が反転している)。
  policies = [{
    id         = cloudflare_zero_trust_access_policy.codip_allow.id
    precedence = 1
  }]
}
