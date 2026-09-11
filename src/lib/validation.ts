import { z } from "zod";

export const parentRegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Ad en az 2 karakter olmalı.")
    .max(80, "Ad çok uzun."),
  email: z.string().trim().email("Geçerli bir e-posta gir."),
  password: z
    .string()
    .min(8, "Şifre en az 8 karakter olmalı.")
    .max(128, "Şifre çok uzun."),
});

export const parentSignInSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta gir."),
  password: z.string().min(1, "Şifre gerekli."),
});

export const parentForgotPasswordSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta gir."),
});

export const parentResetPasswordSchema = z
  .object({
    token: z.string().trim().min(10, "Bağlantı geçersiz."),
    password: z
      .string()
      .min(8, "Şifre en az 8 karakter olmalı.")
      .max(128, "Şifre çok uzun."),
    passwordConfirm: z.string().min(1, "Şifre tekrarı gerekli."),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Şifreler eşleşmiyor.",
    path: ["passwordConfirm"],
  });

export const parentVerifyEmailSchema = z.object({
  token: z.string().trim().min(10, "Bağlantı geçersiz."),
});

export const childProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Görünen ad en az 2 karakter olmalı.")
    .max(40, "Görünen ad çok uzun."),
  ageGroup: z.enum(["AGE_9_11", "AGE_12_14"], {
    message: "Yaş grubu seç.",
  }),
  timeZone: z.string().trim().min(1, "Saat dilimi seç."),
});

export const pairingRedeemSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "Davet kodu geçersiz.")
    .max(200, "Davet kodu geçersiz."),
});

export const avatarSchema = z.object({
  avatarKey: z.enum(["deniz", "gunes", "yildiz", "agac", "kedi", "kitap"], {
    message: "Bir avatar seç.",
  }),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) {
      out[key] = issue.message;
    }
  }
  return out;
}
