import { notFound, redirect } from "next/navigation";
import { getSession } from "@/features/guests/server";
import { questionRoundSchema } from "@/features/programme/contracts";
import { QuestionActivity } from "@/features/programme/question-activity";
import { getProgramme } from "@/features/programme/server";
import { VoteActivity } from "@/features/programme/vote-activity";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/server-api";
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
  return { title: t("page.programme") };
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

  // Only a question activity has a round to read, so the request waits for
  // the event's type. Go still refuses a round the guest may not read.
  let round;
  try {
    round = await serverApi(`/programme/${id}/questions`, questionRoundSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <QuestionActivity
      key={event.id}
      event={{
        id: event.id,
        title: event.title,
        description: event.description,
      }}
      initial={round}
      isAdmin={isAdmin}
    />
  );
}
