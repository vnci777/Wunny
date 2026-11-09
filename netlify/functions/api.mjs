import { getStore } from "@netlify/blobs";
import { makeHandler } from "../lib/wunny.mjs";

export default async (req) => {
  const store = getStore({ name: "wunny", consistency: "strong" });
  const getEnv = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
  return makeHandler(store, getEnv)(req);
};

export const config = { path: "/api/*" };
