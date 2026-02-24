"use client";

import { useState } from "react";

import { ko } from "@/i18n/ko";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export function Step45Recovery({ executingStepId, onExecute, isLocked = false, lockMessage }: StepPanelProps) {
  const [seedTolerance, setSeedTolerance] = useState([12]);
  const [maxIterations, setMaxIterations] = useState([50]);
  const pending = executingStepId === 45;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.steps.names["45"]}</CardTitle>
        <CardDescription>{ko.steps.descriptions["45"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{ko.step45.seedTolerance}</Label>
          <Slider value={seedTolerance} onValueChange={setSeedTolerance} min={0} max={50} step={1} />
          <p className="text-xs text-muted-foreground">{seedTolerance[0]}</p>
        </div>
        <div className="space-y-2">
          <Label>{ko.step45.maxIterations}</Label>
          <Slider value={maxIterations} onValueChange={setMaxIterations} min={1} max={300} step={1} />
          <p className="text-xs text-muted-foreground">{maxIterations[0]}</p>
        </div>
        <StepExecuteButton
          label={ko.step45.runButton}
          pending={pending}
          disabled={isLocked}
          onConfirm={() =>
            onExecute(45, {
              seed_tolerance: seedTolerance[0],
              max_iterations: maxIterations[0],
            })
          }
        />
        {isLocked && lockMessage && <p className="text-xs text-amber-700">{lockMessage}</p>}
      </CardContent>
    </Card>
  );
}
