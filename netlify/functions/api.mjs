import { getStore } from "@netlify/blobs";
import { makeHandler } from "../lib/wunny.mjs";

export default async (req) => {
  const store = getStore({ name: "wunny", consistency: "strong" });
  return makeHandler(store)(req);
};

export const config = { path: "/api/*" };
