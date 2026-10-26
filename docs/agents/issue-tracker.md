# Issue tracker

Use GitHub Issues for issues, specifications, and tickets. Use the GitHub CLI (`gh`) to publish and manage them.

## Implementation plans

- Store the authoritative implementation plan in a dedicated GitHub issue under its specification/feature issue. Include architecture decisions, an ordered task index, checkpoints, risks, open decisions, and the approval status.
- Add a `Plan: #…` reference to the specification/feature issue and every task covered by that plan. Keep tasks under the specification/feature; the plan issue is a sibling, not their parent.
- Keep plans and task lists in GitHub only; do not create local `tasks/plan.md` or `tasks/todo.md` files, including pointer copies. Discover the plan through the specification/feature issue and task references. Update the GitHub plan when decisions change. This repository convention supersedes the planning skill's default local output files.
- Keep native execution dependencies between actual prerequisite tasks. A plan reference is not a blocking edge; do not make every task depend on the plan issue just for navigation. Approval remains an explicit gate before implementation.
- Close the plan issue only when the human approves planning and unresolved decisions are resolved or explicitly deferred. Closing it does not approve or complete implementation, close the specification/feature, or remove its other blockers. Agreement to relocate a plan is not approval of its contents.

## Relationships and dependency graph

When creating or updating an issue, maintain its native GitHub relationships, not just references in its description:

- Attach scoped specifications and implementation tasks to their roadmap/feature issue using **sub-issues**. Parent/child relationships describe scope, not execution order.
- Add **blocked by / blocking** dependencies for genuine prerequisites. If B depends on A, set B as blocked by A. Keep the graph acyclic; do not treat the suggested working sequence as a dependency unless it is actually required.
- For an aggregate roadmap/feature, link required child deliverables as blockers of the aggregate. Do not make a child depend on its parent merely because it belongs to that parent.
- Review existing relationships before adding links. Use `gh api` for native relationships not supported by `gh issue` commands, and verify the resulting links after changes.
- State closure effects explicitly: closing a prerequisite resolves that dependency; it does not automatically complete or close downstream issues. Close an aggregate only when its full completion criteria are met. Closing a prototype does not imply the persisted/backend milestone is complete.
- As follow-up issues are created or scope changes, update affected dependencies and parent/child links. Add a short dependency summary when helpful, but do not substitute a Markdown checklist or diagram for native links.
- If native relationships are unavailable due to permissions or repository support, report the limitation and record explicit issue links as a fallback; do not claim the native graph was updated.
