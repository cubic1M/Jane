"use server";

import { revalidatePath } from "next/cache";
import { AccountantError, answerByToken } from "@/lib/accountant";

// The accountant's answers (spec step 222). The token is the credential: no sign-in.

export type AnswerState = { ok: boolean; message: string } | null;

const text = (f: FormData, name: string) => String(f.get(name) ?? "");

export async function answerAction(
  _previous: AnswerState,
  formData: FormData,
): Promise<AnswerState> {
  const token = text(formData, "token");
  try {
    await answerByToken(token, {
      questionKey: text(formData, "questionKey") || null,
      name: text(formData, "name"),
      body: text(formData, "body"),
    });
    revalidatePath(`/accountant/${token}`);
    return { ok: true, message: "Sent. Thank you." };
  } catch (error) {
    if (error instanceof AccountantError) return { ok: false, message: error.message };
    throw error;
  }
}
