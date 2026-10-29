/* Site-wide settings for the account layer (see account.js).
 * googleClientId: paste the "Web client ID" from Google Cloud Console (APIs & Services > Credentials > OAuth client ID,
 *   authorised JavaScript origins: https://vintechnologies.co.in). While empty, the Sign in button is hidden.
 * requireSignIn: true = visitors must sign in with Google before the simulators open (only takes effect once googleClientId is set).
 * cacheLimitMB: the most the simulators may keep in the visitor's browser (oldest work is removed first). */
window.LL_CONFIG = { googleClientId: "", cacheLimitMB: 8, requireSignIn: true };
