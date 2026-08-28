# Callback page

The OAuth callback page is **not** maintained here. Its canonical source is
its own repository:

<https://github.com/MarcoSburlino/koinkat-callback>

and it is deployed at <https://marcosburlino.github.io/koinkat-callback/>,
which is the default value of `DEFAULT_CALLBACK_URL` in
`src/lib/constants.ts`.

A copy of the page used to live in this directory. It drifted out of sync
with the deployed version - it was missing the `state` parameter and the
`koinkat://auth-callback` deep-link handoff - so anyone auditing the callback
behaviour from this repository was reading the wrong file. It has been
removed rather than re-synced, because a second copy will drift again.

To review what the page actually does, read the source in the repository
above. It is a single static HTML file: it takes the authorization code from
the query string, hands it to the app via the deep link, and offers a manual
copy as a fallback. It makes no network requests, loads no external
resources, and stores nothing.

Self-hosting it is a supported option and is documented in the README under
"Step 3: set the redirect URL".
