import mongoose from "mongoose";

import type { DatabaseConfig } from "./config";

export async function createDb(env: DatabaseConfig) {
  await mongoose.connect(env.DATABASE_URL);
  return mongoose.connection.getClient().db();
}

export type Database = Awaited<ReturnType<typeof createDb>>;

/** The driver's ObjectId, for apps that query the auth collections directly. */
export const ObjectId = mongoose.mongo.ObjectId;
export type ObjectId = InstanceType<typeof mongoose.mongo.ObjectId>;
