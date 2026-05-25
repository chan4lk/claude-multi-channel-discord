import { createAuthClient } from "better-auth/react";

// No baseURL — auth client uses current origin so cookies always land on the
// right domain regardless of where the app is deployed or tested.
export const authClient = createAuthClient({});
