// Wunny accounts API: sign-up, log-in, saved progress, contact messages and the admin tools.
// The storage object is passed in so this file can run against Netlify Blobs or a test store.
import crypto from "node:crypto";

export const ADMINS = ["vincilo", "janisleung"];
const USERNAME = /^[a-z]{2,32}$/;
const SESSION_DAYS = 180;
const MAX_FAILS = 8;
const LOCK_MINUTES = 10;

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)))
  );

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return { salt: salt.toString("base64"), hash: key.toString("base64") };
}

async function checkPassword(password, user) {
  const key = await scrypt(password, Buffer.from(user.salt, "base64"));
  const stored = Buffer.from(user.hash, "base64");
  return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}

const isAdmin = (name) => ADMINS.includes(name);
const publicUser = (u) => ({ username: u.username, admin: isAdmin(u.username) });

// Progress is the app's own save object; keep it a plain object of sensible size.
function cleanProgress(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const text = JSON.stringify(p);
  if (text.length > 50000) return null;
  return JSON.parse(text);
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Natural Cantonese voices (Microsoft Azure Speech). Turned on by the AZURE_SPEECH_KEY and AZURE_SPEECH_REGION settings.
const VOICES = { hiugaai: "zh-HK-HiuGaaiNeural", hiumaan: "zh-HK-HiuMaanNeural", wanlung: "zh-HK-WanLungNeural" };
const RATES = { normal: "0%", calm: "-15%", slow: "-35%" };
const escXml = (t) => t.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
const audio = (buf) =>
  new Response(buf, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" } });

export function makeHandler(store, getEnv = () => undefined) {
  const voicesOn = () => Boolean(getEnv("AZURE_SPEECH_KEY") && getEnv("AZURE_SPEECH_REGION"));

  async function speech(url) {
    if (!voicesOn()) return json(503, { error: "Wunny voices aren't switched on yet." });
    const voice = VOICES[url.searchParams.get("voice")];
    const rate = RATES[url.searchParams.get("rate")] || RATES.normal;
    const text = (url.searchParams.get("text") || "").trim();
    // Only short Cantonese course text: keeps the voice service from being used for anything else.
    if (!voice || !text || text.length > 120 || !/[\u3400-\u9fff]/.test(text) || (text.match(/[A-Za-z]/g) || []).length > 16)
      return json(400, { error: "That can't be spoken." });
    const key = "tts/" + crypto.createHash("sha256").update(`${voice}|${rate}|${text}`).digest("hex");
    const cached = await store.get(key, { type: "arrayBuffer" });
    if (cached) return audio(cached);
    const ssml = `<speak version="1.0" xml:lang="zh-HK"><voice name="${voice}"><prosody rate="${rate}">${escXml(text)}</prosody></voice></speak>`;
    const r = await fetch(`https://${getEnv("AZURE_SPEECH_REGION")}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": getEnv("AZURE_SPEECH_KEY"),
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "wunny",
      },
      body: ssml,
    });
    if (!r.ok) {
      console.error("speech service", r.status, await r.text().catch(() => ""));
      return json(502, { error: "The voice service didn't answer." });
    }
    const buf = await r.arrayBuffer();
    await store.set(key, buf);
    return audio(buf);
  }

  const userKey = (name) => "users/" + name;
  const sessionKey = (token) => "sessions/" + token;
  const getUser = (name) => store.get(userKey(name), { type: "json" });
  const putUser = (u) => store.setJSON(userKey(u.username), u);

  async function newSession(username) {
    const token = crypto.randomBytes(32).toString("base64url");
    await store.setJSON(sessionKey(token), { username, created: Date.now() });
    return token;
  }

  async function authenticate(req) {
    const m = (req.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
    if (!m) return null;
    const session = await store.get(sessionKey(m[1]), { type: "json" });
    if (!session) return null;
    if (Date.now() - session.created > SESSION_DAYS * 864e5) {
      await store.delete(sessionKey(m[1]));
      return null;
    }
    const user = await getUser(session.username);
    return user ? { user, token: m[1] } : null;
  }

  return async function handle(req) {
    const path = new URL(req.url).pathname.replace(/^\/api/, "").replace(/\/+$/, "");
    const method = req.method;
    try {
      if (path === "/health") return json(200, { ok: true, voices: voicesOn() });
      if (path === "/tts" && method === "GET") return speech(new URL(req.url));

      if (path === "/signup" && method === "POST") {
        const b = await readBody(req);
        const username = String(b.username || "");
        const password = String(b.password || "");
        if (!USERNAME.test(username))
          return json(400, { error: "Usernames use lowercase English letters only, with no spaces. Example: janedoe." });
        if (password.length < 8 || password.length > 200)
          return json(400, { error: "Your password needs at least 8 characters." });
        if (await getUser(username))
          return json(409, { error: "That username is already taken. If it's yours, log in instead." });
        const now = Date.now();
        const user = {
          username,
          ...(await hashPassword(password)),
          created: now,
          lastSeen: now,
          progress: cleanProgress(b.progress),
          fails: 0,
          lockUntil: 0,
        };
        await putUser(user);
        const token = await newSession(username);
        return json(201, { token, user: publicUser(user), progress: user.progress, epoch: 0 });
      }

      if (path === "/login" && method === "POST") {
        const b = await readBody(req);
        const username = String(b.username || "").trim().toLowerCase();
        const password = String(b.password || "");
        const user = USERNAME.test(username) ? await getUser(username) : null;
        if (user && user.lockUntil > Date.now())
          return json(429, { error: `Too many tries. Wait ${LOCK_MINUTES} minutes, then try again.` });
        if (!user || !(await checkPassword(password, user))) {
          if (user) {
            user.fails = (user.fails || 0) + 1;
            if (user.fails >= MAX_FAILS) {
              user.fails = 0;
              user.lockUntil = Date.now() + LOCK_MINUTES * 60e3;
            }
            await putUser(user);
          }
          return json(401, { error: "That username and password don't match. Check the spelling and try again." });
        }
        user.fails = 0;
        user.lockUntil = 0;
        user.lastSeen = Date.now();
        await putUser(user);
        const token = await newSession(username);
        return json(200, { token, user: publicUser(user), progress: user.progress, epoch: user.epoch || 0 });
      }

      if (path === "/contact" && method === "POST") {
        const b = await readBody(req);
        if (b.website) return json(200, { ok: true }); // filled only by spam bots
        const name = String(b.name || "").trim().slice(0, 80);
        const email = String(b.email || "").trim().slice(0, 120);
        const message = String(b.message || "").trim();
        if (!message || message.length < 5) return json(400, { error: "Write a message before you send it." });
        if (message.length > 2000) return json(400, { error: "Keep your message under 2,000 characters." });
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "That email address doesn't look right." });
        const sender = await authenticate(req);
        const id = Date.now() + "-" + crypto.randomBytes(4).toString("hex");
        await store.setJSON("messages/" + id, { id, name, email, message, username: sender ? sender.user.username : null, created: Date.now() });
        return json(200, { ok: true });
      }

      // "Forgot your password?" on the log-in screen: tells the admins, without saying whether the account exists.
      if (path === "/forgot" && method === "POST") {
        const b = await readBody(req);
        if (b.website) return json(200, { ok: true });
        const username = String(b.username || "").trim().toLowerCase();
        const reach = String(b.reach || "").trim().slice(0, 120);
        if (!USERNAME.test(username)) return json(400, { error: "Type the username you signed up with: lowercase letters only, like janedoe." });
        const { blobs } = await store.list({ prefix: "messages/" });
        const recent = Date.now() - 10 * 60e3;
        for (const x of blobs) {
          const t = Number(x.key.slice(9).split("-")[0]);
          if (t > recent) { const m = await store.get(x.key, { type: "json" }); if (m && m.kind === "password" && m.username === username) return json(200, { ok: true }); }
        }
        const exists = !!(await getUser(username));
        const id = Date.now() + "-" + crypto.randomBytes(4).toString("hex");
        await store.setJSON("messages/" + id, {
          id, kind: "password", name: "Password help", username, reach, exists,
          message: `${username} forgot their password and asked for a reset.${reach ? " Reach them at: " + reach : ""}`,
          created: Date.now(),
        });
        return json(200, { ok: true });
      }

      const auth = await authenticate(req);
      if (!auth) return json(401, { error: "Please log in again." });
      const me = auth.user;

      if (path === "/me" && method === "GET") {
        me.lastSeen = Date.now();
        await putUser(me);
        return json(200, { user: publicUser(me), progress: me.progress, epoch: me.epoch || 0 });
      }

      if (path === "/progress" && method === "PUT") {
        const b = await readBody(req);
        const progress = cleanProgress(b.progress);
        if (!progress) return json(400, { error: "Your progress couldn't be saved." });
        if ((Number(b.epoch) || 0) < (me.epoch || 0))
          return json(409, { error: "Your progress was reset.", progress: me.progress, epoch: me.epoch });
        me.progress = progress;
        me.lastSeen = Date.now();
        await putUser(me);
        return json(200, { ok: true });
      }

      if (path === "/logout" && method === "POST") {
        await store.delete(sessionKey(auth.token));
        return json(200, { ok: true });
      }

      if (path.startsWith("/admin/")) {
        if (!isAdmin(me.username)) return json(403, { error: "Only Wunny admins can see this." });

        if (path === "/admin/learners" && method === "GET") {
          const { blobs } = await store.list({ prefix: "users/" });
          const users = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })))).filter(Boolean);
          return json(200, {
            learners: users.map((u) => ({
              username: u.username,
              admin: isAdmin(u.username),
              created: u.created,
              lastSeen: u.lastSeen,
              progress: u.progress || null,
            })),
          });
        }

        if (path === "/admin/reset-progress" && method === "POST") {
          const b = await readBody(req);
          const name = String(b.username || "");
          const target = USERNAME.test(name) ? await getUser(name) : null;
          if (!target) return json(404, { error: "There's no learner with that username." });
          target.progress = null;
          target.epoch = (target.epoch || 0) + 1;
          await putUser(target);
          return json(200, { ok: true });
        }

        if (path === "/admin/delete-user" && method === "POST") {
          const b = await readBody(req);
          const name = String(b.username || "");
          if (isAdmin(name)) return json(403, { error: "Admin accounts can't be deleted here." });
          const target = USERNAME.test(name) ? await getUser(name) : null;
          if (!target) return json(404, { error: "There's no learner with that username." });
          await store.delete(userKey(name));
          return json(200, { ok: true });
        }

        if (path === "/admin/messages" && method === "GET") {
          const { blobs } = await store.list({ prefix: "messages/" });
          const msgs = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })))).filter(Boolean);
          msgs.sort((a, b) => b.created - a.created);
          return json(200, { messages: msgs });
        }

        if (path === "/admin/messages/delete" && method === "POST") {
          const b = await readBody(req);
          const id = String(b.id || "");
          if (!/^\d+-[0-9a-f]{8}$/.test(id)) return json(400, { error: "That message couldn't be found." });
          await store.delete("messages/" + id);
          return json(200, { ok: true });
        }

        if (path === "/admin/reset" && method === "POST") {
          const b = await readBody(req);
          const name = String(b.username || "");
          const password = String(b.password || "");
          if (password.length < 8) return json(400, { error: "The new password needs at least 8 characters." });
          const target = USERNAME.test(name) ? await getUser(name) : null;
          if (!target) return json(404, { error: "There's no learner with that username." });
          Object.assign(target, await hashPassword(password), { fails: 0, lockUntil: 0 });
          await putUser(target);
          return json(200, { ok: true });
        }
      }

      return json(404, { error: "Not found." });
    } catch (err) {
      console.error(err);
      return json(500, { error: "Something went wrong on our side. Try again in a moment." });
    }
  };
}
