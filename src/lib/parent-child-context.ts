import { cookies } from "next/headers";
import {
  getParentAccessibleChildren,
  getParentFamilyContext,
} from "@/lib/session";

export const SELECTED_CHILD_COOKIE = "gunce_selected_child";

export async function resolveParentChildContext(userId: string) {
  const accesses = await getParentAccessibleChildren(userId);
  const membership = await getParentFamilyContext(userId);

  if (accesses.length === 0) {
    return {
      membership,
      accesses,
      child: null as null,
      access: null as null,
      needsOnboarding: !membership || membership.family.onboardingStep !== "COMPLETE",
    };
  }

  const jar = await cookies();
  const preferred = jar.get(SELECTED_CHILD_COOKIE)?.value;
  const selected =
    accesses.find((a) => a.childId === preferred) ?? accesses[0]!;

  return {
    membership,
    accesses,
    child: selected.child,
    access: selected,
    needsOnboarding:
      Boolean(membership) &&
      membership!.family.onboardingStep !== "COMPLETE" &&
      // Own-family incomplete onboarding only when this is their membership child
      membership!.family.children.some((c) => c.id === selected.childId),
  };
}
