import "server-only";
import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { eventsSchema } from "./contracts";

/**
 * The programme as its viewer may read it: the host's list includes drafts,
 * a guest's leaves them out. An activity page and its metadata share one read.
 */
export const getProgramme = cache((asHost: boolean) =>
  serverApi(asHost ? "/admin/programme" : "/programme", eventsSchema),
);
