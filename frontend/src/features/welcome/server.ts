import "server-only";
import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { partyStartSchema } from "@/features/party/contracts";
import { welcomeSchema } from "./contracts";

export const getWelcome = cache(() => serverApi("/welcome", welcomeSchema));

export const getPartyStart = cache(() =>
  serverApi("/welcome/party", partyStartSchema),
);
