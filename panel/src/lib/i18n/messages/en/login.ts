const login = {
  invalidCredentials: 'Invalid username or password',
  networkError: 'Unable to connect. Check your connection and try again.',
  tooManyAttempts: 'Too many sign-in attempts. Please try again in 15 minutes.',
  adminCreated: 'Administrator created, please sign in',
  noAdminLead: 'No administrator yet. Sign in to the server over SSH and run',
  noAdminTail: ', then come back to this page to sign in.',
  username: 'Username',
  totpLabel: 'TOTP code',
  totpRequired: 'Enter your TOTP code',
  invalidTotp: 'The code is incorrect or expired, please try again',
  signingIn: 'Signing in…',
  submit: 'Sign in',
  passkeySubmit: 'Sign in with Passkey',
  passkeyNotRegistered: 'No Passkey is registered for this account',
  passkeyFailed: 'Passkey sign-in failed',
  passkeyInterrupted: 'Passkey sign-in interrupted: {message}',
}

export default login
