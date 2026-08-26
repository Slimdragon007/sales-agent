import { z } from "zod";

export const callStageSchema = z.enum([
  "disclosure_permission",
  "connection_context",
  "desired_outcome",
  "current_workflow",
  "pain_impact",
  "commercial_model",
  "authority",
  "timeline_readiness",
  "scope_priority",
  "qualification",
  "recommendation",
  "mutual_action_plan",
]);

export type CallStage = z.infer<typeof callStageSchema>;

export type DiscoveryStage = {
  id: CallStage;
  label: string;
  shortLabel: string;
};

export const DISCOVERY_STAGES = [
  {
    id: "disclosure_permission",
    label: "Disclosure & permission",
    shortLabel: "Disclosure",
  },
  {
    id: "connection_context",
    label: "Connection",
    shortLabel: "Connection",
  },
  {
    id: "desired_outcome",
    label: "Desired outcome",
    shortLabel: "Outcome",
  },
  {
    id: "current_workflow",
    label: "Current workflow",
    shortLabel: "Workflow",
  },
  { id: "pain_impact", label: "Pain & impact", shortLabel: "Pain" },
  {
    id: "commercial_model",
    label: "Commercial model",
    shortLabel: "Commercial",
  },
  { id: "authority", label: "Authority", shortLabel: "Authority" },
  {
    id: "timeline_readiness",
    label: "Timeline",
    shortLabel: "Timeline",
  },
  {
    id: "scope_priority",
    label: "Scope priority",
    shortLabel: "Scope",
  },
  {
    id: "qualification",
    label: "Qualification",
    shortLabel: "Qualify",
  },
  {
    id: "recommendation",
    label: "Recommendation",
    shortLabel: "Recommend",
  },
  {
    id: "mutual_action_plan",
    label: "Mutual action plan",
    shortLabel: "Action plan",
  },
] as const satisfies readonly DiscoveryStage[];

export function getStageIndex(stage: CallStage): number {
  return DISCOVERY_STAGES.findIndex((item) => item.id === stage);
}

export function getStageNumber(stage: CallStage): number {
  return getStageIndex(stage) + 1;
}

export function getStage(stage: CallStage): DiscoveryStage {
  const discoveryStage = DISCOVERY_STAGES.find((item) => item.id === stage);

  if (!discoveryStage) {
    throw new Error(`Unknown discovery stage: ${stage}`);
  }

  return discoveryStage;
}
