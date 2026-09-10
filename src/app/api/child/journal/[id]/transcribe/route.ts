import { NextRequest, NextResponse } from "next/server";
import { getTranscriptionProvider } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import {
  applyTranscriptToEntry,
  JournalError,
  JOURNAL_BODY_MAX,
  listTranscriptSegments,
  saveTranscriptSegment,
} from "@/lib/journal";
import { auth } from "@/lib/auth";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";
import { MAX_SEGMENTS_PER_SESSION } from "@/lib/voice-segments";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // 4 MiB ~ short clips
const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "video/webm",
]);

type Ctx = { params: Promise<{ id: string }> };

async function requireChild(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401, headers: NO_STORE }) };
  }
  if (role !== "CHILD") {
    return { error: NextResponse.json({ error: "Yalnızca çocuk oturumu." }, { status: 403, headers: NO_STORE }) };
  }
  return { session };
}

function mapError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
  }
  if (error instanceof JournalError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: NO_STORE });
  }
  if (error instanceof ProviderError) {
    const status =
      error.code === "NOT_CONFIGURED"
        ? 503
        : error.code === "TIMEOUT"
          ? 504
          : 502;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: NO_STORE });
  }
  console.error("transcribe api error");
  return NextResponse.json({ error: "Ses işlenemedi." }, { status: 500, headers: NO_STORE });
}

/** List persisted private transcript segments for this entry (text only). */
export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id: entryId } = await ctx.params;
  try {
    const segments = await listTranscriptSegments(authz.session!.user.id, entryId);
    return NextResponse.json({ segments }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id: entryId } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `transcribe:${authz.session!.user.id}:${ip}`,
    20,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json({ error: "Çok fazla ses denemesi. Biraz bekle." }, { status: 429, headers: NO_STORE });
  }

  const provider = getTranscriptionProvider();
  if (!provider.isConfigured()) {
    return NextResponse.json(
      {
        error: "Ses yazıya çevirme şu an kullanılamıyor. Yazarak devam edebilirsin.",
        code: "NOT_CONFIGURED",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  const file = form.get("audio");
  const expectedRevisionRaw = form.get("expectedRevision");
  const modeRaw = form.get("mode");
  const applyRaw = form.get("apply");
  const segmentIdRaw = form.get("segmentId");
  const sessionIdRaw = form.get("sessionId");
  const sequenceRaw = form.get("sequence");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Ses dosyası gerekli." }, { status: 400, headers: NO_STORE });
  }

  const expectedRevision = Number(expectedRevisionRaw);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return NextResponse.json({ error: "expectedRevision gerekli." }, { status: 400, headers: NO_STORE });
  }

  if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Ses dosyası çok büyük veya boş. Daha kısa bir kayıt dene." },
      { status: 400, headers: NO_STORE },
    );
  }

  const mime = (file.type || "application/octet-stream").toLowerCase();
  const mimeBase = mime.split(";")[0]!;
  if (![...ALLOWED_MIME].some((a) => a === mime || a === mimeBase)) {
    return NextResponse.json(
      { error: "Bu ses biçimi desteklenmiyor. Yazarak devam edebilirsin." },
      { status: 400, headers: NO_STORE },
    );
  }

  const segmentId =
    typeof segmentIdRaw === "string" && segmentIdRaw.trim().length >= 8
      ? segmentIdRaw.trim().slice(0, 80)
      : null;
  const sessionId =
    typeof sessionIdRaw === "string" && sessionIdRaw.trim().length >= 8
      ? sessionIdRaw.trim().slice(0, 80)
      : null;
  const sequence = Number(sequenceRaw);

  if (segmentId && sessionId) {
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEGMENTS_PER_SESSION) {
      return NextResponse.json(
        { error: "Bölüm numarası geçersiz.", code: "VALIDATION" },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    // Idempotent: if this segment was already saved, skip expensive provider call.
    if (segmentId && sessionId) {
      const { prisma } = await import("@/lib/prisma");
      const existing = await prisma.journalTranscript.findUnique({
        where: { segmentId },
      });
      if (existing && existing.entryId === entryId) {
        return NextResponse.json(
          {
            transcript: existing.text,
            segment: {
              segmentId: existing.segmentId,
              sequence: existing.sequence,
              sessionId: existing.sessionId,
              duplicated: true,
            },
            notice:
              "Bu bölüm daha önce yazıya çevrilmişti; aynı metin korundu.",
          },
          { headers: NO_STORE },
        );
      }
    }

    const result = await provider.transcribe({
      bytes,
      mimeType: mimeBase,
      filename: file.name || "recording.webm",
      languageHint: "tr",
    });

    const transcript = result.text.slice(0, JOURNAL_BODY_MAX);

    let segmentMeta:
      | {
          segmentId: string;
          sequence: number;
          sessionId: string | null;
          duplicated: boolean;
        }
      | undefined;

    if (segmentId && sessionId) {
      const saved = await saveTranscriptSegment({
        childUserId: authz.session!.user.id,
        entryId,
        segmentId,
        sessionId,
        sequence,
        transcriptText: transcript,
      });
      segmentMeta = {
        segmentId: saved.segmentId,
        sequence: saved.sequence,
        sessionId: saved.sessionId,
        duplicated: saved.duplicated,
      };
    }

    const shouldApply = applyRaw === "true" || applyRaw === "1";
    if (!shouldApply) {
      return NextResponse.json(
        {
          transcript,
          segment: segmentMeta,
          notice:
            "Ses, yapılandırılmış yazıya çevirme servisine gönderildi. Servisin veriyi ne kadar sakladığı sağlayıcı politikasına bağlıdır.",
        },
        { headers: NO_STORE },
      );
    }

    const mode = modeRaw === "replace" ? "replace" : "append";
    const entry = await applyTranscriptToEntry({
      childUserId: authz.session!.user.id,
      entryId,
      transcriptText: transcript,
      expectedRevision,
      mode,
      skipTranscriptRow: Boolean(segmentMeta),
    });

    return NextResponse.json(
      {
        entry,
        transcript,
        segment: segmentMeta,
        notice:
          "Ses, yapılandırılmış yazıya çevirme servisine gönderildi. Servisin veriyi ne kadar sakladığı sağlayıcı politikasına bağlıdır.",
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return mapError(error);
  }
}
