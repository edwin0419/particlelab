"use client";

import { useEffect, useMemo, useState } from "react";

import { ko } from "@/i18n/ko";
import { StepArtifact } from "@/types/domain";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export type Step7ViewerMode = "solid" | "outer" | "porosity";
export type Step7BackgroundMode = "original" | "binary";

export interface Step7Params {
  hole_mode: "fill_all" | "fill_small" | "keep";
  max_hole_area_um2: number;
  closing_enabled: boolean;
  closing_radius_um: number;
}

export interface Step7Metrics {
  solid_area_px: number;
  outer_area_px: number;
  porosity: number;
}

interface Step7DualMaskProps extends StepPanelProps {
  viewerMode: Step7ViewerMode;
  backgroundMode: Step7BackgroundMode;
  params: Step7Params;
  selectedStep6ArtifactId: string | null;
  selectedArtifact: StepArtifact | null;
  previewLoading: boolean;
  previewActive: boolean;
  hasBaseMask: boolean;
  hasBinaryBackground: boolean;
  metrics: Step7Metrics | null;
  onViewerModeChange: (mode: Step7ViewerMode) => void;
  onBackgroundModeChange: (mode: Step7BackgroundMode) => void;
  onParamsChange: (patch: Partial<Step7Params>) => void;
  onPreview: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step7DualMask({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  backgroundMode,
  params,
  selectedStep6ArtifactId,
  selectedArtifact,
  previewLoading,
  previewActive,
  hasBaseMask,
  hasBinaryBackground,
  metrics,
  onBackgroundModeChange,
  onParamsChange,
  onPreview,
}: Step7DualMaskProps) {
  const pending = executingStepId === 7;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxHoleAreaInput, setMaxHoleAreaInput] = useState(String(params.max_hole_area_um2));
  const [closingRadiusInput, setClosingRadiusInput] = useState(String(params.closing_radius_um));

  useEffect(() => {
    setMaxHoleAreaInput(String(params.max_hole_area_um2));
  }, [params.max_hole_area_um2]);

  useEffect(() => {
    setClosingRadiusInput(String(params.closing_radius_um));
  }, [params.closing_radius_um]);

  const porosityPct = useMemo(() => {
    if (!metrics) {
      return null;
    }
    return metrics.porosity * 100;
  }, [metrics]);

  const commitMaxHoleArea = () => {
    const parsed = Number(maxHoleAreaInput.trim());
    if (!Number.isFinite(parsed)) {
      setMaxHoleAreaInput(String(params.max_hole_area_um2));
      return;
    }
    const next = clamp(parsed, 0.0001, 1_000_000_000);
    onParamsChange({ max_hole_area_um2: next });
    setMaxHoleAreaInput(String(next));
  };

  const commitClosingRadius = () => {
    const parsed = Number(closingRadiusInput.trim());
    if (!Number.isFinite(parsed)) {
      setClosingRadiusInput(String(params.closing_radius_um));
      return;
    }
    const next = clamp(parsed, 0, 10);
    onParamsChange({ closing_radius_um: next });
    setClosingRadiusInput(String(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step7.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["7"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step7.backgroundModeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={backgroundMode === "original" ? "default" : "outline"}
              onClick={() => onBackgroundModeChange("original")}
            >
              {ko.step7.backgroundModeOriginal}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={backgroundMode === "binary" ? "default" : "outline"}
              disabled={!hasBinaryBackground}
              onClick={() => onBackgroundModeChange("binary")}
            >
              {ko.step7.backgroundModeBinary}
            </Button>
          </div>
          {!hasBinaryBackground && <p className="text-xs text-muted-foreground">{ko.step7.backgroundModeBinaryMissing}</p>}
          <p className="text-xs text-muted-foreground">{previewActive ? ko.step7.previewActiveHint : ko.step7.savedActiveHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step7.holeModeLabel}</Label>
          <div className="space-y-2">
            <Button
              type="button"
              variant={params.hole_mode === "fill_all" ? "default" : "outline"}
              className="h-auto w-full justify-start py-2 text-left"
              onClick={() => onParamsChange({ hole_mode: "fill_all" })}
            >
              {ko.step7.holeModeFillAll}
            </Button>
            <Button
              type="button"
              variant={params.hole_mode === "fill_small" ? "default" : "outline"}
              className="h-auto w-full justify-start py-2 text-left"
              onClick={() => onParamsChange({ hole_mode: "fill_small" })}
            >
              {ko.step7.holeModeFillSmall}
            </Button>
            <Button
              type="button"
              variant={params.hole_mode === "keep" ? "default" : "outline"}
              className="h-auto w-full justify-start py-2 text-left"
              onClick={() => onParamsChange({ hole_mode: "keep" })}
            >
              {ko.step7.holeModeKeep}
            </Button>
          </div>
        </div>

        {params.hole_mode === "fill_small" && (
          <div className="space-y-2">
            <Label>{ko.step7.maxHoleAreaUm2}</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={maxHoleAreaInput}
              onChange={(event) => setMaxHoleAreaInput(event.target.value)}
              onBlur={commitMaxHoleArea}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitMaxHoleArea();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">{ko.step7.maxHoleAreaUm2Hint}</p>
          </div>
        )}

        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            {advancedOpen ? ko.step7.advancedClose : ko.step7.advancedOpen}
          </Button>
          {advancedOpen && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <Label>{ko.step7.closingToggle}</Label>
                <Button
                  type="button"
                  variant={params.closing_enabled ? "default" : "outline"}
                  className="w-full"
                  onClick={() => onParamsChange({ closing_enabled: !params.closing_enabled })}
                >
                  {params.closing_enabled ? ko.step7.toggleOn : ko.step7.toggleOff}
                </Button>
              </div>

              {params.closing_enabled && (
                <div className="space-y-2">
                  <Label>{ko.step7.closingRadiusUm}</Label>
                  <Slider
                    value={[params.closing_radius_um]}
                    onValueChange={(values) =>
                      onParamsChange({
                        closing_radius_um: clamp(values[0] ?? params.closing_radius_um, 0, 10),
                      })
                    }
                    min={0}
                    max={10}
                    step={0.05}
                  />
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={closingRadiusInput}
                    onChange={(event) => setClosingRadiusInput(event.target.value)}
                    onBlur={commitClosingRadius}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitClosingRadius();
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{ko.step7.closingRadiusUmHint}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {previewLoading && (
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {ko.step7.previewRunning}
          </p>
        )}

        {!hasBaseMask && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step7.noMaskNotice}
          </p>
        )}

        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step7.lockNoticePrefix}: {lockMessage ?? ko.step7.lockMessage}
          </p>
        )}

        <Button type="button" variant="outline" className="w-full" disabled={isLocked || !hasBaseMask} onClick={onPreview}>
          {ko.step7.previewButton}
        </Button>

        <StepExecuteButton
          label={ko.step7.runButton}
          pending={pending}
          disabled={isLocked || !hasBaseMask}
          onConfirm={() =>
            onExecute(7, {
              base_mask_artifact_id: selectedStep6ArtifactId || undefined,
              hole_mode: params.hole_mode,
              max_hole_area_um2: params.hole_mode === "fill_small" ? params.max_hole_area_um2 : null,
              closing_enabled: params.closing_enabled,
              closing_radius_um: params.closing_enabled ? params.closing_radius_um : null,
            })
          }
        />

        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{ko.step7.metricsTitle}</p>
          {metrics == null && <p>{ko.step7.metricsEmpty}</p>}
          {metrics != null && (
            <>
              <p>
                {ko.step7.metricOuterAreaPx}:{" "}
                <span className="font-semibold text-foreground">{Math.round(metrics.outer_area_px)}</span>
              </p>
              <p>
                {ko.step7.metricSolidAreaPx}:{" "}
                <span className="font-semibold text-foreground">{Math.round(metrics.solid_area_px)}</span>
              </p>
              <p>
                {ko.step7.metricPorosity}:{" "}
                <span className="font-semibold text-foreground">
                  {porosityPct == null ? "-" : `${porosityPct.toFixed(3)}%`}
                </span>
              </p>
            </>
          )}
          {selectedArtifact && (
            <p className="pt-1 text-[11px]">
              {ko.workspace.historyVersion}: {selectedArtifact.version}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
