import "server-only";
import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { partySchema } from "./contracts";

export const getParty = cache(() => serverApi("/party", partySchema));
