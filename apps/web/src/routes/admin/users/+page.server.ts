import { listAdminUsers } from "$lib/server/admin";
import { listBlocked } from "$lib/server/blocklist";
import { requireAdmin } from "$lib/server/guard";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const me = requireAdmin(locals);
  const [users, blocked] = await Promise.all([listAdminUsers(), listBlocked()]);
  return { users, blocked, meId: me.id };
};
