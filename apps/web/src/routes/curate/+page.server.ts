import { exportBlockers } from "$lib/sets";
import { listSets } from "$lib/server/sets";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const sets = await listSets();
  return {
    sets: sets.map((s) => ({
      id: s.id,
      name: s.name,
      createdByName: s.createdByName,
      updatedAt: s.updatedAt,
      count: s.items.length,
      approved: s.items.filter((i) => i.post && i.state === "approved").length,
      blockers: exportBlockers(s.items),
      thumbs: s.items.slice(0, 5).map((i) => ({ id: i.postId, url: i.post?.thumbUrl ?? "", state: i.state })),
    })),
  };
};
