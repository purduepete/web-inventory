// Static Web Apps authentication helpers.
//
// The app sits behind the SWA `member` role gate (see staticwebapp.config.json).
// When the session expires the platform answers API calls with a 302 to the AAD
// login, which a `fetch` can't follow (cross-origin) — so the UI would otherwise
// render empty. We instead check auth state explicitly via `/.auth/me` and send
// the user straight to sign in, preserving the route they were on.

export interface ClientPrincipal {
    userId: string;
    userDetails: string;
    identityProvider: string;
    userRoles: string[];
}

// Set once a login redirect has started, so we never fire it twice.
let redirectingToLogin = false;

export function isRedirectingToLogin(): boolean {
    return redirectingToLogin;
}

function loginUrl(): string {
    const target = window.location.pathname + window.location.search;
    return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(target)}`;
}

/** Send the user to the AAD sign-in page, returning to the current route after. */
export function redirectToLogin(): void {
    if (redirectingToLogin) return;
    redirectingToLogin = true;
    window.location.href = loginUrl();
}

/**
 * Resolve the current auth state:
 *   - `ClientPrincipal` → signed in
 *   - `null`            → definitively signed out (got a clean answer, no principal)
 *   - `undefined`       → unknown (offline / `/.auth/me` unreachable) — do NOT
 *                          force a login redirect in this case so offline use works.
 */
export async function getClientPrincipal(): Promise<ClientPrincipal | null | undefined> {
    try {
        const res = await fetch('/.auth/me', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        if (!res.ok) return undefined;
        const data = (await res.json()) as { clientPrincipal?: ClientPrincipal | null };
        return data?.clientPrincipal ?? null;
    } catch {
        return undefined; // network/offline — status unknown
    }
}
