import Link from "next/link";
import { recentActivity } from "@/lib/access-log";
import { getCurrentUser } from "@/lib/session";

// The signed-in person's own recent sign-ins and account changes (src/lib/access-log.ts), so
// they can spot one that wasn't them. Nothing for someone signed out.
export async function YourActivity() {
  const user = await getCurrentUser();
  if (!user) return null;
  const activity = await recentActivity(user.id);
  return (
    <section aria-labelledby="your-activity" className="flex flex-col gap-3">
      <h2 id="your-activity">Your recent activity</h2>
      {activity.length === 0 ? (
        <p>Nothing yet.</p>
      ) : (
        <ul className="!list-none !pl-0 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {activity.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-x-4 py-2">
              <span className={a.failed ? "font-semibold text-zinc-950 dark:text-zinc-50" : ""}>
                {a.what}
              </span>
              <span className="text-zinc-500">
                {[a.device, a.place, `${a.at.toISOString().slice(0, 16).replace("T", " ")} UTC`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        Not you?{" "}
        <Link href="/settings#sessions" className="underline">
          Sign out other devices
        </Link>{" "}
        and tell us at once.
      </p>
    </section>
  );
}
