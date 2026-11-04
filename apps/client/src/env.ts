const e = import.meta.env;

/** Public build-time configuration. Firebase web config is meant to be public; never put admin keys here. */
export const env = {
  firebase: {
    apiKey: e.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: e.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: e.VITE_FIREBASE_APP_ID as string | undefined,
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
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
