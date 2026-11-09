# Wunny

Ten minutes of Cantonese a day with Wunny the raccoon.

- `public/index.html` is the whole app (images are built in).
- `netlify/functions/api.mjs` and `netlify/lib/wunny.mjs` run the accounts: sign-up, log-in, saved progress and the admin learner list. Data is kept in Netlify Blobs.
- Admin usernames are listed in `netlify/lib/wunny.mjs` (`ADMINS`).

Netlify publishes `main` automatically.
