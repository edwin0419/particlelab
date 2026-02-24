"use client";

import { ko } from "@/i18n/ko";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export interface Step9Params {
  smooth_level: number;
  resample_step_px: number;
  max_vertex_gap_px: number;
}

interface Props extends StepPanelProps {
  params: Step9Params;
  hasInputs: boolean;
  previewLoading: boolean;
  previewActive: boolean;
  polygonCount: number;
  onParamsChange: (patch: Partial<Step9Params>) => void;
  onPreview: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function Step9NeckSplit({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  params,
  hasInputs,
  previewLoading,
  previewActive,
  polygonCount,
  onParamsChange,
  onPreview,
}: Props) {
  const pending = executingStepId === 9;
  const canRun = hasInputs && !isLocked;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step9.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["9"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasInputs && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{ko.step9.noInputNotice}</p>
        )}

        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step9.lockNoticePrefix}: {lockMessage ?? ko.step9.lockMessage}
          </p>
        )}

        <div className="space-y-2">
          <Label>{ko.step9.smoothLevel}</Label>
          <Slider
            value={[params.smooth_level]}
            onValueChange={(values) => onParamsChange({ smooth_level: Math.round(clamp(values[0] ?? 0, 0, 100)) })}
            min={0}
            max={100}
            step={1}
          />
          <Input
            type="number"
            min={0}
            max={100}
            value={params.smooth_level}
            onChange={(event) =>
              onParamsChange({
                smooth_level: Math.round(clamp(safeNumber(event.target.value, params.smooth_level), 0, 100)),
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step9.smoothLevelHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step9.resampleStepPx}</Label>
          <Slider
            value={[params.resample_step_px]}
            onValueChange={(values) =>
              onParamsChange({ resample_step_px: Number(clamp(values[0] ?? 2, 0.5, 5).toFixed(1)) })
            }
            min={0.5}
            max={5}
            step={0.1}
          />
          <Input
            type="number"
            min={0.5}
            max={5}
            step={0.1}
            value={params.resample_step_px}
            onChange={(event) =>
              onParamsChange({
                resample_step_px: Number(clamp(safeNumber(event.target.value, params.resample_step_px), 0.5, 5).toFixed(2)),
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step9.resampleStepPxHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step9.maxVertexGapPx}</Label>
          <Slider
            value={[params.max_vertex_gap_px]}
            onValueChange={(values) =>
              onParamsChange({ max_vertex_gap_px: Number(clamp(values[0] ?? 3, 1, 8).toFixed(1)) })
            }
            min={1}
            max={8}
            step={0.1}
          />
          <Input
            type="number"
            min={1}
            max={8}
            step={0.1}
            value={params.max_vertex_gap_px}
            onChange={(event) =>
              onParamsChange({
                max_vertex_gap_px: Number(clamp(safeNumber(event.target.value, params.max_vertex_gap_px), 1, 8).toFixed(2)),
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step9.maxVertexGapPxHint}</p>
        </div>

        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {ko.step9.polygonCountLabel}: {polygonCount}
          <br />
          {previewActive ? ko.step9.previewHint : ko.step9.savedHint}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onPreview} disabled={!canRun || previewLoading || pending}>
            {previewLoading ? ko.step9.previewRunning : ko.step9.previewButton}
          </Button>
          <StepExecuteButton
            label={ko.step9.saveButton}
            pending={pending}
            disabled={!canRun}
            onConfirm={() =>
              onExecute(9, {
                smooth_level: Math.round(clamp(params.smooth_level, 0, 100)),
                resample_step_px: Number(clamp(params.resample_step_px, 0.5, 5).toFixed(2)),
                max_vertex_gap_px: Number(clamp(params.max_vertex_gap_px, 1, 8).toFixed(2)),
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
