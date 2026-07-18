terraform {
  # 1.9+ が必要 (variables.tf の allowed_emails/allowed_email_domains で
  # 他変数を参照する cross-variable validation を使用するため)。
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  # 認証は CLOUDFLARE_API_TOKEN 環境変数で行う (Terraform state / tfvars に絶対に書かない)。
}
