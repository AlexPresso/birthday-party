import { z } from "zod";

export const id = z.number().int().positive();
export const instant = z.iso.datetime({ offset: true });
