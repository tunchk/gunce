import { prisma } from "@/lib/prisma";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Simple PostgreSQL-backed fixed window rate limiter.
 * Suitable for local/dev without Redis; not a substitute for edge WAF in production scale.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({ where: { key } });

    if (!existing || now.getTime() - existing.windowStart.getTime() >= windowMs) {
      const bucket = await tx.rateLimitBucket.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now },
        update: { count: 1, windowStart: now },
      });
      return {
        allowed: true,
        remaining: Math.max(0, limit - bucket.count),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    if (existing.count >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowMs - (now.getTime() - existing.windowStart.getTime())) / 1000),
      );
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    const bucket = await tx.rateLimitBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.ceil(
        (windowMs - (now.getTime() - existing.windowStart.getTime())) / 1000,
      ),
    };
  });

  return result;
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip") || "unknown";
}
