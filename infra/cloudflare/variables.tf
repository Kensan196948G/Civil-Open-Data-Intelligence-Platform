variable "cloudflare_account_id" {
  description = "Cloudflare account ID (Dashboard > Workers & Pages > Overview 右側に表示)"
  type        = string
}

variable "environment" {
  description = "保護対象環境。preview または production"
  type        = string
  validation {
    condition     = contains(["preview", "production"], var.environment)
    error_message = "environment は \"preview\" か \"production\" のいずれかにすること。"
  }
}

variable "application_domain" {
  description = "Access で保護する公開ドメイン (例: codip-preview.example.workers.dev または独自ドメイン)"
  type        = string
}

variable "session_duration" {
  description = "Access セッションの有効期間"
  type        = string
  default     = "24h"
}

variable "allowed_emails" {
  description = "個別許可するメールアドレス一覧 (allowed_email_domains と併用可、どちらか一方でも可)"
  type        = list(string)
  default     = []
}

variable "allowed_email_domains" {
  description = "許可するメールドメイン一覧 (例: [\"example.com\"])"
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.allowed_emails) > 0 || length(var.allowed_email_domains) > 0
    error_message = "allowed_emails または allowed_email_domains の少なくとも一方を指定してください (両方空の場合、誰もAccessを通過できないポリシーになります)。"
  }
}
