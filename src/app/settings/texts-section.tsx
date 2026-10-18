import { TEXT_CONSENT_TEXT } from "@/config/messaging";
import { textSettingsFor } from "@/lib/messaging/texts";
import { TextsForm } from "./texts-form";

// The "Texts" section of /settings (spec step 78).
export async function TextsSection({ userId }: { userId: string }) {
  const view = await textSettingsFor(userId);
  return (
    <section id="texts" className="flex scroll-mt-8 flex-col gap-3">
      <h2 className="text-xl font-semibold">Texts</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        Get Jane&apos;s urgent alerts, your weekly plan and things that need you by text (iMessage,
        or SMS). Answer the plan with YES, the numbers you want, or NO.
      </p>
      <TextsForm view={view} consentText={TEXT_CONSENT_TEXT} />
    </section>
  );
}
