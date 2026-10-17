import "server-only";
import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { sessionSchema } from "./contracts";

export const getSession = cache(() => serverApi("/session", sessionSchema));
