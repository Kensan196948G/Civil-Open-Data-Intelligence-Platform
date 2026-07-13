# CODIP: Cloudflare Access による Worker 保護 (Terraform provider v5)
# 適用対象: preview/production の workers.dev または独自ドメイン。
# 注意: このディレクトリは「テンプレート」であり、人間が terraform.tfvars を用意して
#       手動で `terraform plan` / `terraform apply` を実行するまで一切のリソースは作成されない。
#       CTO/Supervisor はこのディレクトリの内容を自律生成できるが、適用 (apply) は行わない
#       (Human Final Decision Boundary: 外部サービスのリソース作成は人間が実行)。

resource "cloudflare_zero_trust_access_application" "codip" {
  account_id                = var.cloudflare_account_id
  name                      = "codip-${var.environment}"
  type                      = "self_hosted"
  domain                    = var.application_domain
  session_duration          = var.session_duration
  auto_redirect_to_identity = false
}

resource "cloudflare_zero_trust_access_policy" "codip_allow" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.codip.id
  name           = "codip-${var.environment}-allow"
  decision       = "allow"
  precedence     = 1

  dynamic "include" {
    for_each = length(var.allowed_emails) > 0 ? [1] : []
    content {
      email = var.allowed_emails
    }
  }

  dynamic "include" {
    for_each = length(var.allowed_email_domains) > 0 ? [1] : []
    content {
      email_domain = var.allowed_email_domains
    }
  }
}
