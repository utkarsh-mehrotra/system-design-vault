# Turn on Google sign-in progress sync (Firebase)

The code is already deployed; the "Sign in" button appears once `firebase-config.js` has your project's config.

1. **Create a project** at https://console.firebase.google.com → *Add project* (Google Analytics not needed).
2. **Enable Google sign-in:** *Build → Authentication → Get started → Sign-in method → Google → Enable* (pick a support email) → Save.
3. **Authorise the site's domain:** *Authentication → Settings → Authorized domains → Add domain* → `system-design-vault.vercel.app` (`localhost` is there by default for local testing).
4. **Create the database:** *Build → Firestore Database → Create database* → production mode → pick a location near you.
5. **Set the security rules:** *Firestore → Rules* → paste the contents of `firestore.rules` from this repo → Publish. (Each user can only read/write their own `progress/{uid}` document.)
6. **Get the web config:** *Project settings (gear) → Your apps → Web (`</>`)* → register an app (no hosting) → copy the `firebaseConfig` object.
7. **Paste it** into `firebase-config.js` as `window.FIREBASE_CONFIG = { ... };`, then commit and deploy (`npx vercel --prod`).

The config values (apiKey etc.) are public identifiers, not secrets; the Firestore rules are what protect the data.

## How sync behaves
- Signed out: progress stays in this browser (localStorage), as before.
- First sign-in on a device: local and cloud progress are **merged** (nothing is lost), then saved to the cloud.
- After that: every change is saved to the cloud about 1.5 s later; returning to the tab pulls changes made on other devices.
- Sign out keeps the local copy. Reset clears local and cloud.
- Data: one Firestore document per user at `progress/{uid}` with `done`, `conf`, `drill`, `rev`, `updatedAt`.
