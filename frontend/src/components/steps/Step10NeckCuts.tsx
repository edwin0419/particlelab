"use client";

import { ko } from "@/i18n/ko";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export interface Step10Params {
  split_strength: number;
  min_center_distance_px: number;
  min_particle_area: number;
}

interface Props extends StepPanelProps {
  params: Step10Params;
  hasInputs: boolean;
  hasGrayInput: boolean;
  previewLoading: boolean;
  previewActive: boolean;
  splitLineCount: number;
  labelCount: number;
  qcWarnings: string[];
  hoveredFragmentId: number | null;
  hoveredFragmentAreaPx: number | null;
  canDownloadFragmentTable?: boolean;
  onDownloadFragmentTable?: () => void;
  onParamsChange: (patch: Partial<Step10Params>) => void;
  onPreview: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step10NeckCuts({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  params,
  hasInputs,
  hasGrayInput,
  previewLoading,
  previewActive,
  splitLineCount: _splitLineCount,
  labelCount,
  qcWarnings,
  hoveredFragmentId,
  hoveredFragmentAreaPx,
  canDownloadFragmentTable = false,
  onDownloadFragmentTable,
  onParamsChange,
  onPreview,
}: Props) {
  const pending = executingStepId === 10;
  const canRun = hasInputs && !isLocked;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step10.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["10"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasInputs && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{ko.step10.noInputNotice}</p>
        )}
        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step10.lockNoticePrefix}: {lockMessage ?? ko.step10.lockMessage}
          </p>
        )}
        {!hasGrayInput && (
          <p className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">{ko.step10.noGrayNotice}</p>
        )}

        <div className="space-y-2">
          <Label>{ko.step10.splitStrength}</Label>
          <Slider
            value={[params.split_strength]}
            onValueChange={(values) =>
              onParamsChange({ split_strength: Math.round(clamp(values[0] ?? params.split_strength, 0, 100)) })
            }
            min={0}
            max={100}
            step={1}
          />
          <Input
            type="number"
            min={0}
            max={100}
            value={params.split_strength}
            onChange={(event) =>
              onParamsChange({
                split_strength: Math.round(clamp(Number(event.target.value || params.split_strength), 0, 100)),
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step10.splitStrengthHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step10.minCenterDistancePx}</Label>
          <Slider
            value={[params.min_center_distance_px]}
            onValueChange={(values) =>
              onParamsChange({ min_center_distance_px: Math.round(clamp(values[0] ?? params.min_center_distance_px, 1, 120)) })
            }
            min={1}
            max={120}
            step={1}
          />
          <Input
            type="number"
            min={1}
            max={512}
            value={params.min_center_distance_px}
            onChange={(event) =>
              onParamsChange({
                min_center_distance_px: Math.round(clamp(Number(event.target.value || params.min_center_distance_px), 1, 512)),
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step10.minCenterDistancePxHint}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step10.minParticleArea}</Label>
          <Input
            type="number"
            min={1}
            step={1}
            value={params.min_particle_area}
            onChange={(event) =>
              onParamsChange({
                min_particle_area: Math.round(clamp(Number(event.target.value || params.min_particle_area), 1, 10_000_000)),
              })
            }
          />
          <p className="text-xs text-muted-foreground">{ko.step10.minParticleAreaHint}</p>
        </div>

        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <p>{ko.step10.labelCountLabel}: {labelCount}</p>
          <p>{previewActive ? ko.step10.previewHint : ko.step10.savedHint}</p>
          <p>{ko.step10.fragmentIdLabel}: {hoveredFragmentId == null ? "-" : hoveredFragmentId}</p>
          <p>{ko.step10.fragmentAreaLabel}: {hoveredFragmentAreaPx == null ? "-" : hoveredFragmentAreaPx}</p>
        </div>
        {qcWarnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {qcWarnings.map((warning, index) => (
              <p key={`${warning}-${index}`}>{warning}</p>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{ko.step10.hoverGuide}</p>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={!canRun || previewLoading || pending} onClick={onPreview}>
            {previewLoading ? ko.step10.previewRunning : ko.step10.previewButton}
          </Button>
          <StepExecuteButton
            label={ko.step10.saveButton}
            pending={pending}
            disabled={!canRun}
            onConfirm={() =>
              onExecute(10, {
                split_strength: clamp(Math.round(params.split_strength), 0, 100),
                min_center_distance_px: clamp(Math.round(params.min_center_distance_px), 1, 512),
                min_particle_area: clamp(Math.round(params.min_particle_area), 1, 10_000_000),
              })
            }
          />
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={!canDownloadFragmentTable}
          onClick={onDownloadFragmentTable}
          className="w-full"
        >
          {ko.step10.exportFragmentTableButton}
        </Button>
      </CardContent>
    </Card>
  );
}
