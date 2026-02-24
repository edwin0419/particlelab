export type StepId = 1 | 2 | 3 | 4 | 45 | 5 | 6 | 7 | 8 | 9 | 10;

export interface FileRef {
  path: string;
  mime_type: string;
}

export interface ImageAsset {
  id: string;
  filename: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  original_url: string;
}

export interface Run {
  id: string;
  image_id: string;
  name: string | null;
  created_at: string;
}

export interface StepArtifact {
  id: string;
  run_id: string;
  step_id: number;
  version: number;
  artifact_type: string;
  params: Record<string, unknown>;
  files: FileRef[];
  created_at: string;
}

export interface ArtifactVersionGroup {
  version: number;
  artifacts: StepArtifact[];
}

export interface ArtifactStepGroup {
  step_id: number;
  versions: ArtifactVersionGroup[];
}

export interface RunArtifactsGrouped {
  run_id: string;
  steps: ArtifactStepGroup[];
}

export interface StepExecuteResponse {
  run_id: string;
  step_id: number;
  version: number;
  artifacts: StepArtifact[];
}

export interface Step1Measurement {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  pixel_distance: number;
  real_um: number;
}

export interface Step1ExecuteRequest {
  crop_bottom_px: number;
  um_per_px: number;
  measurement?: Step1Measurement | null;
}

export interface Step1ExecuteResponse {
  run_id: string;
  step_id: number;
  version: number;
  artifact: StepArtifact;
}
