const e = import.meta.env;
/** Local Firebase emulators (npm run emulators): test accounts never touch the real project. */
const emulator = e.VITE_FIREBASE_EMULATOR === '1';

/** Public build-time configuration. Firebase web config is meant to be public; never put admin keys here. */
export const env = {
  emulator,
  firebase: {
    // In emulator mode the real project's values are ignored outright, so tests can't reach it.
    apiKey: emulator ? 'demo-key' : (e.VITE_FIREBASE_API_KEY as string | undefined),
    authDomain: emulator ? 'demo-chromashift.firebaseapp.com' : (e.VITE_FIREBASE_AUTH_DOMAIN as string | undefined),
    projectId: emulator ? 'demo-chromashift' : (e.VITE_FIREBASE_PROJECT_ID as string | undefined),
    appId: emulator ? 'demo-app' : (e.VITE_FIREBASE_APP_ID as string | undefined),
    messagingSenderId: emulator ? undefined : (e.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined),
  },
  /** Default multiplayer server (wss://…), used by Quick Play and room codes. */
  defaultServer: (e.VITE_DEFAULT_SERVER_URL as string | undefined) || '',
  /**
   * Optional TURN relay for browser-hosted games, for players on networks that block direct
   * peer-to-peer links. These credentials ship in the bundle, so use a relay account meant for that.
   */
  turn: e.VITE_TURN_URLS
    ? { urls: String(e.VITE_TURN_URLS).split(',').map((s) => s.trim()).filter(Boolean), username: e.VITE_TURN_USERNAME as string | undefined, credential: e.VITE_TURN_CREDENTIAL as string | undefined }
    : null,
  base: e.BASE_URL,
};

export const firebaseConfigured = !!(env.firebase.apiKey && env.firebase.projectId && env.firebase.appId);
