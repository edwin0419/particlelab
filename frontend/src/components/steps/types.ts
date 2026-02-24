import { StepArtifact, StepId } from "@/types/domain";

export interface StepPanelProps {
  runId: string;
  executingStepId: number | null;
  onExecute: (stepId: StepId, params: Record<string, unknown>) => Promise<void>;
  latestArtifactsByType: Record<string, StepArtifact | undefined>;
  isLocked?: boolean;
  lockMessage?: string;
}
