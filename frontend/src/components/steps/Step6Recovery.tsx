"use client";

import { useEffect, useState } from "react";

import { ko } from "@/i18n/ko";
import { StepArtifact } from "@/types/domain";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export type Step6ViewerMode = "original" | "base" | "preview" | "saved";

export interface Step6Params {
  max_expand_um: number;
  recover_sensitivity: number;
  edge_protect: number;
  fill_small_holes: boolean;
}

interface Step6RecoveryProps extends StepPanelProps {
  viewerMode: Step6ViewerMode;
  params: Step6Params;
  selectedStep5ArtifactId: string | null;
  selectedArtifact: StepArtifact | null;
  previewLoading: boolean;
  hasBaseMask: boolean;
  onViewerModeChange: (mode: Step6ViewerMode) => void;
  onParamsChange: (patch: Partial<Step6Params>) => void;
  onApplyPreview: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown): number | null {
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    return null;
  }
  return converted;
}

export function Step6Recovery({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  viewerMode,
  params,
  selectedStep5ArtifactId,
  selectedArtifact,
  previewLoading,
  hasBaseMask,
  onViewerModeChange,
  onParamsChange,
  onApplyPreview,
}: Step6RecoveryProps) {
  const pending = executingStepId === 6;
  const [maxExpandUmInput, setMaxExpandUmInput] = useState(String(params.max_expand_um));
  const [recoverSensitivityInput, setRecoverSensitivityInput] = useState(String(params.recover_sensitivity));
  const [edgeProtectInput, setEdgeProtectInput] = useState(String(params.edge_protect));

  const qc = selectedArtifact?.params?.qc;
  const qcObject = qc && typeof qc === "object" ? (qc as Record<string, unknown>) : null;
  const expansionRatio = qcObject ? toNumber(qcObject.expansion_ratio) : null;
  const expandedArea = qcObject ? toNumber(qcObject.expanded_area_px) : null;
  const areaRatio = qcObject ? toNumber(qcObject.mask_area_ratio_pct) : null;

  useEffect(() => {
    setMaxExpandUmInput(String(params.max_expand_um));
  }, [params.max_expand_um]);

  useEffect(() => {
    setRecoverSensitivityInput(String(params.recover_sensitivity));
  }, [params.recover_sensitivity]);

  useEffect(() => {
    setEdgeProtectInput(String(params.edge_protect));
  }, [params.edge_protect]);

  const commitMaxExpandUm = () => {
    const parsed = Number(maxExpandUmInput.trim());
    if (!Number.isFinite(parsed)) {
      setMaxExpandUmInput(String(params.max_expand_um));
      return;
    }
    const next = clamp(parsed, 0, 10);
    onParamsChange({ max_expand_um: next });
    setMaxExpandUmInput(String(next));
  };

  const commitRecoverSensitivity = () => {
    const parsed = Number(recoverSensitivityInput.trim());
    if (!Number.isFinite(parsed)) {
      setRecoverSensitivityInput(String(params.recover_sensitivity));
      return;
    }
    const next = Math.round(clamp(parsed, 0, 100));
    onParamsChange({ recover_sensitivity: next });
    setRecoverSensitivityInput(String(next));
  };

  const commitEdgeProtect = () => {
    const parsed = Number(edgeProtectInput.trim());
    if (!Number.isFinite(parsed)) {
      setEdgeProtectInput(String(params.edge_protect));
      return;
    }
    const next = Math.round(clamp(parsed, 0, 100));
    onParamsChange({ edge_protect: next });
    setEdgeProtectInput(String(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step6.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["6"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step6.viewerModeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "original" ? "default" : "outline"}
              onClick={() => onViewerModeChange("original")}
            >
              {ko.step6.viewerModeOriginal}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "base" ? "default" : "outline"}
              onClick={() => onViewerModeChange("base")}
            >
              {ko.step6.viewerModeBase}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "preview" ? "default" : "outline"}
              onClick={() => onViewerModeChange("preview")}
            >
              {ko.step6.viewerModePreview}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "saved" ? "default" : "outline"}
              onClick={() => onViewerModeChange("saved")}
            >
              {ko.step6.viewerModeSaved}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{ko.step6.maxExpandUm}</Label>
          <Slider
            value={[params.max_expand_um]}
            onValueChange={(values) => onParamsChange({ max_expand_um: clamp(values[0] ?? 0, 0, 10) })}
            min={0}
            max={10}
            step={0.05}
          />
          <Input
            type="text"
            inputMode="decimal"
            value={maxExpandUmInput}
            onChange={(event) => setMaxExpandUmInput(event.target.value)}
            onBlur={commitMaxExpandUm}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitMaxExpandUm();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{ko.step6.maxExpandUmHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step6.recoverSensitivity}</Label>
          <Slider
            value={[params.recover_sensitivity]}
            onValueChange={(values) => onParamsChange({ recover_sensitivity: Math.round(clamp(values[0] ?? 0, 0, 100)) })}
            min={0}
            max={100}
            step={1}
          />
          <Input
            type="text"
            inputMode="numeric"
            value={recoverSensitivityInput}
            onChange={(event) => setRecoverSensitivityInput(event.target.value)}
            onBlur={commitRecoverSensitivity}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRecoverSensitivity();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{ko.step6.recoverSensitivityHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step6.edgeProtect}</Label>
          <Slider
            value={[params.edge_protect]}
            onValueChange={(values) => onParamsChange({ edge_protect: Math.round(clamp(values[0] ?? 0, 0, 100)) })}
            min={0}
            max={100}
            step={1}
          />
          <Input
            type="text"
            inputMode="numeric"
            value={edgeProtectInput}
            onChange={(event) => setEdgeProtectInput(event.target.value)}
            onBlur={commitEdgeProtect}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitEdgeProtect();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{ko.step6.edgeProtectHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step6.fillSmallHoles}</Label>
          <Button
            type="button"
            variant={params.fill_small_holes ? "default" : "outline"}
            className="w-full"
            onClick={() => onParamsChange({ fill_small_holes: !params.fill_small_holes })}
          >
            {params.fill_small_holes ? ko.step6.toggleOn : ko.step6.toggleOff}
          </Button>
        </div>

        {previewLoading && (
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {ko.step6.previewRunning}
          </p>
        )}

        {!hasBaseMask && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step6.noMaskNotice}
          </p>
        )}

        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step6.lockNoticePrefix}: {lockMessage ?? ko.step6.lockMessage}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isLocked || !hasBaseMask}
          onClick={onApplyPreview}
        >
          {ko.step6.previewApplyButton}
        </Button>

        <StepExecuteButton
          label={ko.step6.runButton}
          pending={pending}
          disabled={isLocked || !hasBaseMask}
          onConfirm={() =>
            onExecute(6, {
              base_mask_artifact_id: selectedStep5ArtifactId || undefined,
              max_expand_um: params.max_expand_um,
              recover_sensitivity: params.recover_sensitivity,
              edge_protect: params.edge_protect,
              fill_small_holes: params.fill_small_holes,
            })
          }
        />

        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{ko.step6.qcTitle}</p>
          {selectedArtifact == null && <p>{ko.step6.qcEmpty}</p>}
          {selectedArtifact != null && (
            <>
              <p>
                {ko.step6.qcExpansionRatio}:{" "}
                <span className="font-semibold text-foreground">{expansionRatio == null ? "-" : expansionRatio.toFixed(4)}</span>
              </p>
              <p>
                {ko.step6.qcExpandedArea}:{" "}
                <span className="font-semibold text-foreground">{expandedArea == null ? "-" : Math.round(expandedArea)}</span>
              </p>
              <p>
                {ko.step6.qcAreaRatio}:{" "}
                <span className="font-semibold text-foreground">{areaRatio == null ? "-" : `${areaRatio.toFixed(3)}%`}</span>
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
