import { env } from "cloudflare:workers";
import { apiError, requireAdminProfile, requireAppProfile } from "@/lib/app-auth";

const MAX_PDF_SIZE = 10 * 1024 * 1024;

function key(id: string) {
  return `documents/${encodeURIComponent(id)}.pdf`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAppProfile();
    if (!env.BUCKET) throw new Error("O armazenamento de arquivos não está disponível.");
    const { id } = await context.params;
    const object = await env.BUCKET.get(key(id));
    if (!object) return Response.json({ error: "Arquivo não encontrado." }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/pdf",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminProfile();
    if (!env.BUCKET) throw new Error("O armazenamento de arquivos não está disponível.");
    const contentType = request.headers.get("content-type") || "";
    const length = Number(request.headers.get("content-length") || 0);
    if (!contentType.includes("application/pdf")) {
      return Response.json({ error: "Envie um arquivo PDF." }, { status: 415 });
    }
    if (length > MAX_PDF_SIZE) {
      return Response.json({ error: "O PDF deve ter no máximo 10 MB." }, { status: 413 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_PDF_SIZE) {
      return Response.json({ error: "O PDF deve ter no máximo 10 MB." }, { status: 413 });
    }
    const { id } = await context.params;
    await env.BUCKET.put(key(id), body, { httpMetadata: { contentType: "application/pdf" } });
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
