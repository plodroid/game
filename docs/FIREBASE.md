# Setting up accounts (Firebase, free Spark plan)

Accounts are optional. Without this setup, everyone plays as a guest and progress stays on their device. Everything below fits Firebase's no-cost **Spark** plan. Do **not** add billing or upgrade to Blaze; nothing here needs it. Cloud Functions, App Hosting and Storage are not used.

## 1. Create the project

1. Go to https://console.firebase.google.com and click **Create a project**. Google Analytics is not needed.
2. Project settings → **General** → **Your apps** → add a **Web** app. Firebase Hosting is not needed.
3. Copy the config values into `.env` for local builds:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_APP_ID=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   ```

   For the GitHub Pages build, add the same names as repository **Variables** (Settings → Secrets and variables → Actions → **Variables**). `VITE_FIREBASE_API_KEY` may be a Secret instead; the workflow reads either. The web config is public by design; security comes from the rules below.

## 2. Authentication

1. **Build → Authentication → Get started.**
2. **Sign-in method:** enable **Email/Password** (not the passwordless email link), and enable **Google** (choose a support email).
3. **Settings → Authorized domains:** make sure these are listed:
   - `localhost` (development)
   - `plodroid.github.io` (the GitHub Pages site)
   - any domain you self-host the client on

Phone authentication is not used.

## 3. Firestore

1. **Build → Firestore Database → Create database.** Pick a location and start in **production mode**.
2. **Rules:** replace them with the contents of [`firestore.rules`](../firestore.rules) and publish. Or, with the Firebase CLI: `npx firebase-tools deploy --only firestore:rules`.

What the rules enforce:

| Collection | Who can read | Who can write |
| --- | --- | --- |
| `usernames/{name}` | anyone (`get` only, for availability checks) | created once by its owner in the same transaction as their profile; never renamed by edit |
| `users/{uid}` (private: settings, offline progress, loadout) | owner | owner, with validated fields; username and created date immutable; XP growth capped per write |
| `profiles/{uid}` (public card: username, display name, level, look) | signed-in players | owner, validated |
| `stats/{uid}` (verified online record) | owner | nobody from a client. Only the game server through the Admin SDK |
| `rooms/{uid}` (public game listing: code, host's display name, map, mode, player count, phase) | anyone | the signed-in host, one listing per account, every field validated, timestamp set by the server |

Passwords never reach Firestore; Firebase Authentication stores them. Emails are not copied into any document.

## 4. Optional: verified results on your game server

The game server can verify signed-in players and record **verified** online results:

- `FIREBASE_PROJECT_ID=your-project` alone lets the server verify sign-in tokens.
- Add `FIREBASE_SERVICE_ACCOUNT` to also read usernames (so names can't be spoofed) and write `stats/{uid}`. Create the key under Project settings → Service accounts → **Generate new private key**. Store the JSON outside the repository and point the variable at its path, or paste the JSON into the variable.

**Never** commit the service-account file or put it in the web build. `.gitignore` excludes common names (`*service-account*.json`, `*-adminsdk-*.json`), but keep it out of the project folder anyway.

## Quotas and failures

The Spark plan has daily limits (reads, writes, storage). CHROMASHIFT is frugal: one read at sign-in, debounced writes after changes, and the Firestore offline cache.

Public games are the busiest part. A listed game writes about once a minute (more while players come and go), so the free 20,000 writes a day cover roughly 150 hours of listed games a day. Browsers only watch the list while the Online screen is open, and each watcher reads a listing again when it changes. If the quota runs out, the list stops updating until the next day; codes and invite links keep working, because they don't use Firestore.

If the service is unreachable or a quota is exhausted:

- the game keeps working: offline play, settings and progress are saved locally;
- the Profile screen shows "saved on this device, will sync when possible";
- retries back off exponentially (up to 5 minutes) rather than hammering the service.
