import type { VercelResponse } from "@vercel/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../api/_lib/supabase", () => ({
  supabase: { rpc },
}));

import { enforceRateLimit } from "../../api/_lib/rateLimit";

function response(): VercelResponse {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as VercelResponse;
}

describe("enforceRateLimit", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("denies a request when the persistent limiter is unavailable", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "RPC unavailable" },
    });
    const res = response();

    await expect(
      enforceRateLimit({
        res,
        action: "contact",
        userId: "ip",
        max: 5,
        windowSeconds: 3600,
      })
    ).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("protection") })
    );
  });

  it("still returns 429 for an exhausted bucket", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = response();

    await expect(
      enforceRateLimit({
        res,
        action: "contact",
        userId: "ip",
        max: 5,
        windowSeconds: 3600,
      })
    ).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
