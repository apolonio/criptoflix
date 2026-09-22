import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appState } from "@/db/schema";
import { apiError, requireAdminProfile, requireAppProfile } from "@/lib/app-auth";

const STATE_KEY = "gestao-casa";

export async function GET() {
  try {
    const { profile } = await requireAppProfile();
    const [row] = await getDb().select().from(appState).where(eq(appState.key, STATE_KEY)).limit(1);
    return Response.json({
      data: row ? JSON.parse(row.data) : null,
      profile,
      updatedAt: row?.updatedAt || null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { profile } = await requireAdminProfile();
    const data = await request.json();
    const serialized = JSON.stringify(data);
    if (serialized.length > 1_800_000) {
      return Response.json({ error: "Os dados excederam o limite de sincronização." }, { status: 413 });
    }

    const now = new Date().toISOString();
    await getDb()
      .insert(appState)
      .values({ key: STATE_KEY, data: serialized, updatedBy: profile.id, updatedAt: now })
      .onConflictDoUpdate({
        target: appState.key,
        set: { data: serialized, updatedBy: profile.id, updatedAt: now },
      });

    return Response.json({ saved: true, updatedAt: now });
  } catch (error) {
    return apiError(error);
  }
}
