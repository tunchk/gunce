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
import { isMailDeliveryAvailable } from "@/lib/mail";
import {
  avatarSchema,
  childProfileSchema,
  fieldErrors,
  parentForgotPasswordSchema,
  parentRegisterSchema,
  parentResetPasswordSchema,
  parentSignInSchema,
  parentVerifyEmailSchema,
} from "@/lib/validation";

export type ActionState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  token?: string;
};

const PUBLIC_RESET_MESSAGE =
  "Bu adresle bir hesap varsa, şifre yenileme bağlantısını gönderdik.";

async function rateLimitOrFail(
  action: string,
  max = 30,
  windowMs = 60_000,
): Promise<ActionState | null> {
  const h = await headers();
  const ip = clientIpFromHeaders(h);
  const result = await consumeRateLimit(`action:${action}:${ip}`, max, windowMs);
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
    const signedIn = await auth.api.signInEmail({
      body: {
        email: parsed.data.email.toLowerCase(),
        password: parsed.data.password,
      },
      headers: await headers(),
    });
    const role = (signedIn.user as { role?: string } | undefined)?.role;
    if (role !== "PARENT") {
      await auth.api.signOut({ headers: await headers() });
      return { ok: false, message: "Bu giriş yalnızca veliler içindir." };
    }
  } catch {
    return { ok: false, message: "E-posta veya şifre hatalı." };
  }

  redirect("/veli");
}

export async function signOutAction() {
  const session = await getAppSession();
  if (session?.session?.id) {
    const { revokePushSubscriptionsForSession } = await import("@/lib/reminder");
    await revokePushSubscriptionsForSession(session.session.id);
  } else if (session?.user?.role === "CHILD") {
    const { revokePushSubscriptionsForUser } = await import("@/lib/reminder");
    await revokePushSubscriptionsForUser(session.user.id);
  }
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

/** Explicit confirmation — GET must not call this (scanner-safe). */
export async function confirmEmailVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("verify-email", 20, 60_000);
  if (limited) return limited;

  const parsed = parentVerifyEmailSchema.safeParse({
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Doğrulama bağlantısı geçersiz veya eksik.",
      errors: fieldErrors(parsed.error),
    };
  }

  const { consumeEmailVerifyRedemption } = await import(
    "@/lib/email-verify-redemption"
  );
  // Single-use gate before Better Auth JWT verify (JWTs alone are not consumed).
  const userId = await consumeEmailVerifyRedemption(parsed.data.token);
  if (!userId) {
    return {
      ok: false,
      message:
        "Doğrulama başarısız. Bağlantı süresi dolmuş, geçersiz veya daha önce kullanılmış olabilir.",
    };
  }

  try {
    await auth.api.verifyEmail({
      query: { token: parsed.data.token },
    });
  } catch {
    return {
      ok: false,
      message:
        "Doğrulama başarısız. Bağlantı süresi dolmuş, geçersiz veya daha önce kullanılmış olabilir.",
    };
  }

  return {
    ok: true,
    message: "E-posta adresin doğrulandı. Artık giriş yaparak devam edebilirsin.",
  };
}

export async function resendVerificationEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  void formData;
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }

  if (session.user.emailVerified) {
    return { ok: true, message: "E-posta adresin zaten doğrulanmış." };
  }

  // Cooldown: 1 / 60s per user; broader IP cap.
  const cooldown = await consumeRateLimit(
    `action:verify-resend-user:${session.user.id}`,
    1,
    60_000,
  );
  if (!cooldown.allowed) {
    return {
      ok: false,
      message: `Tekrar göndermek için ${cooldown.retryAfterSeconds} sn bekle.`,
    };
  }
  const limited = await rateLimitOrFail("verify-resend", 5, 15 * 60_000);
  if (limited) return limited;

  if (!isMailDeliveryAvailable()) {
    return {
      ok: false,
      message: "E-posta gönderimi şu an yapılamıyor. Daha sonra tekrar dene.",
    };
  }

  try {
    await auth.api.sendVerificationEmail({
      body: {
        email: session.user.email,
        callbackURL: "/veli/ana",
      },
      headers: await headers(),
    });
  } catch {
    return {
      ok: false,
      message: "Doğrulama e-postası gönderilemedi. Daha sonra tekrar dene.",
    };
  }

  return {
    ok: true,
    message: "Doğrulama e-postası gönderildi. Gelen kutunu kontrol et.",
  };
}

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("forgot-password", 5, 15 * 60_000);
  if (limited) {
    // Same public wording — do not reveal rate-limit as account signal via different copy
    // for success vs failure on unknown emails; still block abuse.
    return { ok: false, message: limited.message };
  }

  const parsed = parentForgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  try {
    await auth.api.requestPasswordReset({
      body: {
        email: parsed.data.email.toLowerCase(),
        redirectTo: "/veli/sifre-yenile",
      },
      headers: await headers(),
    });
  } catch {
    // Keep response account-independent even when delivery/API fails.
  }

  return { ok: true, message: PUBLIC_RESET_MESSAGE };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("reset-password", 10, 60_000);
  if (limited) return limited;

  const parsed = parentResetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  try {
    await auth.api.resetPassword({
      body: {
        newPassword: parsed.data.password,
        token: parsed.data.token,
      },
    });
  } catch {
    return {
      ok: false,
      message:
        "Şifre yenilenemedi. Bağlantı süresi dolmuş, geçersiz veya daha önce kullanılmış olabilir.",
    };
  }

  return {
    ok: true,
    message: "Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.",
  };
}

export async function inviteGuardianAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("guardian-invite", 10, 15 * 60_000);
  if (limited) return limited;

  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }

  const childId = String(formData.get("childId") || "");
  const email = String(formData.get("email") || "");
  if (!childId) return { ok: false, message: "Çocuk seçilmedi." };

  const parsed = parentForgotPasswordSchema.safeParse({ email });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  try {
    const { inviteGuardian, GuardianError } = await import("@/lib/guardian");
    await inviteGuardian({
      managerUserId: session.user.id,
      childId,
      email: parsed.data.email,
    });
    return {
      ok: true,
      message: "Davet e-postası gönderildi. Alıcı kendi hesabıyla kabul etmeli.",
    };
  } catch (error) {
    const { GuardianError } = await import("@/lib/guardian");
    const { AuthorizationError } = await import("@/lib/session");
    if (error instanceof GuardianError || error instanceof AuthorizationError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Davet gönderilemedi." };
  }
}

export async function revokeGuardianInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }
  const invitationId = String(formData.get("invitationId") || "");
  if (!invitationId) return { ok: false, message: "Davet seçilmedi." };

  try {
    const { revokeGuardianInvitation, GuardianError } = await import("@/lib/guardian");
    await revokeGuardianInvitation({
      managerUserId: session.user.id,
      invitationId,
    });
    return { ok: true, message: "Davet iptal edildi." };
  } catch (error) {
    const { GuardianError } = await import("@/lib/guardian");
    const { AuthorizationError } = await import("@/lib/session");
    if (error instanceof GuardianError || error instanceof AuthorizationError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "İptal edilemedi." };
  }
}

export async function removeGuardianAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Oturum gerekli." };
  }
  const childId = String(formData.get("childId") || "");
  const targetUserId = String(formData.get("targetUserId") || "");
  if (!childId || !targetUserId) {
    return { ok: false, message: "Eksik bilgi." };
  }

  try {
    const { removeGuardianAccess, GuardianError } = await import("@/lib/guardian");
    await removeGuardianAccess({
      managerUserId: session.user.id,
      childId,
      targetUserId,
    });
    return {
      ok: true,
      message:
        "Veli erişimi kaldırıldı. Bundan sonra uygulamada bu çocuğu göremez; daha önce okudukları geri alınamaz.",
    };
  } catch (error) {
    const { GuardianError } = await import("@/lib/guardian");
    const { AuthorizationError } = await import("@/lib/session");
    if (error instanceof GuardianError || error instanceof AuthorizationError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Kaldırılamadı." };
  }
}

export async function acceptGuardianInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await rateLimitOrFail("guardian-accept", 20, 60_000);
  if (limited) return limited;

  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    return { ok: false, message: "Daveti kabul etmek için veli olarak giriş yap." };
  }

  const token = String(formData.get("token") || "").trim();
  if (!token) return { ok: false, message: "Davet bağlantısı eksik." };

  try {
    const { acceptGuardianInvitation, GuardianError } = await import("@/lib/guardian");
    await acceptGuardianInvitation({
      token,
      acceptorUserId: session.user.id,
    });
    return {
      ok: true,
      message: "Davet kabul edildi. Artık bu çocuğun planını ve sana özel paylaşımları görebilirsin.",
    };
  } catch (error) {
    const { GuardianError } = await import("@/lib/guardian");
    if (error instanceof GuardianError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Davet kabul edilemedi." };
  }
}
