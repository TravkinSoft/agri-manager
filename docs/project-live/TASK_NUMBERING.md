# Task Numbering Registry

Реестр обновляет только координатор основной ветки. Номер ТЗ никогда не используется повторно, даже если задача отменена или заменена.

Допустимые направления: `CORE`, `DATABASE`, `GLBD`, `ASSISTANT`, `UI`, `OPERATIONS`, `WAREHOUSE`.

## Независимые последовательности

- Основная ветка TravkinFlow использует `TZ-141`, `TZ-142`, `TZ-143` и далее; в тексте это «ТЗ №141», «ТЗ №142», «ТЗ №143».
- Ветка Travkin Assistant использует отдельную последовательность `TZ-A100`, `TZ-A101`, `TZ-A102` и далее; `A` — латинская буква.
- CORE- и ASSISTANT-номера не пересекаются и никогда не используются повторно.
- Core-отчёт называется `task-reports/core/TZ-141.md`; assistant-отчёт называется `task-reports/assistant/TZ-A100.md`.
- Основная ветка может резервировать номера `Axxx` в этом реестре.
- `assistant-v1` не присваивает себе новый номер самостоятельно: номер должен сначала появиться в этом реестре основной ветки.

| task_number | direction | title | branch | status | depends_on | report_path | commit_hash |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TZ-135 | DATABASE | Legacy migration audit | copilot-v1 | DONE | TZ-134 | `external: audit-output/TZ-135/` | N/A (audit outputs not committed) |
| TZ-136 | UI | Fallow crop structure fix | copilot-v1 | DONE | — | Not created before Project Live foundation | `e36ab0a` |
| TZ-137 | DATABASE | Superseded migrations review | copilot-v1 | DONE | TZ-135 | `external: audit-output/TZ-137/` | N/A (audit outputs not committed) |
| TZ-138 | DATABASE | Canonical varieties selective commit | copilot-v1 | DONE | TZ-137 | Not created before Project Live foundation | `4eb2d58` |
| TZ-139 | CORE | Project Live and assistant handoff foundation | copilot-v1 | DONE | TZ-135,TZ-137,TZ-138 | [task-reports/core/TZ-139.md](task-reports/core/TZ-139.md) | `3ef0afe` |
| TZ-140 | DATABASE | Push core commits and repair six legacy history entries | copilot-v1 | DONE | TZ-137,TZ-138,TZ-139 | [task-reports/core/TZ-140.md](task-reports/core/TZ-140.md) | `SELF` |
| TZ-141 | ASSISTANT / GOVERNANCE | Assistant isolated branch and Live sync | copilot-v1 -> assistant-v1 | DONE | TZ-139,TZ-140 | [task-reports/core/TZ-141.md](task-reports/core/TZ-141.md) | `d192587` |
| TZ-A100 | ASSISTANT | Current Architecture & Runtime Audit | assistant-v1 | DONE | TZ-141 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A100.md` | `4cb8cdf` |
| TZ-A101 | ASSISTANT | Read-only Assistant Foundation | assistant-v1 | DONE | TZ-A100 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A101.md` | `51e878e` |
| TZ-A102 | ASSISTANT | Real Local Runtime Validation | assistant-v1 | DONE | TZ-A101,TZ-145 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A102.md` | `c4ec0b0` |
| TZ-A103 | ASSISTANT | Close A102 findings and pass read-only acceptance | assistant-v1 | DONE | TZ-A102 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A103.md` | `20117c6` |
| TZ-A104 | ASSISTANT | Server Conversation Runtime V2 | assistant-v1 | DONE | TZ-A103 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A104.md` | `2152b73` |
| TZ-A105 | ASSISTANT | Conversation Summary, Unresolved Questions & Confirmed Memory Prototype | assistant-v1 | DONE_WITH_SCHEMA_GATE | TZ-A104 | `external: origin/assistant-v1:docs/project-live/task-reports/assistant/TZ-A105.md` | `b22f765` |
| TZ-A106 | ASSISTANT | Memory Schema Implementation & Real Acceptance | assistant-v1 | PLANNED | TZ-A105,TZ-169 | `external: pending` | — |
| TZ-A107 | ASSISTANT | Full Permission-Aware Knowledge Base | assistant-v1 | PLANNED | TZ-A106,TZ-177 | `external: pending` | — |
| TZ-142 | DATABASE | Audit partially equivalent legacy migrations | copilot-v1 | DONE | TZ-141 | [task-reports/core/TZ-142.md](task-reports/core/TZ-142.md) | `SELF` |
| TZ-143 | WAREHOUSE | Warehouse units and batch classes correction plan | copilot-v1 | DONE | TZ-142 | [task-reports/core/TZ-143.md](task-reports/core/TZ-143.md) | `SELF` |
| TZ-144 | WAREHOUSE | Canonical warehouse units and batch identity implementation | copilot-v1 | DONE | TZ-143 | [task-reports/core/TZ-144.md](task-reports/core/TZ-144.md) | `SELF` |
| TZ-145 | CORE / ASSISTANT GOVERNANCE | Approve read-only Assistant foundation | copilot-v1 | DONE | TZ-A100,TZ-A101 | [task-reports/core/TZ-145.md](task-reports/core/TZ-145.md) | `SELF` |

| TZ-146 | WAREHOUSE / DATABASE | Warehouse Units V2 production preflight | copilot-v1 | DONE | TZ-144,TZ-145 | [task-reports/core/TZ-146.md](task-reports/core/TZ-146.md) | `SELF` |
| TZ-147 | CORE / ASSISTANT GOVERNANCE | Provision safe QA identity for A102 | copilot-v1 | DONE | TZ-A102,TZ-145 | [task-reports/core/TZ-147.md](task-reports/core/TZ-147.md) | `SELF` |
| TZ-148 | WAREHOUSE / DATABASE | Make Warehouse Units V2 migration repeat-safe | copilot-v1 | DONE | TZ-144,TZ-146,TZ-147 | [task-reports/core/TZ-148.md](task-reports/core/TZ-148.md) | `SELF` |
| TZ-149 | GLBD | Component V2 alias and source audit | copilot-v1 | DONE | TZ-148 | [task-reports/core/TZ-149.md](task-reports/core/TZ-149.md) | `SELF` |
| TZ-150 | GLBD | Component aliases and sources import preview | copilot-v1 | DONE | TZ-149 | [task-reports/core/TZ-150.md](task-reports/core/TZ-150.md) | `SELF` |
| TZ-151 | GLBD | Import approved component aliases and sources | copilot-v1 | DONE | TZ-150 | [task-reports/core/TZ-151.md](task-reports/core/TZ-151.md) | `SELF` |
| TZ-152 | GLBD / UI | Surface component aliases in search and sources in cards | copilot-v1 | DONE | TZ-151 | [task-reports/core/TZ-152.md](task-reports/core/TZ-152.md) | `SELF` |
| TZ-153 | CORE / ASSISTANT GOVERNANCE | Approve Travkin Assistant confirmed memory schema | copilot-v1 | DONE | TZ-A105,TZ-152 | [task-reports/core/TZ-153.md](task-reports/core/TZ-153.md) | `SELF` |
| TZ-154 | DATABASE / ASSISTANT GOVERNANCE | Provision isolated Supabase branch for A106 | copilot-v1 | BLOCKED | TZ-153 | `external: evidence in audit-output/TZ-155/` | — |
| TZ-155 | DATABASE | Prepare corrupted migration-history recovery | copilot-v1 | BLOCKED | TZ-154 | [task-reports/core/TZ-155.md](task-reports/core/TZ-155.md) | `SELF` |
| TZ-156 | DATABASE | Audit canonical source for migration 20260610123000 | copilot-v1 | DONE | TZ-155 | [task-reports/core/TZ-156.md](task-reports/core/TZ-156.md) | `SELF` |
| TZ-157 | DATABASE | Canonicalize legacy vehicle migration 20260509142000 | copilot-v1 | DONE | TZ-155,TZ-156 | [task-reports/core/TZ-157.md](task-reports/core/TZ-157.md) | `SELF` |
| TZ-158 | DATABASE | Prepare exact migration-history recovery | copilot-v1 | DONE | TZ-155,TZ-156,TZ-157 | [task-reports/core/TZ-158.md](task-reports/core/TZ-158.md) | `SELF` |
| TZ-159 | DATABASE | Canonicalize legacy demo migrations and repeat full replay | copilot-v1 | DONE | TZ-158 | [task-reports/core/TZ-159.md](task-reports/core/TZ-159.md) | `SELF` |
| TZ-160 | DATABASE | Canonicalize legacy test-user cleanup and repeat full replay | copilot-v1 | DONE | TZ-159 | [task-reports/core/TZ-160.md](task-reports/core/TZ-160.md) | `SELF` |
| TZ-161 | DATABASE | Close remaining legacy bootstrap blockers and continue full replay | copilot-v1 | DONE | TZ-160 | [task-reports/core/TZ-161.md](task-reports/core/TZ-161.md) | `SELF` |
| TZ-162 | DATABASE | Restore missing migration dependencies and repeat full replay | copilot-v1 | DONE | TZ-161 | [task-reports/core/TZ-162.md](task-reports/core/TZ-162.md) | `SELF` |
| TZ-163 | DATABASE | Complete crop mapping and canonical migration chain | copilot-v1 | DONE | TZ-162 | [task-reports/core/TZ-163.md](task-reports/core/TZ-163.md) | `SELF` |
| TZ-164 | DATABASE | Restore all production baseline migration sources | copilot-v1 | DONE | TZ-163 | [task-reports/core/TZ-164.md](task-reports/core/TZ-164.md) | `SELF` |
| TZ-165 | DATABASE / ASSISTANT GOVERNANCE | Execute metadata repair and create A106 Supabase branch | copilot-v1 | BLOCKED | TZ-164 | [task-reports/core/TZ-165.md](task-reports/core/TZ-165.md) | `SELF` |
| TZ-166 | DATABASE / ASSISTANT GOVERNANCE | Complete canonical migration history and retry branch bootstrap | copilot-v1 | DONE | TZ-165 | [task-reports/core/TZ-166.md](task-reports/core/TZ-166.md) | `SELF` |
| TZ-167 | DATABASE SECURITY | Harden catalog RLS and SECURITY DEFINER grants in isolated branch | copilot-v1 | DONE | TZ-166 | [task-reports/core/TZ-167.md](task-reports/core/TZ-167.md) | `SELF` |
| TZ-168 | DATABASE SECURITY | Apply catalog RLS and function hardening in production | copilot-v1 | BLOCKED | TZ-167 | [task-reports/core/TZ-168.md](task-reports/core/TZ-168.md) | `SELF` |
| TZ-169 | CORE / ASSISTANT GOVERNANCE | Contract 0.4 and branch-only Memory Policy V2 | copilot-v1 | DONE | TZ-A105,TZ-166 | [task-reports/core/TZ-169.md](task-reports/core/TZ-169.md) | `SELF` |
| TZ-170 | DATABASE SECURITY | Remove hidden helper-schema dependency and repeat production-equivalent acceptance | copilot-v1 | DONE | TZ-168,TZ-169 | [task-reports/core/TZ-170.md](task-reports/core/TZ-170.md) | `SELF` |
| TZ-171 | DATABASE SECURITY | Apply corrected catalog security hardening in production | copilot-v1 | DONE | TZ-170 | [task-reports/core/TZ-171.md](task-reports/core/TZ-171.md) | `SELF` |
| TZ-172 | GLBD | Classify all 54 blocked component sources | copilot-v1 | DONE | TZ-151,TZ-171 | [task-reports/core/TZ-172.md](task-reports/core/TZ-172.md) | `SELF` |
| TZ-173 | GLBD | Apply safe blocked component sources | copilot-v1 | BLOCKED | TZ-172 | [task-reports/core/TZ-173.md](task-reports/core/TZ-173.md) | `SELF` |
| TZ-174 | GLBD | Rebuild UTF-8-safe component apply package | copilot-v1 | DONE | TZ-173 | [task-reports/core/TZ-174.md](task-reports/core/TZ-174.md) | `SELF` |
| TZ-175 | CORE / ASSISTANT QA | Assistant QA Company Dataset V1 | copilot-v1 | DONE | TZ-169 | `completed inside TZ-176` | `SELF` |
| TZ-176 | CORE / ASSISTANT QA | Branch-only canonical references and Assistant QA Dataset V1 | copilot-v1 | BLOCKED | TZ-175 | [task-reports/core/TZ-176.md](task-reports/core/TZ-176.md) | `SELF` |
| TZ-177 | CORE / ASSISTANT QA | Synchronize production catalog security to Assistant QA branch | copilot-v1 | DONE | TZ-176,TZ-171 | [task-reports/core/TZ-177.md](task-reports/core/TZ-177.md) | `SELF` |
| TZ-178 | GLBD | Rebuild reproducible UTF-8-safe component package | copilot-v1 | DONE | TZ-172,TZ-173,TZ-174 | [task-reports/core/TZ-178.md](task-reports/core/TZ-178.md) | `SELF` |
| TZ-179 | GLBD | Production selective apply component package | copilot-v1 | DONE | TZ-178 | [task-reports/core/TZ-179.md](task-reports/core/TZ-179.md) | `SELF` |
| TZ-180 | GLBD | Global pesticide cards completeness audit V1 | copilot-v1 | DONE | TZ-179 | [task-reports/core/TZ-180.md](task-reports/core/TZ-180.md) | `SELF` |
| TZ-181 | GLBD | Review 45 problematic pesticide cards | copilot-v1 | DONE | TZ-180 | [task-reports/core/TZ-181.md](task-reports/core/TZ-181.md) | `SELF` |
| TZ-182 | GLBD | Owner review of ten disputed pesticide cards | copilot-v1 | DONE | TZ-181 | `owner decisions recorded by TZ-184` | N/A (conversation-only owner review) |
| TZ-183 | GLBD | Selective apply pesticide Batch 1 | copilot-v1 | BLOCKED | TZ-181,TZ-182 | `failure and rollback recorded by TZ-184` | — |
| TZ-184 | GLBD | Rebuild pesticide Batch 1 formulation updates | copilot-v1 | DONE | TZ-183 | [task-reports/core/TZ-184.md](task-reports/core/TZ-184.md) | `SELF` |
| TZ-185 | GLBD | Apply corrected pesticide Batch 1 in production | copilot-v1 | DONE | TZ-181,TZ-182,TZ-184 | [task-reports/core/TZ-185.md](task-reports/core/TZ-185.md) | `SELF` |
| TZ-186 | CORE / ASSISTANT QA | Load Core preview data through user JWT and RLS | copilot-v1 | DONE | TZ-176,TZ-177 | [task-reports/core/TZ-186.md](task-reports/core/TZ-186.md) | `SELF` |
| TZ-187 | GLBD | Prepare the next safe pesticide batch | copilot-v1 | DONE | TZ-180,TZ-185 | [task-reports/core/TZ-187.md](task-reports/core/TZ-187.md) | `SELF` |
| TZ-188 | GLBD | Apply pesticide search aliases Batch 1 | copilot-v1 | DONE | TZ-187 | [task-reports/core/TZ-188.md](task-reports/core/TZ-188.md) | `SELF` |
| TZ-189 | CORE / ASSISTANT QA | Fix warehouse balance loading for A108 | copilot-v1 | DONE | TZ-186 | [task-reports/core/TZ-189.md](task-reports/core/TZ-189.md) | `SELF` |
| TZ-190 | GLBD | Apply 200 pesticide search aliases | copilot-v1 | BLOCKED | TZ-187,TZ-188 | `superseded by owner-corrected TZ-191 package after preflight collision` | — |
| TZ-191 | GLBD | Rebuild and apply 200 unique pesticide search aliases | copilot-v1 | DONE | TZ-190 | [task-reports/core/TZ-191.md](task-reports/core/TZ-191.md) | `SELF` |
| TZ-192 | CORE / ASSISTANT QA | Integrate verified Travkin Assistant into Core preview | copilot-v1 | DONE | TZ-186,TZ-189,TZ-A108 | [task-reports/core/TZ-192.md](task-reports/core/TZ-192.md) | `SELF` |
| TZ-193 | GLBD | Apply the next 200 pesticide search aliases | copilot-v1 | DONE | TZ-187,TZ-191 | [task-reports/core/TZ-193.md](task-reports/core/TZ-193.md) | `SELF` |
| TZ-194 | GLBD | Apply the final 112 pesticide search aliases | copilot-v1 | DONE | TZ-187,TZ-193 | [task-reports/core/TZ-194.md](task-reports/core/TZ-194.md) | `SELF` |
| TZ-195 | CORE / ASSISTANT QA | Integrate verified A109 into Core preview | copilot-v1 | DONE | TZ-192,TZ-A109 | [task-reports/core/TZ-195.md](task-reports/core/TZ-195.md) | `SELF` |
| TZ-196 | GLBD / ASSISTANT GOVERNANCE | Finalize remaining pesticide cards and GLBD V1 read safety | copilot-v1 | DONE | TZ-181,TZ-185,TZ-194,TZ-195 | [task-reports/core/TZ-196.md](task-reports/core/TZ-196.md) | `SELF` |
| TZ-197 | GLBD / ASSISTANT GOVERNANCE | Apply confirmed GLBD V1 corrections | copilot-v1 | DONE | TZ-196 | [task-reports/core/TZ-197.md](task-reports/core/TZ-197.md) | `SELF` |
| TZ-198 | GLBD / ASSISTANT QA | Provide branch-only read-only GLBD surface for A110 | copilot-v1 | DONE | TZ-196,TZ-197 | [task-reports/core/TZ-198.md](task-reports/core/TZ-198.md) | `SELF` |
| TZ-199 | GLBD / UI | Full Pesticide Card V1 and ten-card pilot | copilot-v1 | DONE | TZ-198 | [task-reports/core/TZ-199.md](task-reports/core/TZ-199.md) | `SELF` |
| TZ-200 | GLBD / UI | Deploy Full Pesticide Card V1 pilot to preview | copilot-v1 | DONE | TZ-199 | `preview acceptance completed` | `4a80e9a` |
| TZ-201 | GLBD / UI | Present Full Pesticide Card V1 in agronomic format | copilot-v1 | DONE | TZ-200 | `owner preview accepted` | `193cee7` |
| TZ-202 | GLBD / EXPORT | Export all pesticide cards for full external research | copilot-v1 | DONE | TZ-201 | [task-reports/core/TZ-202.md](task-reports/core/TZ-202.md) | `SELF` |
| TZ-204 | OPERATIONS / DATABASE | Enforce atomic operation lifecycle and data integrity | copilot-v1 | DONE | TZ-203 | [task-reports/core/TZ-204.md](task-reports/core/TZ-204.md) | `9ff5701` |
| TZ-207 | OPERATIONS / PILOT | Minimal non-chemical field operations for the real pilot | copilot-v1 | DONE | TZ-204 | [task-reports/core/TZ-207.md](task-reports/core/TZ-207.md) | `SELF` |
| TZ-209 | OPERATIONS / UI | Final simplified field-work selector | copilot-v1 | DONE | TZ-204,TZ-207,TZ-208 | [task-reports/core/TZ-209.md](task-reports/core/TZ-209.md) | `SELF` |
| TZ-210 | WAREHOUSE / UI / DATABASE | Warehousekeeper V1 roles, receipts, warehouses and requests | copilot-v1 | DONE | TZ-204,TZ-207,TZ-209 | [task-reports/core/TZ-210.md](task-reports/core/TZ-210.md) | `SELF` |
| TZ-211 | COUNTERPARTIES / WAREHOUSE / DATABASE | Global counterparty catalog and supplier auto-link | copilot-v1 | DONE | TZ-210 | [task-reports/core/TZ-211.md](task-reports/core/TZ-211.md) | `SELF` |
| TZ-212 | WAREHOUSE / UI / DATABASE | Warehouse balances, transfers, receipts and inventory | copilot-v1 | DONE | TZ-210,TZ-211 | [task-reports/core/TZ-212.md](task-reports/core/TZ-212.md) | `SELF` |
| TZ-213 | WEIGHBRIDGE / PROCESSING / UI / DATABASE | Weighbridge V1.1 harvest auto-link, yield and embedded processing | copilot-v1 | DONE | TZ-204,TZ-207,TZ-212 | [task-reports/core/TZ-213.md](task-reports/core/TZ-213.md) | `SELF` |
| TZ-214 | WEIGHBRIDGE / WAREHOUSE / UI / DATABASE | Weighbridge V1.2 harvest impurity removal and clean mass | copilot-v1 | DONE | TZ-204,TZ-212,TZ-213 | [task-reports/core/TZ-214.md](task-reports/core/TZ-214.md) | `SELF` |
| TZ-215 | COMPANY ADMIN / WAREHOUSE / REFERENCES / UI / DATABASE | Company Admin V1 role boundaries, references and pilot cleanup | copilot-v1 | DONE | TZ-210,TZ-212,TZ-214 | [task-reports/core/TZ-215.md](task-reports/core/TZ-215.md) | `SELF` |
| TZ-216 | WEIGHBRIDGE / WAREHOUSE / COUNTERPARTIES / UI / DATABASE | Weighbridge V1.3 single quantity source, routes and approved inventory | copilot-v1 | DONE | TZ-211,TZ-212,TZ-213,TZ-214,TZ-215 | [task-reports/core/TZ-216.md](task-reports/core/TZ-216.md) | `SELF` |

## Status values

Use one of: `PLANNED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DONE_WITH_SCHEMA_GATE`, `CANCELLED`, `SUPERSEDED`.

## Registration rule

1. Before issuing a new number, search this file.
2. Choose the correct independent sequence: numeric CORE or Latin-`A` ASSISTANT.
3. Add the task once with direction and branch.
4. Update status and report path after completion; do not delete the row.
5. `assistant-v1` may use only an `Axxx` number already reserved here by the main branch.
6. `SELF` is allowed only when the registry row and task report are committed together with the task itself.
