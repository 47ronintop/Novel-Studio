# M45 Workflow Branch

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M45 implements `branch` workflow steps as a first-class Workflow Engine action, closing the explicit M35 gap where branch steps were parsed but not executable.

## Scope

- Add branch metadata to workflow step types and JSON Schema.
- Validate branch target references during workflow definition parsing.
- Return a `choose-branch` action from `evaluateNextWorkflowAction()`.
- Add `chooseWorkflowBranch()` to advance a run through the selected branch.
- Prevent ordinary `completeWorkflowStep()` from skipping a branch without an explicit choice.

## Non-Goals

- Expression language execution for branch conditions.
- Agent-driven automatic branch decisions.
- UI workflow graph editing.

## Data Flow

Workflow definition with branch metadata
-> `parseWorkflowDefinition()`
-> `evaluateNextWorkflowAction()`
-> caller evaluates conditions or asks user
-> `chooseWorkflowBranch()`
-> next workflow step

## Acceptance

- Branch actions expose branch id, label, condition, and next target.
- Selecting a valid branch advances run state and marks the branch step completed.
- Missing branch targets fail parse-time validation.
- Direct branch completion fails with `WORKFLOW_BRANCH_CHOICE_REQUIRED`.
- Workflow Engine package remains dependency-clean.

## Changelog

- v1.0 - Completed Workflow Engine branch action and branch selection state transition.
