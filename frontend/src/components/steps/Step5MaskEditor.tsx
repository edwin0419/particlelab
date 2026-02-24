"use client";

import { useEffect, useState } from "react";

import { ko } from "@/i18n/ko";
import { Step5BrushMode, Step5ViewerMode } from "@/components/step5/Step5MaskEditorViewer";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

interface Step5MaskEditorProps extends StepPanelProps {
  viewerMode: Step5ViewerMode;
  brushMode: Step5BrushMode;
  brushSizePx: number;
  canUndo: boolean;
  canRedo: boolean;
  hasMask: boolean;
  baseMaskArtifactId: string | null;
  onViewerModeChange: (mode: Step5ViewerMode) => void;
  onBrushModeChange: (mode: Step5BrushMode) => void;
  onBrushSizePxChange: (value: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetToBase: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step5MaskEditor({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  viewerMode,
  brushMode,
  brushSizePx,
  canUndo,
  canRedo,
  hasMask,
  baseMaskArtifactId,
  onViewerModeChange,
  onBrushModeChange,
  onBrushSizePxChange,
  onUndo,
  onRedo,
  onResetToBase,
}: Step5MaskEditorProps) {
  const pending = executingStepId === 5;
  const [brushSizeInput, setBrushSizeInput] = useState(String(brushSizePx));

  useEffect(() => {
    setBrushSizeInput(String(brushSizePx));
  }, [brushSizePx]);

  const commitBrushSizeInput = () => {
    const parsed = Number(brushSizeInput.trim());
    if (!Number.isFinite(parsed)) {
      setBrushSizeInput(String(brushSizePx));
      return;
    }
    const next = clamp(Math.round(parsed), 1, 60);
    onBrushSizePxChange(next);
    setBrushSizeInput(String(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step5.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["5"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step5.viewerModeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "overlay" ? "default" : "outline"}
              onClick={() => onViewerModeChange("overlay")}
            >
              {ko.step5.viewerModeOverlay}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewerMode === "binary" ? "default" : "outline"}
              onClick={() => onViewerModeChange("binary")}
            >
              {ko.step5.viewerModeBinary}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{ko.step5.modeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={brushMode === "erase" ? "default" : "outline"}
              onClick={() => onBrushModeChange("erase")}
            >
              {ko.step5.modeErase}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={brushMode === "restore" ? "default" : "outline"}
              onClick={() => onBrushModeChange("restore")}
            >
              {ko.step5.modeRestore}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{ko.step5.brushSize}</Label>
          <Slider
            value={[brushSizePx]}
            onValueChange={(values) => onBrushSizePxChange(clamp(Math.round(values[0] ?? 30), 1, 60))}
            min={1}
            max={60}
            step={1}
          />
          <Input
            type="text"
            inputMode="numeric"
            value={brushSizeInput}
            onChange={(event) => setBrushSizeInput(event.target.value)}
            onBlur={commitBrushSizeInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitBrushSizeInput();
              }
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={!canUndo} onClick={onUndo}>
            {ko.step5.undoButton}
          </Button>
          <Button type="button" variant="outline" disabled={!canRedo} onClick={onRedo}>
            {ko.step5.redoButton}
          </Button>
        </div>

        {!hasMask && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step5.noMaskNotice}
          </p>
        )}

        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step5.lockNoticePrefix}: {lockMessage ?? ko.step5.lockMessage}
          </p>
        )}

        <div className="space-y-3 rounded-lg border border-border bg-muted/25 p-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full border-amber-300 bg-amber-50 font-semibold text-amber-900 hover:bg-amber-100"
            disabled={!hasMask}
            onClick={() => {
              if (!window.confirm(ko.step5.resetConfirm)) {
                return;
              }
              onResetToBase();
            }}
          >
            {ko.step5.resetButton}
          </Button>

          <StepExecuteButton
            label={ko.step5.runButton}
            pending={pending}
            disabled={isLocked || !hasMask}
            buttonClassName="h-11 text-base font-semibold shadow-sm"
            onConfirm={() =>
              onExecute(5, {
                base_mask_artifact_id: baseMaskArtifactId || undefined,
                brush_mode: brushMode === "restore" ? "복원" : "삭제",
                brush_size_px: brushSizePx,
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
