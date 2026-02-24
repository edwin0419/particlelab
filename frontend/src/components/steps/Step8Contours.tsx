"use client";

import { ko } from "@/i18n/ko";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export type Step8BackgroundMode = "original" | "binary";

interface Props extends StepPanelProps {
  contourCount: number;
  selectedContourId: number | null;
  loading?: boolean;
  hasBaseMask: boolean;
  baseMaskArtifactId: string | null;
  step7ArtifactId: string | null;
  backgroundMode: Step8BackgroundMode;
  hasBinaryBackground: boolean;
  onBackgroundModeChange: (mode: Step8BackgroundMode) => void;
  canDownloadContourOnly: boolean;
  onDownloadContourOnly: () => void;
  canDownloadContourWithOriginal: boolean;
  onDownloadContourWithOriginal: () => void;
}

export function Step8Contours({
  executingStepId,
  onExecute,
  isLocked = false,
  lockMessage,
  contourCount,
  selectedContourId,
  loading = false,
  hasBaseMask,
  baseMaskArtifactId,
  step7ArtifactId,
  backgroundMode,
  hasBinaryBackground,
  onBackgroundModeChange,
  canDownloadContourOnly,
  onDownloadContourOnly,
  canDownloadContourWithOriginal,
  onDownloadContourWithOriginal,
}: Props) {
  const pending = executingStepId === 8;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.step8.title}</CardTitle>
        <CardDescription>{ko.steps.descriptions["8"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Label>{ko.step8.backgroundModeLabel}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={backgroundMode === "original" ? "default" : "outline"}
              onClick={() => onBackgroundModeChange("original")}
            >
              {ko.step8.backgroundModeOriginal}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={backgroundMode === "binary" ? "default" : "outline"}
              disabled={!hasBinaryBackground}
              onClick={() => onBackgroundModeChange("binary")}
            >
              {ko.step8.backgroundModeBinary}
            </Button>
          </div>
          {!hasBinaryBackground && <p className="text-xs text-muted-foreground">{ko.step8.backgroundModeBinaryMissing}</p>}
        </div>

        {!hasBaseMask && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step8.noMaskNotice}
          </p>
        )}

        {isLocked && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ko.step8.lockNoticePrefix}: {lockMessage ?? ko.step8.lockMessage}
          </p>
        )}

        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          {loading && <p className="mb-2 text-xs text-muted-foreground">{ko.common.loading}</p>}
          <p>
            <span className="font-semibold">{ko.step8.contourCountLabel}: </span>
            <span>{contourCount}</span>
          </p>
          <p className="mt-1">
            <span className="font-semibold">{ko.step8.selectedContourIdLabel}: </span>
            <span>{selectedContourId == null ? "-" : selectedContourId}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <Button type="button" variant="outline" disabled={!canDownloadContourOnly} onClick={onDownloadContourOnly}>
            {ko.step8.downloadContourOnlyButton}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canDownloadContourWithOriginal}
            onClick={onDownloadContourWithOriginal}
          >
            {ko.step8.downloadContourWithOriginalButton}
          </Button>
        </div>

        <StepExecuteButton
          label={ko.step8.runButton}
          pending={pending}
          disabled={isLocked || !hasBaseMask}
          onConfirm={() =>
            onExecute(8, {
              base_mask_artifact_id: baseMaskArtifactId || undefined,
              step7_artifact_id: step7ArtifactId || undefined,
            })
          }
        />
      </CardContent>
    </Card>
  );
}
