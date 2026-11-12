import { listAdminUsers } from "$lib/server/admin";
import { requireAdmin } from "$lib/server/guard";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const me = requireAdmin(locals);
  return { users: await listAdminUsers(), meId: me.id };
};
