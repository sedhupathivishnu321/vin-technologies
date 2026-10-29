/* Site-wide settings for the account layer (see account.js).
 * googleClientId: paste the "Web client ID" from Google Cloud Console (APIs & Services > Credentials > OAuth client ID,
 *   authorised JavaScript origins: https://vintechnologies.co.in). While empty, the Sign in button is hidden.
 * requireSignIn: true = visitors must sign in with Google before the simulators open (only takes effect once googleClientId is set).
 * cacheLimitMB: the most the simulators may keep in the visitor's browser (oldest work is removed first). */
window.LL_CONFIG = { googleClientId: "125720671346-5dre30aa93ed45d7q4uoa1l9h0m5416v.apps.googleusercontent.com", cacheLimitMB: 100, requireSignIn: false };
