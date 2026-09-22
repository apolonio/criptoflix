import { env } from "cloudflare:workers";
import { apiError, requireAdminProfile, requireAppProfile } from "@/lib/app-auth";

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

function key(id: string) {
  return `property-images/${encodeURIComponent(id)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAppProfile();
    if (!env.BUCKET) throw new Error("O armazenamento de imagens não está disponível.");
    const { id } = await context.params;
    const object = await env.BUCKET.get(key(id));
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "image/jpeg",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminProfile();
    if (!env.BUCKET) throw new Error("O armazenamento de imagens não está disponível.");
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "Envie uma imagem válida." }, { status: 415 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_SIZE) {
      return Response.json({ error: "A imagem deve ter no máximo 8 MB." }, { status: 413 });
    }
    const { id } = await context.params;
    await env.BUCKET.put(key(id), body, { httpMetadata: { contentType } });
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
