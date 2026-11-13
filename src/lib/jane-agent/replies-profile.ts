import { type Profile } from "@/profile/build";
import type { Reply } from "./replies";
import { whoAmI } from "./who-am-i";
import { openLink } from "./types";

// What Jane knows about the person (spec step 253), as a short paragraph about their life built
// only from the facts it holds (./who-am-i.ts), each said as sure as it is, with the page where
// any of them can be corrected.
export function profileReply(profile: Profile): Reply {
  const { body } = whoAmI(profile);
  return {
    body,
    actions: [openLink("What Jane knows about you", "/profile")],
    refs: {},
  };
}
