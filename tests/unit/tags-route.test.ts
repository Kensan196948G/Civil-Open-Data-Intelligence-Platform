import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const tagFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    tag: {
      findMany: tagFindManyMock,
    },
  },
}));

import { GET as tagsGET } from "@/app/api/tags/route";

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("tags API route", () => {
  it("rate limits public tag reads", async () => {
    tagFindManyMock.mockResolvedValue([]);

    let response = await tagsGET(new NextRequest("http://localhost/api/tags"));
    expect(response.status).toBe(200);

    for (let index = 0; index < 119; index += 1) {
      response = await tagsGET(new NextRequest("http://localhost/api/tags"));
      expect(response.status).toBe(200);
    }

    response = await tagsGET(new NextRequest("http://localhost/api/tags"));
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.error).toBe("rate_limited");
  });
});
