import { NextResponse, type NextRequest } from "next/server";

/** Only the synthetic pages and the gated API are reachable in visual preview. */
export function proxy(request: NextRequest): NextResponse {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.BIDVEDA_VISUAL_PREVIEW !== "true"
  )
    return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (
    path === "/visual-preview/dashboard" ||
    path === "/visual-preview/evidence" ||
    path === "/api" ||
    path.startsWith("/api/")
  )
    return NextResponse.next();
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: "/((?!_next/|favicon.ico|icon.svg).*)",
};
