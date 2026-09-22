import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { apiError, requireAdminProfile, requireAppProfile } from "@/lib/app-auth";

export async function GET() {
  try {
    const { profile } = await requireAppProfile();
    const users = await getDb().select().from(profiles).orderBy(asc(profiles.fullName));
    return Response.json({ profile, users });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminProfile();
    const payload = (await request.json()) as Record<string, unknown>;
    const login = String(payload.login || "").trim().toLowerCase();
    const fullName = String(payload.fullName || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const phone = String(payload.phone || "").trim();
    const role = payload.role === "admin" ? "admin" : "viewer";

    if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
      return Response.json(
        { error: "Informe um login com 3 a 40 letras, números, ponto, hífen ou sublinhado." },
        { status: 400 },
      );
    }
    if (!fullName || !email.includes("@")) {
      return Response.json({ error: "Nome completo e e-mail válido são obrigatórios." }, { status: 400 });
    }

    const [user] = await getDb()
      .insert(profiles)
      .values({
        id: crypto.randomUUID(),
        login,
        fullName,
        email,
        phone,
        role,
        status: "active",
      })
      .returning();

    return Response.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "Este login ou e-mail já está cadastrado." }, { status: 409 });
    }
    return apiError(error);
  }
}
