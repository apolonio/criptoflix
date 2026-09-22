import { count, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";

export class AppAccessError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function defaultLogin(email: string) {
  return email
    .split("@")[0]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/gi, "")
    .toLowerCase() || "usuario";
}

export async function requireAppProfile() {
  const identity = await getChatGPTUser();
  if (!identity) throw new AppAccessError("Faça login para acessar o sistema.", 401);

  const db = getDb();
  const email = identity.email.trim().toLowerCase();
  const [linked] = await db.select().from(profiles).where(eq(profiles.authUserId, identity.userId)).limit(1);

  if (linked) {
    if (linked.status !== "active") throw new AppAccessError("Este acesso está inativo.", 403);
    return { identity, profile: linked };
  }

  const [invited] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
  if (invited) {
    if (invited.status !== "active") throw new AppAccessError("Este acesso está inativo.", 403);
    const [claimed] = await db
      .update(profiles)
      .set({
        authUserId: identity.userId,
        fullName: invited.fullName || identity.fullName || identity.displayName,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(profiles.id, invited.id))
      .returning();
    return { identity, profile: claimed };
  }

  const [{ value: profileCount }] = await db.select({ value: count() }).from(profiles);
  if (profileCount === 0) {
    const [owner] = await db
      .insert(profiles)
      .values({
        id: crypto.randomUUID(),
        authUserId: identity.userId,
        login: defaultLogin(email),
        fullName: identity.fullName || identity.displayName,
        email,
        role: "admin",
        status: "active",
      })
      .returning();
    return { identity, profile: owner };
  }

  throw new AppAccessError("Seu e-mail ainda não foi cadastrado em Pessoas e acessos.", 403);
}

export async function requireAdminProfile() {
  const access = await requireAppProfile();
  if (access.profile.role !== "admin") {
    throw new AppAccessError("Somente administradores podem alterar acessos.", 403);
  }
  return access;
}

export function apiError(error: unknown) {
  if (error instanceof AppAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Erro inesperado.";
  return Response.json({ error: message }, { status: 500 });
}
