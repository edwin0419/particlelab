"use client";

import { useMemo, useState } from "react";

import { ko } from "@/i18n/ko";
import { useAppStore } from "@/store/useAppStore";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export function Step1Calibration({ executingStepId, onExecute }: StepPanelProps) {
  const [manualUmPerPx, setManualUmPerPx] = useState("");
  const [realLengthUm, setRealLengthUm] = useState("");

  const measurementMode = useAppStore((state) => state.measurementMode);
  const setMeasurementMode = useAppStore((state) => state.setMeasurementMode);
  const measurementPoints = useAppStore((state) => state.measurementPoints);
  const clearMeasurementPoints = useAppStore((state) => state.clearMeasurementPoints);

  const distancePx = useMemo(() => {
    if (measurementPoints.length !== 2) {
      return 0;
    }
    const [p1, p2] = measurementPoints;
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }, [measurementPoints]);

  const computedUmPerPx = useMemo(() => {
    const real = Number(realLengthUm);
    if (!Number.isFinite(real) || real <= 0 || distancePx <= 0) {
      return null;
    }
    return real / distancePx;
  }, [realLengthUm, distancePx]);

  const pending = executingStepId === 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.steps.names["1"]}</CardTitle>
        <CardDescription>{ko.steps.descriptions["1"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{ko.step1.manualTitle}</Label>
          <Input
            value={manualUmPerPx}
            onChange={(e) => setManualUmPerPx(e.target.value)}
            placeholder={ko.step1.manualPlaceholder}
          />
        </div>

        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <Label>{ko.step1.toolTitle}</Label>
            <Button
              size="sm"
              variant={measurementMode ? "secondary" : "outline"}
              onClick={() => setMeasurementMode(!measurementMode)}
            >
              {measurementMode ? ko.step1.toolDisable : ko.step1.toolEnable}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{ko.step1.helper}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{ko.step1.pixelDistance}</Label>
              <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                {distancePx > 0 ? `${distancePx.toFixed(2)} px` : "-"}
              </div>
            </div>
            <div className="space-y-1">
              <Label>{ko.step1.realLengthLabel}</Label>
              <Input
                value={realLengthUm}
                onChange={(e) => setRealLengthUm(e.target.value)}
                placeholder={ko.step1.realLengthPlaceholder}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{ko.step1.computedUmPerPx}</Label>
            <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {computedUmPerPx ? computedUmPerPx.toFixed(6) : "-"}
            </div>
          </div>

          <Button size="sm" variant="outline" onClick={clearMeasurementPoints}>
            {ko.step1.clearPoints}
          </Button>
        </div>

        <StepExecuteButton
          label={ko.step1.runButton}
          pending={pending}
          onConfirm={async () => {
            const finalUmPerPx = computedUmPerPx ?? Number(manualUmPerPx);
            await onExecute(1, {
              mode: computedUmPerPx ? "two_point" : "manual",
              um_per_px: Number.isFinite(finalUmPerPx) && finalUmPerPx > 0 ? finalUmPerPx : null,
              points: measurementPoints,
              distance_px: distancePx,
              real_length_um: Number(realLengthUm) || null,
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
