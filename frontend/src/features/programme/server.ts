import "server-only";
import { cache } from "react";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/server-api";
import { eventSchema } from "./contracts";

/**
 * One event with its whole vote, as its viewer may read it: the host sees
 * drafts, a guest does not and gets null. An activity page and its metadata
 * share one read.
 */
export const getEvent = cache(async (id: number) => {
  try {
    return await serverApi(`/programme/${id}`, eventSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});
