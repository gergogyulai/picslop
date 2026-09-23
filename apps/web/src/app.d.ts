// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session } from "@picslop/auth";

declare global {
  namespace App {
    interface Error {
      message: string;
    }
    interface Locals {
      user: Session["user"] | null;
      session: Session["session"] | null;
      isAdmin: boolean;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
