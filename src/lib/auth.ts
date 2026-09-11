import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getAppOrigin } from "@/lib/app-origin";
import {
  isMailDeliveryAvailable,
  reportMailFailure,
  sendMail,
} from "@/lib/mail";
import { registerEmailVerifyRedemption } from "@/lib/email-verify-redemption";
import { prisma } from "@/lib/prisma";

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = getAppOrigin();

if (!secret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET is required");
}

const VERIFICATION_EXPIRES_SEC = 60 * 60 * 24; // 24 hours
const RESET_EXPIRES_SEC = 60 * 60; // 1 hour

async function deliverAuthEmail(input: {
  purpose: "verification" | "password-reset";
  to: string;
  subject: string;
  text: string;
  /** When false, failures are logged and swallowed (signup / public reset). */
  rethrow: boolean;
}): Promise<void> {
  try {
    if (!isMailDeliveryAvailable()) {
      throw new Error("mail_transport_unavailable");
    }
    await sendMail({
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  } catch (error) {
    reportMailFailure(input.purpose, error);
    if (input.rethrow) throw error;
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: secret || "dev-only-insecure-secret-change-me",
  baseURL,
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: VERIFICATION_EXPIRES_SEC,
    autoSignInAfterVerification: false,
    /**
     * Custom app URL (not Better Auth's GET /verify-email) so email scanners
     * cannot consume the token by merely opening the link. Confirmation is POST.
     */
    sendVerificationEmail: async ({ user, token }) => {
      const origin = getAppOrigin();
      const link = `${origin}/veli/eposta-dogrula?token=${encodeURIComponent(token)}`;
      try {
        await registerEmailVerifyRedemption({
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + VERIFICATION_EXPIRES_SEC * 1000),
        });
      } catch (error) {
        reportMailFailure("verification-redemption", error);
      }
      // Swallow on signup path: registration must not roll back if delivery fails.
      // Authenticated resend checks isMailDeliveryAvailable() before calling the API.
      await deliverAuthEmail({
        purpose: "verification",
        to: user.email,
        subject: "Günce — e-postanı doğrula",
        text: [
          "Merhaba,",
          "",
          "Günce hesabındaki e-posta adresini doğrulamak için aşağıdaki bağlantıyı aç,",
          "sonra sayfadaki “E-postamı doğrula” düğmesine bas.",
          "",
          link,
          "",
          "Bu bağlantı sınırlı süre geçerlidir. Sen istemediysen bu iletiyi yok sayabilirsin.",
        ].join("\n"),
        rethrow: false,
      });
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Verification is optional for access in this milestone.
    requireEmailVerification: false,
    resetPasswordTokenExpiresIn: RESET_EXPIRES_SEC,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const origin = getAppOrigin();
      // Direct app page with token — GET does not consume (consume only on POST reset).
      const link = `${origin}/veli/sifre-yenile?token=${encodeURIComponent(token)}`;
      // Never throw: unknown vs known must stay indistinguishable at the public API.
      await deliverAuthEmail({
        purpose: "password-reset",
        to: user.email,
        subject: "Günce — şifreni yenile",
        text: [
          "Merhaba,",
          "",
          "Şifreni yenilemek için bağlantıyı aç ve yeni şifreni gir.",
          "Bağlantıyı yalnızca açmak hesabını değiştirmez.",
          "",
          link,
          "",
          "Bu bağlantı sınırlı süre geçerlidir. Sen istemediysen bu iletiyi yok sayabilirsin.",
        ].join("\n"),
        rethrow: false,
      });
    },
    /**
     * Better Auth consumes only the redeemed reset token. We also delete any
     * other outstanding reset-password verification rows for this user so a
     * successful reset invalidates older unused links (library gap).
     */
    onPasswordReset: async ({ user }) => {
      await prisma.verification.deleteMany({
        where: {
          value: user.id,
          identifier: { startsWith: "reset-password:" },
        },
      });
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "PARENT",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: false,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  trustedOrigins: [baseURL],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Public email signup is always a parent. Child users are created server-side.
          if (!user.email?.endsWith("@users.gunce.local")) {
            return {
              data: {
                ...user,
                role: "PARENT",
              },
            };
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

export const AUTH_EMAIL = {
  verificationExpiresSec: VERIFICATION_EXPIRES_SEC,
  resetExpiresSec: RESET_EXPIRES_SEC,
} as const;
