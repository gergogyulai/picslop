<div align="center">
  <br>
  <h1>picslop</h1>
  <sub>a private image & video board for people who share one inbox domain</sub>
  <br>
  <br>
</div>

picslop is a self-hosted image and video board gated to your own email domain. Sign-in is magic-link only, no passwords — post images or short clips, vote, comment in threads, react with emoji, and sort by hot, top, new, or most discussed.

- 🔗 Passwordless auth via magic link (Better Auth), domain-restricted sign-up
- 🖼️ Images and video, with HEIC→JPEG conversion and in-browser video validation
- ⬆️⬇️ Voting, nested comments, and emoji reactions
- 🔥 Hot / top / new / most-discussed sorting
- 🪣 Media stored in Cloudflare R2 via presigned uploads
- 🛡️ Cloudflare Turnstile on sign-in, Redis-backed rate limiting, admin ban tools
- 📱 Installable as a PWA

## Quick Start

```bash
bun install
```

Copy `apps/web/.env.schema` to `apps/web/.env` and fill in the values:

| Variable | How to get it |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Your app's URL, e.g. `http://localhost:5173` |
| `DATABASE_URL` | A MongoDB connection string |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated domains allowed to sign in |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | [upstash.com](https://upstash.com) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) — test keys work for local dev |
| `RESEND_API_KEY` | [resend.com](https://resend.com) — optional, magic links print to the console without it |

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Project Structure

```
picslop/
├── apps/
│   └── web/         # SvelteKit app
├── packages/
│   ├── auth/        # Better Auth configuration
│   └── db/          # Mongoose schema & queries
```

## Contribute

This is a personal project, built in the open. Ideas, issues, and PRs are welcome.

## License

[MIT](./LICENSE)
