import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const dataSourceFindManyMock = vi.hoisted(() => vi.fn());
const dataSourceCountMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    dataSource: {
      findMany: dataSourceFindManyMock,
      count: dataSourceCountMock,
    },
  },
}));

import { GET as sourcesGET } from "@/app/api/sources/route";

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("sources API route", () => {
  it("does not use internal notes as public search fields", async () => {
    dataSourceFindManyMock.mockResolvedValueOnce([]);
    dataSourceCountMock.mockResolvedValueOnce(0);

    const response = await sourcesGET(new NextRequest("http://localhost/api/sources?q=internal-note"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ items: [], total: 0 });
    expect(dataSourceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "internal-note" } },
            { nameEn: { contains: "internal-note" } },
            { description: { contains: "internal-note" } },
          ],
        },
      }),
    );
  });
});
