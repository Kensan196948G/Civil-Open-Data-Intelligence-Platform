terraform {
  required_version = ">= 1.8"

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
