import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        {/* A pseudonymous student room has nothing to gain from being indexed. */}
        <meta name="robots" content="noindex" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem("theme") === "light") {
                  document.documentElement.classList.add("light");
                }
              } catch (_) {}
            `,
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something broke";
  let detail = "An unexpected error occurred. Try again in a moment.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? "Not found" : `Error ${error.status}`;
    detail =
      error.status === 404
        ? "That page does not exist."
        : error.statusText || detail;
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center px-5">
      <div className="wordmark mb-8">
        <i />V ROOMS
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="text-ink-2 mt-2 text-sm leading-relaxed">{detail}</p>
      <a
        className="text-ink mt-6 inline-block text-sm underline underline-offset-4"
        href="/"
      >
        Back to the start
      </a>
      {stack && (
        <pre className="border-line-2 text-ink-3 mt-8 max-h-72 overflow-auto rounded-md border p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
