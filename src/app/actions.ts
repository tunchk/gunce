"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import {
  advanceParentOnboarding,
  createPairingInvitation,
  ensureParentFamily,
  markParentOnboardingComplete,
  revokeChildSessions,
  updateChildOnboarding,
  upsertChildDuringOnboarding,
} from "@/lib/family";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { getAppSession } from "@/lib/session";
import {
  avatarSchema,
  childProfileSchema,
  fieldErrors,
  parentRegisterSchema,
  parentSignInSchema,
} from "@/lib/validation";

export type ActionState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  token?: string;
};

async function rateLimitOrFail(action: string): Promise<ActionState | null> {
  const h = await headers();
  const ip = clientIpFromHeaders(h);
  const result = await consumeRateLimit(`action:${action}:${ip}`, 30, 60_000);
  if (!result.allowed) {
    return {
      ok: false,
      message: `Çok fazla deneme. ${result.retryAfterSeconds} sn sonra tekrar dene.`,
    };
  }
  return null;
}

export async function registerParentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("register");
  if (limited) return limited;

  const parsed = parentRegisterSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  try {
    await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        password: parsed.data.password,
      },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      return {
        ok: false,
        message: "Bu e-posta ile kayıt olunamadı. Giriş yapmayı dene.",
      };
    }
    throw error;
  }

  // Ensure role stays PARENT (Better Auth additionalFields default)
  redirect("/veli/onboarding");
}

export async function signInParentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("signin");
  if (limited) return limited;

  const parsed = parentSignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  try {
    await auth.api.signInEmail({
      body: {
        email: parsed.data.email.toLowerCase(),
        password: parsed.data.password,
      },
      headers: await headers(),
    });
  } catch {
    return { ok: false, message: "E-posta veya şifre hatalı." };
  }

  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    await auth.api.signOut({ headers: await headers() });
    return { ok: false, message: "Bu giriş yalnızca veliler içindir." };
  }

  redirect("/veli");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

export async function saveChildProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("child-profile");
  if (limited) return limited;

  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }

  const parsed = childProfileSchema.safeParse({
    displayName: formData.get("displayName"),
    ageGroup: formData.get("ageGroup"),
    timeZone: formData.get("timeZone"),
  });

  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  await upsertChildDuringOnboarding({
    parentUserId: session.user.id,
    ...parsed.data,
  });

  redirect("/veli/onboarding/aciklama");
}

export async function continueExplanationAction() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    redirect("/giris");
  }
  await advanceParentOnboarding(session.user.id, "PAIRING");
  redirect("/veli/onboarding/eslestirme");
}

export async function createInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("create-invite");
  if (limited) return limited;

  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }

  const membership = await ensureParentFamily(session.user.id);
  const child = membership.family.children[0];
  if (!child) {
    return { ok: false, message: "Önce çocuk profili oluştur." };
  }

  const childId = String(formData.get("childId") || child.id);
  if (childId !== child.id) {
    // Only allow the family's child; ignore forged ids by re-checking in service
  }

  try {
    const { token } = await createPairingInvitation({
      parentUserId: session.user.id,
      childId,
    });
    await markParentOnboardingComplete(session.user.id);
    return { ok: true, token };
  } catch {
    return { ok: false, message: "Davet oluşturulamadı." };
  }
}

export async function revokeChildSessionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("revoke");
  if (limited) return limited;

  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }

  const childId = String(formData.get("childId") || "");
  if (!childId) {
    return { ok: false, message: "Çocuk seçilmedi." };
  }

  try {
    await revokeChildSessions({
      parentUserId: session.user.id,
      childId,
    });
    return { ok: true, message: "Çocuk oturumları sonlandırıldı." };
  } catch {
    return { ok: false, message: "İşlem yapılamadı." };
  }
}

export async function saveChildAvatarAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") {
    return { ok: false, message: "Oturum gerekli." };
  }

  const parsed = avatarSchema.safeParse({
    avatarKey: formData.get("avatarKey"),
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  await updateChildOnboarding({
    childUserId: session.user.id,
    avatarKey: parsed.data.avatarKey,
    step: "EXPLANATION",
  });

  redirect("/cocuk/onboarding/aciklama");
}

export async function finishChildOnboardingAction() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") {
    redirect("/cocuk/giris");
  }
  await updateChildOnboarding({
    childUserId: session.user.id,
    step: "COMPLETE",
  });
  redirect("/cocuk");
}
