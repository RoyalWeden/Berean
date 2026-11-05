# Using Claude and ChatGPT subscriptions in Berean

Checked 2026-11-05 against the providers' own documentation. Re-check before acting: both pages change.

| | Claude Pro, Max, Ultra | ChatGPT Plus, Pro | Your own API key |
|---|---|---|---|
| Allowed in Berean today | **No** | **Not for general release yet** | Yes (Anthropic built) |
| Official method | None for third parties | Sign in with ChatGPT, plan usage | API key from the provider's console |
| Needs provider approval | Contact sales; no public route | Interest form for paid or remotely hosted apps | No |
| Billing | n/a | Counts against the user's plan | Billed to the key |

## Anthropic

Prohibited. [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance): OAuth is "designed to support ordinary use of Claude Code and other native Anthropic applications", and "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users." Developers "may not collect, store, or intermediate Claude.ai credentials or session tokens". Developers should use API keys or a supported cloud provider, and Anthropic may enforce without notice.

Running the Claude Code program from Berean to borrow a user's subscription is not an option either: that would be general inference through Claude Code authentication. Berean offers no Claude subscription option.

## OpenAI

[Sign in with ChatGPT](https://developers.openai.com/siwc) has a real plan-usage path: OAuth with PKCE through the system browser, a separate consent scope, then the public Responses API. Signing in alone grants no model access; the `sharing` flag must be true. Users set weekly caps, and [apps get no access to conversations or memories](https://learn.chatgpt.com/docs/sign-in-with-chatgpt).

[Plan usage](https://developers.openai.com/siwc/token-sharing-open-source) is documented for "open-source and locally hosted apps". Paid or remotely hosted apps must complete an interest form first. The [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) adds "selected private apps".

What stops Berean today:

1. **Eligibility is unclear.** The repository is public but has no license and `package.json` says `"private": true`, so it isn't clearly open source. OpenAI doesn't define its terms further. It is also distributed through the App Store. Decision needed: choose an open-source license, or file the interest form.
2. **Mac App Store sandbox.** The documented flow requires a callback listener on `127.0.0.1`. Berean's MAS build forbids `com.apple.security.network.server` (`scripts/mac/verify-mas.mjs`). The direct-download Mac build has no such limit.
3. **iPhone.** OpenAI's documentation doesn't cover mobile. Not available until it does.

Nothing about this path was tested, and no OpenAI registration was made. The dynamic registration happens at first sign-in, so it wasn't attempted.

## Design, if eligibility is confirmed

Add a `chatgpt` provider beside `anthropic` in `src/lib/research/providers.ts`, direct-download Mac only at first.

- Sign-in runs in the main process with the system browser. No embedded web view.
- A stable opaque `urn:uuid:` host id. Tokens encrypted with the existing Keychain-backed store, never sent to the renderer.
- Plan use enabled only if the `sharing` flag is true. Sign-in alone changes nothing in Ask Berean.
- Responses API with `store: false` and `stream: true`; model list from the connection, never hard-coded.
- The same rules as the API key provider: off by default, private context needs separate consent, never a fallback from a local failure. A limit shows a Manage usage link and stops; it doesn't move to another provider.
