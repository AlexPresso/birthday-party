import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import { readResponse } from "./api";
import { sessionSchema, partySchema } from "./contracts";

export async function serverApi<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const jar = await cookies();
  const response = await fetch(
    `${process.env.API_INTERNAL_URL || "http://127.0.0.1:8080"}/api${path}`,
    {
      headers: { Cookie: jar.toString() },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (response.status === 401) redirect("/invitation");
  return readResponse(response, schema);
}

export const getSession = cache(() => serverApi("/session", sessionSchema));
export const getParty = cache(() => serverApi("/party", partySchema));
