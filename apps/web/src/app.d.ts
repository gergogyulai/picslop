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
      /** Designated curator (admins count as curators wherever curating is allowed). */
      isCurator: boolean;
      /** May approve or veto images in curated sets. Only granted explicitly, never implied by admin. */
      isReviewer: boolean;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
