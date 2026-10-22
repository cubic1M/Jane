"use server";

import { redirect } from "next/navigation";
import {
  confirmBeneficiaries,
  FamilyFileError,
  recordEvent,
  saveBeneficiaries,
  saveContacts,
  savePicks,
} from "@/lib/investments/family-file";
import { requireUser } from "@/lib/session";

// The family file page's forms (spec step 237). They record what the person says; nothing
// changes at a bank or a plan.

const back = (done: string) => redirect(`/investments/family-file?done=${done}`);

export async function saveNames(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get("accountId") ?? "");
  const names = [1, 2, 3, 4].map((i) => ({
    name: String(formData.get(`name${i}`) ?? ""),
    relationship: String(formData.get(`relationship${i}`) ?? "other"),
    sharePct: Number(formData.get(`share${i}`) ?? 0),
    tier: (i > 2 ? "contingent" : "primary") as "primary" | "contingent",
  }));
  try {
    await saveBeneficiaries(user.id, accountId, names);
  } catch (error) {
    if (!(error instanceof FamilyFileError)) throw error;
    back("shares");
  }
  back("saved");
}

export async function stillRight(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await confirmBeneficiaries(user.id, String(formData.get("accountId") ?? ""));
  } catch (error) {
    if (!(error instanceof FamilyFileError)) throw error;
    back("none");
  }
  back("confirmed");
}

export async function addEvent(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await recordEvent(
      user.id,
      String(formData.get("kind") ?? ""),
      String(formData.get("on") ?? ""),
    );
  } catch (error) {
    if (!(error instanceof FamilyFileError)) throw error;
    back("event");
  }
  back("event_saved");
}

export async function saveSharing(formData: FormData): Promise<void> {
  const user = await requireUser();
  await savePicks(user.id, formData.getAll("picks").map(String));
  back("picked");
}

export async function saveFileContacts(formData: FormData): Promise<void> {
  const user = await requireUser();
  const contacts = [1, 2, 3].map((i) => ({
    name: String(formData.get(`cname${i}`) ?? ""),
    role: String(formData.get(`crole${i}`) ?? ""),
    phone: String(formData.get(`cphone${i}`) ?? "") || null,
    email: String(formData.get(`cemail${i}`) ?? "") || null,
  }));
  await saveContacts(user.id, contacts, String(formData.get("documents") ?? ""));
  back("contacts");
}
