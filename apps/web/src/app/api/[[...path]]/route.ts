import { proxyApiRequest } from "../../../lib/api-proxy.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handle(request: Request): Promise<Response> {
  if (
    process.env.VERCEL_ENV === "preview" &&
    process.env.BIDVEDA_VISUAL_PREVIEW === "true"
  )
    return Promise.resolve(
      Response.json(
        {
          error: {
            code: "VISUAL_PREVIEW_ONLY",
            message: "This preview does not connect to an API.",
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    );
  return proxyApiRequest(request, process.env);
}

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as OPTIONS,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
