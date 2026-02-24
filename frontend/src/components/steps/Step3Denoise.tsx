"use client";

import { ko } from "@/i18n/ko";
import { Step3ViewerMode, useStep1Store } from "@/store/useStep1Store";
import { StepArtifact } from "@/types/domain";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

interface Step3DenoiseProps extends StepPanelProps {
  viewerMode: Step3ViewerMode;
  onViewerModeChange: (mode: Step3ViewerMode) => void;
  selectedStep2ArtifactId: string | null;
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

export function Step3Denoise({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  viewerMode,
  onViewerModeChange,
  selectedStep2ArtifactId,
  selectedArtifact,
  previewLoading,
}: Step3DenoiseProps) {
  const step3Params = useStep1Store((state) => state.step3Params);
  const setStep3Params = useStep1Store((state) => state.setStep3Params);

  const pending = executingStepId === 3;
  const qc = selectedArtifact?.params?.qc;
  const qcObject = qc && typeof qc === "object" ? (qc as Record<string, unknown>) : null;
  const noiseReductionPct = qcObject ? toNumber(qcObject.noise_reduction_pct) : null;
  const edgePreservePct = qcObject ? toNumber(qcObject.edge_preserve_pct) : null;
  const noiseLevel = qcObject && typeof qcObject.noise_reduction_level === "string" ? qcObject.noise_reduction_level : null;
  const edgeLevel = qcObject && typeof qcObject.edge_preserve_level === "string" ? qcObject.edge_preserve_level : null;

  const updatePreviewParams = (patch: Parameters<typeof setStep3Params>[0]) => {
    setStep3Params(patch);
    onViewerModeChange("preview");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step3.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["3"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step3.modeLabel}</Label>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "input" ? "default" : "outline"}
              onClick={() => onViewerModeChange("input")}
            >
              {ko.step3.modeInput}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "preview" ? "default" : "outline"}
              onClick={() => onViewerModeChange("preview")}
            >
              {ko.step3.modePreview}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "saved" ? "default" : "outline"}
              onClick={() => onViewerModeChange("saved")}
            >
              {ko.step3.modeSaved}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{ko.step3.methodLabel}</Label>
          <select
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
            value={step3Params.method}
            onChange={(event) =>
              updatePreviewParams({
                method: event.target.value as typeof step3Params.method,
              })
            }
          >
            <option value="bilateral">{ko.step3.methodBilateral}</option>
            <option value="nlm">{ko.step3.methodNlm}</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>{ko.step3.strength}</Label>
          <Slider
            value={[step3Params.strength]}
            onValueChange={(values) => updatePreviewParams({ strength: values[0] ?? 0 })}
            min={0}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">{step3Params.strength}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step3.edgeProtect}</Label>
          <Slider
            value={[step3Params.edge_protect]}
            onValueChange={(values) => updatePreviewParams({ edge_protect: values[0] ?? 0 })}
            min={0}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">{step3Params.edge_protect}</p>
        </div>

        <details className="rounded-md border border-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{ko.step3.advancedOptions}</summary>
          <div className="mt-3 space-y-2">
            <Label>{ko.step3.qualityMode}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={step3Params.quality_mode === "빠름" ? "default" : "outline"}
                onClick={() => updatePreviewParams({ quality_mode: "빠름" })}
              >
                {ko.step3.qualityFast}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={step3Params.quality_mode === "정확" ? "default" : "outline"}
                onClick={() => updatePreviewParams({ quality_mode: "정확" })}
              >
                {ko.step3.qualityAccurate}
              </Button>
            </div>
          </div>
        </details>

        {previewLoading && (
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {ko.step3.previewUpdating}
          </p>
        )}

        {isLocked && lockMessage && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step3.lockNoticePrefix}: {lockMessage}
          </p>
        )}

        <StepExecuteButton
          label={ko.step3.runButton}
          pending={pending}
          disabled={isLocked}
          onConfirm={() =>
            onExecute(3, {
              method: step3Params.method,
              strength: step3Params.strength,
              edge_protect: step3Params.edge_protect,
              quality_mode: step3Params.quality_mode,
              input_artifact_id: selectedStep2ArtifactId,
            })
          }
        />

        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <p className="text-sm font-semibold">{ko.step3.qcTitle}</p>
          {selectedArtifact == null && <p className="text-xs text-muted-foreground">{ko.step3.qcEmpty}</p>}
          {selectedArtifact != null && (
            <div className="space-y-1.5 text-xs">
              <p className="text-muted-foreground">
                {ko.step3.qcNoiseReduction}:{" "}
                <span className="font-semibold text-foreground">
                  {noiseReductionPct == null ? "-" : `${noiseReductionPct.toFixed(2)}%`} {noiseLevel ?? ""}
                </span>
              </p>
              <p className="text-muted-foreground">
                {ko.step3.qcEdgePreserve}:{" "}
                <span className="font-semibold text-foreground">
                  {edgePreservePct == null ? "-" : `${edgePreservePct.toFixed(2)}%`} {edgeLevel ?? ""}
                </span>
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
