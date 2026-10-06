import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { auth } from "~/lib/auth.server";
import { isSignInRequest, isVAuthSignInOpen } from "~/lib/sign-in.server";

function handle(request: Request) {
  if (!isVAuthSignInOpen() && isSignInRequest(request)) {
    return Response.json(
      { error: "sign_in_paused", message: "V Auth sign-in is paused." },
      { status: 503 },
    );
  }
  return auth.handler(request);
}

export function loader({ request }: LoaderFunctionArgs) {
  return handle(request);
}

export function action({ request }: ActionFunctionArgs) {
  return handle(request);
}
