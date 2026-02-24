"use client";

import { ko } from "@/i18n/ko";
import { Step2ViewerMode, useStep1Store } from "@/store/useStep1Store";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

interface Step2PreprocessProps extends StepPanelProps {
  viewerMode: Step2ViewerMode;
  onViewerModeChange: (mode: Step2ViewerMode) => void;
}

export function Step2Preprocess({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  viewerMode,
  onViewerModeChange,
}: Step2PreprocessProps) {
  const step2Params = useStep1Store((state) => state.step2Params);
  const setStep2Params = useStep1Store((state) => state.setStep2Params);

  const pending = executingStepId === 2;
  const updatePreviewParams = (patch: Parameters<typeof setStep2Params>[0]) => {
    setStep2Params(patch);
    onViewerModeChange("preview");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.steps.names["2"]}</CardTitle>
        <CardDescription>{ko.steps.descriptions["2"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step2.modeLabel}</Label>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "input" ? "default" : "outline"}
              onClick={() => onViewerModeChange("input")}
            >
              {ko.step2.modeInput}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "preview" ? "default" : "outline"}
              onClick={() => onViewerModeChange("preview")}
            >
              {ko.step2.modePreview}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "saved" ? "default" : "outline"}
              onClick={() => onViewerModeChange("saved")}
            >
              {ko.step2.modeSaved}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{ko.step2.brightness}</Label>
          <Slider
            value={[step2Params.brightness]}
            onValueChange={(values) => updatePreviewParams({ brightness: values[0] ?? 0 })}
            min={-100}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">{step2Params.brightness}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step2.contrast}</Label>
          <Slider
            value={[step2Params.contrast]}
            onValueChange={(values) => updatePreviewParams({ contrast: values[0] ?? 0 })}
            min={-100}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">{step2Params.contrast}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step2.gamma}</Label>
          <Slider
            value={[step2Params.gamma]}
            onValueChange={(values) => updatePreviewParams({ gamma: values[0] ?? 1 })}
            min={0.2}
            max={5}
            step={0.05}
          />
          <p className="text-xs text-muted-foreground">{step2Params.gamma.toFixed(2)}</p>
        </div>

        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label>{ko.step2.claheUse}</Label>
            <Button
              type="button"
              size="sm"
              variant={step2Params.clahe_enabled ? "default" : "outline"}
              onClick={() => updatePreviewParams({ clahe_enabled: !step2Params.clahe_enabled })}
            >
              {step2Params.clahe_enabled ? ko.step1Panel.toggleOn : ko.step1Panel.toggleOff}
            </Button>
          </div>
          <div className="space-y-2">
            <Label>{ko.step2.claheStrength}</Label>
            <p className="text-xs text-muted-foreground">{ko.step2.claheStrengthHelp}</p>
            <Slider
              value={[step2Params.clahe_strength]}
              onValueChange={(values) => updatePreviewParams({ clahe_strength: values[0] ?? 0 })}
              min={0}
              max={10}
              step={0.1}
              disabled={!step2Params.clahe_enabled}
            />
            <p className="text-xs text-muted-foreground">{step2Params.clahe_strength.toFixed(1)}</p>
          </div>
        </div>

        <details className="rounded-md border border-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{ko.step2.advancedOptions}</summary>
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <Label>{ko.step2.blackClip}</Label>
              <p className="text-xs text-muted-foreground">{ko.step2.blackClipHelp}</p>
              <Slider
                value={[step2Params.black_clip_pct]}
                onValueChange={(values) => updatePreviewParams({ black_clip_pct: values[0] ?? 0.5 })}
                min={0}
                max={5}
                step={0.1}
              />
              <p className="text-xs text-muted-foreground">{step2Params.black_clip_pct.toFixed(1)}%</p>
            </div>

            <div className="space-y-2">
              <Label>{ko.step2.whiteClip}</Label>
              <p className="text-xs text-muted-foreground">{ko.step2.whiteClipHelp}</p>
              <Slider
                value={[step2Params.white_clip_pct]}
                onValueChange={(values) => updatePreviewParams({ white_clip_pct: values[0] ?? 99.5 })}
                min={95}
                max={100}
                step={0.1}
              />
              <p className="text-xs text-muted-foreground">{step2Params.white_clip_pct.toFixed(1)}%</p>
            </div>

            <div className="space-y-2">
              <Label>{ko.step2.claheTile}</Label>
              <select
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
                value={step2Params.clahe_tile}
                onChange={(event) =>
                  updatePreviewParams({
                    clahe_tile: event.target.value as typeof step2Params.clahe_tile,
                  })
                }
              >
                <option value="auto">{ko.step2.claheTileAuto}</option>
                <option value="small">{ko.step2.claheTileSmall}</option>
                <option value="medium">{ko.step2.claheTileMedium}</option>
                <option value="large">{ko.step2.claheTileLarge}</option>
              </select>
            </div>
          </div>
        </details>

        {isLocked && lockMessage && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step2.lockNoticePrefix}: {lockMessage}
          </p>
        )}

        <StepExecuteButton
          label={ko.step2.runButton}
          pending={pending}
          disabled={isLocked}
          onConfirm={() =>
            onExecute(2, {
              brightness: step2Params.brightness,
              contrast: step2Params.contrast,
              gamma: step2Params.gamma,
              black_clip_pct: step2Params.black_clip_pct,
              white_clip_pct: step2Params.white_clip_pct,
              clahe_enabled: step2Params.clahe_enabled,
              clahe_strength: step2Params.clahe_strength,
              clahe_tile: step2Params.clahe_tile,
            })
          }
        />
      </CardContent>
    </Card>
  );
}
