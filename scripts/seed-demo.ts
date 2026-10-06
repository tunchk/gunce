/**
 * Seed a stable manual-testing family on the development database (`gunce`).
 * Usage: npx tsx scripts/seed-demo.ts
 */
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const { hashPassword } = await import("better-auth/crypto");
  const { prisma } = await import("../src/lib/prisma");
  const {
    ensureParentFamily,
    upsertChildDuringOnboarding,
    createPairingInvitation,
  } = await import("../src/lib/family");

  const email = "demo.veli@gunce.local";
  const password = "DemoVeli123!";
  const name = "Demo Veli";

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name,
        email,
        emailVerified: true,
        role: "PARENT",
      },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(password),
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, name },
    });
    const account = await prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    if (account) {
      await prisma.account.update({
        where: { id: account.id },
        data: { password: await hashPassword(password) },
      });
    } else {
      await prisma.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: await hashPassword(password),
        },
      });
    }
  }

  await ensureParentFamily(user.id);
  const child = await upsertChildDuringOnboarding({
    parentUserId: user.id,
    displayName: "Deniz",
    ageGroup: "AGE_9_11",
    timeZone: "Europe/Istanbul",
  });

  await prisma.childProfile.update({
    where: { id: child.id },
    data: { onboardingStep: "COMPLETE", avatarKey: "deniz" },
  });

  const membership = await prisma.familyMembership.findUnique({
    where: { userId: user.id },
  });
  if (membership) {
    await prisma.family.update({
      where: { id: membership.familyId },
      data: { onboardingStep: "COMPLETE" },
    });
  }

  // Ensure guardian access row exists for manager (M10+)
  const access = await prisma.childGuardianAccess.findFirst({
    where: { userId: user.id, childId: child.id, revokedAt: null },
  });
  if (!access) {
    await prisma.childGuardianAccess.create({
      data: {
        userId: user.id,
        childId: child.id,
        role: "MANAGER",
        generation: 1,
      },
    });
  }

  const { token } = await createPairingInvitation({
    parentUserId: user.id,
    childId: child.id,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        parent: { email, password, name },
        child: { displayName: child.displayName, id: child.id },
        childPairingToken: token,
        urls: {
          parentSignIn: "/giris",
          childSignIn: "/cocuk/giris",
        },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
