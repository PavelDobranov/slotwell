# GitHub planning and issue relationships

Use GitHub Issues through `gh` for specifications, plans, tasks, approval, and delivery evidence. No local `tasks/plan.md`, `tasks/todo.md`, or pointer copies; this overrides skill defaults.

## Ownership and approval

- A dedicated plan issue owns decisions, ordered task index, checkpoints, risks, open questions, and approval status. Specification and tasks reference it with `Plan: #…`.
- Plan and implementation tasks are sibling native sub-issues of their specification/feature. Attach the feature to its roadmap where applicable.
- Publication/relocation is not approval. Close a plan only after explicit human approval and resolution or explicit deferral of open decisions. This does not approve/complete implementation or close the feature.
- Discover current work through the specification/plan; do not copy progress into repository context documents. At restart checkpoints record changed paths, working-tree state, exact verification/results, next task, risks, and required approvals.

## Native graph

- Sub-issues express scope; `blocked by`/`blocking` express actual prerequisites. Keep dependencies acyclic. Do not make tasks depend on the plan for navigation, or children depend on their parent merely for scope.
- Required deliverables block the aggregate. Closing one prerequisite resolves only its edge, not downstream work; close the aggregate only when its full acceptance criteria pass. Prototype completion is not backend/persistence completion.
- Inspect existing relationships, use `gh api` where CLI commands lack native support, and verify the resulting graph after scope changes/splits. Markdown references/checklists do not replace native links.
- If permissions/repository support prevent native links, report the limitation and use explicit issue references as a fallback; never claim the graph was updated.
