import { createAuth } from "@picslop/auth";
import { createDb } from "@picslop/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db);
