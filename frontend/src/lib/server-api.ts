import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { readResponse } from "./api";

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
  if (response.status === 423) redirect("/attente");
  return readResponse(response, schema);
}
