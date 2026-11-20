/**
 * Stage-1 safety screen: OpenAI omni-moderation over text + images.
 *
 * EXTRACTED VERBATIM from `moderate-listing/index.ts` (2026-08-06). That
 * function is live on prod, fail-closed and correct, so this is an
 * extract-and-reuse, not a rewrite — the request shape, the 15s abort, the
 * error string, the MAX_IMAGES cap, the result-count log line and the
 * flagged-category accumulation are unchanged. The ONLY difference is that the
 * log prefix is now a parameter, so `moderate-listing` still emits byte-identical
 * `[moderate-listing] stage1 …` lines while `moderate-image` labels its own.
 *
 * The endpoint is still read from the same `OPENAI_MODERATIONS_URL` env var
 * (operator-set, never request-derived) so `scripts/test-edge.sh` can point every
 * caller at the same local stub.
 *
 * The endpoint is free, which is why every upload path can afford to call it.
 */
import { classifySeverity, type Severity } from "./moderationCategories.ts";

/** Bound the free stage-1 payload. Callers with more images must batch. */
export const MAX_IMAGES = 4;

export interface Screen {
  severity: Severity;
  categories: string[];
}

const OPENAI_MODERATIONS_URL =
  Deno.env.get("OPENAI_MODERATIONS_URL") ??
  "https://api.openai.com/v1/moderations";

export async function screenWithOpenAI(
  text: string,
  imageUrls: string[],
  apiKey: string,
  logPrefix = "moderate-listing"
): Promise<Screen> {
  const input: unknown[] = [{ type: "text", text }];
  for (const url of imageUrls.slice(0, MAX_IMAGES)) {
    input.push({ type: "image_url", image_url: { url } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(OPENAI_MODERATIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok)
    throw new Error(`openai moderation ${res.status}: ${await res.text()}`);

  const data = await res.json();
  // Observability: omni-moderation returns one result per input item, so a
  // result count of (1 text + N images) confirms every photo URL was fetched
  // and screened (an unreachable URL makes OpenAI error out above -> we hold).
  const imageCount = Math.min(imageUrls.length, MAX_IMAGES);
  console.log(
    `[${logPrefix}] stage1 screened ${
      input.length
    } input(s): 1 text + ${imageCount} image(s); openai returned ${
      data?.results?.length ?? 0
    } result(s)`
  );
  const flagged = new Set<string>();
  for (const result of data?.results ?? []) {
    const cats = result?.categories ?? {};
    for (const [cat, on] of Object.entries(cats)) {
      if (on === true) flagged.add(cat);
    }
  }
  const categories = [...flagged];
  const severity = classifySeverity(categories);
  return { severity, categories: severity === "clean" ? [] : categories };
}
