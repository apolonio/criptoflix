import { apiError, requireAppProfile } from "@/lib/app-auth";

export async function GET() {
  try {
    const { profile } = await requireAppProfile();
    return Response.json({ profile });
  } catch (error) {
    return apiError(error);
  }
}
