"use client";

import { useState } from "react";

import { ko } from "@/i18n/ko";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { StepExecuteButton } from "./StepExecuteButton";
import { StepPanelProps } from "./types";

export function Step5DualMask({ executingStepId, onExecute, isLocked = false, lockMessage }: StepPanelProps) {
  const [porosityHint, setPorosityHint] = useState([40]);
  const [bridgeWidth, setBridgeWidth] = useState([5]);
  const pending = executingStepId === 5;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ko.steps.names["5"]}</CardTitle>
        <CardDescription>{ko.steps.descriptions["5"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{ko.step5.dualMaskNote}</p>

        <div className="space-y-2">
          <Label>{ko.step5.porosityHint}</Label>
          <Slider value={porosityHint} onValueChange={setPorosityHint} min={0} max={100} step={1} />
          <p className="text-xs text-muted-foreground">{porosityHint[0]}</p>
        </div>

        <div className="space-y-2">
          <Label>{ko.step5.bridgeWidth}</Label>
          <Slider value={bridgeWidth} onValueChange={setBridgeWidth} min={1} max={20} step={1} />
          <p className="text-xs text-muted-foreground">{bridgeWidth[0]}</p>
        </div>

        <StepExecuteButton
          label={ko.step5.runButton}
          pending={pending}
          disabled={isLocked}
          onConfirm={() =>
            onExecute(5, {
              porosity_hint: porosityHint[0],
              bridge_width: bridgeWidth[0],
            })
          }
        />
        {isLocked && lockMessage && <p className="text-xs text-amber-700">{lockMessage}</p>}
      </CardContent>
    </Card>
  );
}
