import { z } from "zod";
import "../../lib/zod-config.ts";

// Go enforces the number of tabs and their lengths; responses only need the
// shape and the rules the interface depends on.
const tabText = z.string().refine((value) => value.trim().length > 0);

const informationTabSchema = z.object({ title: tabText, body: tabText });

export type InformationTab = z.infer<typeof informationTabSchema>;

/** What every participant receives: tabs only while the page is shown. */
export const informationSchema = z
  .object({ enabled: z.boolean(), tabs: z.array(informationTabSchema) })
  .refine((value) => value.enabled === value.tabs.length > 0);

export type Information = z.infer<typeof informationSchema>;

/** What the host edits: the switch as saved, even without any tab. */
export const adminInformationSchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  tabs: z.array(informationTabSchema),
});

export type AdminInformation = z.infer<typeof adminInformationSchema>;
