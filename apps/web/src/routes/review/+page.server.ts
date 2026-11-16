import { listSets } from "$lib/server/sets";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const sets = await listSets();
  return {
    sets: sets
      .map((s) => ({
        id: s.id,
        name: s.name,
        createdByName: s.createdByName,
        updatedAt: s.updatedAt,
        count: s.items.length,
        pending: s.items.filter((i) => i.post && i.state === "pending").length,
        approved: s.items.filter((i) => i.post && i.state === "approved").length,
        vetoed: s.items.filter((i) => i.post && i.state === "vetoed").length,
      }))
      .sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0) || b.updatedAt - a.updatedAt),
  };
};
