import { notFound, redirect } from "next/navigation";
import { getSession } from "@/features/guests/server";
import {
  questionRoundSchema,
  werewolfSchema,
} from "@/features/programme/contracts";
import { QuestionActivity } from "@/features/programme/question-activity";
import { getProgramme } from "@/features/programme/server";
import { VoteActivity } from "@/features/programme/vote-activity";
import { WerewolfActivity } from "@/features/programme/werewolf-activity";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/server-api";
import type { z } from "zod";
import { getI18n } from "@/lib/server-i18n";

type Props = { params: Promise<{ id: string }> };

const isEventId = (id: string) =>
  /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

/** The viewer and the event of this page, if the viewer's programme has it. */
async function readActivity(id: string) {
  const { guest } = await getSession();
  const isAdmin = guest.role === "admin";
  const events = await getProgramme(isAdmin);
  const event = events.items.find((item) => item.id === Number(id));
  return { guest, isAdmin, event };
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const [{ t }, activity] = await Promise.all([
    getI18n(),
    isEventId(id) ? readActivity(id) : null,
  ]);
  const type = activity?.event?.type;
  if (type === "vote") return { title: t("activities.voteType") };
  if (type === "questions") return { title: t("questions.name") };
  if (type === "werewolf") return { title: t("werewolf.name") };
  return { title: t("page.programme") };
}

/**
 * Reads what the activity keeps beside its event. Go refuses it to a guest
 * who may not read the activity; the page then does not exist.
 */
async function readDetails<T>(path: string, schema: z.ZodType<T>) {
  try {
    return await serverApi(path, schema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export default async function ActivityPage({ params }: Props) {
  const { id } = await params;
  if (!isEventId(id)) notFound();
  // The event decides whether this page exists and which activity it shows.
  const { guest, isAdmin, event } = await readActivity(id);
  if (!event || event.type === "event") notFound();
  if (event.locked) redirect("/programme");

  if (event.type === "vote") {
    // The response schema gives every unlocked vote event its details.
    if (!event.vote) notFound();
    return (
      <VoteActivity
        key={event.id}
        initial={{ ...event, vote: event.vote }}
        guestId={guest.id}
        isAdmin={isAdmin}
      />
    );
  }

  // Only these activities have details to read, so the request waits for
  // the event's type.
  const heading = {
    id: event.id,
    title: event.title,
    description: event.description,
  };
  if (event.type === "werewolf") {
    return (
      <WerewolfActivity
        key={event.id}
        event={heading}
        initial={await readDetails(`/programme/${id}/werewolf`, werewolfSchema)}
        guestId={guest.id}
        isAdmin={isAdmin}
      />
    );
  }
  return (
    <QuestionActivity
      key={event.id}
      event={heading}
      initial={await readDetails(
        `/programme/${id}/questions`,
        questionRoundSchema,
      )}
      isAdmin={isAdmin}
    />
  );
}
