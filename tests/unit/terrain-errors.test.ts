import { describe, expect, it } from "vitest";
import { createProblemDetails } from "@/lib/terrain/domain";

describe("createProblemDetails", () => {
  it("maps the error code to its designated HTTP status", () => {
    const problem = createProblemDetails("NO_COVERAGE", "対象地点にデータがありません");
    expect(problem.status).toBe(404);
    expect(problem.code).toBe("NO_COVERAGE");
  });

  it("maps authentication codes to 401/403 (Cloudflare Access 限定検証モード用)", () => {
    expect(createProblemDetails("UNAUTHENTICATED", "認証が必要です").status).toBe(401);
    expect(createProblemDetails("FORBIDDEN", "権限がありません").status).toBe(403);
  });

  it("omits optional fields entirely when not provided", () => {
    const problem = createProblemDetails("INVALID_INPUT", "入力が不正です");
    expect("detail" in problem).toBe(false);
    expect("instance" in problem).toBe(false);
    expect("requestId" in problem).toBe(false);
  });

  it("includes optional fields when provided", () => {
    const problem = createProblemDetails("INVALID_INPUT", "入力が不正です", {
      detail: "radiusM must be between 50 and 2000",
      requestId: "req-123",
    });
    expect(problem.detail).toBe("radiusM must be between 50 and 2000");
    expect(problem.requestId).toBe("req-123");
    expect("instance" in problem).toBe(false);
  });
});
