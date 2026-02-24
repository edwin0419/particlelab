"use client";

import { useEffect, useState } from "react";

import { ko } from "@/i18n/ko";
import { Step4ViewerMode, useStep1Store } from "@/store/useStep1Store";
import { StepArtifact } from "@/types/domain";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

interface Step4BinarizeProps extends StepPanelProps {
  viewerMode: Step4ViewerMode;
  onViewerModeChange: (mode: Step4ViewerMode) => void;
  selectedStep3ArtifactId: string | null;
  selectedArtifact: StepArtifact | null;
  previewLoading: boolean;
}

function toNumber(value: unknown): number | null {
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    return null;
  }
  return converted;
}

export function Step4Binarize({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  viewerMode,
  onViewerModeChange,
  selectedStep3ArtifactId,
  selectedArtifact,
  previewLoading,
}: Step4BinarizeProps) {
  const step4Params = useStep1Store((state) => state.step4Params);
  const setStep4Params = useStep1Store((state) => state.setStep4Params);
  const [minAreaInput, setMinAreaInput] = useState(String(step4Params.min_area_um2));

  const pending = executingStepId === 4;
  const qc = selectedArtifact?.params?.qc;
  const qcObject = qc && typeof qc === "object" ? (qc as Record<string, unknown>) : null;
  const areaRatio = qcObject ? toNumber(qcObject.mask_area_ratio_pct) : null;
  const expansion = qcObject ? toNumber(qcObject.seed_to_final_expansion_ratio) : null;
  const boundary = qcObject ? toNumber(qcObject.boundary_complexity) : null;

  const updateParams = (patch: Parameters<typeof setStep4Params>[0]) => {
    setStep4Params(patch);
    if (viewerMode === "input") {
      onViewerModeChange("mask");
    }
  };

  useEffect(() => {
    setMinAreaInput(String(step4Params.min_area_um2));
  }, [step4Params.min_area_um2]);

  const commitMinAreaInput = () => {
    const trimmed = minAreaInput.trim();
    if (!trimmed) {
      setMinAreaInput(String(step4Params.min_area_um2));
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setMinAreaInput(String(step4Params.min_area_um2));
      return;
    }

    const next = Math.max(0.0001, parsed);
    updateParams({ min_area_um2: next });
    setMinAreaInput(String(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step4.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["4"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step4.viewerModeLabel}</Label>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                size="sm"
                className="w-full"
                variant={viewerMode === "input" ? "default" : "outline"}
                onClick={() => onViewerModeChange("input")}
              >
                {ko.step4.viewerInput}
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-full"
                variant={viewerMode === "seed" ? "default" : "outline"}
                onClick={() => onViewerModeChange("seed")}
              >
                {ko.step4.viewerSeed}
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-full"
                variant={viewerMode === "candidate" ? "default" : "outline"}
                onClick={() => onViewerModeChange("candidate")}
              >
                {ko.step4.viewerCandidate}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                className="w-full"
                variant={viewerMode === "mask" ? "default" : "outline"}
                onClick={() => onViewerModeChange("mask")}
              >
                {ko.step4.viewerMask}
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-full"
                variant={viewerMode === "mask_binary" ? "default" : "outline"}
                onClick={() => onViewerModeChange("mask_binary")}
              >
                {ko.step4.viewerMaskBinary}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{ko.step4.previewLayerHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step4.modeLabel}</Label>
          <select
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
            value={step4Params.mode}
            onChange={(event) =>
              updateParams({
                mode: event.target.value as typeof step4Params.mode,
              })
            }
          >
            <option value="structure">{ko.step4.modeStructure}</option>
            <option value="simple">{ko.step4.modeSimple}</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>{ko.step4.seedSensitivity}</Label>
          <Slider
            value={[step4Params.seed_sensitivity]}
            onValueChange={(values) => updateParams({ seed_sensitivity: values[0] ?? 50 })}
            min={0}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">{Math.round(step4Params.seed_sensitivity)}</p>
          <p className="text-xs text-muted-foreground">{ko.step4.seedSensitivityHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step4.candidateSensitivity}</Label>
          <Slider
            value={[step4Params.candidate_sensitivity]}
            onValueChange={(values) => updateParams({ candidate_sensitivity: values[0] ?? 50 })}
            min={0}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">{Math.round(step4Params.candidate_sensitivity)}</p>
          <p className="text-xs text-muted-foreground">{ko.step4.candidateSensitivityHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step4.structureScaleUm}</Label>
          <Input
            type="number"
            min={0.05}
            step={0.05}
            value={step4Params.structure_scale_um}
            onChange={(event) =>
              updateParams({
                structure_scale_um: Number.isFinite(Number(event.target.value))
                  ? Math.max(0.05, Number(event.target.value))
                  : step4Params.structure_scale_um,
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step4.structureScaleUmHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step4.minAreaUm2}</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={minAreaInput}
            onChange={(event) => setMinAreaInput(event.target.value)}
            onBlur={commitMinAreaInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitMinAreaInput();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{ko.step4.minAreaUm2Hint}</p>
        </div>

        {previewLoading && (
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">{ko.step4.previewLoading}</p>
        )}

        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step4.lockNoticePrefix}: {lockMessage ?? ko.step4.lockMessage}
          </p>
        )}

        <StepExecuteButton
          label={ko.step4.runButton}
          pending={pending}
          disabled={isLocked}
          onConfirm={() =>
            onExecute(4, {
              mode: step4Params.mode,
              seed_sensitivity: step4Params.seed_sensitivity,
              candidate_sensitivity: step4Params.candidate_sensitivity,
              structure_scale_um: step4Params.structure_scale_um,
              min_area_um2: step4Params.min_area_um2,
              input_artifact_id: selectedStep3ArtifactId,
            })
          }
        />

        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <p className="text-sm font-semibold">{ko.step4.qcTitle}</p>
          {selectedArtifact == null && <p className="text-xs text-muted-foreground">{ko.step4.qcEmpty}</p>}
          {selectedArtifact != null && (
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>
                {ko.step4.qcAreaRatio}:{" "}
                <span className="font-semibold text-foreground">{areaRatio == null ? "-" : `${areaRatio.toFixed(3)}%`}</span>
              </p>
              <p>
                {ko.step4.qcExpansion}:{" "}
                <span className="font-semibold text-foreground">{expansion == null ? "-" : expansion.toFixed(4)}</span>
              </p>
              <p>
                {ko.step4.qcBoundary}:{" "}
                <span className="font-semibold text-foreground">{boundary == null ? "-" : boundary.toFixed(4)}</span>
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
