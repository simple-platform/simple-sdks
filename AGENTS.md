## Architecture history

- Before planning or implementing a change with architectural impact, search `architecture_history/*.md` for the document that matches the current project. Match by project name, scope, affected subsystem, and terms used in the request; do not assume the newest file is the right one.
- Read the matching architecture-history document before changing the design or implementation. Treat its current plan, constraints, non-goals, and decision history as project context, while following newer explicit user decisions when they conflict.
- When a new architectural decision is made, update the matching document in the same change. Keep the overall target architecture and phased plan current, and append a dated decision-history entry that records the decision, why it was made, and what it supersedes. Preserve superseded decisions in the history instead of silently deleting them.
- If no matching project document exists, ask the user whether an architecture-history document should be created. After approval, create `architecture_history/<project-name>.md` using a short kebab-case project name.
- A new architecture-history document must include: status and last-updated date, context/problem, goals, non-goals, engineering principles, current-state findings, target architecture, ownership and security boundaries, public primitives or contracts, proposed folders/packages, phased delivery plan with independently testable stopping points, validation/rollout strategy, risks/open questions, and a dated decision history.
- Keep architecture-history documents useful to both engineers and LLMs: record concrete file locations and contracts, explain the reasons behind boundaries, distinguish approved decisions from proposals, and avoid turning the document into a task-by-task progress log.

## Public SDK design

- Design public SDK functions as standalone capabilities. Do not make unrelated functions depend on a page, route, framework, or prior domain call.
- When a capability genuinely requires a particular environment, expose the normal API and return a structured domain error only when that capability is invoked outside the supported environment. Do not fail unrelated SDK initialization, guess context from URLs or the DOM, or add duplicate convenience APIs to hide the requirement.
- Keep connection/bootstrap functions such as `connectSpace()` explicit. The context they return is descriptive; callers use it to decide which standalone capabilities are appropriate.
