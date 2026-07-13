import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 最小構成。R2 incremental cache 等の追加バインディングは未使用
// (関連リソースが未プロビジョニングのため)。導入時はここに追記する。
export default defineCloudflareConfig();
