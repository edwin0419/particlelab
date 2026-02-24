"use client";

import { WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import type { Step8Contour } from "@/components/step8/Step8ContoursViewer";
import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { useStep1Store } from "@/store/useStep1Store";

type OverlayMode = "step8" | "step9" | "both";

interface Props {
  imageUrl?: string;
  imageSizeHint?: { width: number; height: number } | null;
  baseContours?: Step8Contour[];
  polygonContours?: Step8Contour[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step9NeckSplitViewer({ imageUrl, imageSizeHint, baseContours = [], polygonContours = [] }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("both");

  const effectiveSize = imageSize ?? imageSizeHint ?? null;

  useEffect(() => {
    if (!imageUrl) {
      setImageSize(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setImageSize({ width: image.width, height: image.height });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setImageSize(null);
      }
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const fitToViewport = () => {
    const viewport = viewportRef.current;
    if (!viewport || !effectiveSize || effectiveSize.width <= 0 || effectiveSize.height <= 0) {
      return;
    }
    const fitZoom = Math.min(viewport.clientWidth / effectiveSize.width, viewport.clientHeight / effectiveSize.height);
    const nextZoom = clamp(fitZoom, 0.1, 8);
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      if (!scrollRef.current) {
        return;
      }
      const scroll = scrollRef.current;
      const targetWidth = effectiveSize.width * nextZoom;
      const targetHeight = effectiveSize.height * nextZoom;
      scroll.scrollLeft = Math.max(0, (targetWidth - scroll.clientWidth) / 2);
      scroll.scrollTop = Math.max(0, (targetHeight - scroll.clientHeight) / 2);
    });
  };

  useEffect(() => {
    if (!effectiveSize) {
      return;
    }
    fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSize?.width, effectiveSize?.height, fitRequestKey]);

  const onWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    if (!effectiveSize || !scrollRef.current) {
      return;
    }
    event.preventDefault();
    const scroll = scrollRef.current;
    const rect = scroll.getBoundingClientRect();
    const cursorX = event.clientX - rect.left + scroll.scrollLeft;
    const cursorY = event.clientY - rect.top + scroll.scrollTop;
    const nextZoom = clamp(event.deltaY < 0 ? zoom * 1.1 : zoom / 1.1, 0.1, 8);
    if (nextZoom === zoom) {
      return;
    }
    const ratio = nextZoom / zoom;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      scroll.scrollLeft = cursorX * ratio - (event.clientX - rect.left);
      scroll.scrollTop = cursorY * ratio - (event.clientY - rect.top);
    });
  };

  const showStep8 = overlayMode === "step8" || overlayMode === "both";
  const showStep9 = overlayMode === "step9" || overlayMode === "both";

  const polygonCount = useMemo(() => polygonContours.length, [polygonContours]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-muted/40">
      <div className="z-20 flex flex-wrap items-center gap-2 border-b border-border bg-card/95 px-3 py-2">
        <span className="text-sm font-semibold">{ko.workspace.viewerToolbarTitle}</span>
        <Button type="button" size="sm" variant="outline" onClick={zoomOut} className="h-8 px-2">
          {ko.workspace.viewerZoomOut}
        </Button>
        <span className="min-w-[58px] text-center text-sm font-semibold">{Math.round(zoom * 100)}%</span>
        <Button type="button" size="sm" variant="outline" onClick={zoomIn} className="h-8 px-2">
          {ko.workspace.viewerZoomIn}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={resetZoom}>
          {ko.workspace.viewerOriginal}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={fitToViewport}>
          {ko.workspace.viewerFit}
        </Button>

        <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-1">
          <Button
            type="button"
            size="sm"
            variant={overlayMode === "step8" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setOverlayMode("step8")}
          >
            {ko.step9.overlayStep8}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={overlayMode === "step9" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setOverlayMode("step9")}
          >
            {ko.step9.overlayStep9}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={overlayMode === "both" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setOverlayMode("both")}
          >
            {ko.step9.overlayBoth}
          </Button>
        </div>
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 p-3">
        <div ref={scrollRef} className="h-full w-full overflow-auto rounded-md border border-border bg-slate-50" onWheel={onWheelZoom}>
          {!effectiveSize && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{ko.workspace.viewerNoImage}</div>
          )}

          {effectiveSize && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                className="relative shrink-0"
                style={{
                  width: effectiveSize.width * zoom,
                  height: effectiveSize.height * zoom,
                }}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={ko.workspace.viewerImageAlt}
                    className="absolute left-0 top-0"
                    style={{
                      width: effectiveSize.width,
                      height: effectiveSize.height,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  />
                ) : (
                  <div
                    className="absolute left-0 top-0 bg-black"
                    style={{
                      width: effectiveSize.width,
                      height: effectiveSize.height,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  />
                )}

                <svg
                  className="absolute left-0 top-0"
                  width={effectiveSize.width}
                  height={effectiveSize.height}
                  viewBox={`0 0 ${effectiveSize.width} ${effectiveSize.height}`}
                  style={{
                    width: effectiveSize.width,
                    height: effectiveSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  {showStep8 &&
                    baseContours.map((contour) => {
                      const points = contour.points.length > 1
                        ? [...contour.points, contour.points[0]].map(([x, y]) => `${x},${y}`).join(" ")
                        : "";
                      if (!points) {
                        return null;
                      }
                      return (
                        <polyline
                          key={`step8-${contour.id}`}
                          points={points}
                          fill="none"
                          stroke="#22c55e"
                          strokeWidth={1}
                          opacity={0.85}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  {showStep9 &&
                    polygonContours.map((polygon) => {
                      const points = polygon.points.length > 1
                        ? [...polygon.points, polygon.points[0]].map(([x, y]) => `${x},${y}`).join(" ")
                        : "";
                      if (!points) {
                        return null;
                      }
                      return (
                        <polyline
                          key={`poly-${polygon.id}`}
                          points={points}
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth={1.2}
                          opacity={0.95}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
        {!polygonCount && <p>{ko.step9.viewerFallback}</p>}
        <p>
          {ko.step9.polygonCountLabel}: {polygonCount}
        </p>
        {effectiveSize && (
          <p>
            {ko.workspace.viewerFooterTemplate
              .replace("{{width}}", String(effectiveSize.width))
              .replace("{{height}}", String(effectiveSize.height))
              .replace("{{cropped}}", String(effectiveSize.height))}
          </p>
        )}
      </div>
    </div>
  );
}
