import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login");

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user) {
    // A disabled (or missing) profile must be signed OUT here, not just
    // bounced to /login: pages redirect inactive users to /login, and the
    // block below redirects authenticated users away from /login - without
    // clearing the session those two rules ping-pong forever and the user
    // sees an endless loading screen. Middleware is the one place that can
    // reliably clear the auth cookies.
    const { data: profile } = await supabase
      .from("profiles").select("active").eq("id", user.id).single();
    if (!profile || !profile.active) {
      await supabase.auth.signOut();
      const redirectRes = NextResponse.redirect(new URL("/login?disabled=1", request.url));
      // carry the cookie deletions from signOut onto the redirect response
      response.cookies.getAll().forEach((c) => redirectRes.cookies.set(c));
      return redirectRes;
    }
    if (isPublic) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
