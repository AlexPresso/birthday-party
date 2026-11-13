import "server-only";
import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { informationSchema } from "./contracts";

// The party layout and the information page share one read per request.
export const getInformation = cache(() =>
  serverApi("/information", informationSchema),
);
