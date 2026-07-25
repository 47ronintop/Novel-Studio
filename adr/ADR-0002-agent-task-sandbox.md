# ADR-0002: Agent Task Sandbox — Threat Model and Trust Boundaries

**Date:** 2026-07-23  
**Status:** Candidate  
**Context:** Phase C — Controlled Execution for Novel Studio Agent

## Problem Statement

The Agent needs to execute project tasks (e.g., TypeScript builds, test runners) without exposing
the user's workspace, credentials, or operating system to malicious project code. Ordinary
`node:child_process` spawn inherits the full process environment, has no file boundary enforcement,
and cannot guarantee process tree cleanup.

## Trust Boundary Model

### Threat Actor: Malicious Project / Model / Plugin Code

A compromised project file, adversarially-crafted model output, or untrusted plugin could:

- Supply a taskId or task parameters that attempt shell injection
- Craft a `package.json` script that reads `~/.npmrc`, `$HOME/.ssh/id_rsa`, or `GITHUB_TOKEN`
- Spawn background processes that survive the run
- Write files outside the declared workspace projection
- Open network connections to exfiltrate data

**Mitigations:**

- Task input is only `taskId` + structured parameters — no raw command strings
- launcher/argv come exclusively from the app-local authorized task catalog (never from the model)
- AppContainer/LowBox file isolation: task can only access declared projection paths
- Network capability empty: no internet, no loopback, no LAN
- Job Object `KILL_ON_JOB_CLOSE`: all descendants terminate on host exit or crash

### Threat Actor: Local Administrator (Can Modify Installed App)

A local admin with write access to the application binary directory could:

- Replace the sandbox host binary with a malicious executable
- Modify the expected-digest constant in the TypeScript adapter
- Remove the host binary to cause unavailability

**Note:** This ADR does not claim to defend against a privileged local admin who can
modify both the host binary AND the digest that the application checks. Production
Authenticode signing of the host binary (verified at runtime) is required for that
guarantee. The current implementation provides fail-closed behavior: a missing or
digest-mismatched host returns `AGENT_TASK_SANDBOX_UNAVAILABLE`, never falls back
to unsandboxed execution.

**Development builds:** unsigned builds produce `development` qualification only and
are never accepted by the production attestation channel.

## Trust Hierarchy

```
User (grants task authorization in UI)
  └── Main process (holds attestation, catalog, feature flags)
        └── AgentTaskSandboxHost (ONLY module that may spawn native host)
              └── Native sandbox host binary (Rust, Authenticode-signed in production)
                    └── AppContainer/LowBox process (actual task execution)
                          └── Workspace projection (read-only copy of declared files)
```

No component lower in this hierarchy can expand its own permissions. The model,
renderer, project files, and plugins are all below the line and cannot influence
attestation, catalog, or sandbox policy.

## Key Invariants

1. **No direct spawn:** `node:child_process` for task purposes is only in `agent-task-sandbox.ts`.
   All other Application and agent-engine code is statically prohibited from importing it.

2. **Fail-closed attestation:** Missing binary, digest mismatch, partial capabilities, or
   expired attestation → `AGENT_TASK_SANDBOX_UNAVAILABLE`. No partial protection accepted.

3. **Network isolation:** Tasks have zero network capabilities. Loopback exemptions are
   rejected at AppContainer profile level.

4. **Process tree containment:** Tasks are created suspended, joined to a Job Object with
   `KILL_ON_JOB_CLOSE` before first user instruction. Cancel, timeout, host crash, and IPC
   disconnect all trigger job closure → full tree termination.

5. **Workspace projection:** Tasks receive a disposable copy of declared files (not the
   live workspace). Writes outside the declared scratch directory are rejected by the OS boundary.

6. **Attestation lifetime:** 1 hour maximum. Requalification required on app restart,
   policy drift, or explicit invalidation.

## Explicit Non-Guarantees

- Does NOT protect against a local administrator who controls both the host binary and the
  expected-digest constant in the same privilege domain.
- Does NOT protect against a compromised signing key (Authenticode must be separately protected).
- Does NOT protect against OS-level kernel vulnerabilities that escape AppContainer.
- Phase C does NOT provide network access for tasks; networked tasks require a separate RFC.
