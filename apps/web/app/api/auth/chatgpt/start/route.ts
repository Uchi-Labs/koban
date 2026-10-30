import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { chatgptAuth, chatgptSubject, isChatGptOAuthEnabled } from "@/lib/ai/chatgpt-oauth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

/**
 * Starts ChatGPT sign-in with the device flow.
 *
 * The redirect flow this used to run could not work from a browser and always
 * failed with `authorize_hydra_invalid_request`. It sent this app's own origin
 * as `redirect_uri`, but the protocol's client id belongs to the Codex CLI and
 * OpenAI accepts only two callbacks for it: `http://localhost:1455/auth/callback`
 * and the device exchange URL (PROTOCOL.md sections 1 and 5). An unregistered
 * redirect is rejected before the user ever sees a consent screen. Registering
 * this domain is not something the app can do, so the device flow is the only
 * route that works.
 *
 * The trade is a visible one: the user reads a short code and approves it at
 * OpenAI rather than being bounced back automatically.
 */

interface InFlightDeviceLogin {
  expiresAt: number;
  userCode: string;
  verificationUrl: string;
}

/**
 * The device exchange has to outlive the request that started it: `wait()`
 * polls OpenAI for up to fifteen minutes, far longer than any HTTP request
 * should be held open, and the browser watches /status instead. Module state is
 * enough because this is one credential for one subject on a long-lived Node
 * server, and a restart only costs the user a re-click.
 */
let inFlight: InFlightDeviceLogin | null = null;

export async function POST(_request: NextRequest) {
  const env = readWorkspaceEnv();

  if (!isChatGptOAuthEnabled(env)) {
    return NextResponse.json(
      { error: "ChatGPT OAuth is disabled. Set AI_FINANCES_ENABLE_CHATGPT_OAUTH=1 to enable it." },
      { status: 404 }
    );
  }

  // A second click while the first code is still valid should show that same
  // code, not strand it and issue another the user has not seen.
  if (inFlight && Date.now() < inFlight.expiresAt) {
    return NextResponse.json({
      object: "chatgpt_oauth_start",
      expires_at: new Date(inFlight.expiresAt).toISOString(),
      user_code: inFlight.userCode,
      verification_url: inFlight.verificationUrl
    });
  }

  let device: Awaited<ReturnType<typeof chatgptAuth.startDeviceLogin>>;

  try {
    device = await chatgptAuth.startDeviceLogin(chatgptSubject);
  } catch (error) {
    inFlight = null;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start ChatGPT sign-in." },
      { status: 502 }
    );
  }

  inFlight = {
    expiresAt: device.expiresAt,
    userCode: device.userCode,
    verificationUrl: device.verificationUrl
  };

  // Fire and forget: wait() persists the credential itself on success, so the
  // /status route just reads the store. Attached here only to clear the slot
  // and to keep a rejection from surfacing as an unhandled promise.
  void device
    .wait()
    .catch((error: unknown) => {
      console.warn(
        `ChatGPT device sign-in did not complete: ${error instanceof Error ? error.message : String(error)}`
      );
    })
    .finally(() => {
      inFlight = null;
    });

  return NextResponse.json({
    object: "chatgpt_oauth_start",
    expires_at: new Date(device.expiresAt).toISOString(),
    user_code: device.userCode,
    verification_url: device.verificationUrl
  });
}
