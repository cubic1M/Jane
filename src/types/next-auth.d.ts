import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role: Role;
  }
}
