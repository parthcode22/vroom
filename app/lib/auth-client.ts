import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

/**
 * V Rooms creates no accounts of its own, so there is no signUp here. Accounts
 * exist at V Auth, which is what verifies the college email.
 */
export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});

export const { signOut, useSession } = authClient;

export async function signInWithVAuth(callbackURL = "/room"): Promise<void> {
  await authClient.signIn.oauth2({ providerId: "voss", callbackURL });
}
