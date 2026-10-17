import "server-only";
import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { welcomeSchema } from "./contracts";

export const getWelcome = cache(() => serverApi("/welcome", welcomeSchema));
