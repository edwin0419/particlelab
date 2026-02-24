"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { ko } from "@/i18n/ko";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Step1ExecuteRequest } from "@/types/domain";
import { useStep1Store } from "@/store/useStep1Store";

interface Props {
  imageHeight: number | null;
  saving: boolean;
  onSave: (payload: Step1ExecuteRequest) => Promise<void>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step1Panel({ imageHeight, saving, onSave }: Props) {
  const cropBottomPx = useStep1Store((state) => state.cropBottomPx);
  const pixelDistanceInput = useStep1Store((state) => state.pixelDistanceInput);
  const realUmInput = useStep1Store((state) => state.realUmInput);
  const measurementMode = useStep1Store((state) => state.measurementMode);
  const measurementPoints = useStep1Store((state) => state.measurementPoints);
  const rectangleVisible = useStep1Store((state) => state.rectangleVisible);
  const autoApplyRectangleWidth = useStep1Store((state) => state.autoApplyRectangleWidth);

  const setCropBottomPx = useStep1Store((state) => state.setCropBottomPx);
  const setPixelDistanceInput = useStep1Store((state) => state.setPixelDistanceInput);
  const setRealUmInput = useStep1Store((state) => state.setRealUmInput);
  const setMeasurementMode = useStep1Store((state) => state.setMeasurementMode);
  const setRectangleVisible = useStep1Store((state) => state.setRectangleVisible);
  const setAutoApplyRectangleWidth = useStep1Store((state) => state.setAutoApplyRectangleWidth);
  const clearMeasurement = useStep1Store((state) => state.clearMeasurement);
  const setSelectedArtifactId = useStep1Store((state) => state.setSelectedArtifactId);

  const maxCrop = useMemo(() => {
    if (!imageHeight || imageHeight <= 1) {
      return 0;
    }
    return imageHeight - 1;
  }, [imageHeight]);

  const rectanglePixelWidth = useMemo(() => {
    if (measurementPoints.length !== 2) {
      return 0;
    }

    const [a, b] = measurementPoints;
    return Math.abs(b.x - a.x);
  }, [measurementPoints]);
  const hasRectangle = measurementPoints.length === 2;

  const computedUmPerPx = useMemo(() => {
    const pixel = Number(pixelDistanceInput);
    const real = Number(realUmInput);
    if (!Number.isFinite(real) || real <= 0 || !Number.isFinite(pixel) || pixel <= 0) {
      return null;
    }
    return real / pixel;
  }, [pixelDistanceInput, realUmInput]);

  const optionToggleBaseClass =
    "h-10 min-h-10 max-h-10 w-[72px] min-w-[72px] max-w-[72px] shrink-0 whitespace-nowrap border px-0 text-sm font-semibold leading-none transition-colors";

  const handleCropChange = (value: number) => {
    const next = clamp(Math.floor(value), 0, maxCrop);
    if (next === cropBottomPx) {
      return;
    }

    setCropBottomPx(next);
    setSelectedArtifactId(null);
  };

  const handleCalculate = () => {
    const pixel = Number(pixelDistanceInput);
    if (!Number.isFinite(pixel) || pixel <= 0) {
      toast.error(ko.step1Panel.invalidPixelDistance);
      return;
    }

    const real = Number(realUmInput);
    if (!Number.isFinite(real) || real <= 0) {
      toast.error(ko.step1Panel.invalidRealLength);
      return;
    }

    const value = real / pixel;
    setSelectedArtifactId(null);
    toast.success(`${ko.step1Panel.calculateSuccessPrefix}: ${value.toFixed(8)}`);
  };

  const handleSave = async () => {
    const pixelDistance = Number(pixelDistanceInput);
    if (!Number.isFinite(pixelDistance) || pixelDistance <= 0) {
      toast.error(ko.step1Panel.invalidPixelDistance);
      return;
    }

    const real = Number(realUmInput);
    if (!Number.isFinite(real) || real <= 0) {
      toast.error(ko.step1Panel.invalidRealLength);
      return;
    }
    const umPerPx = real / pixelDistance;
    const payload: Step1ExecuteRequest = {
      crop_bottom_px: clamp(cropBottomPx, 0, maxCrop),
      um_per_px: umPerPx,
      measurement: {
        ax: 0,
        ay: 0,
        bx: Math.max(1, Math.round(pixelDistance)),
        by: 0,
        pixel_distance: pixelDistance,
        real_um: real,
      },
    };

    if (measurementPoints.length === 2) {
      const [start, end] = measurementPoints;
      payload.measurement = {
        ax: Math.round(start.x),
        ay: Math.round(start.y),
        bx: Math.round(end.x),
        by: Math.round(end.y),
        pixel_distance: pixelDistance,
        real_um: real,
      };
    }

    await onSave(payload);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">{ko.step1Panel.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pb-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">{ko.step1Panel.cropTitle}</Label>
            <span className="text-sm text-muted-foreground">
              {ko.step1Panel.cropMaxPrefix} {maxCrop}px
            </span>
          </div>

          <Slider
            value={[clamp(cropBottomPx, 0, maxCrop)]}
            min={0}
            max={Math.max(1, maxCrop)}
            step={1}
            onValueChange={(values) => handleCropChange(values[0] ?? 0)}
            disabled={maxCrop <= 0}
          />

          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={maxCrop}
              value={clamp(cropBottomPx, 0, maxCrop)}
              onChange={(event) => handleCropChange(Number(event.target.value))}
              className="max-w-[180px]"
            />
            <span className="text-sm text-muted-foreground">px</span>
          </div>
        </section>

        <section className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
          <Label className="text-base font-semibold">{ko.step1Panel.calibrationTitle}</Label>

          <div className="space-y-2">
            <Label>{ko.step1Panel.pixelDistanceManualLabel}</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={pixelDistanceInput}
              disabled={hasRectangle && autoApplyRectangleWidth}
              onChange={(event) => {
                setPixelDistanceInput(event.target.value);
                setSelectedArtifactId(null);
              }}
              placeholder={ko.step1Panel.pixelDistancePlaceholder}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <Label>{ko.step1Panel.rectangleToolTitle}</Label>
              <Button
                variant={measurementMode ? "secondary" : "outline"}
                size="sm"
                onClick={() => setMeasurementMode(!measurementMode)}
              >
                {measurementMode ? ko.step1Panel.rectangleStop : ko.step1Panel.rectangleStart}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">{ko.step1Panel.rectangleGuide}</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{ko.step1Panel.rectangleWidthLabel}</Label>
                <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                  {rectanglePixelWidth > 0 ? `${rectanglePixelWidth.toFixed(2)} px` : "-"}
                </div>
              </div>
              <div className="space-y-1">
                <Label>{ko.step1Panel.realLengthLabel}</Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={realUmInput}
                  onChange={(event) => {
                    setRealUmInput(event.target.value);
                    setSelectedArtifactId(null);
                  }}
                  placeholder={ko.step1Panel.realLengthPlaceholder}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
              <Label className="text-sm font-semibold">{ko.step1Panel.optionsTitle}</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{ko.step1Panel.autoApplyTitle}</p>
                    <p className="text-xs text-muted-foreground">{ko.step1Panel.autoApplyDescription}</p>
                  </div>
                  <Button
                    type="button"
                    size="default"
                    className={`${optionToggleBaseClass} ${
                      autoApplyRectangleWidth
                        ? "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700"
                        : "border-rose-700 bg-rose-600 text-white hover:bg-rose-700"
                    }`}
                    variant="default"
                    disabled={!hasRectangle}
                    onClick={() => {
                      const next = !autoApplyRectangleWidth;
                      setAutoApplyRectangleWidth(next);
                      setSelectedArtifactId(null);
                      if (next && rectanglePixelWidth > 0) {
                        setPixelDistanceInput(String(rectanglePixelWidth));
                      }
                    }}
                  >
                    {autoApplyRectangleWidth ? ko.step1Panel.toggleOn : ko.step1Panel.toggleOff}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{ko.step1Panel.rectangleVisibleTitle}</p>
                    <p className="text-xs text-muted-foreground">{ko.step1Panel.rectangleVisibleDescription}</p>
                  </div>
                  <Button
                    type="button"
                    size="default"
                    className={`${optionToggleBaseClass} ${
                      rectangleVisible
                        ? "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700"
                        : "border-rose-700 bg-rose-600 text-white hover:bg-rose-700"
                    }`}
                    variant="default"
                    disabled={!hasRectangle}
                    onClick={() => {
                      setRectangleVisible(!rectangleVisible);
                      setSelectedArtifactId(null);
                    }}
                  >
                    {rectangleVisible ? ko.step1Panel.toggleOn : ko.step1Panel.toggleOff}
                  </Button>
                </div>
              </div>
              {!hasRectangle && (
                <p className="text-xs text-muted-foreground">{ko.step1Panel.optionsRequiresRectangle}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCalculate}>
                {ko.step1Panel.calculateButton}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearMeasurement();
                  setMeasurementMode(false);
                  setSelectedArtifactId(null);
                }}
              >
                {ko.step1Panel.clearMeasurementButton}
              </Button>
            </div>

            <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {ko.step1Panel.computedUmPerPxLabel}: {computedUmPerPx ? computedUmPerPx.toFixed(8) : "-"}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <Label className="text-base font-semibold">{ko.step1Panel.saveTitle}</Label>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? ko.step1Panel.savePending : ko.step1Panel.saveButton}
          </Button>
          <p className="text-xs text-muted-foreground">{ko.step1Panel.saveDescription}</p>
        </section>
      </CardContent>
    </Card>
  );
}
