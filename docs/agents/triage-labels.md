# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Canonical role     | Label in this repo  | Meaning                                  |
| ------------------ | ------------------- | ---------------------------------------- |
| `needs-triage`     | `needs-triage`      | Maintainer needs to evaluate this issue  |
| `needs-info`       | `needs-info`        | Waiting on reporter for more information |
| `ready-for-agent`  | `ready-for-agent`   | Fully specified, ready for an AFK agent  |
| `ready-for-human`  | `ready-for-human`   | Requires human implementation            |
| `wontfix`          | `wontfix`           | Will not be actioned                     |

The mapping is 1:1 — canonical names are used as-is in GitHub.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Other labels in this repo

GitHub also provides default categorical labels (`bug`, `enhancement`, `documentation`, `duplicate`, `good first issue`, `help wanted`, `invalid`, `question`). These are **categorical**, not triage state — they describe the issue's nature, and can coexist with any triage label.

A typical issue might carry both: `bug` (category) + `needs-info` (triage state).
