import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = pathname === "/" || pathname.startsWith("/articles");
  if (!isProtected) return NextResponse.next();

  const session = req.cookies.get("ke_session");
  if (!session?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/articles/:path*"],
};
