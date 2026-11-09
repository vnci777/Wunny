# Wunny

10 minutes of Cantonese a day with Wunny the raccoon.

- `public/index.html` is the whole app (most images are built in).
- `public/art/` holds the animated Wunnys (Professor, kung fu, Hong Kong flag). Each is split into same-size layers so parts can move: a head, an arm, a flag.
- `public/audio/marble-and-string.mp3` is the looping background music.
- `netlify/functions/api.mjs` and `netlify/lib/wunny.mjs` run the accounts: sign-up, log-in, saved progress and the admin learner list. Data is kept in Netlify Blobs.
- Admin usernames are listed in `netlify/lib/wunny.mjs` (`ADMINS`).

Netlify publishes `main` automatically.
