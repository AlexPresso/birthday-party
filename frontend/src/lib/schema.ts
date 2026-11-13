import { z } from "zod";
import "./zod-config.ts";

export const id = z.number().int().positive();
export const instant = z.iso.datetime({ offset: true });
