import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ChildProfile, Family, UserRole } from "@prisma/client";

export type AppSession = {
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
  };
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
};

export async function getAppSession(): Promise<AppSession | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return null;

  const role = (session.user as { role?: string }).role;
  if (role !== "PARENT" && role !== "CHILD") return null;

  return {
    session: {
      id: session.session.id,
      token: session.session.token,
      userId: session.user.id,
      expiresAt: new Date(session.session.expiresAt),
    },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role,
    },
  };
}

export async function requireParentSession(): Promise<AppSession> {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    redirect("/giris");
  }
  return session;
}

export async function requireChildSession(): Promise<AppSession> {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") {
    redirect("/cocuk/giris");
  }
  return session;
}

export async function getParentFamilyContext(userId: string) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId },
    include: {
      family: {
        include: {
          children: {
            include: {
              invitations: {
                orderBy: { createdAt: "desc" },
                take: 5,
              },
              user: {
                include: {
                  sessions: {
                    where: { expiresAt: { gt: new Date() } },
                    orderBy: { createdAt: "desc" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return membership;
}

export async function assertParentOwnsChild(
  parentUserId: string,
  childId: string,
): Promise<{ child: ChildProfile; family: Family }> {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });

  if (!membership) {
    throw new AuthorizationError("Bu aileye erişimin yok.");
  }

  const child = await prisma.childProfile.findFirst({
    where: {
      id: childId,
      familyId: membership.familyId,
    },
    include: { family: true },
  });

  if (!child) {
    throw new AuthorizationError("Bu çocuğa erişimin yok.");
  }

  return { child, family: child.family };
}

export async function getChildProfileForUser(userId: string) {
  return prisma.childProfile.findUnique({
    where: { userId },
  });
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
