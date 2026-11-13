import { notFound, redirect } from "next/navigation";
import { getSession } from "@/features/guests/server";
import {
  eventsSchema,
  questionRoundSchema,
} from "@/features/programme/contracts";
import { QuestionActivity } from "@/features/programme/question-activity";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/server-api";
import { getI18n } from "@/lib/server-i18n";

export async function generateMetadata() {
  return { title: (await getI18n()).t("questions.name") };
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  // The round needs only the id, so it loads while the session and the event
  // list resolve. Its outcome is examined last: the event decides first
  // whether this page exists, and Go still refuses a round the guest may not read.
  const roundRequest = serverApi(
    `/programme/${id}/questions`,
    questionRoundSchema,
  ).then(
    (round) => ({ round }),
    (error: unknown) => ({ error }),
  );
  const session = await getSession();
  const isAdmin = session.guest.role === "admin";
  const events = await serverApi(
    isAdmin ? "/admin/programme" : "/programme",
    eventsSchema,
  );
  const event = events.items.find((item) => item.id === Number(id));
  if (!event || event.type !== "questions") notFound();
  if (event.locked) redirect("/programme");

  const roundResult = await roundRequest;
  if ("error" in roundResult) {
    const { error } = roundResult;
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { round } = roundResult;
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
