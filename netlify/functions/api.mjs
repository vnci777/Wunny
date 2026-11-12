import { getStore } from "@netlify/blobs";
import { makeHandler } from "../lib/wunny.mjs";

export default async (req, context) => {
  // Which deploy is live, so pages left open on phones know when to reload into a newer version.
  if (new URL(req.url).pathname === "/api/version") {
    return new Response(JSON.stringify({ v: context?.deploy?.id || null }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const store = getStore({ name: "wunny", consistency: "strong" });
  const getEnv = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
  return makeHandler(store, getEnv)(req);
};

export const config = { path: "/api/*" };
