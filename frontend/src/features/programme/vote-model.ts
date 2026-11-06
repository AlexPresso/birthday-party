import type { PartyEvent, Vote } from "./contracts.ts";

export function replaceEvent(
  events: PartyEvent[],
  saved: PartyEvent,
): PartyEvent[] {
  return events.map((event) =>
    event.id === saved.id && event.revision <= saved.revision ? saved : event,
  );
}

export function rankedResults(vote: Vote) {
  const candidates = new Map(
    vote.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const results = (vote.results ?? [])
    .map((result) => ({
      ...result,
      candidate: candidates.get(result.candidateId)!,
    }))
    .sort((a, b) => b.votes - a.votes);
  let rank = 0;
  return results.map((result, index) => {
    if (index === 0 || result.votes !== results[index - 1].votes)
      rank = index + 1;
    return { ...result, rank };
  });
}
