// =====================================================================
// Route protection (runs before every page / API request).
//  * not logged in  -> pages redirect to /login, APIs return 401
//  * wrong role     -> pages redirect to the user's home page
// API routes additionally check roles themselves (defence in depth).
// =====================================================================
import { NextResponse } from "next/server";
import { jwtVerify } from "jose/jwt/verify"; // only the verifier: keeps the Edge bundle small

const PAGE_ACCESS = [
  ["/work-orders", ["TECHNICIAN"]],
  ["/queue", ["FACILITY_MANAGER", "ADMIN"]],
  ["/incidents", ["FACILITY_MANAGER", "ADMIN", "TECHNICIAN", "STUDENT_STAFF"]],
  ["/analytics", ["FACILITY_MANAGER", "ADMIN"]],
  ["/assets", ["FACILITY_MANAGER", "ADMIN"]],
  ["/inventory", ["TECHNICIAN", "FACILITY_MANAGER", "ADMIN"]],
  ["/showcase", ["FACILITY_MANAGER", "ADMIN"]],
  ["/vectors", ["FACILITY_MANAGER", "ADMIN"]],
  ["/reports", ["FACILITY_MANAGER", "ADMIN"]],
  ["/admin", ["ADMIN"]],
];

const HOME = {
  STUDENT_STAFF: "/my",
  TECHNICIAN: "/work-orders",
  FACILITY_MANAGER: "/queue",
  ADMIN: "/analytics",
};

async function readSession(req) {
  const token = req.cookies.get("rx_session")?.value;
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const session = await readSession(req);

  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/auth/login")) return NextResponse.next();
    if (!session) return NextResponse.json({ error: "Please log in" }, { status: 401 });
    return NextResponse.next();
  }

  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL(HOME[session.role] || "/", req.url)) : NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/") return NextResponse.redirect(new URL(HOME[session.role], req.url));

  const rule = PAGE_ACCESS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"));
  if (rule && !rule[1].includes(session.role)) {
    return NextResponse.redirect(new URL(HOME[session.role], req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
