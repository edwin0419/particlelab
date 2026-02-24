"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { Step1Panel } from "@/components/step1/Step1Panel";
import { Step1VersionHistory } from "@/components/step1/Step1VersionHistory";
import { Step1Viewer } from "@/components/step1/Step1Viewer";
import { Step2PreviewViewer } from "@/components/step2/Step2PreviewViewer";
import { Step3PreviewViewer } from "@/components/step3/Step3PreviewViewer";
import { Step4PreviewViewer } from "@/components/step4/Step4PreviewViewer";
import { Step6PreviewViewer } from "@/components/step6/Step6PreviewViewer";
import { Step7DualMaskViewer } from "@/components/step7/Step7DualMaskViewer";
import { Step8Contour, Step8ContoursJson, Step8ContoursViewer } from "@/components/step8/Step8ContoursViewer";
import { Step9NeckSplitViewer } from "@/components/step9/Step9NeckSplitViewer";
import { Step10AutoCutViewer } from "@/components/step10/Step10AutoCutViewer";
import {
  Step5MaskEditorViewer,
  Step5MaskEditorViewerHandle,
  Step5BrushMode,
  Step5ViewerMode,
} from "@/components/step5/Step5MaskEditorViewer";
import { Step2Preprocess } from "@/components/steps/Step2Preprocess";
import { Step3Denoise } from "@/components/steps/Step3Denoise";
import { Step4Binarize } from "@/components/steps/Step4Binarize";
import { Step45Recovery } from "@/components/steps/Step45Recovery";
import { Step5MaskEditor } from "@/components/steps/Step5MaskEditor";
import { Step6Params, Step6Recovery, Step6ViewerMode } from "@/components/steps/Step6Recovery";
import {
  Step7BackgroundMode,
  Step7DualMask,
  Step7Metrics,
  Step7Params,
  Step7ViewerMode,
} from "@/components/steps/Step7DualMask";
import { Step8BackgroundMode, Step8Contours } from "@/components/steps/Step8Contours";
import { Step9NeckSplit, Step9Params } from "@/components/steps/Step9NeckSplit";
import { Step10NeckCuts, Step10Params } from "@/components/steps/Step10NeckCuts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ko } from "@/i18n/ko";
import {
  ApiError,
  Step3ExecutePayload,
  Step4ExecutePayload,
  Step4PreviewPayload,
  Step5ExecutePayload,
  Step6ExecutePayload,
  Step7ExecutePayload,
  Step7PreviewResponse,
  Step8ExecutePayload,
  Step9ExecutePayload,
  Step9Polygon,
  Step9PreviewResponse,
  Step10SplitLine,
  Step10ExecutePayload,
  Step10PreviewResponse,
  api,
} from "@/lib/api";
import { Step2Params, Step3Params, Step4Params, Step4ViewerMode, useStep1Store } from "@/store/useStep1Store";
import { RunArtifactsGrouped, Step1ExecuteRequest, StepArtifact, StepId } from "@/types/domain";

const STEP_IDS: StepId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STEP_PREREQUISITES: Partial<Record<StepId, StepId>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  9: 8,
  10: 9,
};

const DEFAULT_STEP6_PARAMS: Step6Params = {
  max_expand_um: 1.0,
  recover_sensitivity: 50,
  edge_protect: 60,
  fill_small_holes: true,
};

const DEFAULT_STEP7_PARAMS: Step7Params = {
  hole_mode: "fill_all",
  max_hole_area_um2: 1.0,
  closing_enabled: false,
  closing_radius_um: 0.2,
};

const DEFAULT_STEP9_PARAMS: Step9Params = {
  smooth_level: 35,
  resample_step_px: 2.0,
  max_vertex_gap_px: 3.0,
};

type Step9BackgroundMode = "gray" | "mask";

const DEFAULT_STEP10_PARAMS: Step10Params = {
  split_strength: 50,
  min_center_distance_px: 18,
  min_particle_area: 30,
};

interface WorkspacePersistedState {
  current_step?: number;
  selected_step1_artifact_id?: string | null;
  selected_step2_artifact_id?: string | null;
  selected_step3_artifact_id?: string | null;
  selected_step4_artifact_id?: string | null;
  selected_step5_artifact_id?: string | null;
  selected_step6_artifact_id?: string | null;
  selected_step7_artifact_id?: string | null;
  selected_step8_artifact_id?: string | null;
  selected_step9_artifact_id?: string | null;
  selected_step10_artifact_id?: string | null;
  step2_viewer_mode?: string;
  step3_viewer_mode?: string;
  step4_viewer_mode?: string;
  step5_viewer_mode?: string;
  step6_viewer_mode?: string;
  step7_viewer_mode?: string;
  step7_background_mode?: string;
  step8_background_mode?: string;
  step9_background_mode?: string;
}

function toNumber(value: unknown): number | null {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    return null;
  }
  return result;
}

function extractStepArtifacts(grouped: RunArtifactsGrouped | undefined, stepId: StepId): StepArtifact[] {
  if (!grouped) {
    return [];
  }

  const stepGroup = grouped.steps.find((step) => step.step_id === stepId);
  if (!stepGroup) {
    return [];
  }

  return [...stepGroup.versions]
    .sort((a, b) => b.version - a.version)
    .flatMap((version) => version.artifacts)
    .sort((a, b) => {
      if (a.version !== b.version) {
        return b.version - a.version;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

function getLatestArtifactsByType(grouped: RunArtifactsGrouped | undefined): Record<string, StepArtifact | undefined> {
  const latest: Record<string, StepArtifact | undefined> = {};
  if (!grouped) {
    return latest;
  }

  for (const step of grouped.steps) {
    for (const versionGroup of step.versions) {
      for (const artifact of versionGroup.artifacts) {
        const current = latest[artifact.artifact_type];
        if (!current) {
          latest[artifact.artifact_type] = artifact;
          continue;
        }

        if (artifact.version > current.version) {
          latest[artifact.artifact_type] = artifact;
          continue;
        }

        if (artifact.version === current.version) {
          const createdAt = new Date(artifact.created_at).getTime();
          const currentCreatedAt = new Date(current.created_at).getTime();
          if (createdAt > currentCreatedAt) {
            latest[artifact.artifact_type] = artifact;
          }
        }
      }
    }
  }

  return latest;
}

function formatStepNumber(stepId: StepId): string {
  if (stepId === 45) {
    return "4.5";
  }
  return String(stepId);
}

function getArtifactImageFileIndex(artifact: StepArtifact): number | null {
  const fileIndex = artifact.files.findIndex((file) => file.mime_type.startsWith("image/"));
  if (fileIndex < 0) {
    return null;
  }
  return fileIndex;
}

function getArtifactImageUrl(artifact: StepArtifact): string | undefined {
  const fileIndex = getArtifactImageFileIndex(artifact);
  if (fileIndex == null) {
    return undefined;
  }
  return api.getArtifactFileUrl(artifact.id, fileIndex);
}

function getArtifactImageUrlByName(artifact: StepArtifact, patterns: string[]): string | undefined {
  const normalizedPatterns = patterns.map((item) => item.toLowerCase());
  const fileIndex = artifact.files.findIndex((file) => {
    if (!file.mime_type.startsWith("image/")) {
      return false;
    }
    const path = file.path.toLowerCase();
    return normalizedPatterns.some((pattern) => path.includes(pattern));
  });
  if (fileIndex < 0) {
    return undefined;
  }
  return api.getArtifactFileUrl(artifact.id, fileIndex);
}

function getArtifactJsonFileIndex(artifact: StepArtifact, preferredPattern?: string): number | null {
  if (preferredPattern) {
    const pattern = preferredPattern.toLowerCase();
    const preferredIndex = artifact.files.findIndex(
      (file) => file.mime_type.includes("json") && file.path.toLowerCase().includes(pattern),
    );
    if (preferredIndex >= 0) {
      return preferredIndex;
    }
  }
  const fileIndex = artifact.files.findIndex((file) => file.mime_type.includes("json"));
  if (fileIndex < 0) {
    return null;
  }
  return fileIndex;
}

function firstImageArtifact(artifacts: StepArtifact[]): StepArtifact | null {
  for (const artifact of artifacts) {
    if (getArtifactImageFileIndex(artifact) != null) {
      return artifact;
    }
  }
  return null;
}

function getCompletedSteps(grouped: RunArtifactsGrouped | undefined): Set<number> {
  const completed = new Set<number>();
  if (!grouped) {
    return completed;
  }
  for (const stepGroup of grouped.steps) {
    if (stepGroup.versions.some((version) => version.artifacts.length > 0)) {
      completed.add(stepGroup.step_id);
    }
  }
  return completed;
}

function isStepUnlocked(stepId: StepId, completedSteps: Set<number>): boolean {
  if (stepId === 8) {
    return completedSteps.has(6) || completedSteps.has(5);
  }
  if (stepId === 9) {
    return completedSteps.has(8);
  }
  const prerequisite = STEP_PREREQUISITES[stepId];
  if (!prerequisite) {
    return true;
  }
  return completedSteps.has(prerequisite);
}

function getStepLockMessage(stepId: StepId): string | null {
  if (stepId === 8) {
    return ko.step8.lockMessage;
  }
  if (stepId === 9) {
    return ko.step9.lockMessage;
  }
  if (stepId === 10) {
    return ko.step10.lockMessage;
  }
  const prerequisite = STEP_PREREQUISITES[stepId];
  if (!prerequisite) {
    return null;
  }
  return ko.workspace.stepLockedTooltipTemplate.replace("{{required}}", formatStepNumber(prerequisite));
}

function summarizeParams(stepId: StepId, params: Record<string, unknown>): string {
  if (stepId === 2) {
    const brightness = toNumber(params.brightness);
    const contrast = toNumber(params.contrast);
    const gamma = toNumber(params.gamma);
    const black = toNumber(params.black_clip_pct);
    const white = toNumber(params.white_clip_pct);
    const claheTileRaw = typeof params.clahe_tile === "string" ? params.clahe_tile : "";
    const tileLabelMap: Record<string, string> = {
      auto: ko.step2.claheTileAuto,
      small: ko.step2.claheTileSmall,
      medium: ko.step2.claheTileMedium,
      large: ko.step2.claheTileLarge,
    };
    const tileLabel = tileLabelMap[claheTileRaw] ?? (claheTileRaw || ko.step2.claheTileAuto);

    return [
      `${ko.step2.brightness} ${brightness == null ? "-" : brightness.toFixed(0)}`,
      `${ko.step2.contrast} ${contrast == null ? "-" : contrast.toFixed(0)}`,
      `${ko.step2.gamma} ${gamma == null ? "-" : gamma.toFixed(2)}`,
      `${ko.step2.blackClip} ${black == null ? "-" : `${black.toFixed(1)}%`}`,
      `${ko.step2.whiteClip} ${white == null ? "-" : `${white.toFixed(1)}%`}`,
      `${ko.step2.claheTile} ${tileLabel}`,
    ].join(" · ");
  }

  if (stepId === 10) {
    const splitStrength = toNumber(params.split_strength);
    const minCenterDistance = toNumber(params.min_center_distance_px);
    const splitLineCount = toNumber(params.split_line_count);
    const labelCount = toNumber(params.label_count);
    return [
      `${ko.step10.splitStrength} ${splitStrength == null ? "-" : splitStrength.toFixed(0)}`,
      `${ko.step10.minCenterDistancePx} ${minCenterDistance == null ? "-" : minCenterDistance.toFixed(0)}`,
      `${ko.step10.splitLineCountLabel} ${splitLineCount == null ? "-" : splitLineCount.toFixed(0)}`,
      `${ko.step10.labelCountLabel} ${labelCount == null ? "-" : labelCount.toFixed(0)}`,
    ].join(" · ");
  }

  if (stepId === 3) {
    const methodRaw = typeof params.method === "string" ? params.method : "";
    const methodLabel = methodRaw === "nlm" ? ko.step3.methodNlm : ko.step3.methodBilateral;
    const strength = toNumber(params.strength);
    const edgeProtect = toNumber(params.edge_protect);
    const qualityRaw = typeof params.quality_mode === "string" ? params.quality_mode : "";
    const qualityLabel = qualityRaw === "정확" ? ko.step3.qualityAccurate : ko.step3.qualityFast;

    return [
      `${ko.step3.methodLabel} ${methodLabel}`,
      `${ko.step3.strength} ${strength == null ? "-" : strength.toFixed(0)}`,
      `${ko.step3.edgeProtect} ${edgeProtect == null ? "-" : edgeProtect.toFixed(0)}`,
      `${ko.step3.qualityMode} ${qualityLabel}`,
    ].join(" · ");
  }

  if (stepId === 4) {
    const modeRaw = typeof params.mode === "string" ? params.mode : "";
    const modeLabel = modeRaw === "simple" ? ko.step4.modeSimple : ko.step4.modeStructure;
    const seedSensitivity = toNumber(params.seed_sensitivity);
    const candidateSensitivity = toNumber(params.candidate_sensitivity);
    const structureScale = toNumber(params.structure_scale_um);
    const minArea = toNumber(params.min_area_um2);

    return [
      `${ko.step4.modeLabel} ${modeLabel}`,
      `${ko.step4.seedSensitivity} ${seedSensitivity == null ? "-" : seedSensitivity.toFixed(0)}`,
      `${ko.step4.candidateSensitivity} ${candidateSensitivity == null ? "-" : candidateSensitivity.toFixed(0)}`,
      `${ko.step4.structureScaleUm} ${structureScale == null ? "-" : structureScale.toFixed(3)}`,
      `${ko.step4.minAreaUm2} ${minArea == null ? "-" : minArea.toFixed(3)}`,
    ].join(" · ");
  }

  if (stepId === 5) {
    const brushMode = parseStep5BrushMode(params) === "restore" ? ko.step5.modeRestore : ko.step5.modeErase;
    const brushSize = parseStep5BrushSize(params);
    const baseMaskArtifactId =
      typeof params.base_mask_artifact_id === "string" && params.base_mask_artifact_id.trim().length > 0
        ? params.base_mask_artifact_id.trim()
        : "-";

    return [
      `${ko.step5.modeLabel} ${brushMode}`,
      `${ko.step5.brushSize} ${brushSize == null ? "-" : brushSize}`,
      `${ko.step5.baseMaskLabel} ${baseMaskArtifactId}`,
    ].join(" · ");
  }

  if (stepId === 6) {
    const maxExpandUm = toNumber(params.max_expand_um);
    const recoverSensitivity = toNumber(params.recover_sensitivity);
    const edgeProtect = toNumber(params.edge_protect);
    const fillSmallHoles = Boolean(params.fill_small_holes);
    return [
      `${ko.step6.maxExpandUm} ${maxExpandUm == null ? "-" : maxExpandUm.toFixed(3)}`,
      `${ko.step6.recoverSensitivity} ${recoverSensitivity == null ? "-" : recoverSensitivity.toFixed(0)}`,
      `${ko.step6.edgeProtect} ${edgeProtect == null ? "-" : edgeProtect.toFixed(0)}`,
      `${ko.step6.fillSmallHoles} ${fillSmallHoles ? ko.step6.toggleOn : ko.step6.toggleOff}`,
    ].join(" · ");
  }

  if (stepId === 7) {
    const holeModeRaw = typeof params.hole_mode === "string" ? params.hole_mode : "";
    const holeModeLabel =
      holeModeRaw === "fill_small"
        ? ko.step7.holeModeFillSmall
        : holeModeRaw === "keep"
          ? ko.step7.holeModeKeep
          : ko.step7.holeModeFillAll;
    const maxHoleArea = toNumber(params.max_hole_area_um2);
    const closingEnabled = Boolean(params.closing_enabled);
    const closingRadius = toNumber(params.closing_radius_um);
    return [
      `${ko.step7.holeModeLabel} ${holeModeLabel}`,
      `${ko.step7.maxHoleAreaUm2} ${maxHoleArea == null ? "-" : maxHoleArea.toFixed(4)}`,
      `${ko.step7.closingToggle} ${closingEnabled ? ko.step7.toggleOn : ko.step7.toggleOff}`,
      `${ko.step7.closingRadiusUm} ${closingRadius == null ? "-" : closingRadius.toFixed(3)}`,
    ].join(" · ");
  }

  if (stepId === 8) {
    const contourCount = toNumber(params.contour_count);
    const baseMaskStepId = toNumber(params.base_mask_step_id);
    const mode = typeof params.contour_mode === "string" ? params.contour_mode : "external_only";
    const modeLabel =
      mode === "solid_and_pore"
        ? ko.step8.solidAndPoreLabel
        : mode === "solid_only"
          ? ko.step8.solidOnlyLabel
          : mode === "external_only"
            ? ko.step8.externalOnlyLabel
            : mode;
    return [
      `${ko.step8.modeLabel} ${modeLabel}`,
      `${ko.step8.contourCountLabel} ${contourCount == null ? "-" : contourCount.toFixed(0)}`,
      `${ko.step8.baseMaskStepLabel} ${baseMaskStepId == null ? "-" : `${baseMaskStepId}단계`}`,
    ].join(" · ");
  }

  if (stepId === 9) {
    const smoothLevel = toNumber(params.smooth_level);
    const resampleStepPx = toNumber(params.resample_step_px);
    const maxVertexGapPx = toNumber(params.max_vertex_gap_px);
    const polygonCount = toNumber(params.polygon_count);
    return [
      `${ko.step9.smoothLevel} ${smoothLevel == null ? "-" : smoothLevel.toFixed(0)}`,
      `${ko.step9.resampleStepPx} ${resampleStepPx == null ? "-" : resampleStepPx.toFixed(1)}`,
      `${ko.step9.maxVertexGapPx} ${maxVertexGapPx == null ? "-" : maxVertexGapPx.toFixed(1)}`,
      `${ko.step9.polygonCountLabel} ${polygonCount == null ? "-" : polygonCount.toFixed(0)}`,
    ].join(" · ");
  }

  const entries = Object.entries(params)
    .filter(([key]) => key !== "measurement" && key !== "version_name")
    .slice(0, 3)
    .map(([, value]) => (typeof value === "number" ? value.toFixed(4).replace(/\\.0+$/, "") : String(value)));

  if (entries.length === 0) {
    return "-";
  }

  return entries.join(" · ");
}

function applyArtifactToStore(artifact: StepArtifact) {
  const params = artifact.params;

  const cropBottomPx = toNumber(params.crop_bottom_px) ?? 0;

  const measurement =
    params.measurement && typeof params.measurement === "object"
      ? (params.measurement as Record<string, unknown>)
      : null;

  const ax = measurement ? toNumber(measurement.ax) : null;
  const ay = measurement ? toNumber(measurement.ay) : null;
  const bx = measurement ? toNumber(measurement.bx) : null;
  const by = measurement ? toNumber(measurement.by) : null;
  const pixelDistance = measurement ? toNumber(measurement.pixel_distance) : null;
  const realUm = measurement ? toNumber(measurement.real_um) : null;

  const points =
    ax == null || ay == null || bx == null || by == null
      ? []
      : [
          { x: Math.round(ax), y: Math.round(ay) },
          { x: Math.round(bx), y: Math.round(by) },
        ];

  useStep1Store.getState().applySavedState({
    artifactId: artifact.id,
    cropBottomPx,
    pixelDistance,
    realUm,
    measurementPoints: points,
  });
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return ko.workspace.uploadConnectError;
    }
    if (error.status === 413) {
      return ko.workspace.uploadTooLargeError;
    }
    if (error.status === 422) {
      return ko.workspace.uploadInvalidError;
    }
    if (error.status === 500) {
      return ko.workspace.uploadServerError;
    }
    return error.message;
  }
  return ko.workspace.uploadFallbackError;
}

function getQueryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return ko.workspace.genericError;
}

function getRunCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${ko.workspace.createRunFailurePrefix}: ${error.message}`;
  }
  return ko.workspace.createRunFailure;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseStep2Params(params: Record<string, unknown>): Step2Params {
  const claheTileRaw = typeof params.clahe_tile === "string" ? params.clahe_tile.trim().toLowerCase() : "auto";
  const claheTileMap: Record<string, Step2Params["clahe_tile"]> = {
    auto: "auto",
    자동: "auto",
    small: "small",
    작게: "small",
    medium: "medium",
    보통: "medium",
    large: "large",
    크게: "large",
  };

  return {
    brightness: clamp(toNumber(params.brightness) ?? 0, -100, 100),
    contrast: clamp(toNumber(params.contrast) ?? 0, -100, 100),
    gamma: clamp(toNumber(params.gamma) ?? 1, 0.2, 5),
    black_clip_pct: clamp(toNumber(params.black_clip_pct) ?? 0.5, 0, 5),
    white_clip_pct: clamp(toNumber(params.white_clip_pct) ?? 99.5, 95, 100),
    clahe_enabled: toBoolean(params.clahe_enabled, false),
    clahe_strength: clamp(toNumber(params.clahe_strength) ?? 2, 0, 10),
    clahe_tile: claheTileMap[claheTileRaw] ?? "auto",
  };
}

function parseStep3Params(params: Record<string, unknown>): Step3Params {
  const methodRaw = typeof params.method === "string" ? params.method.trim().toLowerCase() : "bilateral";
  const qualityRaw = typeof params.quality_mode === "string" ? params.quality_mode.trim() : "빠름";
  const legacyEdgeProtect = toNumber(params.preserve_edge);

  return {
    method: methodRaw === "nlm" ? "nlm" : "bilateral",
    strength: clamp(toNumber(params.strength) ?? 40, 0, 100),
    edge_protect: clamp(toNumber(params.edge_protect) ?? legacyEdgeProtect ?? 60, 0, 100),
    quality_mode: qualityRaw === "정확" || qualityRaw.includes("정확") ? "정확" : "빠름",
  };
}

function parseStep4Params(params: Record<string, unknown>): Step4Params {
  const modeRaw = typeof params.mode === "string" ? params.mode.trim().toLowerCase() : "structure";
  return {
    mode: modeRaw === "simple" ? "simple" : "structure",
    seed_sensitivity: clamp(toNumber(params.seed_sensitivity) ?? 50, 0, 100),
    candidate_sensitivity: clamp(toNumber(params.candidate_sensitivity) ?? 50, 0, 100),
    structure_scale_um: clamp(toNumber(params.structure_scale_um) ?? 1.2, 0.05, 1000),
    min_area_um2: clamp(toNumber(params.min_area_um2) ?? 0.2, 0.0001, 1_000_000),
  };
}

function parseStep5BrushMode(params: Record<string, unknown>): Step5BrushMode {
  const raw = typeof params.brush_mode === "string" ? params.brush_mode.trim().toLowerCase() : "";
  if (raw === "복원" || raw === "restore") {
    return "restore";
  }
  return "erase";
}

function parseStep5BrushSize(params: Record<string, unknown>): number | null {
  const parsed = toNumber(params.brush_size_px);
  if (parsed == null) {
    return null;
  }
  return clamp(Math.round(parsed), 1, 60);
}

function parseStep6Params(params: Record<string, unknown>): Step6Params {
  return {
    max_expand_um: clamp(toNumber(params.max_expand_um) ?? DEFAULT_STEP6_PARAMS.max_expand_um, 0, 10),
    recover_sensitivity: clamp(
      Math.round(toNumber(params.recover_sensitivity) ?? DEFAULT_STEP6_PARAMS.recover_sensitivity),
      0,
      100,
    ),
    edge_protect: clamp(Math.round(toNumber(params.edge_protect) ?? DEFAULT_STEP6_PARAMS.edge_protect), 0, 100),
    fill_small_holes: toBoolean(params.fill_small_holes, DEFAULT_STEP6_PARAMS.fill_small_holes),
  };
}

function parseStep7Params(params: Record<string, unknown>): Step7Params {
  const holeModeRaw = typeof params.hole_mode === "string" ? params.hole_mode.trim().toLowerCase() : "fill_all";
  const holeModeMap: Record<string, Step7Params["hole_mode"]> = {
    fill_all: "fill_all",
    fill_small: "fill_small",
    keep: "keep",
    "모든 공극 채우기(추천)": "fill_all",
    "모든 공극 채우기": "fill_all",
    "작은 공극만 채우기": "fill_small",
    "공극 유지": "keep",
  };

  return {
    hole_mode: holeModeMap[holeModeRaw] ?? "fill_all",
    max_hole_area_um2: clamp(toNumber(params.max_hole_area_um2) ?? DEFAULT_STEP7_PARAMS.max_hole_area_um2, 0.0001, 1_000_000_000),
    closing_enabled: toBoolean(params.closing_enabled, DEFAULT_STEP7_PARAMS.closing_enabled),
    closing_radius_um: clamp(toNumber(params.closing_radius_um) ?? DEFAULT_STEP7_PARAMS.closing_radius_um, 0, 10),
  };
}

function parseStep9Params(params: Record<string, unknown>): Step9Params {
  return {
    smooth_level: clamp(Math.round(toNumber(params.smooth_level) ?? DEFAULT_STEP9_PARAMS.smooth_level), 0, 100),
    resample_step_px: clamp(toNumber(params.resample_step_px) ?? DEFAULT_STEP9_PARAMS.resample_step_px, 0.5, 5),
    max_vertex_gap_px: clamp(toNumber(params.max_vertex_gap_px) ?? DEFAULT_STEP9_PARAMS.max_vertex_gap_px, 1, 8),
  };
}

function parseStep10Params(params: Record<string, unknown>): Step10Params {
  return {
    split_strength: clamp(
      Math.round(toNumber(params.split_strength) ?? DEFAULT_STEP10_PARAMS.split_strength),
      0,
      100,
    ),
    min_center_distance_px: clamp(
      Math.round(toNumber(params.min_center_distance_px) ?? DEFAULT_STEP10_PARAMS.min_center_distance_px),
      1,
      512,
    ),
    min_particle_area: clamp(
      Math.round(toNumber(params.min_particle_area) ?? DEFAULT_STEP10_PARAMS.min_particle_area),
      1,
      10_000_000,
    ),
  };
}

function toStep3Payload(params: Step3Params, inputArtifactId: string | null): Step3ExecutePayload {
  return {
    method: params.method,
    strength: params.strength,
    edge_protect: params.edge_protect,
    quality_mode: params.quality_mode,
    input_artifact_id: inputArtifactId || undefined,
  };
}

function toStep4Payload(params: Step4Params, inputArtifactId: string | null): Step4ExecutePayload {
  return {
    mode: params.mode,
    seed_sensitivity: params.seed_sensitivity,
    candidate_sensitivity: params.candidate_sensitivity,
    structure_scale_um: params.structure_scale_um,
    min_area_um2: params.min_area_um2,
    input_artifact_id: inputArtifactId || undefined,
  };
}

function toStep4PreviewPayload(
  params: Step4Params,
  inputArtifactId: string | null,
  previewLayer: Exclude<Step4ViewerMode, "input">,
): Step4PreviewPayload {
  return {
    ...toStep4Payload(params, inputArtifactId),
    preview_layer: previewLayer,
  };
}

function toStep5Payload(params: Record<string, unknown>, editedMaskPngBase64: string): Step5ExecutePayload {
  const baseMaskArtifactId =
    typeof params.base_mask_artifact_id === "string" && params.base_mask_artifact_id.trim().length > 0
      ? params.base_mask_artifact_id.trim()
      : undefined;
  const brushModeRaw = typeof params.brush_mode === "string" ? params.brush_mode.trim() : "";
  const brushMode: Step5ExecutePayload["brush_mode"] = brushModeRaw === "복원" ? "복원" : "삭제";
  const brushSizeRaw = toNumber(params.brush_size_px);
  const brushSize = brushSizeRaw == null ? undefined : clamp(Math.round(brushSizeRaw), 1, 60);

  return {
    base_mask_artifact_id: baseMaskArtifactId,
    edited_mask_png_base64: editedMaskPngBase64,
    brush_mode: brushMode,
    brush_size_px: brushSize,
  };
}

function toStep6Payload(params: Step6Params, baseMaskArtifactId: string | null): Step6ExecutePayload {
  return {
    base_mask_artifact_id: baseMaskArtifactId || undefined,
    max_expand_um: clamp(params.max_expand_um, 0, 10),
    recover_sensitivity: clamp(Math.round(params.recover_sensitivity), 0, 100),
    edge_protect: clamp(Math.round(params.edge_protect), 0, 100),
    fill_small_holes: Boolean(params.fill_small_holes),
  };
}

function toStep7Payload(params: Step7Params, baseMaskArtifactId: string | null): Step7ExecutePayload {
  return {
    base_mask_artifact_id: baseMaskArtifactId || undefined,
    hole_mode: params.hole_mode,
    max_hole_area_um2: params.hole_mode === "fill_small" ? clamp(params.max_hole_area_um2, 0.0001, 1_000_000_000) : null,
    closing_enabled: Boolean(params.closing_enabled),
    closing_radius_um: params.closing_enabled ? clamp(params.closing_radius_um, 0, 10) : null,
  };
}

function toStep9PreviewPayload(params: Step9Params, step8ArtifactId: string | null): Step9ExecutePayload {
  return {
    step8_artifact_id: step8ArtifactId || undefined,
    smooth_level: clamp(Math.round(params.smooth_level), 0, 100),
    resample_step_px: Number(clamp(params.resample_step_px, 0.5, 5).toFixed(2)),
    max_vertex_gap_px: Number(clamp(params.max_vertex_gap_px, 1, 8).toFixed(2)),
  };
}

function toStep10Payload(
  params: Step10Params,
  step9ArtifactId: string | null,
  step3ArtifactId: string | null,
): Step10ExecutePayload {
  return {
    split_strength: clamp(Math.round(params.split_strength), 0, 100),
    min_center_distance_px: clamp(Math.round(params.min_center_distance_px), 1, 512),
    min_particle_area: clamp(Math.round(params.min_particle_area), 1, 10_000_000),
    step9_artifact_id: step9ArtifactId || undefined,
    step3_artifact_id: step3ArtifactId || undefined,
  };
}

interface Step9PolygonsJson {
  image_width?: number;
  image_height?: number;
  polygon_count?: number;
  step8_artifact_id?: string;
  polygons?: Step9Polygon[];
  params?: Record<string, unknown>;
}

interface Step10CutsJson {
  image_width?: number;
  image_height?: number;
  step9_artifact_id?: string;
  step3_artifact_id?: string | null;
  split_lines?: Step10SplitLine[];
  split_line_count?: number;
  label_count?: number;
  label_areas?: Record<string, number>;
  qc?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

interface StepsPresetFileV1 {
  schema_version: 1;
  preset_type: "step_params_1_8";
  exported_at: string;
  source_run_id: string;
  source_image_id: string | null;
  steps: {
    "1"?: Record<string, unknown>;
    "2"?: Record<string, unknown>;
    "3"?: Record<string, unknown>;
    "4"?: Record<string, unknown>;
    "5"?: Record<string, unknown>;
    "6"?: Record<string, unknown>;
    "7"?: Record<string, unknown>;
    "8"?: Record<string, unknown>;
  };
}

interface LegacyHistoryArtifactItem {
  step_id?: number;
  version?: number;
  created_at?: string;
  params?: Record<string, unknown>;
}

function unwrapStepParamPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const asRecord = raw as Record<string, unknown>;
  if (asRecord.params && typeof asRecord.params === "object") {
    return asRecord.params as Record<string, unknown>;
  }
  return asRecord;
}

function mapStep9PolygonToContour(polygon: Step9Polygon, index: number): Step8Contour | null {
  const points = Array.isArray(polygon.points)
    ? polygon.points
        .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
        .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0] as [number, number])
    : [];
  if (points.length < 3) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  const objectId = Math.max(1, Math.round(Number(polygon.object_id) || (index + 1)));
  return {
    id: objectId,
    bbox: [
      Math.floor(minX),
      Math.floor(minY),
      Math.max(1, Math.ceil(maxX - minX)),
      Math.max(1, Math.ceil(maxY - minY)),
    ],
    points,
  };
}

export default function RunWorkspacePage() {
  const params = useParams<{ runId: string }>();
  const router = useRouter();
  const runId = params.runId;
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const historyImportInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceStorageKey = `particlelab-workspace:${runId}`;

  const currentStep = useStep1Store((state) => state.currentStep);
  const setCurrentStep = useStep1Store((state) => state.setCurrentStep);
  const measurementMode = useStep1Store((state) => state.measurementMode);
  const measurementPoints = useStep1Store((state) => state.measurementPoints);
  const rectangleVisible = useStep1Store((state) => state.rectangleVisible);
  const autoApplyRectangleWidth = useStep1Store((state) => state.autoApplyRectangleWidth);
  const cropBottomPx = useStep1Store((state) => state.cropBottomPx);
  const pixelDistanceInput = useStep1Store((state) => state.pixelDistanceInput);
  const realUmInput = useStep1Store((state) => state.realUmInput);
  const selectedArtifactId = useStep1Store((state) => state.selectedArtifactId);
  const step2Params = useStep1Store((state) => state.step2Params);
  const step2ViewerMode = useStep1Store((state) => state.step2ViewerMode);
  const selectedStep2ArtifactId = useStep1Store((state) => state.selectedStep2ArtifactId);
  const step3Params = useStep1Store((state) => state.step3Params);
  const step3ViewerMode = useStep1Store((state) => state.step3ViewerMode);
  const selectedStep3ArtifactId = useStep1Store((state) => state.selectedStep3ArtifactId);
  const step4Params = useStep1Store((state) => state.step4Params);
  const step4ViewerMode = useStep1Store((state) => state.step4ViewerMode);
  const selectedStep4ArtifactId = useStep1Store((state) => state.selectedStep4ArtifactId);
  const setMeasurementPoints = useStep1Store((state) => state.setMeasurementPoints);
  const setCropBottomPx = useStep1Store((state) => state.setCropBottomPx);
  const setPixelDistanceInput = useStep1Store((state) => state.setPixelDistanceInput);
  const setRealUmInput = useStep1Store((state) => state.setRealUmInput);
  const setRectangleVisible = useStep1Store((state) => state.setRectangleVisible);
  const setAutoApplyRectangleWidth = useStep1Store((state) => state.setAutoApplyRectangleWidth);
  const setSelectedArtifactId = useStep1Store((state) => state.setSelectedArtifactId);
  const setStep2ViewerMode = useStep1Store((state) => state.setStep2ViewerMode);
  const setSelectedStep2ArtifactId = useStep1Store((state) => state.setSelectedStep2ArtifactId);
  const setStep2Params = useStep1Store((state) => state.setStep2Params);
  const setStep3ViewerMode = useStep1Store((state) => state.setStep3ViewerMode);
  const setSelectedStep3ArtifactId = useStep1Store((state) => state.setSelectedStep3ArtifactId);
  const setStep3Params = useStep1Store((state) => state.setStep3Params);
  const setStep4ViewerMode = useStep1Store((state) => state.setStep4ViewerMode);
  const setSelectedStep4ArtifactId = useStep1Store((state) => state.setSelectedStep4ArtifactId);
  const setStep4Params = useStep1Store((state) => state.setStep4Params);
  const reset = useStep1Store((state) => state.reset);

  const initializedRef = useRef(false);
  const step3PreviewSeqRef = useRef(0);
  const step4PreviewSeqRef = useRef(0);
  const step6PreviewSeqRef = useRef(0);
  const step7PreviewSeqRef = useRef(0);
  const step5ViewerRef = useRef<Step5MaskEditorViewerHandle | null>(null);
  const [step3PreviewImageUrl, setStep3PreviewImageUrl] = useState<string | null>(null);
  const [step3PreviewLoading, setStep3PreviewLoading] = useState(false);
  const [step4PreviewImageUrl, setStep4PreviewImageUrl] = useState<string | null>(null);
  const [step4PreviewLoading, setStep4PreviewLoading] = useState(false);
  const [step6PreviewImageUrl, setStep6PreviewImageUrl] = useState<string | null>(null);
  const [step6PreviewLoading, setStep6PreviewLoading] = useState(false);
  const [step7PreviewLoading, setStep7PreviewLoading] = useState(false);
  const [step7PreviewData, setStep7PreviewData] = useState<Step7PreviewResponse | null>(null);
  const [step7PreviewActive, setStep7PreviewActive] = useState(false);
  const [selectedStep5ArtifactId, setSelectedStep5ArtifactId] = useState<string | null>(null);
  const [step5ViewerMode, setStep5ViewerMode] = useState<Step5ViewerMode>("overlay");
  const [step5BrushMode, setStep5BrushMode] = useState<Step5BrushMode>("erase");
  const [step5BrushSizePx, setStep5BrushSizePx] = useState(30);
  const [step5CanUndo, setStep5CanUndo] = useState(false);
  const [step5CanRedo, setStep5CanRedo] = useState(false);
  const [step5HasMask, setStep5HasMask] = useState(false);
  const [selectedStep6ArtifactId, setSelectedStep6ArtifactId] = useState<string | null>(null);
  const [step6ViewerMode, setStep6ViewerMode] = useState<Step6ViewerMode>("base");
  const [step6Params, setStep6Params] = useState<Step6Params>({ ...DEFAULT_STEP6_PARAMS });
  const [selectedStep7ArtifactId, setSelectedStep7ArtifactId] = useState<string | null>(null);
  const [step7ViewerMode, setStep7ViewerMode] = useState<Step7ViewerMode>("solid");
  const [step7BackgroundMode, setStep7BackgroundMode] = useState<Step7BackgroundMode>("original");
  const [step7Params, setStep7Params] = useState<Step7Params>({ ...DEFAULT_STEP7_PARAMS });
  const [selectedStep8ArtifactId, setSelectedStep8ArtifactId] = useState<string | null>(null);
  const [step8BackgroundMode, setStep8BackgroundMode] = useState<Step8BackgroundMode>("original");
  const [step8ContoursData, setStep8ContoursData] = useState<Step8ContoursJson | null>(null);
  const [step8ContoursLoading, setStep8ContoursLoading] = useState(false);
  const [step8SelectedContourId, setStep8SelectedContourId] = useState<number | null>(null);
  const [selectedStep9ArtifactId, setSelectedStep9ArtifactId] = useState<string | null>(null);
  const [step9BackgroundMode, setStep9BackgroundMode] = useState<Step9BackgroundMode>("gray");
  const [step9Params, setStep9Params] = useState<Step9Params>({ ...DEFAULT_STEP9_PARAMS });
  const [step9PreviewLoading, setStep9PreviewLoading] = useState(false);
  const [step9PreviewData, setStep9PreviewData] = useState<Step9PreviewResponse | null>(null);
  const [step9PreviewActive, setStep9PreviewActive] = useState(false);
  const [step9SavedCutsData, setStep9SavedCutsData] = useState<Step9PolygonsJson | null>(null);
  const [step9CheckedCandidateIds, setStep9CheckedCandidateIds] = useState<string[]>([]);
  const [step9HoveredCandidateId, setStep9HoveredCandidateId] = useState<string | null>(null);
  const [selectedStep10ArtifactId, setSelectedStep10ArtifactId] = useState<string | null>(null);
  const [step10Params, setStep10Params] = useState<Step10Params>({ ...DEFAULT_STEP10_PARAMS });
  const [step10PreviewLoading, setStep10PreviewLoading] = useState(false);
  const [step10PreviewData, setStep10PreviewData] = useState<Step10PreviewResponse | null>(null);
  const [step10PreviewActive, setStep10PreviewActive] = useState(false);
  const [step10SavedCutsData, setStep10SavedCutsData] = useState<Step10CutsJson | null>(null);
  const [step10HoveredFragmentId, setStep10HoveredFragmentId] = useState<number | null>(null);

  useEffect(() => {
    reset();
    initializedRef.current = false;
    step3PreviewSeqRef.current = 0;
    step4PreviewSeqRef.current = 0;
    step6PreviewSeqRef.current = 0;
    step7PreviewSeqRef.current = 0;
    setStep3PreviewLoading(false);
    setStep4PreviewLoading(false);
    setStep6PreviewLoading(false);
    setStep7PreviewLoading(false);
    setStep7PreviewData(null);
    setStep7PreviewActive(false);
    setStep8BackgroundMode("original");
    setStep9BackgroundMode("gray");
    setStep9Params({ ...DEFAULT_STEP9_PARAMS });
    setStep9PreviewLoading(false);
    setStep9PreviewData(null);
    setStep9PreviewActive(false);
    setStep9SavedCutsData(null);
    setStep9CheckedCandidateIds([]);
    setStep9HoveredCandidateId(null);
    setSelectedStep10ArtifactId(null);
    setStep10Params({ ...DEFAULT_STEP10_PARAMS });
    setStep10PreviewLoading(false);
    setStep10PreviewData(null);
    setStep10PreviewActive(false);
    setStep10SavedCutsData(null);
    setStep10HoveredFragmentId(null);
    setStep3PreviewImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setStep4PreviewImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setStep6PreviewImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setSelectedStep5ArtifactId(null);
    setStep5ViewerMode("overlay");
    setStep5BrushMode("erase");
    setStep5BrushSizePx(30);
    setStep5CanUndo(false);
    setStep5CanRedo(false);
    setStep5HasMask(false);
    setSelectedStep6ArtifactId(null);
    setStep6ViewerMode("base");
    setStep6Params({ ...DEFAULT_STEP6_PARAMS });
    setSelectedStep7ArtifactId(null);
    setStep7ViewerMode("solid");
    setStep7BackgroundMode("original");
    setStep7Params({ ...DEFAULT_STEP7_PARAMS });
    setSelectedStep8ArtifactId(null);
    setSelectedStep9ArtifactId(null);
    setStep8ContoursData(null);
    setStep8ContoursLoading(false);
    setStep8SelectedContourId(null);
  }, [reset, runId]);

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId),
    enabled: Boolean(runId),
  });

  const imageQuery = useQuery({
    queryKey: ["image", runQuery.data?.image_id],
    queryFn: () => api.getImage(runQuery.data!.image_id),
    enabled: Boolean(runQuery.data?.image_id),
  });

  const imagesQuery = useQuery({
    queryKey: ["images"],
    queryFn: api.listImages,
    retry: 0,
  });

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", runId],
    queryFn: () => api.getRunArtifacts(runId),
    enabled: Boolean(runId),
  });

  const latestArtifactsByType = useMemo(() => getLatestArtifactsByType(artifactsQuery.data), [artifactsQuery.data]);
  const step1Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 1), [artifactsQuery.data]);
  const step2Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 2), [artifactsQuery.data]);
  const step3Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 3), [artifactsQuery.data]);
  const step4Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 4), [artifactsQuery.data]);
  const step5Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 5), [artifactsQuery.data]);
  const step6Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 6), [artifactsQuery.data]);
  const step7Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 7), [artifactsQuery.data]);
  const step8Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 8), [artifactsQuery.data]);
  const step9Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 9), [artifactsQuery.data]);
  const step10Artifacts = useMemo(() => extractStepArtifacts(artifactsQuery.data, 10), [artifactsQuery.data]);
  const selectedStepArtifacts = useMemo(
    () => extractStepArtifacts(artifactsQuery.data, currentStep),
    [artifactsQuery.data, currentStep],
  );
  const completedSteps = useMemo(() => getCompletedSteps(artifactsQuery.data), [artifactsQuery.data]);

  const unlockedSteps = useMemo(() => {
    const map = new Map<StepId, boolean>();
    for (const stepId of STEP_IDS) {
      map.set(stepId, isStepUnlocked(stepId, completedSteps));
    }
    return map;
  }, [completedSteps]);

  useEffect(() => {
    if (unlockedSteps.get(currentStep) === false) {
      setCurrentStep(1);
    }
  }, [currentStep, setCurrentStep, unlockedSteps]);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    if (artifactsQuery.isLoading) {
      return;
    }

    let persistedState: WorkspacePersistedState | null = null;
    try {
      const raw = localStorage.getItem(workspaceStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as WorkspacePersistedState;
        if (parsed && typeof parsed === "object") {
          persistedState = parsed;
        }
      }
    } catch {
      persistedState = null;
    }

    const persistedStep1Id = persistedState?.selected_step1_artifact_id;
    const step1Target =
      typeof persistedStep1Id === "string" && persistedStep1Id.length > 0
        ? step1Artifacts.find((artifact) => artifact.id === persistedStep1Id) ?? null
        : null;

    if (step1Target) {
      applyArtifactToStore(step1Target);
    } else if (step1Artifacts.length > 0) {
      applyArtifactToStore(step1Artifacts[0]);
    }

    const persistedStep2Id = persistedState?.selected_step2_artifact_id;
    if (typeof persistedStep2Id === "string" && persistedStep2Id.length > 0) {
      const step2Target = step2Artifacts.find((artifact) => artifact.id === persistedStep2Id);
      if (step2Target) {
        setSelectedStep2ArtifactId(step2Target.id);
        setStep2Params(parseStep2Params(step2Target.params));
      }
    }

    const persistedStep3Id = persistedState?.selected_step3_artifact_id;
    if (typeof persistedStep3Id === "string" && persistedStep3Id.length > 0) {
      const step3Target = step3Artifacts.find((artifact) => artifact.id === persistedStep3Id);
      if (step3Target) {
        setSelectedStep3ArtifactId(step3Target.id);
        setStep3Params(parseStep3Params(step3Target.params));
      }
    }

    const persistedStep4Id = persistedState?.selected_step4_artifact_id;
    if (typeof persistedStep4Id === "string" && persistedStep4Id.length > 0) {
      const step4Target = step4Artifacts.find((artifact) => artifact.id === persistedStep4Id);
      if (step4Target) {
        setSelectedStep4ArtifactId(step4Target.id);
        setStep4Params(parseStep4Params(step4Target.params));
      }
    }

    const persistedStep5Id = persistedState?.selected_step5_artifact_id;
    if (typeof persistedStep5Id === "string" && persistedStep5Id.length > 0) {
      const step5Target = step5Artifacts.find((artifact) => artifact.id === persistedStep5Id);
      if (step5Target) {
        setSelectedStep5ArtifactId(step5Target.id);
        const parsedBrushSize = parseStep5BrushSize(step5Target.params);
        if (parsedBrushSize != null) {
          setStep5BrushSizePx(parsedBrushSize);
        }
        setStep5BrushMode(parseStep5BrushMode(step5Target.params));
      }
    }

    const persistedStep6Id = persistedState?.selected_step6_artifact_id;
    if (typeof persistedStep6Id === "string" && persistedStep6Id.length > 0) {
      const step6Target = step6Artifacts.find((artifact) => artifact.id === persistedStep6Id);
      if (step6Target) {
        setSelectedStep6ArtifactId(step6Target.id);
        setStep6Params(parseStep6Params(step6Target.params));
      }
    }

    const persistedStep7Id = persistedState?.selected_step7_artifact_id;
    if (typeof persistedStep7Id === "string" && persistedStep7Id.length > 0) {
      const step7Target = step7Artifacts.find((artifact) => artifact.id === persistedStep7Id);
      if (step7Target) {
        setSelectedStep7ArtifactId(step7Target.id);
        setStep7Params(parseStep7Params(step7Target.params));
      }
    }

    const persistedStep8Id = persistedState?.selected_step8_artifact_id;
    if (typeof persistedStep8Id === "string" && persistedStep8Id.length > 0) {
      const step8Target = step8Artifacts.find((artifact) => artifact.id === persistedStep8Id);
      if (step8Target) {
        setSelectedStep8ArtifactId(step8Target.id);
      }
    }

    const persistedStep9Id = persistedState?.selected_step9_artifact_id;
    if (typeof persistedStep9Id === "string" && persistedStep9Id.length > 0) {
      const step9Target = step9Artifacts.find((artifact) => artifact.id === persistedStep9Id);
      if (step9Target) {
        setSelectedStep9ArtifactId(step9Target.id);
        setStep9Params(parseStep9Params(step9Target.params));
      }
    }

    const persistedStep10Id = persistedState?.selected_step10_artifact_id;
    if (typeof persistedStep10Id === "string" && persistedStep10Id.length > 0) {
      const step10Target = step10Artifacts.find((artifact) => artifact.id === persistedStep10Id);
      if (step10Target) {
        setSelectedStep10ArtifactId(step10Target.id);
        setStep10Params(parseStep10Params(step10Target.params));
      }
    }

    if (persistedState?.step2_viewer_mode === "input" || persistedState?.step2_viewer_mode === "preview" || persistedState?.step2_viewer_mode === "saved") {
      setStep2ViewerMode(persistedState.step2_viewer_mode);
    }

    if (persistedState?.step3_viewer_mode === "input" || persistedState?.step3_viewer_mode === "preview" || persistedState?.step3_viewer_mode === "saved") {
      setStep3ViewerMode(persistedState.step3_viewer_mode);
    }

    if (
      persistedState?.step4_viewer_mode === "input" ||
      persistedState?.step4_viewer_mode === "seed" ||
      persistedState?.step4_viewer_mode === "candidate" ||
      persistedState?.step4_viewer_mode === "mask" ||
      persistedState?.step4_viewer_mode === "mask_binary"
    ) {
      setStep4ViewerMode(persistedState.step4_viewer_mode);
    }

    if (persistedState?.step5_viewer_mode === "overlay" || persistedState?.step5_viewer_mode === "binary") {
      setStep5ViewerMode(persistedState.step5_viewer_mode);
    }

    if (
      persistedState?.step6_viewer_mode === "original" ||
      persistedState?.step6_viewer_mode === "base" ||
      persistedState?.step6_viewer_mode === "preview" ||
      persistedState?.step6_viewer_mode === "saved"
    ) {
      setStep6ViewerMode(persistedState.step6_viewer_mode);
    }

    if (
      persistedState?.step7_viewer_mode === "solid" ||
      persistedState?.step7_viewer_mode === "outer" ||
      persistedState?.step7_viewer_mode === "porosity"
    ) {
      setStep7ViewerMode(persistedState.step7_viewer_mode);
    }

    if (persistedState?.step7_background_mode === "original" || persistedState?.step7_background_mode === "binary") {
      setStep7BackgroundMode(persistedState.step7_background_mode);
    }

    if (persistedState?.step8_background_mode === "original" || persistedState?.step8_background_mode === "binary") {
      setStep8BackgroundMode(persistedState.step8_background_mode);
    }

    if (persistedState?.step9_background_mode === "gray" || persistedState?.step9_background_mode === "mask") {
      setStep9BackgroundMode(persistedState.step9_background_mode);
    }

    const persistedStepRaw = persistedState?.current_step;
    if (typeof persistedStepRaw === "number") {
      const persistedStep = STEP_IDS.find((stepId) => stepId === persistedStepRaw);
      if (persistedStep && unlockedSteps.get(persistedStep) !== false) {
        setCurrentStep(persistedStep);
      }
    }

    initializedRef.current = true;
  }, [
    artifactsQuery.isLoading,
    setCurrentStep,
    setSelectedStep2ArtifactId,
    setSelectedStep3ArtifactId,
    setSelectedStep4ArtifactId,
    setSelectedStep9ArtifactId,
    setSelectedStep5ArtifactId,
    setSelectedStep8ArtifactId,
    setStep2Params,
    setStep2ViewerMode,
    setStep5BrushMode,
    setStep5BrushSizePx,
    setStep6Params,
    setStep7Params,
    setStep3Params,
    setStep3ViewerMode,
    setStep4Params,
    setStep4ViewerMode,
    setStep5ViewerMode,
    setStep6ViewerMode,
    setStep7ViewerMode,
    setStep7BackgroundMode,
    setStep8BackgroundMode,
    setStep9BackgroundMode,
    setStep9Params,
    step1Artifacts,
    step2Artifacts,
    step3Artifacts,
    step4Artifacts,
    step5Artifacts,
    step6Artifacts,
    step7Artifacts,
    step8Artifacts,
    step9Artifacts,
    step10Artifacts,
    unlockedSteps,
    workspaceStorageKey,
  ]);

  useEffect(() => {
    const payload: WorkspacePersistedState = {
      current_step: currentStep,
      selected_step1_artifact_id: selectedArtifactId,
      selected_step2_artifact_id: selectedStep2ArtifactId,
      selected_step3_artifact_id: selectedStep3ArtifactId,
      selected_step4_artifact_id: selectedStep4ArtifactId,
      selected_step5_artifact_id: selectedStep5ArtifactId,
      selected_step6_artifact_id: selectedStep6ArtifactId,
      selected_step7_artifact_id: selectedStep7ArtifactId,
      selected_step8_artifact_id: selectedStep8ArtifactId,
      selected_step9_artifact_id: selectedStep9ArtifactId,
      selected_step10_artifact_id: selectedStep10ArtifactId,
      step2_viewer_mode: step2ViewerMode,
      step3_viewer_mode: step3ViewerMode,
      step4_viewer_mode: step4ViewerMode,
      step5_viewer_mode: step5ViewerMode,
      step6_viewer_mode: step6ViewerMode,
      step7_viewer_mode: step7ViewerMode,
      step7_background_mode: step7BackgroundMode,
      step8_background_mode: step8BackgroundMode,
      step9_background_mode: step9BackgroundMode,
    };

    try {
      localStorage.setItem(workspaceStorageKey, JSON.stringify(payload));
    } catch {
      // 로컬 저장소 쓰기 실패는 무시하고 기본 동작을 유지한다.
    }
  }, [
    currentStep,
    selectedArtifactId,
    selectedStep2ArtifactId,
    selectedStep3ArtifactId,
    selectedStep4ArtifactId,
    selectedStep5ArtifactId,
    selectedStep6ArtifactId,
    selectedStep7ArtifactId,
    selectedStep8ArtifactId,
    selectedStep9ArtifactId,
    selectedStep10ArtifactId,
    step2ViewerMode,
    step3ViewerMode,
    step4ViewerMode,
    step5ViewerMode,
    step6ViewerMode,
    step7ViewerMode,
    step7BackgroundMode,
    step8BackgroundMode,
    step9BackgroundMode,
    workspaceStorageKey,
  ]);

  const saveMutation = useMutation({
    mutationFn: (payload: Step1ExecuteRequest) => api.executeStep1(runId, payload),
    onMutate: () => toast.info(ko.workspace.saveRunning),
    onSuccess: (response) => {
      applyArtifactToStore(response.artifact);
      queryClient.invalidateQueries({ queryKey: ["artifacts", runId] });
      toast.success(ko.workspace.saveSuccess);
    },
    onError: () => {
      toast.error(ko.workspace.genericError);
    },
  });

  const executeStepMutation = useMutation({
    mutationFn: ({ stepId, params }: { stepId: StepId; params: Record<string, unknown> }) => {
      if (stepId === 3) {
        return api.executeStep3(runId, params as unknown as Step3ExecutePayload);
      }
      if (stepId === 4) {
        return api.executeStep4(runId, params as unknown as Step4ExecutePayload);
      }
      if (stepId === 5) {
        return api.executeStep5(runId, params as unknown as Step5ExecutePayload);
      }
      if (stepId === 6) {
        return api.executeStep6(runId, params as unknown as Step6ExecutePayload);
      }
      if (stepId === 7) {
        return api.executeStep7(runId, params as unknown as Step7ExecutePayload);
      }
      if (stepId === 8) {
        return api.executeStep8(runId, params as unknown as Step8ExecutePayload);
      }
      if (stepId === 9) {
        return api.executeStep9(runId, params as unknown as Step9ExecutePayload);
      }
      if (stepId === 10) {
        return api.executeStep10(runId, params as unknown as Step10ExecutePayload);
      }
      return api.executeStep(runId, stepId, params);
    },
    onMutate: () => toast.info(ko.toast.stepRunning),
    onSuccess: (response, variables) => {
      if (variables.stepId === 2) {
        const imageArtifact = response.artifacts.find((artifact) => artifact.artifact_type === "image_preview") ?? response.artifacts[0];
        if (imageArtifact) {
          setSelectedStep2ArtifactId(imageArtifact.id);
        }
        setStep2ViewerMode("saved");
      }
      if (variables.stepId === 3) {
        const imageArtifact = response.artifacts.find((artifact) => artifact.artifact_type === "image_preview") ?? response.artifacts[0];
        if (imageArtifact) {
          setSelectedStep3ArtifactId(imageArtifact.id);
        }
        setStep3ViewerMode("saved");
      }
      if (variables.stepId === 4) {
        const imageArtifact = response.artifacts.find((artifact) => artifact.files.some((file) => file.mime_type.startsWith("image/"))) ?? response.artifacts[0];
        if (imageArtifact) {
          setSelectedStep4ArtifactId(imageArtifact.id);
        }
        setStep4ViewerMode("mask");
      }
      if (variables.stepId === 5) {
        const imageArtifact = response.artifacts.find((artifact) => artifact.files.some((file) => file.mime_type.startsWith("image/"))) ?? response.artifacts[0];
        if (imageArtifact) {
          setSelectedStep5ArtifactId(imageArtifact.id);
        }
      }
      if (variables.stepId === 6) {
        const imageArtifact = response.artifacts.find((artifact) => artifact.files.some((file) => file.mime_type.startsWith("image/"))) ?? response.artifacts[0];
        if (imageArtifact) {
          setSelectedStep6ArtifactId(imageArtifact.id);
          setStep6Params(parseStep6Params(imageArtifact.params));
        }
        setStep6ViewerMode("saved");
      }
      if (variables.stepId === 7) {
        const imageArtifact =
          response.artifacts.find((artifact) => artifact.files.some((file) => file.mime_type.startsWith("image/"))) ??
          response.artifacts[0];
        if (imageArtifact) {
          setSelectedStep7ArtifactId(imageArtifact.id);
          setStep7Params(parseStep7Params(imageArtifact.params));
        }
        setStep7PreviewActive(false);
      }
      if (variables.stepId === 8) {
        const contoursArtifact = response.artifacts.find((artifact) => artifact.artifact_type === "contours") ?? response.artifacts[0];
        if (contoursArtifact) {
          setSelectedStep8ArtifactId(contoursArtifact.id);
        }
      }
      if (variables.stepId === 9) {
        const splitArtifact =
          response.artifacts.find(
            (artifact) =>
              artifact.artifact_type === "polygonized_contours" ||
              artifact.artifact_type === "concave_split" ||
              artifact.artifact_type === "watershed_split" ||
              artifact.artifact_type === "neck_split",
          ) ?? response.artifacts[0];
        if (splitArtifact) {
          setSelectedStep9ArtifactId(splitArtifact.id);
          setStep9Params(parseStep9Params(splitArtifact.params));
        }
        setStep9PreviewActive(false);
      }
      if (variables.stepId === 10) {
        const step10Artifact =
          response.artifacts.find((artifact) => artifact.artifact_type === "overlap_watershed_split") ?? response.artifacts[0];
        if (step10Artifact) {
          setSelectedStep10ArtifactId(step10Artifact.id);
          setStep10Params(parseStep10Params(step10Artifact.params));
        }
        setStep10PreviewActive(false);
      }
      toast.success(ko.toast.stepSuccess);
      queryClient.invalidateQueries({ queryKey: ["artifacts", runId] });
    },
    onError: () => {
      toast.error(ko.toast.stepFailure);
    },
  });

  const renameVersionMutation = useMutation({
    mutationFn: ({ artifactId, name }: { artifactId: string; name: string }) => api.renameArtifactVersion(artifactId, name),
    onSuccess: () => {
      toast.success(ko.workspace.versionRenameSuccess);
      queryClient.invalidateQueries({ queryKey: ["artifacts", runId] });
    },
    onError: (error) => {
      toast.error(getQueryErrorMessage(error));
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (artifactId: string) => api.deleteArtifactVersion(artifactId),
    onSuccess: (_, artifactId) => {
      if (selectedArtifactId === artifactId) {
        setSelectedArtifactId(null);
      }
      if (selectedStep2ArtifactId === artifactId) {
        setSelectedStep2ArtifactId(null);
      }
      if (selectedStep3ArtifactId === artifactId) {
        setSelectedStep3ArtifactId(null);
      }
      if (selectedStep4ArtifactId === artifactId) {
        setSelectedStep4ArtifactId(null);
      }
      if (selectedStep5ArtifactId === artifactId) {
        setSelectedStep5ArtifactId(null);
      }
      if (selectedStep6ArtifactId === artifactId) {
        setSelectedStep6ArtifactId(null);
      }
      if (selectedStep7ArtifactId === artifactId) {
        setSelectedStep7ArtifactId(null);
      }
      if (selectedStep8ArtifactId === artifactId) {
        setSelectedStep8ArtifactId(null);
      }
      if (selectedStep9ArtifactId === artifactId) {
        setSelectedStep9ArtifactId(null);
      }
      if (selectedStep10ArtifactId === artifactId) {
        setSelectedStep10ArtifactId(null);
      }
      toast.success(ko.workspace.versionDeleteSuccess);
      queryClient.invalidateQueries({ queryKey: ["artifacts", runId] });
    },
    onError: (error) => {
      toast.error(getQueryErrorMessage(error));
    },
  });

  const exportHistoryMutation = useMutation({
    mutationFn: async () => {
      const pixelDistance = toNumber(pixelDistanceInput);
      const realUm = toNumber(realUmInput);
      const step2PresetParams = parseStep2Params((selectedStep2Artifact ?? latestStep2Artifact)?.params ?? step2Params);
      const step3PresetParams = parseStep3Params((selectedStep3Artifact ?? latestStep3Artifact)?.params ?? step3Params);
      const step4PresetParams = parseStep4Params((selectedStep4Artifact ?? latestStep4Artifact)?.params ?? step4Params);
      const step6PresetParams = parseStep6Params((selectedStep6Artifact ?? latestStep6Artifact)?.params ?? step6Params);
      const step7PresetParams = parseStep7Params((selectedStep7Artifact ?? latestStep7Artifact)?.params ?? step7Params);
      const preset: StepsPresetFileV1 = {
        schema_version: 1,
        preset_type: "step_params_1_8",
        exported_at: new Date().toISOString(),
        source_run_id: runId,
        source_image_id: runQuery.data?.image_id ?? null,
        steps: {
          "1": {
            crop_bottom_px: Math.max(0, Math.round(cropBottomPx)),
            pixel_distance: pixelDistance,
            real_um: realUm,
            rectangle_visible: rectangleVisible,
            auto_apply_rectangle_width: autoApplyRectangleWidth,
          },
          "2": { ...step2PresetParams },
          "3": { ...step3PresetParams },
          "4": { ...step4PresetParams },
          // 5단계 브러시는 이미지/마스크 상태에 강하게 의존하므로 파라미터 프리셋에서는 제외한다.
          "5": {},
          "6": { ...step6PresetParams },
          "7": { ...step7PresetParams },
          "8": {},
        },
      };
      return new Blob([JSON.stringify(preset, null, 2)], { type: "application/json;charset=utf-8" });
    },
    onMutate: () => toast.info(ko.workspace.historyExportRunning),
    onSuccess: (blob) => {
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `run-${runId}-1~8단계-파라미터.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      toast.success(ko.workspace.historyExportSuccess);
    },
    onError: (error) => {
      toast.error(`${ko.workspace.historyExportFailurePrefix}: ${getQueryErrorMessage(error)}`);
    },
  });

  const importHistoryMutation = useMutation({
    mutationFn: async (file: File) => {
      const raw = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("파라미터 파일 형식이 올바르지 않습니다.");
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("파라미터 파일 형식이 올바르지 않습니다.");
      }
      const payload = parsed as Partial<StepsPresetFileV1>;
      let steps: Record<string, unknown> | null = null;

      if (payload.steps && typeof payload.steps === "object") {
        steps = payload.steps as Record<string, unknown>;
      } else if (Array.isArray((parsed as { artifacts?: unknown }).artifacts)) {
        const artifacts = (parsed as { artifacts: unknown[] }).artifacts;
        const latestByStep = new Map<number, LegacyHistoryArtifactItem>();
        for (const item of artifacts) {
          if (!item || typeof item !== "object") {
            continue;
          }
          const artifact = item as LegacyHistoryArtifactItem;
          const stepId = toNumber(artifact.step_id);
          if (stepId == null) {
            continue;
          }
          const step = Math.round(stepId);
          if (step < 1 || step > 8) {
            continue;
          }
          const current = latestByStep.get(step);
          const nextVersion = toNumber(artifact.version) ?? 0;
          const currentVersion = current ? toNumber(current.version) ?? 0 : -1;
          if (!current || nextVersion >= currentVersion) {
            latestByStep.set(step, artifact);
          }
        }
        steps = {};
        for (const [step, artifact] of latestByStep.entries()) {
          if (artifact.params && typeof artifact.params === "object") {
            steps[String(step)] = artifact.params;
          }
        }
      }

      if (!steps) {
        throw new Error("1~8단계 파라미터 항목이 없습니다.");
      }

      let appliedCount = 0;

      // 저장된 버전 params가 다시 덮어쓰는 것을 막기 위해 먼저 선택 상태를 해제한다.
      setSelectedStep2ArtifactId(null);
      setSelectedStep3ArtifactId(null);
      setSelectedStep4ArtifactId(null);
      setSelectedStep6ArtifactId(null);
      setSelectedStep7ArtifactId(null);
      setSelectedStep8ArtifactId(null);

      const step1Raw = unwrapStepParamPayload(steps["1"]);
      if (step1Raw) {
        const obj = step1Raw;
        setCropBottomPx(clamp(Math.round(toNumber(obj.crop_bottom_px) ?? cropBottomPx), 0, 1_000_000));
        setPixelDistanceInput(toNumber(obj.pixel_distance) == null ? "" : String(toNumber(obj.pixel_distance)));
        setRealUmInput(toNumber(obj.real_um) == null ? "" : String(toNumber(obj.real_um)));
        setMeasurementPoints([]);
        setRectangleVisible(toBoolean(obj.rectangle_visible, rectangleVisible));
        setAutoApplyRectangleWidth(toBoolean(obj.auto_apply_rectangle_width, autoApplyRectangleWidth));
        appliedCount += 1;
      }

      const step2Raw = unwrapStepParamPayload(steps["2"]);
      if (step2Raw) {
        setStep2Params(parseStep2Params(step2Raw));
        appliedCount += 1;
      }

      const step3Raw = unwrapStepParamPayload(steps["3"]);
      if (step3Raw) {
        setStep3Params(parseStep3Params(step3Raw));
        appliedCount += 1;
      }

      const step4Raw = unwrapStepParamPayload(steps["4"]);
      if (step4Raw) {
        setStep4Params(parseStep4Params(step4Raw));
        appliedCount += 1;
      }

      // 5단계 브러시 설정은 파라미터 프리셋 적용 대상에서 제외한다.

      const step6Raw = unwrapStepParamPayload(steps["6"]);
      if (step6Raw) {
        setStep6Params(parseStep6Params(step6Raw));
        appliedCount += 1;
      }

      const step7Raw = unwrapStepParamPayload(steps["7"]);
      if (step7Raw) {
        setStep7Params(parseStep7Params(step7Raw));
        appliedCount += 1;
      }

      if (appliedCount <= 0) {
        throw new Error("적용할 1~8단계 파라미터가 없습니다.");
      }
      return { run_id: runId, imported_count: appliedCount };
    },
    onMutate: () => toast.info(ko.workspace.historyImportRunning),
    onSuccess: (result) => {
      setCurrentStep(1);
      setSelectedStep2ArtifactId(null);
      setSelectedStep3ArtifactId(null);
      setSelectedStep4ArtifactId(null);
      setSelectedStep6ArtifactId(null);
      setSelectedStep7ArtifactId(null);
      setSelectedStep8ArtifactId(null);
      setStep2ViewerMode("input");
      setStep3ViewerMode("input");
      setStep4ViewerMode("input");
      setStep6ViewerMode("base");
      setStep7PreviewActive(false);
      setStep7BackgroundMode("original");
      setStep8BackgroundMode("original");
      setStep8SelectedContourId(null);
      toast.success(ko.workspace.historyImportSuccessTemplate.replace("{{count}}", String(result.imported_count)));
    },
    onError: (error) => {
      toast.error(`${ko.workspace.historyImportFailurePrefix}: ${getQueryErrorMessage(error)}`);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await api.uploadImage(file);
      }
    },
    onMutate: () => toast.info(ko.toast.uploadRunning),
    onSuccess: () => {
      toast.success(ko.toast.uploadSuccess);
      queryClient.invalidateQueries({ queryKey: ["images"] });
    },
    onError: (error) => {
      toast.error(getUploadErrorMessage(error));
    },
  });

  const createRunMutation = useMutation({
    mutationFn: async (imageId: string) => {
      try {
        return await api.createRun(imageId);
      } catch (error) {
        const runs = await api.listRuns(imageId);
        if (runs.length > 0) {
          return runs[0];
        }
        throw error;
      }
    },
    onSuccess: (run) => {
      toast.success(ko.workspace.createRunSuccess);
      reset();
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${run.id}`);
    },
    onError: (error) => {
      toast.error(getRunCreateErrorMessage(error));
    },
  });

  const selectedArtifact = useMemo(() => {
    if (!selectedArtifactId) {
      return null;
    }
    return step1Artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
  }, [selectedArtifactId, step1Artifacts]);

  const selectedStep2Artifact = useMemo(() => {
    if (!selectedStep2ArtifactId) {
      return null;
    }
    return step2Artifacts.find((artifact) => artifact.id === selectedStep2ArtifactId) ?? null;
  }, [selectedStep2ArtifactId, step2Artifacts]);

  const selectedStep3Artifact = useMemo(() => {
    if (!selectedStep3ArtifactId) {
      return null;
    }
    return step3Artifacts.find((artifact) => artifact.id === selectedStep3ArtifactId) ?? null;
  }, [selectedStep3ArtifactId, step3Artifacts]);

  const selectedStep4Artifact = useMemo(() => {
    if (!selectedStep4ArtifactId) {
      return null;
    }
    return step4Artifacts.find((artifact) => artifact.id === selectedStep4ArtifactId) ?? null;
  }, [selectedStep4ArtifactId, step4Artifacts]);

  const selectedStep5Artifact = useMemo(() => {
    if (!selectedStep5ArtifactId) {
      return null;
    }
    return step5Artifacts.find((artifact) => artifact.id === selectedStep5ArtifactId) ?? null;
  }, [selectedStep5ArtifactId, step5Artifacts]);

  const selectedStep6Artifact = useMemo(() => {
    if (!selectedStep6ArtifactId) {
      return null;
    }
    return step6Artifacts.find((artifact) => artifact.id === selectedStep6ArtifactId) ?? null;
  }, [selectedStep6ArtifactId, step6Artifacts]);

  const selectedStep7Artifact = useMemo(() => {
    if (!selectedStep7ArtifactId) {
      return null;
    }
    return step7Artifacts.find((artifact) => artifact.id === selectedStep7ArtifactId) ?? null;
  }, [selectedStep7ArtifactId, step7Artifacts]);

  const selectedStep8Artifact = useMemo(() => {
    if (!selectedStep8ArtifactId) {
      return null;
    }
    return step8Artifacts.find((artifact) => artifact.id === selectedStep8ArtifactId) ?? null;
  }, [selectedStep8ArtifactId, step8Artifacts]);

  const selectedStep9Artifact = useMemo(() => {
    if (!selectedStep9ArtifactId) {
      return null;
    }
    return step9Artifacts.find((artifact) => artifact.id === selectedStep9ArtifactId) ?? null;
  }, [selectedStep9ArtifactId, step9Artifacts]);

  const selectedStep10Artifact = useMemo(() => {
    if (!selectedStep10ArtifactId) {
      return null;
    }
    return step10Artifacts.find((artifact) => artifact.id === selectedStep10ArtifactId) ?? null;
  }, [selectedStep10ArtifactId, step10Artifacts]);

  const latestStep1Artifact = step1Artifacts[0] ?? null;
  const latestStep2Artifact = step2Artifacts[0] ?? null;
  const latestStep3Artifact = step3Artifacts[0] ?? null;
  const latestStep4Artifact = step4Artifacts[0] ?? null;
  const latestStep5Artifact = step5Artifacts[0] ?? null;
  const latestStep6Artifact = step6Artifacts[0] ?? null;
  const latestStep7Artifact = step7Artifacts[0] ?? null;
  const latestStep8Artifact = step8Artifacts[0] ?? null;
  const latestStep9Artifact = step9Artifacts[0] ?? null;
  const latestStep10Artifact = step10Artifacts[0] ?? null;

  const step2InputImageUrl = useMemo(() => {
    if (!imageQuery.data) {
      return undefined;
    }
    if (latestStep1Artifact) {
      const url = getArtifactImageUrl(latestStep1Artifact);
      if (url) {
        return url;
      }
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, latestStep1Artifact]);

  const maskViewerCroppedOriginalImageUrl = useMemo(() => {
    const preferredStep1Artifact = selectedArtifact ?? latestStep1Artifact;
    if (preferredStep1Artifact) {
      const preferredUrl = getArtifactImageUrl(preferredStep1Artifact);
      if (preferredUrl) {
        return preferredUrl;
      }
    }
    if (latestStep1Artifact && preferredStep1Artifact?.id !== latestStep1Artifact.id) {
      const latestUrl = getArtifactImageUrl(latestStep1Artifact);
      if (latestUrl) {
        return latestUrl;
      }
    }
    return undefined;
  }, [latestStep1Artifact, selectedArtifact]);

  const step2SavedImageUrl = useMemo(() => {
    const target = selectedStep2Artifact ?? latestStep2Artifact;
    if (!target) {
      return undefined;
    }
    return getArtifactImageUrl(target);
  }, [latestStep2Artifact, selectedStep2Artifact]);

  const step3InputArtifact = selectedStep2Artifact ?? latestStep2Artifact;
  const step3InputImageUrl = useMemo(() => {
    if (!step3InputArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step3InputArtifact);
  }, [step3InputArtifact]);

  const step3SavedImageUrl = useMemo(() => {
    const target = selectedStep3Artifact ?? latestStep3Artifact;
    if (!target) {
      return undefined;
    }
    return getArtifactImageUrl(target);
  }, [latestStep3Artifact, selectedStep3Artifact]);

  const step4InputArtifact = selectedStep3Artifact ?? latestStep3Artifact;
  const step4InputImageUrl = useMemo(() => {
    if (!step4InputArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step4InputArtifact);
  }, [step4InputArtifact]);

  const step4SavedImageUrl = useMemo(() => {
    const target = selectedStep4Artifact ?? latestStep4Artifact;
    if (!target) {
      return undefined;
    }
    return getArtifactImageUrl(target);
  }, [latestStep4Artifact, selectedStep4Artifact]);

  const step5BaseMaskArtifact = selectedStep4Artifact ?? latestStep4Artifact;
  const step5BaseMaskUrl = useMemo(() => {
    if (!step5BaseMaskArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step5BaseMaskArtifact);
  }, [step5BaseMaskArtifact]);

  const step5MaskSourceArtifact = selectedStep5Artifact ?? latestStep5Artifact;
  const step5MaskSourceUrl = useMemo(() => {
    if (step5MaskSourceArtifact) {
      const url = getArtifactImageUrl(step5MaskSourceArtifact);
      if (url) {
        return url;
      }
    }
    return step5BaseMaskUrl;
  }, [step5BaseMaskUrl, step5MaskSourceArtifact]);

  const step5ContextImageUrl = useMemo(() => {
    if (maskViewerCroppedOriginalImageUrl) {
      return maskViewerCroppedOriginalImageUrl;
    }
    if (step4InputImageUrl) {
      return step4InputImageUrl;
    }
    if (step3InputImageUrl) {
      return step3InputImageUrl;
    }
    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, maskViewerCroppedOriginalImageUrl, step3InputImageUrl, step4InputImageUrl]);

  const step5BaseMaskArtifactId = useMemo(() => {
    const selectedBase = selectedStep5Artifact?.params.base_mask_artifact_id;
    if (typeof selectedBase === "string" && selectedBase.trim().length > 0) {
      return selectedBase.trim();
    }
    return step5BaseMaskArtifact?.id ?? null;
  }, [selectedStep5Artifact?.params.base_mask_artifact_id, step5BaseMaskArtifact?.id]);

  const step6BaseMaskArtifact = selectedStep5Artifact ?? latestStep5Artifact;
  const step6BaseMaskUrl = useMemo(() => {
    if (!step6BaseMaskArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step6BaseMaskArtifact);
  }, [step6BaseMaskArtifact]);

  const step6SavedMaskUrl = useMemo(() => {
    const target = selectedStep6Artifact ?? latestStep6Artifact;
    if (!target) {
      return undefined;
    }
    return getArtifactImageUrl(target);
  }, [latestStep6Artifact, selectedStep6Artifact]);

  const step6InputImageUrl = useMemo(() => {
    if (maskViewerCroppedOriginalImageUrl) {
      return maskViewerCroppedOriginalImageUrl;
    }
    if (step4InputImageUrl) {
      return step4InputImageUrl;
    }
    if (step3InputImageUrl) {
      return step3InputImageUrl;
    }
    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, maskViewerCroppedOriginalImageUrl, step3InputImageUrl, step4InputImageUrl]);

  const step7BaseMaskArtifact = selectedStep6Artifact ?? latestStep6Artifact;
  const step7BaseMaskArtifactId = step7BaseMaskArtifact?.id ?? null;
  const step7BaseMaskUrl = useMemo(() => {
    if (!step7BaseMaskArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step7BaseMaskArtifact);
  }, [step7BaseMaskArtifact]);

  const step7InputImageUrl = useMemo(() => {
    if (maskViewerCroppedOriginalImageUrl) {
      return maskViewerCroppedOriginalImageUrl;
    }
    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, maskViewerCroppedOriginalImageUrl]);

  const step7BinaryBackgroundUrl = useMemo(() => {
    if (step7BaseMaskUrl) {
      return step7BaseMaskUrl;
    }
    if (step4InputImageUrl) {
      return step4InputImageUrl;
    }
    return undefined;
  }, [step4InputImageUrl, step7BaseMaskUrl]);

  const step7ViewerBackgroundUrl = useMemo(() => {
    if (step7BackgroundMode === "binary") {
      return step7BinaryBackgroundUrl ?? step7InputImageUrl;
    }
    return step7InputImageUrl;
  }, [step7BackgroundMode, step7BinaryBackgroundUrl, step7InputImageUrl]);

  const step7SavedSolidMaskUrl = useMemo(() => {
    const target = selectedStep7Artifact ?? latestStep7Artifact;
    if (!target) {
      return undefined;
    }
    return (
      getArtifactImageUrlByName(target, ["mask_solid"]) ??
      getArtifactImageUrlByName(target, ["solid"]) ??
      getArtifactImageUrl(target)
    );
  }, [latestStep7Artifact, selectedStep7Artifact]);

  const step7SavedOuterMaskUrl = useMemo(() => {
    const target = selectedStep7Artifact ?? latestStep7Artifact;
    if (!target) {
      return undefined;
    }
    return (
      getArtifactImageUrlByName(target, ["mask_outer"]) ??
      getArtifactImageUrlByName(target, ["outer"]) ??
      getArtifactImageUrl(target)
    );
  }, [latestStep7Artifact, selectedStep7Artifact]);

  const step7PreviewSolidMaskUrl = step7PreviewData ? `data:image/png;base64,${step7PreviewData.solid_png_base64}` : undefined;
  const step7PreviewOuterMaskUrl = step7PreviewData ? `data:image/png;base64,${step7PreviewData.outer_png_base64}` : undefined;

  const step7ActiveSolidMaskUrl = step7PreviewActive ? step7PreviewSolidMaskUrl : step7SavedSolidMaskUrl;
  const step7ActiveOuterMaskUrl = step7PreviewActive ? step7PreviewOuterMaskUrl : step7SavedOuterMaskUrl;

  const step7ActiveMetrics = useMemo<Step7Metrics | null>(() => {
    if (step7PreviewActive && step7PreviewData) {
      return {
        solid_area_px: step7PreviewData.metrics.solid_area_px,
        outer_area_px: step7PreviewData.metrics.outer_area_px,
        porosity: step7PreviewData.metrics.porosity,
      };
    }
    const target = selectedStep7Artifact ?? latestStep7Artifact;
    const metricsRaw = target?.params?.metrics;
    if (!metricsRaw || typeof metricsRaw !== "object") {
      return null;
    }
    const metricsObj = metricsRaw as Record<string, unknown>;
    const solid = toNumber(metricsObj.solid_area_px);
    const outer = toNumber(metricsObj.outer_area_px);
    const porosity = toNumber(metricsObj.porosity);
    if (solid == null || outer == null || porosity == null) {
      return null;
    }
    return {
      solid_area_px: solid,
      outer_area_px: outer,
      porosity,
    };
  }, [latestStep7Artifact, selectedStep7Artifact, step7PreviewActive, step7PreviewData]);

  const step8BaseMaskArtifact = selectedStep6Artifact ?? latestStep6Artifact ?? selectedStep5Artifact ?? latestStep5Artifact;
  const step8BaseMaskArtifactId = step8BaseMaskArtifact?.id ?? null;
  const step8ActiveArtifact = selectedStep8Artifact ?? latestStep8Artifact;

  const step8OriginalBackgroundUrl = useMemo(() => {
    if (maskViewerCroppedOriginalImageUrl) {
      return maskViewerCroppedOriginalImageUrl;
    }
    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, maskViewerCroppedOriginalImageUrl]);

  const step8BinaryBackgroundUrl = useMemo(() => {
    const linkedStep6ArtifactId =
      typeof step8ActiveArtifact?.params?.base_mask_artifact_id === "string" && step8ActiveArtifact.params.base_mask_artifact_id.trim().length > 0
        ? step8ActiveArtifact.params.base_mask_artifact_id.trim()
        : null;
    const linkedStep6Artifact =
      linkedStep6ArtifactId != null
        ? step6Artifacts.find((artifact) => artifact.id === linkedStep6ArtifactId) ?? null
        : null;
    const step6MaskArtifact = linkedStep6Artifact ?? selectedStep6Artifact ?? latestStep6Artifact;
    if (!step6MaskArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step6MaskArtifact);
  }, [latestStep6Artifact, selectedStep6Artifact, step6Artifacts, step8ActiveArtifact]);

  const step8ViewerImageUrl = useMemo(() => {
    if (step8BackgroundMode === "binary") {
      return step8BinaryBackgroundUrl ?? step8OriginalBackgroundUrl;
    }
    return step8OriginalBackgroundUrl;
  }, [step8BackgroundMode, step8BinaryBackgroundUrl, step8OriginalBackgroundUrl]);

  const step9BaseMaskArtifact = selectedStep6Artifact ?? latestStep6Artifact;
  const step9BaseMaskArtifactId = step9BaseMaskArtifact?.id ?? null;
  const step9MaskBackgroundUrl = useMemo(() => {
    if (!step9BaseMaskArtifact) {
      return undefined;
    }
    return getArtifactImageUrl(step9BaseMaskArtifact);
  }, [step9BaseMaskArtifact]);

  const step9GrayBackgroundUrl = useMemo(() => {
    if (step4InputImageUrl) {
      return step4InputImageUrl;
    }
    if (step3InputImageUrl) {
      return step3InputImageUrl;
    }
    if (maskViewerCroppedOriginalImageUrl) {
      return maskViewerCroppedOriginalImageUrl;
    }
    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, maskViewerCroppedOriginalImageUrl, step3InputImageUrl, step4InputImageUrl]);

  const step9ViewerImageUrl = useMemo(
    () => step9GrayBackgroundUrl ?? step9MaskBackgroundUrl,
    [step9GrayBackgroundUrl, step9MaskBackgroundUrl],
  );

  const step9ActiveArtifact = selectedStep9Artifact ?? latestStep9Artifact;
  const step10ActiveArtifact = selectedStep10Artifact ?? latestStep10Artifact;

  useEffect(() => {
    if (step7BackgroundMode === "binary" && !step7BinaryBackgroundUrl) {
      setStep7BackgroundMode("original");
    }
  }, [step7BackgroundMode, step7BinaryBackgroundUrl]);

  useEffect(() => {
    if (step8BackgroundMode === "binary" && !step8BinaryBackgroundUrl) {
      setStep8BackgroundMode("original");
    }
  }, [step8BackgroundMode, step8BinaryBackgroundUrl]);

  useEffect(() => {
    if (step9BackgroundMode === "mask" && !step9MaskBackgroundUrl) {
      setStep9BackgroundMode("gray");
    }
  }, [step9BackgroundMode, step9MaskBackgroundUrl]);

  useEffect(() => {
    if (!step8ActiveArtifact) {
      setStep8ContoursData(null);
      setStep8ContoursLoading(false);
      setStep8SelectedContourId(null);
      return;
    }
    const jsonFileIndex = getArtifactJsonFileIndex(step8ActiveArtifact, "contours");
    if (jsonFileIndex == null) {
      setStep8ContoursData(null);
      setStep8ContoursLoading(false);
      setStep8SelectedContourId(null);
      return;
    }

    let cancelled = false;
    setStep8ContoursLoading(true);
    setStep8SelectedContourId(null);
    void api
      .getArtifactFileJson<Step8ContoursJson>(step8ActiveArtifact.id, jsonFileIndex)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setStep8ContoursData(payload);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setStep8ContoursData(null);
      })
      .finally(() => {
        if (!cancelled) {
          setStep8ContoursLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [step8ActiveArtifact]);

  useEffect(() => {
    if (!step9ActiveArtifact) {
      setStep9SavedCutsData(null);
      return;
    }
    const jsonFileIndex = getArtifactJsonFileIndex(step9ActiveArtifact, "polygons");
    if (jsonFileIndex == null) {
      setStep9SavedCutsData(null);
      return;
    }

    let cancelled = false;
    void api
      .getArtifactFileJson<Step9PolygonsJson>(step9ActiveArtifact.id, jsonFileIndex)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setStep9SavedCutsData(payload);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setStep9SavedCutsData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [step9ActiveArtifact]);

  useEffect(() => {
    if (!step10ActiveArtifact) {
      setStep10SavedCutsData(null);
      return;
    }
    const jsonFileIndex =
      getArtifactJsonFileIndex(step10ActiveArtifact, "split_lines") ??
      getArtifactJsonFileIndex(step10ActiveArtifact, "cuts");
    if (jsonFileIndex == null) {
      setStep10SavedCutsData(null);
      return;
    }
    let cancelled = false;
    void api
      .getArtifactFileJson<Step10CutsJson>(step10ActiveArtifact.id, jsonFileIndex)
      .then((payload) => {
        if (!cancelled) {
          setStep10SavedCutsData(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStep10SavedCutsData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [step10ActiveArtifact]);

  useEffect(() => {
    if (!selectedStep5ArtifactId) {
      return;
    }
    const exists = step5Artifacts.some((artifact) => artifact.id === selectedStep5ArtifactId);
    if (!exists) {
      setSelectedStep5ArtifactId(null);
    }
  }, [selectedStep5ArtifactId, step5Artifacts]);

  useEffect(() => {
    if (currentStep !== 5 || selectedStep5ArtifactId) {
      return;
    }
    if (latestStep5Artifact) {
      setSelectedStep5ArtifactId(latestStep5Artifact.id);
    }
  }, [currentStep, latestStep5Artifact, selectedStep5ArtifactId]);

  useEffect(() => {
    if (!selectedStep6ArtifactId) {
      return;
    }
    const exists = step6Artifacts.some((artifact) => artifact.id === selectedStep6ArtifactId);
    if (!exists) {
      setSelectedStep6ArtifactId(null);
    }
  }, [selectedStep6ArtifactId, step6Artifacts]);

  useEffect(() => {
    if (currentStep !== 6 || selectedStep6ArtifactId) {
      return;
    }
    if (latestStep6Artifact) {
      setSelectedStep6ArtifactId(latestStep6Artifact.id);
    }
  }, [currentStep, latestStep6Artifact, selectedStep6ArtifactId]);

  useEffect(() => {
    if (!selectedStep7ArtifactId) {
      return;
    }
    const exists = step7Artifacts.some((artifact) => artifact.id === selectedStep7ArtifactId);
    if (!exists) {
      setSelectedStep7ArtifactId(null);
    }
  }, [selectedStep7ArtifactId, step7Artifacts]);

  useEffect(() => {
    if (currentStep !== 7 || selectedStep7ArtifactId) {
      return;
    }
    if (latestStep7Artifact) {
      setSelectedStep7ArtifactId(latestStep7Artifact.id);
    }
  }, [currentStep, latestStep7Artifact, selectedStep7ArtifactId]);

  useEffect(() => {
    if (!selectedStep8ArtifactId) {
      return;
    }
    const exists = step8Artifacts.some((artifact) => artifact.id === selectedStep8ArtifactId);
    if (!exists) {
      setSelectedStep8ArtifactId(null);
    }
  }, [selectedStep8ArtifactId, step8Artifacts]);

  useEffect(() => {
    if (currentStep !== 8 || selectedStep8ArtifactId) {
      return;
    }
    if (latestStep8Artifact) {
      setSelectedStep8ArtifactId(latestStep8Artifact.id);
    }
  }, [currentStep, latestStep8Artifact, selectedStep8ArtifactId]);

  useEffect(() => {
    if (!selectedStep9ArtifactId) {
      return;
    }
    const exists = step9Artifacts.some((artifact) => artifact.id === selectedStep9ArtifactId);
    if (!exists) {
      setSelectedStep9ArtifactId(null);
    }
  }, [selectedStep9ArtifactId, step9Artifacts]);

  useEffect(() => {
    if (currentStep !== 9 || selectedStep9ArtifactId) {
      return;
    }
    if (latestStep9Artifact) {
      setSelectedStep9ArtifactId(latestStep9Artifact.id);
    }
  }, [currentStep, latestStep9Artifact, selectedStep9ArtifactId]);

  useEffect(() => {
    if (!selectedStep10ArtifactId) {
      return;
    }
    const exists = step10Artifacts.some((artifact) => artifact.id === selectedStep10ArtifactId);
    if (!exists) {
      setSelectedStep10ArtifactId(null);
    }
  }, [selectedStep10ArtifactId, step10Artifacts]);

  useEffect(() => {
    if (currentStep !== 10 || selectedStep10ArtifactId) {
      return;
    }
    if (latestStep10Artifact) {
      setSelectedStep10ArtifactId(latestStep10Artifact.id);
    }
  }, [currentStep, latestStep10Artifact, selectedStep10ArtifactId]);

  useEffect(() => {
    if (currentStep !== 10) {
      return;
    }
    const linkedFromCuts =
      typeof step10SavedCutsData?.step9_artifact_id === "string" && step10SavedCutsData.step9_artifact_id.trim().length > 0
        ? step10SavedCutsData.step9_artifact_id.trim()
        : null;
    const linkedFromParams =
      typeof step10ActiveArtifact?.params?.step9_artifact_id === "string" && step10ActiveArtifact.params.step9_artifact_id.trim().length > 0
        ? step10ActiveArtifact.params.step9_artifact_id.trim()
        : null;
    const linkedStep9ArtifactId = linkedFromCuts ?? linkedFromParams;
    if (!linkedStep9ArtifactId) {
      return;
    }
    if (selectedStep9ArtifactId === linkedStep9ArtifactId) {
      return;
    }
    const exists = step9Artifacts.some((artifact) => artifact.id === linkedStep9ArtifactId);
    if (!exists) {
      return;
    }
    setSelectedStep9ArtifactId(linkedStep9ArtifactId);
    setStep9PreviewActive(false);
  }, [
    currentStep,
    selectedStep9ArtifactId,
    step9Artifacts,
    step10ActiveArtifact,
    step10SavedCutsData?.step9_artifact_id,
  ]);

  const nonStepViewerImageUrl = useMemo(() => {
    if (
      currentStep === 1 ||
      currentStep === 2 ||
      currentStep === 3 ||
      currentStep === 4 ||
      currentStep === 5 ||
      currentStep === 6 ||
      currentStep === 7 ||
      currentStep === 8 ||
      currentStep === 9 ||
      currentStep === 10
    ) {
      return undefined;
    }

    const currentStepImage = firstImageArtifact(selectedStepArtifacts);
    if (currentStepImage) {
      return getArtifactImageUrl(currentStepImage);
    }

    let pointer: StepId | undefined = currentStep;
    while (pointer) {
      const prerequisite: StepId | undefined = STEP_PREREQUISITES[pointer];
      if (!prerequisite) {
        break;
      }
      const artifacts = extractStepArtifacts(artifactsQuery.data, prerequisite);
      const candidate = firstImageArtifact(artifacts);
      if (candidate) {
        return getArtifactImageUrl(candidate);
      }
      pointer = prerequisite;
    }

    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [artifactsQuery.data, currentStep, imageQuery.data, selectedStepArtifacts]);

  const currentStepLocked = unlockedSteps.get(currentStep) === false;
  const currentStepLockMessage = currentStepLocked ? getStepLockMessage(currentStep) ?? "" : "";

  const step9HasInputs = Boolean(selectedStep8Artifact ?? latestStep8Artifact);
  const step9PreviewPolygons = useMemo<Step9Polygon[]>(
    () => (step9PreviewActive ? step9PreviewData?.polygons ?? [] : []),
    [step9PreviewActive, step9PreviewData?.polygons],
  );
  const step9SavedPolygons = useMemo<Step9Polygon[]>(() => {
    return Array.isArray(step9SavedCutsData?.polygons) ? step9SavedCutsData.polygons : [];
  }, [step9SavedCutsData?.polygons]);
  const step9PolygonContours = useMemo<Step8Contour[]>(() => {
    const source = step9PreviewActive ? step9PreviewPolygons : step9SavedPolygons;
    return source
      .map((polygon, index) => mapStep9PolygonToContour(polygon, index))
      .filter((item): item is Step8Contour => item !== null);
  }, [step9PreviewActive, step9PreviewPolygons, step9SavedPolygons]);

  const step9ImageSizeHint = useMemo(() => {
    const width = toNumber(step9PreviewActive ? step9PreviewData?.image_width : step9SavedCutsData?.image_width);
    const height = toNumber(step9PreviewActive ? step9PreviewData?.image_height : step9SavedCutsData?.image_height);
    if (width == null || height == null) {
      return null;
    }
    return { width, height };
  }, [
    step9PreviewActive,
    step9PreviewData?.image_height,
    step9PreviewData?.image_width,
    step9SavedCutsData?.image_height,
    step9SavedCutsData?.image_width,
  ]);

  const step9PolygonCount = useMemo(() => {
    if (step9PreviewActive) {
      return Number(step9PreviewData?.polygon_count ?? step9PreviewPolygons.length ?? 0);
    }
    return Number(step9SavedCutsData?.polygon_count ?? step9SavedPolygons.length ?? 0);
  }, [step9PreviewActive, step9PreviewData?.polygon_count, step9PreviewPolygons.length, step9SavedCutsData?.polygon_count, step9SavedPolygons.length]);

  const handleStep9Preview = async () => {
    if (currentStepLocked || !step9HasInputs) {
      return;
    }
    setStep9PreviewLoading(true);
    toast.info(ko.step9.previewRunning, { id: "step9-preview-status" });
    try {
      const payload = toStep9PreviewPayload(step9Params, (selectedStep8Artifact ?? latestStep8Artifact)?.id ?? null);
      const response = await api.previewStep9(runId, payload);
      setStep9PreviewData(response);
      setStep9PreviewActive(true);
      toast.success(ko.step9.previewSuccess, { id: "step9-preview-status" });
    } catch (error) {
      toast.error(`${ko.step9.previewFailurePrefix}: ${getQueryErrorMessage(error)}`, { id: "step9-preview-status" });
    } finally {
      setStep9PreviewLoading(false);
    }
  };

  const step10HasInputs = Boolean(selectedStep9Artifact ?? latestStep9Artifact);
  const step10BasePolygonArtifact = selectedStep9Artifact ?? latestStep9Artifact;
  const step10GrayArtifact = selectedStep3Artifact ?? latestStep3Artifact;
  const step10HasGrayInput = Boolean(step10GrayArtifact);

  const step10ViewerImageUrl = useMemo(() => {
    if (step3SavedImageUrl) {
      return step3SavedImageUrl;
    }
    if (step4InputImageUrl) {
      return step4InputImageUrl;
    }
    if (maskViewerCroppedOriginalImageUrl) {
      return maskViewerCroppedOriginalImageUrl;
    }
    if (!imageQuery.data) {
      return undefined;
    }
    return api.getImageFileUrl(imageQuery.data.id);
  }, [imageQuery.data, maskViewerCroppedOriginalImageUrl, step3SavedImageUrl, step4InputImageUrl]);

  const step10PreviewCuts = useMemo<Step10SplitLine[]>(() => {
    if (!step10PreviewActive) {
      return [];
    }
    return Array.isArray(step10PreviewData?.split_lines) ? step10PreviewData.split_lines : [];
  }, [step10PreviewActive, step10PreviewData?.split_lines]);

  const step10SavedCuts = useMemo<Step10SplitLine[]>(() => {
    return Array.isArray(step10SavedCutsData?.split_lines) ? step10SavedCutsData.split_lines : [];
  }, [step10SavedCutsData?.split_lines]);

  const step10DisplayedCuts = useMemo<Step10SplitLine[]>(
    () => (step10PreviewActive ? step10PreviewCuts : step10SavedCuts),
    [step10PreviewActive, step10PreviewCuts, step10SavedCuts],
  );
  const step10BasePolygonContours = useMemo<Step8Contour[]>(() => {
    return step9SavedPolygons
      .map((polygon, index) => mapStep9PolygonToContour(polygon, index))
      .filter((item): item is Step8Contour => item !== null);
  }, [step9SavedPolygons]);

  const step10PreviewLabelsUrl = step10PreviewData?.preview_labels_url ?? null;
  const step10SavedLabelsUrl = useMemo(() => {
    if (!step10ActiveArtifact) {
      return null;
    }
    return (
      getArtifactImageUrlByName(step10ActiveArtifact, ["preview_labels_vis"]) ??
      getArtifactImageUrlByName(step10ActiveArtifact, ["labels_vis"]) ??
      null
    );
  }, [step10ActiveArtifact]);
  const step10DisplayedLabelsUrl = step10PreviewActive ? step10PreviewLabelsUrl : step10SavedLabelsUrl;

  const step10LabelAreas = useMemo<Record<string, number>>(() => {
    if (step10PreviewActive) {
      return (step10PreviewData?.label_areas as Record<string, number> | undefined) ?? {};
    }
    return (step10SavedCutsData?.label_areas as Record<string, number> | undefined) ?? {};
  }, [step10PreviewActive, step10PreviewData?.label_areas, step10SavedCutsData?.label_areas]);

  const step10HoveredFragmentAreaPx = useMemo(() => {
    if (step10HoveredFragmentId == null) {
      return null;
    }
    const raw = step10LabelAreas[String(step10HoveredFragmentId)];
    return typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : null;
  }, [step10HoveredFragmentId, step10LabelAreas]);

  const step10CutCount = useMemo(() => {
    if (step10PreviewActive) {
      return Math.max(step10DisplayedCuts.length, Number(step10PreviewData?.split_line_count ?? 0));
    }
    return Math.max(step10DisplayedCuts.length, Number(step10SavedCutsData?.split_line_count ?? 0));
  }, [step10DisplayedCuts.length, step10PreviewActive, step10PreviewData?.split_line_count, step10SavedCutsData?.split_line_count]);

  const step10LabelCount = useMemo(() => {
    if (step10PreviewActive) {
      return Number(step10PreviewData?.label_count ?? 0);
    }
    return Number(step10SavedCutsData?.label_count ?? 0);
  }, [step10PreviewActive, step10PreviewData?.label_count, step10SavedCutsData?.label_count]);

  const step10QcWarnings = useMemo<string[]>(() => {
    const qcRaw = (step10PreviewActive ? step10PreviewData?.qc : step10SavedCutsData?.qc) as Record<string, unknown> | undefined;
    const warningsRaw = qcRaw?.warnings;
    if (!Array.isArray(warningsRaw)) {
      return [];
    }
    return warningsRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }, [step10PreviewActive, step10PreviewData?.qc, step10SavedCutsData?.qc]);

  const step10ImageSizeHint = useMemo(() => {
    const width = toNumber(step10PreviewActive ? step10PreviewData?.image_width : step10SavedCutsData?.image_width);
    const height = toNumber(step10PreviewActive ? step10PreviewData?.image_height : step10SavedCutsData?.image_height);
    if (width == null || height == null) {
      return null;
    }
    return { width, height };
  }, [
    step10PreviewActive,
    step10PreviewData?.image_width,
    step10PreviewData?.image_height,
    step10SavedCutsData?.image_width,
    step10SavedCutsData?.image_height,
  ]);

  const step10UmPerPx = useMemo(() => {
    const step1Params = (selectedArtifact ?? latestStep1Artifact)?.params as Record<string, unknown> | undefined;
    const value = toNumber(step1Params?.um_per_px);
    if (value == null || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    return value;
  }, [latestStep1Artifact, selectedArtifact]);

  const handleStep10Preview = async () => {
    if (currentStepLocked || !step10HasInputs) {
      return;
    }
    setStep10PreviewLoading(true);
    toast.info(ko.step10.previewRunning, { id: "step10-preview-status" });
    try {
      const payload = toStep10Payload(
        step10Params,
        step10BasePolygonArtifact?.id ?? null,
        step10GrayArtifact?.id ?? null,
      );
      const response = await api.previewStep10(runId, payload);
      setStep10PreviewData(response);
      setStep10PreviewActive(true);
      setStep10HoveredFragmentId(null);
      toast.success(ko.step10.previewSuccess, { id: "step10-preview-status" });
    } catch (error) {
      toast.error(`${ko.step10.previewFailurePrefix}: ${getQueryErrorMessage(error)}`, { id: "step10-preview-status" });
    } finally {
      setStep10PreviewLoading(false);
    }
  };

  const handleStep10FragmentTableDownload = () => {
    const entries = Object.entries(step10LabelAreas)
      .map(([labelId, area]) => ({
        labelId: Number(labelId),
        areaPx: typeof area === "number" && Number.isFinite(area) ? Math.round(area) : 0,
      }))
      .filter((item) => Number.isFinite(item.labelId) && item.labelId > 0 && item.areaPx > 0)
      .sort((a, b) => a.labelId - b.labelId);

    if (entries.length === 0) {
      toast.error(ko.step10.exportFragmentTableEmpty);
      return;
    }

    try {
      const header = ["조각 ID", "면적(px)", "면적(um^2)"];
      const lines = [header.join(",")];
      for (const item of entries) {
        const areaUm2 = step10UmPerPx == null ? "" : (item.areaPx * step10UmPerPx * step10UmPerPx).toFixed(6);
        lines.push([String(item.labelId), String(item.areaPx), areaUm2].join(","));
      }
      const csv = `\uFEFF${lines.join("\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `step10-조각정보-${runId}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(ko.step10.exportFragmentTableSuccess);
    } catch {
      toast.error(ko.step10.exportFragmentTableFailure);
    }
  };

  const handleStep8ContourOnlyDownload = () => {
    const contoursPayload = step8ContoursData;
    if (!contoursPayload || !Array.isArray(contoursPayload.contours) || contoursPayload.contours.length === 0) {
      toast.error(ko.step8.downloadContourOnlyEmpty);
      return;
    }

    const width = Math.max(1, Math.round(contoursPayload.image_width || 0));
    const height = Math.max(1, Math.round(contoursPayload.image_height || 0));
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("canvas-context");
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#16a34a";
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      for (const contour of contoursPayload.contours) {
        if (!Array.isArray(contour.points) || contour.points.length < 2) {
          continue;
        }
        ctx.beginPath();
        const [firstX, firstY] = contour.points[0];
        ctx.moveTo(firstX, firstY);
        for (let index = 1; index < contour.points.length; index += 1) {
          const [x, y] = contour.points[index];
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      const version = step8ActiveArtifact?.version;
      const fileName = `step8-윤곽선-백지${typeof version === "number" ? `-v${version}` : ""}.png`;
      const triggerDownload = (href: string) => {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      };

      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) {
            toast.error(ko.step8.downloadContourOnlyFailure);
            return;
          }
          const url = URL.createObjectURL(blob);
          triggerDownload(url);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast.success(ko.step8.downloadContourOnlySuccess);
        }, "image/png");
        return;
      }

      const dataUrl = canvas.toDataURL("image/png");
      triggerDownload(dataUrl);
      toast.success(ko.step8.downloadContourOnlySuccess);
    } catch {
      toast.error(ko.step8.downloadContourOnlyFailure);
    }
  };

  const handleStep8ContourWithOriginalDownload = async () => {
    const contoursPayload = step8ContoursData;
    const backgroundUrl = step8OriginalBackgroundUrl;
    if (!contoursPayload || !Array.isArray(contoursPayload.contours) || contoursPayload.contours.length === 0 || !backgroundUrl) {
      toast.error(ko.step8.downloadContourWithOriginalEmpty);
      return;
    }

    const width = Math.max(1, Math.round(contoursPayload.image_width || 0));
    const height = Math.max(1, Math.round(contoursPayload.image_height || 0));
    try {
      const imageBlob = await fetch(backgroundUrl, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`image-fetch-${response.status}`);
        }
        return await response.blob();
      });
      const objectUrl = URL.createObjectURL(imageBlob);

      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const next = new Image();
          next.onload = () => resolve(next);
          next.onerror = () => reject(new Error("image-load-failed"));
          next.src = objectUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("canvas-context");
        }

        ctx.drawImage(image, 0, 0, width, height);
        ctx.strokeStyle = "#16a34a";
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        for (const contour of contoursPayload.contours) {
          if (!Array.isArray(contour.points) || contour.points.length < 2) {
            continue;
          }
          ctx.beginPath();
          const [firstX, firstY] = contour.points[0];
          ctx.moveTo(firstX, firstY);
          for (let index = 1; index < contour.points.length; index += 1) {
            const [x, y] = contour.points[index];
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        const version = step8ActiveArtifact?.version;
        const fileName = `step8-원본-윤곽선${typeof version === "number" ? `-v${version}` : ""}.png`;
        const triggerDownload = (href: string) => {
          const anchor = document.createElement("a");
          anchor.href = href;
          anchor.download = fileName;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        };

        if (canvas.toBlob) {
          canvas.toBlob((blob) => {
            if (!blob) {
              toast.error(ko.step8.downloadContourWithOriginalFailure);
              return;
            }
            const url = URL.createObjectURL(blob);
            triggerDownload(url);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast.success(ko.step8.downloadContourWithOriginalSuccess);
          }, "image/png");
        } else {
          const dataUrl = canvas.toDataURL("image/png");
          triggerDownload(dataUrl);
          toast.success(ko.step8.downloadContourWithOriginalSuccess);
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      toast.error(ko.step8.downloadContourWithOriginalFailure);
    }
  };

  useEffect(() => {
    if (currentStep !== 3 || step3ViewerMode !== "preview") {
      setStep3PreviewLoading(false);
      return;
    }
    if (currentStepLocked || !step3InputArtifact?.id) {
      setStep3PreviewLoading(false);
      return;
    }

    const requestSeq = step3PreviewSeqRef.current + 1;
    step3PreviewSeqRef.current = requestSeq;
    const timer = setTimeout(async () => {
      setStep3PreviewLoading(true);
      toast.info(ko.step3.previewRunning, { id: "step3-preview-status" });

      try {
        const payload = toStep3Payload(step3Params, step3InputArtifact.id);
        const blob = await api.previewStep3(runId, payload);
        if (requestSeq !== step3PreviewSeqRef.current) {
          return;
        }

        const nextPreviewUrl = URL.createObjectURL(blob);
        setStep3PreviewImageUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return nextPreviewUrl;
        });
        toast.success(ko.step3.previewSuccess, { id: "step3-preview-status" });
      } catch (error) {
        if (requestSeq !== step3PreviewSeqRef.current) {
          return;
        }
        toast.error(`${ko.step3.previewFailurePrefix}: ${getQueryErrorMessage(error)}`, {
          id: "step3-preview-status",
        });
      } finally {
        if (requestSeq === step3PreviewSeqRef.current) {
          setStep3PreviewLoading(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [currentStep, currentStepLocked, runId, step3InputArtifact, step3Params, step3ViewerMode]);

  useEffect(() => {
    if (currentStep !== 4 || step4ViewerMode === "input") {
      setStep4PreviewLoading(false);
      return;
    }
    if (currentStepLocked || !step4InputArtifact?.id) {
      setStep4PreviewLoading(false);
      return;
    }

    const requestSeq = step4PreviewSeqRef.current + 1;
    step4PreviewSeqRef.current = requestSeq;
    const timer = setTimeout(async () => {
      setStep4PreviewLoading(true);
      try {
        const previewLayer = step4ViewerMode as Exclude<Step4ViewerMode, "input">;
        const payload = toStep4PreviewPayload(step4Params, step4InputArtifact.id, previewLayer);
        const blob = await api.previewStep4(runId, payload);
        if (requestSeq !== step4PreviewSeqRef.current) {
          return;
        }
        const nextPreviewUrl = URL.createObjectURL(blob);
        setStep4PreviewImageUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return nextPreviewUrl;
        });
      } catch (error) {
        if (requestSeq !== step4PreviewSeqRef.current) {
          return;
        }
        toast.error(`${ko.step4.previewErrorPrefix}: ${getQueryErrorMessage(error)}`);
      } finally {
        if (requestSeq === step4PreviewSeqRef.current) {
          setStep4PreviewLoading(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [currentStep, currentStepLocked, runId, step4InputArtifact, step4Params, step4ViewerMode]);

  useEffect(() => {
    if (currentStep !== 6 || step6ViewerMode !== "preview") {
      setStep6PreviewLoading(false);
      return;
    }
    if (currentStepLocked || !step6BaseMaskArtifact?.id) {
      setStep6PreviewLoading(false);
      return;
    }

    const requestSeq = step6PreviewSeqRef.current + 1;
    step6PreviewSeqRef.current = requestSeq;
    const timer = setTimeout(async () => {
      setStep6PreviewLoading(true);
      toast.info(ko.step6.previewRunning, { id: "step6-preview-status" });

      try {
        const payload = toStep6Payload(step6Params, step6BaseMaskArtifact.id);
        const blob = await api.previewStep6(runId, payload);
        if (requestSeq !== step6PreviewSeqRef.current) {
          return;
        }
        const nextPreviewUrl = URL.createObjectURL(blob);
        setStep6PreviewImageUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return nextPreviewUrl;
        });
        toast.success(ko.step6.previewSuccess, { id: "step6-preview-status" });
      } catch (error) {
        if (requestSeq !== step6PreviewSeqRef.current) {
          return;
        }
        toast.error(`${ko.step6.previewFailurePrefix}: ${getQueryErrorMessage(error)}`, {
          id: "step6-preview-status",
        });
      } finally {
        if (requestSeq === step6PreviewSeqRef.current) {
          setStep6PreviewLoading(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [currentStep, currentStepLocked, runId, step6BaseMaskArtifact?.id, step6Params, step6ViewerMode]);

  useEffect(() => {
    if (currentStep !== 7 || !step7PreviewActive) {
      setStep7PreviewLoading(false);
      return;
    }
    if (currentStepLocked || !step7BaseMaskArtifactId) {
      setStep7PreviewLoading(false);
      return;
    }

    const requestSeq = step7PreviewSeqRef.current + 1;
    step7PreviewSeqRef.current = requestSeq;
    const timer = setTimeout(async () => {
      setStep7PreviewLoading(true);
      toast.info(ko.step7.previewRunning, { id: "step7-preview-status" });
      try {
        const payload = toStep7Payload(step7Params, step7BaseMaskArtifactId);
        const result = await api.previewStep7(runId, payload);
        if (requestSeq !== step7PreviewSeqRef.current) {
          return;
        }
        setStep7PreviewData(result);
        toast.success(ko.step7.previewSuccess, { id: "step7-preview-status" });
      } catch (error) {
        if (requestSeq !== step7PreviewSeqRef.current) {
          return;
        }
        toast.error(`${ko.step7.previewFailurePrefix}: ${getQueryErrorMessage(error)}`, { id: "step7-preview-status" });
      } finally {
        if (requestSeq === step7PreviewSeqRef.current) {
          setStep7PreviewLoading(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [currentStep, currentStepLocked, runId, step7BaseMaskArtifactId, step7Params, step7PreviewActive]);

  useEffect(() => {
    return () => {
      if (step3PreviewImageUrl) {
        URL.revokeObjectURL(step3PreviewImageUrl);
      }
    };
  }, [step3PreviewImageUrl]);

  useEffect(() => {
    return () => {
      if (step4PreviewImageUrl) {
        URL.revokeObjectURL(step4PreviewImageUrl);
      }
    };
  }, [step4PreviewImageUrl]);

  useEffect(() => {
    return () => {
      if (step6PreviewImageUrl) {
        URL.revokeObjectURL(step6PreviewImageUrl);
      }
    };
  }, [step6PreviewImageUrl]);

  if (runQuery.isLoading || imageQuery.isLoading) {
    return (
      <main className="mx-auto min-h-screen max-w-[2200px] p-6">
        <p className="text-sm text-muted-foreground">{ko.workspace.loading}</p>
      </main>
    );
  }

  if (runQuery.isError || !runQuery.data || imageQuery.isError || !imageQuery.data) {
    return (
      <main className="mx-auto min-h-screen max-w-[2200px] p-6">
        <p className="text-sm text-red-600">{ko.workspace.notFound}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-[2200px] space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">{ko.workspace.title}</h1>
          <p className="text-base text-muted-foreground">
            {ko.workspace.subtitle} | {ko.workspace.currentImage}: {imageQuery.data.filename}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/">
            <Button size="sm" variant="outline" className="h-9 px-3">
              {ko.navigation.toDashboard}
            </Button>
          </Link>
          <ThemeToggle className="h-9 px-3" />
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-180px)] grid-cols-[380px_minmax(0,1fr)_420px] items-start gap-4">
        <Card className="flex min-h-[1080px] flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-2xl font-bold tracking-tight">{ko.workspace.stepSectionTitle}</CardTitle>
            <CardDescription>{ko.workspace.stepSectionDescription}</CardDescription>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col p-0">
            <div className="px-4 pb-4">
              <div className="pr-2">
                <TooltipProvider delayDuration={150}>
                  <div className="space-y-2">
                    {STEP_IDS.map((stepId) => {
                      const stepName = ko.steps.names[String(stepId) as keyof typeof ko.steps.names];
                      const stepDescription = ko.steps.descriptions[String(stepId) as keyof typeof ko.steps.descriptions];
                      const active = currentStep === stepId;
                      const completed = completedSteps.has(stepId);
                      const unlocked = unlockedSteps.get(stepId) !== false;
                      const lockMessage = getStepLockMessage(stepId);
                      const statusLabel = completed
                        ? ko.workspace.stepCompletedBadge
                        : unlocked
                          ? ko.workspace.stepIncompleteBadge
                          : ko.workspace.stepLockedBadge;
                      const badgeVariant = completed ? "success" : unlocked ? "secondary" : "warning";

                      return (
                        <Tooltip key={stepId}>
                          <TooltipTrigger asChild>
                            <span className="block">
                              <Button
                                type="button"
                                variant={active ? "default" : "outline"}
                                className="h-auto w-full justify-between px-3 py-2.5"
                                onClick={() => setCurrentStep(stepId)}
                                disabled={!unlocked}
                              >
                                <span className="inline-flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold">
                                  {!unlocked && <Lock className="h-3.5 w-3.5" />}
                                  <span className="truncate">
                                    {ko.workspace.stepButtonTemplate
                                      .replace("{{step}}", formatStepNumber(stepId))
                                      .replace("{{name}}", stepName)}
                                  </span>
                                </span>
                                <Badge variant={badgeVariant}>{statusLabel}</Badge>
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right">{!unlocked && lockMessage ? lockMessage : stepDescription}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </div>
            </div>

            <Separator />

            <div className="mt-auto shrink-0 space-y-4 border-t border-sky-200/70 bg-gradient-to-b from-sky-50/80 to-white p-4">
              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold tracking-tight text-sky-900">{ko.workspace.imageSectionTitle}</h3>
                <p className="text-sm font-medium text-slate-600">{ko.workspace.imageUploadDescription}</p>
              </div>

              <input
                ref={uploadInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff"
                onChange={async (event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length === 0) {
                    return;
                  }
                  try {
                    await uploadMutation.mutateAsync(files);
                  } catch {
                    // 오류 토스트는 onError에서 처리
                  }
                  const inputEl = event.currentTarget;
                  inputEl.value = "";
                }}
              />

              <Button
                className="h-11 w-full bg-sky-600 text-base font-semibold text-white shadow-sm hover:bg-sky-700"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {ko.workspace.imageUploadButton}
              </Button>
              <p className="rounded-md border border-sky-200 bg-white/80 px-2.5 py-1.5 text-xs text-slate-600">
                {ko.workspace.imageUploadHint}
              </p>

              <div className="space-y-2 rounded-lg border border-sky-200/70 bg-white/90 p-3 shadow-sm">
                <h4 className="text-base font-bold tracking-tight text-sky-900">{ko.workspace.imageListTitle}</h4>
                {imagesQuery.isLoading && <p className="text-xs font-medium text-slate-600">{ko.workspace.loading}</p>}
                {imagesQuery.isError && <p className="text-xs font-medium text-red-600">{getQueryErrorMessage(imagesQuery.error)}</p>}
                {imagesQuery.data && imagesQuery.data.length === 0 && (
                  <p className="text-xs font-medium text-slate-600">{ko.workspace.imageListEmpty}</p>
                )}

                <ScrollArea className="max-h-[290px] space-y-2 rounded-md border border-slate-200/80 bg-slate-50/50 p-2 pr-1">
                  <div className="space-y-2">
                    {imagesQuery.data?.slice(0, 20).map((image) => (
                      <div
                        key={image.id}
                        className={`rounded-lg border p-2.5 transition-colors ${
                          image.id === runQuery.data.image_id
                            ? "border-sky-400 bg-sky-50/80"
                            : "border-slate-200 bg-white hover:border-sky-300"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => createRunMutation.mutate(image.id)}
                          disabled={createRunMutation.isPending}
                        >
                          <p className="truncate text-sm font-semibold text-slate-900">{image.filename}</p>
                          <p className="text-[11px] font-medium text-slate-500">
                            {image.width} × {image.height}
                          </p>
                        </button>
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 border-sky-300 text-sky-700 hover:bg-sky-50"
                            onClick={() => createRunMutation.mutate(image.id)}
                            disabled={createRunMutation.isPending}
                          >
                            {ko.workspace.imageSelectAction}
                          </Button>
                          {image.id === runQuery.data.image_id && (
                            <Badge variant="secondary" className="border border-sky-200 bg-sky-100 text-sky-800">
                              {ko.workspace.imageCurrentBadge}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-2xl font-bold tracking-tight">{ko.workspace.viewerTitle}</CardTitle>
          </CardHeader>
          <CardContent className="h-[86vh] min-h-[860px] p-3">
            {currentStep === 1 && (
              <Step1Viewer
                imageUrl={api.getImageFileUrl(imageQuery.data.id)}
                cropBottomPx={cropBottomPx}
                measurementMode={measurementMode}
                measurementPoints={measurementPoints}
                rectangleVisible={rectangleVisible}
                onSetMeasurementRect={(points) => {
                  setSelectedArtifactId(null);
                  setMeasurementPoints(points);
                  if (points.length === 2 && autoApplyRectangleWidth) {
                    const width = Math.abs(points[1].x - points[0].x);
                    setPixelDistanceInput(String(width));
                  }
                }}
              />
            )}

            {currentStep === 2 && (
              <Step2PreviewViewer
                inputImageUrl={step2InputImageUrl}
                savedImageUrl={step2SavedImageUrl}
                mode={step2ViewerMode}
                params={step2Params}
              />
            )}

            {currentStep === 3 && (
              <Step3PreviewViewer
                originalImageUrl={api.getImageFileUrl(imageQuery.data.id)}
                inputImageUrl={step3InputImageUrl}
                previewImageUrl={step3PreviewImageUrl ?? undefined}
                savedImageUrl={step3SavedImageUrl}
                mode={step3ViewerMode}
                roiTool="none"
                excludeRoi={{ rectangles: [], polygons: [], brush_strokes: [] }}
                onExcludeRoiChange={() => {}}
                onRoiEdited={() => {}}
              />
            )}

            {currentStep === 4 && (
              <Step4PreviewViewer
                inputImageUrl={step4InputImageUrl}
                overlayImageUrl={
                  step4ViewerMode === "input"
                    ? undefined
                    : step4ViewerMode === "mask" || step4ViewerMode === "mask_binary"
                      ? (step4PreviewImageUrl ?? step4SavedImageUrl)
                      : (step4PreviewImageUrl ?? undefined)
                }
                mode={step4ViewerMode}
              />
            )}

            {currentStep === 5 && (
              <Step5MaskEditorViewer
                ref={step5ViewerRef}
                baseImageUrl={step5ContextImageUrl}
                baseMaskUrl={step5BaseMaskUrl}
                sourceMaskUrl={step5MaskSourceUrl}
                brushMode={step5BrushMode}
                viewerMode={step5ViewerMode}
                brushSizePx={step5BrushSizePx}
                editable={!currentStepLocked}
                onStateChange={(state) => {
                  setStep5CanUndo(state.canUndo);
                  setStep5CanRedo(state.canRedo);
                  setStep5HasMask(state.hasMask);
                }}
              />
            )}

            {currentStep === 6 && (
              <Step6PreviewViewer
                inputImageUrl={step6InputImageUrl}
                baseMaskUrl={step6BaseMaskUrl}
                previewMaskUrl={step6PreviewImageUrl ?? undefined}
                savedMaskUrl={step6SavedMaskUrl}
                mode={step6ViewerMode}
              />
            )}

            {currentStep === 7 && (
              <Step7DualMaskViewer
                inputImageUrl={step7ViewerBackgroundUrl}
                solidMaskUrl={step7ActiveSolidMaskUrl}
                outerMaskUrl={step7ActiveOuterMaskUrl}
                mode="porosity"
              />
            )}

            {currentStep === 8 && (
              <Step8ContoursViewer
                imageUrl={step8ViewerImageUrl}
                contoursData={step8ContoursData}
                onSelectContourIdChange={(id) => setStep8SelectedContourId(id)}
              />
            )}

            {currentStep === 9 && (
              <Step9NeckSplitViewer
                imageUrl={step9ViewerImageUrl}
                imageSizeHint={step9ImageSizeHint}
                baseContours={step8ContoursData?.contours ?? []}
                polygonContours={step9PolygonContours}
              />
            )}

            {currentStep === 10 && (
              <Step10AutoCutViewer
                imageUrl={step10ViewerImageUrl}
                imageSizeHint={step10ImageSizeHint}
                polygons={step10BasePolygonContours}
                splitLines={step10DisplayedCuts}
                previewLabelsUrl={step10DisplayedLabelsUrl}
                onHoverFragmentIdChange={(labelId) => setStep10HoveredFragmentId(labelId)}
              />
            )}

            {currentStep !== 1 &&
              currentStep !== 2 &&
              currentStep !== 3 &&
              currentStep !== 4 &&
              currentStep !== 5 &&
              currentStep !== 6 &&
              currentStep !== 7 &&
              currentStep !== 8 &&
              currentStep !== 9 && (
              <Step1Viewer
                imageUrl={nonStepViewerImageUrl}
                cropBottomPx={0}
                measurementMode={false}
                measurementPoints={[]}
                rectangleVisible={false}
                onSetMeasurementRect={() => {
                  // 비활성 모드
                }}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          {currentStep === 1 && (
            <>
              <Step1Panel
                imageHeight={imageQuery.data.height}
                saving={saveMutation.isPending}
                onSave={async (payload) => {
                  await saveMutation.mutateAsync(payload);
                }}
              />

              <Step1VersionHistory
                artifacts={step1Artifacts}
                selectedArtifactId={selectedArtifact?.id ?? selectedArtifactId}
                renaming={renameVersionMutation.isPending}
                deleting={deleteVersionMutation.isPending}
                onSelect={(artifactId) => {
                  const target = step1Artifacts.find((artifact) => artifact.id === artifactId);
                  if (!target) {
                    return;
                  }
                  applyArtifactToStore(target);
                  toast.success(`${ko.step1Version.versionPrefix} ${target.version} ${ko.workspace.versionLoadSuccessPrefix}`);
                }}
                onRename={async (artifactId, name) => {
                  await renameVersionMutation.mutateAsync({ artifactId, name });
                }}
                onDelete={async (artifactId) => {
                  await deleteVersionMutation.mutateAsync(artifactId);
                }}
              />
            </>
          )}

          {currentStep === 2 && (
            <Step2Preprocess
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              viewerMode={step2ViewerMode}
              onViewerModeChange={(mode) => {
                setStep2ViewerMode(mode);
                if (mode === "saved" && latestStep2Artifact) {
                  const target = selectedStep2Artifact ?? latestStep2Artifact;
                  setSelectedStep2ArtifactId(target.id);
                  setStep2Params(parseStep2Params(target.params));
                }
              }}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 3 && (
            <Step3Denoise
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              viewerMode={step3ViewerMode}
              onViewerModeChange={(mode) => {
                setStep3ViewerMode(mode);
                if (mode === "saved" && latestStep3Artifact) {
                  const target = selectedStep3Artifact ?? latestStep3Artifact;
                  setSelectedStep3ArtifactId(target.id);
                  setStep3Params(parseStep3Params(target.params));
                }
              }}
              selectedStep2ArtifactId={step3InputArtifact?.id ?? null}
              selectedArtifact={selectedStep3Artifact ?? latestStep3Artifact}
              previewLoading={step3PreviewLoading}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 4 && (
            <Step4Binarize
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage || ko.step4.lockMessage}
              viewerMode={step4ViewerMode}
              onViewerModeChange={(mode) => setStep4ViewerMode(mode)}
              selectedStep3ArtifactId={step4InputArtifact?.id ?? null}
              selectedArtifact={selectedStep4Artifact ?? latestStep4Artifact}
              previewLoading={step4PreviewLoading}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 45 && (
            <Step45Recovery
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 5 && (
            <Step5MaskEditor
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              viewerMode={step5ViewerMode}
              brushMode={step5BrushMode}
              brushSizePx={step5BrushSizePx}
              canUndo={step5CanUndo}
              canRedo={step5CanRedo}
              hasMask={step5HasMask}
              baseMaskArtifactId={step5BaseMaskArtifactId}
              onViewerModeChange={(mode) => setStep5ViewerMode(mode)}
              onBrushModeChange={(mode) => setStep5BrushMode(mode)}
              onBrushSizePxChange={(value) => setStep5BrushSizePx(value)}
              onUndo={() => step5ViewerRef.current?.undo()}
              onRedo={() => step5ViewerRef.current?.redo()}
              onResetToBase={() => step5ViewerRef.current?.resetToBaseMask()}
              onExecute={async (stepId, stepParams) => {
                const editedMaskDataUrl = step5ViewerRef.current?.exportMaskPngDataUrl();
                if (!editedMaskDataUrl) {
                  toast.error(ko.step5.saveMaskMissing);
                  return;
                }
                const payload = toStep5Payload(stepParams, editedMaskDataUrl);
                await executeStepMutation.mutateAsync({ stepId, params: payload as unknown as Record<string, unknown> });
              }}
            />
          )}

          {currentStep === 6 && (
            <Step6Recovery
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              viewerMode={step6ViewerMode}
              params={step6Params}
              selectedStep5ArtifactId={step6BaseMaskArtifact?.id ?? null}
              selectedArtifact={selectedStep6Artifact ?? latestStep6Artifact}
              previewLoading={step6PreviewLoading}
              hasBaseMask={Boolean(step6BaseMaskArtifact && step6BaseMaskUrl)}
              onViewerModeChange={(mode) => {
                setStep6ViewerMode(mode);
                if (mode === "saved" && latestStep6Artifact) {
                  const target = selectedStep6Artifact ?? latestStep6Artifact;
                  setSelectedStep6ArtifactId(target.id);
                  setStep6Params(parseStep6Params(target.params));
                }
              }}
              onParamsChange={(patch) => {
                setStep6Params((current) => ({ ...current, ...patch }));
                if (step6ViewerMode === "saved") {
                  setStep6ViewerMode("preview");
                }
              }}
              onApplyPreview={() => setStep6ViewerMode("preview")}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 7 && (
            <Step7DualMask
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              viewerMode="porosity"
              backgroundMode={step7BackgroundMode}
              params={step7Params}
              selectedStep6ArtifactId={step7BaseMaskArtifactId}
              selectedArtifact={selectedStep7Artifact ?? latestStep7Artifact}
              previewLoading={step7PreviewLoading}
              previewActive={step7PreviewActive}
              hasBaseMask={Boolean(step7BaseMaskArtifactId && step7BaseMaskUrl)}
              hasBinaryBackground={Boolean(step7BinaryBackgroundUrl)}
              metrics={step7ActiveMetrics}
              onViewerModeChange={() => {
                // 7단계 화면 모드는 공극 보기만 사용한다.
              }}
              onBackgroundModeChange={(mode) => setStep7BackgroundMode(mode)}
              onParamsChange={(patch) => {
                setStep7Params((current) => ({ ...current, ...patch }));
              }}
              onPreview={() => {
                setStep7PreviewActive(true);
              }}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 8 && (
            <Step8Contours
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              contourCount={step8ContoursData?.contours.length ?? 0}
              selectedContourId={step8SelectedContourId}
              loading={step8ContoursLoading}
              hasBaseMask={Boolean(step8BaseMaskArtifactId)}
              baseMaskArtifactId={step8BaseMaskArtifactId}
              step7ArtifactId={(selectedStep7Artifact ?? latestStep7Artifact)?.id ?? null}
              backgroundMode={step8BackgroundMode}
              hasBinaryBackground={Boolean(step8BinaryBackgroundUrl)}
              onBackgroundModeChange={(mode) => setStep8BackgroundMode(mode)}
              canDownloadContourOnly={Boolean(step8ContoursData?.contours?.length)}
              onDownloadContourOnly={handleStep8ContourOnlyDownload}
              canDownloadContourWithOriginal={Boolean(step8ContoursData?.contours?.length && step8OriginalBackgroundUrl)}
              onDownloadContourWithOriginal={handleStep8ContourWithOriginalDownload}
              onExecute={async (stepId, stepParams) => {
                await executeStepMutation.mutateAsync({ stepId, params: stepParams });
              }}
            />
          )}

          {currentStep === 9 && (
            <Step9NeckSplit
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              params={step9Params}
              hasInputs={step9HasInputs}
              previewLoading={step9PreviewLoading}
              previewActive={step9PreviewActive}
              polygonCount={step9PolygonCount}
              onParamsChange={(patch) => {
                setStep9Params((current) => ({ ...current, ...patch }));
                setStep9PreviewActive(false);
              }}
              onPreview={handleStep9Preview}
              onExecute={async (stepId, stepParams) => {
                const payload = {
                  ...(stepParams as Record<string, unknown>),
                  step8_artifact_id: (selectedStep8Artifact ?? latestStep8Artifact)?.id ?? undefined,
                };
                await executeStepMutation.mutateAsync({ stepId, params: payload });
              }}
            />
          )}

          {currentStep === 10 && (
            <Step10NeckCuts
              runId={runId}
              executingStepId={executeStepMutation.isPending ? executeStepMutation.variables?.stepId ?? null : null}
              latestArtifactsByType={latestArtifactsByType}
              isLocked={currentStepLocked}
              lockMessage={currentStepLockMessage}
              params={step10Params}
              hasInputs={step10HasInputs}
              hasGrayInput={step10HasGrayInput}
              previewLoading={step10PreviewLoading}
              previewActive={step10PreviewActive}
              splitLineCount={step10CutCount}
              labelCount={step10LabelCount}
              qcWarnings={step10QcWarnings}
              hoveredFragmentId={step10HoveredFragmentId}
              hoveredFragmentAreaPx={step10HoveredFragmentAreaPx}
              canDownloadFragmentTable={Object.keys(step10LabelAreas).length > 0}
              onDownloadFragmentTable={handleStep10FragmentTableDownload}
              onParamsChange={(patch) => {
                setStep10Params((current) => ({ ...current, ...patch }));
                setStep10PreviewActive(false);
              }}
              onPreview={handleStep10Preview}
              onExecute={async (stepId, stepParams) => {
                const payload = {
                  ...(stepParams as Record<string, unknown>),
                  step9_artifact_id: step10BasePolygonArtifact?.id ?? undefined,
                  step3_artifact_id: step10GrayArtifact?.id ?? undefined,
                };
                await executeStepMutation.mutateAsync({ stepId, params: payload });
              }}
            />
          )}

          {(
            <Card className="overflow-hidden">
              <CardHeader className="space-y-3">
                <CardTitle>{ko.workspace.historyTitle}</CardTitle>
                <div className="flex items-center gap-2">
                  <input
                    ref={historyImportInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={async (event) => {
                      const inputEl = event.currentTarget;
                      const file = inputEl.files?.[0];
                      if (!file) {
                        toast.error(ko.workspace.historyImportEmptyFile);
                        return;
                      }
                      try {
                        await importHistoryMutation.mutateAsync(file);
                      } catch {
                        // 오류 메시지는 mutation onError에서 표시
                      } finally {
                        inputEl.value = "";
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportHistoryMutation.isPending || importHistoryMutation.isPending}
                    onClick={() => exportHistoryMutation.mutate()}
                  >
                    {ko.workspace.historyExportButton}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportHistoryMutation.isPending || importHistoryMutation.isPending}
                    onClick={() => historyImportInputRef.current?.click()}
                  >
                    {ko.workspace.historyImportButton}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">{ko.workspace.historyImportHint}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedStepArtifacts.length === 0 && (
                  <p className="text-sm text-muted-foreground">{ko.workspace.historyEmpty}</p>
                )}

                {selectedStepArtifacts.map((artifact) => {
                  const active =
                    (currentStep === 1 && selectedArtifactId === artifact.id) ||
                    (currentStep === 2 && selectedStep2ArtifactId === artifact.id) ||
                    (currentStep === 3 && selectedStep3ArtifactId === artifact.id) ||
                    (currentStep === 4 && selectedStep4ArtifactId === artifact.id) ||
                    (currentStep === 5 && selectedStep5ArtifactId === artifact.id) ||
                    (currentStep === 6 && selectedStep6ArtifactId === artifact.id) ||
                    (currentStep === 7 && selectedStep7ArtifactId === artifact.id) ||
                    (currentStep === 8 && selectedStep8ArtifactId === artifact.id) ||
                    (currentStep === 9 && selectedStep9ArtifactId === artifact.id) ||
                    (currentStep === 10 && selectedStep10ArtifactId === artifact.id);
                  const versionName =
                    typeof artifact.params.version_name === "string" && artifact.params.version_name.trim().length > 0
                      ? artifact.params.version_name.trim()
                      : null;

                  if (
                    currentStep === 1 ||
                    currentStep === 2 ||
                    currentStep === 3 ||
                    currentStep === 4 ||
                    currentStep === 5 ||
                    currentStep === 6 ||
                    currentStep === 7 ||
                    currentStep === 8 ||
                    currentStep === 9 ||
                    currentStep === 10
                  ) {
                    return (
                      <div
                        key={artifact.id}
                        role="button"
                        tabIndex={0}
                        className={`w-full cursor-pointer rounded-md border p-3 text-left ${
                          active ? "border-primary bg-primary/10" : "border-border bg-card"
                        }`}
                        onClick={() => {
                          if (currentStep === 1) {
                            applyArtifactToStore(artifact);
                            return;
                          }
                          if (currentStep === 2) {
                            setSelectedStep2ArtifactId(artifact.id);
                            setStep2ViewerMode("saved");
                            setStep2Params(parseStep2Params(artifact.params));
                            return;
                          }
                          if (currentStep === 3) {
                            setSelectedStep3ArtifactId(artifact.id);
                            setStep3ViewerMode("saved");
                            setStep3Params(parseStep3Params(artifact.params));
                            return;
                          }
                          if (currentStep === 5) {
                            setSelectedStep5ArtifactId(artifact.id);
                            const parsedBrushSize = parseStep5BrushSize(artifact.params);
                            if (parsedBrushSize != null) {
                              setStep5BrushSizePx(parsedBrushSize);
                            }
                            setStep5BrushMode(parseStep5BrushMode(artifact.params));
                            return;
                          }
                          if (currentStep === 6) {
                            setSelectedStep6ArtifactId(artifact.id);
                            setStep6ViewerMode("saved");
                            setStep6Params(parseStep6Params(artifact.params));
                            return;
                          }
                          if (currentStep === 7) {
                            setSelectedStep7ArtifactId(artifact.id);
                            setStep7PreviewActive(false);
                            setStep7Params(parseStep7Params(artifact.params));
                            return;
                          }
                          if (currentStep === 8) {
                            setSelectedStep8ArtifactId(artifact.id);
                            return;
                          }
                          if (currentStep === 9) {
                            setSelectedStep9ArtifactId(artifact.id);
                            setStep9PreviewActive(false);
                            setStep9Params(parseStep9Params(artifact.params));
                            return;
                          }
                          if (currentStep === 10) {
                            setSelectedStep10ArtifactId(artifact.id);
                            setStep10PreviewActive(false);
                            setStep10Params(parseStep10Params(artifact.params));
                            return;
                          }
                          setSelectedStep4ArtifactId(artifact.id);
                          setStep4ViewerMode("mask");
                          setStep4Params(parseStep4Params(artifact.params));
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          if (currentStep === 1) {
                            applyArtifactToStore(artifact);
                            return;
                          }
                          if (currentStep === 2) {
                            setSelectedStep2ArtifactId(artifact.id);
                            setStep2ViewerMode("saved");
                            setStep2Params(parseStep2Params(artifact.params));
                            return;
                          }
                          if (currentStep === 3) {
                            setSelectedStep3ArtifactId(artifact.id);
                            setStep3ViewerMode("saved");
                            setStep3Params(parseStep3Params(artifact.params));
                            return;
                          }
                          if (currentStep === 5) {
                            setSelectedStep5ArtifactId(artifact.id);
                            const parsedBrushSize = parseStep5BrushSize(artifact.params);
                            if (parsedBrushSize != null) {
                              setStep5BrushSizePx(parsedBrushSize);
                            }
                            setStep5BrushMode(parseStep5BrushMode(artifact.params));
                            return;
                          }
                          if (currentStep === 6) {
                            setSelectedStep6ArtifactId(artifact.id);
                            setStep6ViewerMode("saved");
                            setStep6Params(parseStep6Params(artifact.params));
                            return;
                          }
                          if (currentStep === 7) {
                            setSelectedStep7ArtifactId(artifact.id);
                            setStep7PreviewActive(false);
                            setStep7Params(parseStep7Params(artifact.params));
                            return;
                          }
                          if (currentStep === 8) {
                            setSelectedStep8ArtifactId(artifact.id);
                            return;
                          }
                          if (currentStep === 9) {
                            setSelectedStep9ArtifactId(artifact.id);
                            setStep9PreviewActive(false);
                            setStep9Params(parseStep9Params(artifact.params));
                            return;
                          }
                          if (currentStep === 10) {
                            setSelectedStep10ArtifactId(artifact.id);
                            setStep10PreviewActive(false);
                            setStep10Params(parseStep10Params(artifact.params));
                            return;
                          }
                          setSelectedStep4ArtifactId(artifact.id);
                          setStep4ViewerMode("mask");
                          setStep4Params(parseStep4Params(artifact.params));
                        }}
                      >
                        <p className="text-sm font-semibold">
                          {versionName ?? `${ko.workspace.historyVersion} ${artifact.version}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {ko.workspace.historyCreatedAt}: {new Date(artifact.created_at).toLocaleString("ko-KR")}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {ko.workspace.historyVersion}: {artifact.version}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {ko.workspace.historyParams}: {summarizeParams(currentStep, artifact.params)}
                        </p>
                        {(currentStep === 1 ||
                          currentStep === 2 ||
                          currentStep === 3 ||
                          currentStep === 4 ||
                          currentStep === 5 ||
                          currentStep === 6 ||
                          currentStep === 7 ||
                          currentStep === 8 ||
                          currentStep === 9 ||
                          currentStep === 10) && (
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={renameVersionMutation.isPending}
                              onClick={async (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const initialName = versionName ?? `${ko.workspace.historyVersion} ${artifact.version}`;
                                const nextName = window.prompt(ko.step1Version.renamePrompt, initialName);
                                if (!nextName || nextName.trim().length === 0) {
                                  return;
                                }
                                await renameVersionMutation.mutateAsync({ artifactId: artifact.id, name: nextName.trim() });
                              }}
                            >
                              {ko.step1Version.renameButton}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deleteVersionMutation.isPending}
                              onClick={async (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (!window.confirm(ko.step1Version.deleteConfirm)) {
                                  return;
                                }
                                await deleteVersionMutation.mutateAsync(artifact.id);
                              }}
                            >
                              {ko.step1Version.deleteButton}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={artifact.id} className="rounded-md border border-border bg-card p-3 text-left">
                      <p className="text-sm font-semibold">
                        {ko.workspace.historyVersion} {artifact.version}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {ko.workspace.historyCreatedAt}: {new Date(artifact.created_at).toLocaleString("ko-KR")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ko.workspace.historyParams}: {summarizeParams(currentStep, artifact.params)}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
