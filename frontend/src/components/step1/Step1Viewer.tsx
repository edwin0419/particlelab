"use client";

import { MouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { Step1Point, useStep1Store } from "@/store/useStep1Store";

interface Props {
  imageUrl?: string;
  cropBottomPx: number;
  measurementMode: boolean;
  measurementPoints: Step1Point[];
  rectangleVisible: boolean;
  onSetMeasurementRect: (points: Step1Point[]) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step1Viewer({
  imageUrl,
  cropBottomPx,
  measurementMode,
  measurementPoints,
  rectangleVisible,
  onSetMeasurementRect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [dragStart, setDragStart] = useState<Step1Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Step1Point | null>(null);
  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const croppedHeight = useMemo(() => {
    if (!imageSize) {
      return 0;
    }
    return clamp(imageSize.height - cropBottomPx, 1, imageSize.height);
  }, [cropBottomPx, imageSize]);

  useEffect(() => {
    if (!imageUrl) {
      setImageSize(null);
      return;
    }

    const image = new Image();
    image.src = imageUrl;
    image.onload = () => {
      setImageSize({ width: image.width, height: image.height });
    };
    image.onerror = () => {
      setImageSize(null);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (measurementMode) {
      return;
    }
    setDragStart(null);
    setDragCurrent(null);
  }, [measurementMode]);

  const fitToViewport = () => {
    const viewport = viewportRef.current;
    if (!viewport || !imageSize || croppedHeight <= 0) {
      return;
    }
    const fitZoom = Math.min(viewport.clientWidth / imageSize.width, viewport.clientHeight / croppedHeight);
    setZoom(clamp(fitZoom, 0.1, 8));
    requestAnimationFrame(() => {
      if (!scrollRef.current) {
        return;
      }
      const scroll = scrollRef.current;
      const targetWidth = imageSize.width * clamp(fitZoom, 0.1, 8);
      const targetHeight = croppedHeight * clamp(fitZoom, 0.1, 8);
      scroll.scrollLeft = Math.max(0, (targetWidth - scroll.clientWidth) / 2);
      scroll.scrollTop = Math.max(0, (targetHeight - scroll.clientHeight) / 2);
    });
  };

  useEffect(() => {
    if (!imageSize) {
      return;
    }
    fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSize?.width, imageSize?.height, fitRequestKey]);

  const onWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    if (!imageSize || !scrollRef.current) {
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

  const toImagePoint = (event: MouseEvent<HTMLDivElement>): Step1Point | null => {
    if (!measurementMode || !imageSize || croppedHeight <= 0) {
      return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;

    if (x < 0 || y < 0 || x > imageSize.width || y > croppedHeight) {
      return null;
    }

    return {
      x: Math.round(clamp(x, 0, imageSize.width - 1)),
      y: Math.round(clamp(y, 0, croppedHeight - 1)),
    };
  };

  const committedRect = useMemo(() => {
    if (measurementPoints.length !== 2) {
      return null;
    }
    const [start, end] = measurementPoints;
    return {
      start,
      end,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }, [measurementPoints]);

  const previewRect = useMemo(() => {
    if (!dragStart || !dragCurrent) {
      return null;
    }
    return {
      start: dragStart,
      end: dragCurrent,
      x: Math.min(dragStart.x, dragCurrent.x),
      y: Math.min(dragStart.y, dragCurrent.y),
      width: Math.abs(dragCurrent.x - dragStart.x),
      height: Math.abs(dragCurrent.y - dragStart.y),
    };
  }, [dragCurrent, dragStart]);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!measurementMode) {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }
    setDragStart(point);
    setDragCurrent(point);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!measurementMode || !dragStart) {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }
    setDragCurrent(point);
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!measurementMode || !dragStart) {
      return;
    }
    const point = toImagePoint(event) ?? dragCurrent ?? dragStart;
    onSetMeasurementRect([dragStart, point]);
    setDragStart(null);
    setDragCurrent(null);
  };

  const handleMouseLeave = () => {
    if (!measurementMode || !dragStart || !dragCurrent) {
      return;
    }
    onSetMeasurementRect([dragStart, dragCurrent]);
    setDragStart(null);
    setDragCurrent(null);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-muted/40">
      <div className="z-20 flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2">
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
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 p-3">
        <div
          ref={scrollRef}
          className="h-full w-full overflow-auto rounded-md border border-border bg-slate-50"
          onWheel={onWheelZoom}
        >
          {!imageSize && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {ko.workspace.viewerNoImage}
            </div>
          )}

          {imageSize && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                className="relative shrink-0"
                style={{
                  width: imageSize.width * zoom,
                  height: croppedHeight * zoom,
                  cursor: measurementMode ? "crosshair" : "default",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              >
                <div
                  className="absolute left-0 top-0 overflow-hidden"
                  style={{
                    width: imageSize.width,
                    height: croppedHeight,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <img
                    src={imageUrl}
                    alt={ko.workspace.viewerImageAlt}
                    className="pointer-events-none absolute left-0 top-0 select-none"
                    draggable={false}
                    style={{
                      width: imageSize.width,
                      height: imageSize.height,
                    }}
                  />

                  <svg width={imageSize.width} height={croppedHeight} className="absolute left-0 top-0">
                    {committedRect && rectangleVisible && (
                      <g>
                        <rect
                          x={committedRect.x}
                          y={committedRect.y}
                          width={committedRect.width}
                          height={committedRect.height}
                          fill="rgba(14,116,144,0.12)"
                          stroke="rgba(14,116,144,0.95)"
                          strokeWidth={2}
                        />
                        <text
                          x={committedRect.x + 6}
                          y={Math.max(14, committedRect.y - 8)}
                          fontSize={12}
                          fill="rgba(14,116,144,0.95)"
                        >
                          {ko.step1Viewer.rectangleWidthPrefix} {committedRect.width.toFixed(2)} px
                        </text>
                      </g>
                    )}

                    {previewRect && (
                      <rect
                        x={previewRect.x}
                        y={previewRect.y}
                        width={previewRect.width}
                        height={previewRect.height}
                        fill="rgba(30,64,175,0.08)"
                        stroke="rgba(30,64,175,0.95)"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                      />
                    )}
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {imageSize && (
        <div className="border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
          {ko.workspace.viewerFooterTemplate
            .replace("{{width}}", String(imageSize.width))
            .replace("{{height}}", String(imageSize.height))
            .replace("{{cropped}}", String(croppedHeight))}
        </div>
      )}
    </div>
  );
}
