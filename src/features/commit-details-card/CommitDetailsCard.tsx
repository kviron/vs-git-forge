import type { Commit } from "@/shared/lib/types";
import { UNCOMMITTED_HASH } from "@/shared/lib/types";

interface CommitDetailsCardProps {
  commit: Commit;
}

export function CommitDetailsCard(props: CommitDetailsCardProps) {
  const c = () => props.commit;
  const isUncommitted = () => c().hash === UNCOMMITTED_HASH;
  return (
    <div class="commit-details-card">
      <div class="commit-details-card__message">{c().message}</div>
      {!isUncommitted() && (
        <>
          <div class="commit-details-card__meta">
            {c().shortHash} {c().author}
            {c().authorEmail && ` <${c().authorEmail}>`} on {c().date}
          </div>
          {c().branches && c().branches!.length > 0 && (
            <div class="commit-details-card__branches">
              {c().branches!.join(', ')}
            </div>
          )}
          <div class="commit-details-card__in-branches">
            In 5 branches: HEAD, MP-8857_edit_create_project_2, master, origi...
            <button type="button" class="commit-details-card__show-all">
              Show all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
