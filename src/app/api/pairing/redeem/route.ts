import { NextRequest, NextResponse } from "next/server";
import { PairingError, redeemPairingInvitation } from "@/lib/family";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { pairingRedeemSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`pair-redeem:${ip}`, 10, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme. Biraz sonra tekrar dene." },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const parsed = pairingRedeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Davet kodu geçersiz." }, { status: 400 });
  }

  try {
    const { responseHeaders } = await redeemPairingInvitation({
      token: parsed.data.token,
      requestHeaders: request.headers,
    });

    const response = NextResponse.json({ ok: true });
    for (const cookie of responseHeaders.getSetCookie?.() || []) {
      response.headers.append("set-cookie", cookie);
    }
    if (!response.headers.has("set-cookie")) {
      const single = responseHeaders.get("set-cookie");
      if (single) response.headers.append("set-cookie", single);
    }
    return response;
  } catch (error) {
    if (error instanceof PairingError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "RATE_LIMIT"
            ? 429
            : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("pairing redeem failed");
    return NextResponse.json({ error: "Eşleştirme başarısız." }, { status: 500 });
  }
}
