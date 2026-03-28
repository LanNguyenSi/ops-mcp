# Task 001 — Architecture Baseline + Project Charter

**Wave:** 1 — Foundation  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 1–2h

---

## Goal

Establish the project's documentation foundation: project charter, architecture overview, and decisions log. These files serve as the authoritative reference for all subsequent implementation tasks.

## Deliverables

- [x] `docs/PROJECT-CHARTER.md` — goals, scope, stakeholders, success criteria, risks
- [x] `docs/ARCHITECTURE.md` — system diagram, DB schema, API surface, package structure, data flows
- [x] `docs/DECISIONS.md` — ADR log (8 initial decisions)
- [x] `tasks/` folder with task files 001–008

## Definition of Done

- All three docs files exist and contain complete content (no placeholders)
- All 8 task files exist with full specifications
- Lan has reviewed and approved the architecture

## Notes

This task is the planning task. The actual document content is already produced as part of this task file set. Commit everything in this folder to the ops-mcp repository root.

## Suggested Repo Structure

```
ops-mcp/
├── docs/
│   ├── PROJECT-CHARTER.md
│   ├── ARCHITECTURE.md
│   └── DECISIONS.md
├── tasks/
│   ├── 001-architecture-baseline.md
│   ├── 002-state-store-api.md
│   ├── 003-activity-feed-api.md
│   ├── 004-mcp-package-scaffold.md
│   ├── 005-mcp-tools-agents.md
│   ├── 006-mcp-tools-state.md
│   ├── 007-dashboard-activity-tab.md
│   └── 008-integration-tests.md
├── packages/
│   └── mcp/              ← @opentriologue/mcp (Wave 2)
└── README.md
```

## Next Steps

After this task is committed:
- Start Task 002 (State Store schema + API)
- Start Task 003 (Activity Feed schema + API)
- Tasks 002 and 003 can run in parallel (both are gateway changes, no dependency)
