"use client";

import { MouseEvent as ReactMouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { useStep1Store } from "@/store/useStep1Store";

export interface Step8Contour {
  id: number;
  bbox: [number, number, number, number];
  points: [number, number][];
  kind?: "solid" | "pore" | string;
}

export interface Step8ContoursJson {
  image_width: number;
  image_height: number;
  contours: Step8Contour[];
}

interface Props {
  imageUrl?: string;
  contoursData: Step8ContoursJson | null;
  onSelectContourIdChange?: (id: number | null) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const sx = px - ax;
    const sy = py - ay;
    return Math.sqrt((sx * sx) + (sy * sy));
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / ((dx * dx) + (dy * dy));
  const tt = Math.max(0, Math.min(1, t));
  const cx = ax + (dx * tt);
  const cy = ay + (dy * tt);
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt((ex * ex) + (ey * ey));
}

function isNearPolyline(pointX: number, pointY: number, points: [number, number][], tolerance: number): boolean {
  if (points.length < 2) {
    return false;
  }
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    if (distancePointToSegment(pointX, pointY, ax, ay, bx, by) <= tolerance) {
      return true;
    }
  }
  return false;
}

export function Step8ContoursViewer({ imageUrl, contoursData, onSelectContourIdChange }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [hoveredContourId, setHoveredContourId] = useState<number | null>(null);
  const [selectedContourId, setSelectedContourId] = useState<number | null>(null);

  const fallbackSize = useMemo(() => {
    if (!contoursData) {
      return null;
    }
    return { width: contoursData.image_width, height: contoursData.image_height };
  }, [contoursData]);

  const effectiveSize = imageSize ?? fallbackSize;

  useEffect(() => {
    onSelectContourIdChange?.(selectedContourId);
  }, [onSelectContourIdChange, selectedContourId]);

  useEffect(() => {
    setHoveredContourId(null);
    setSelectedContourId(null);
  }, [contoursData]);

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
    if (!viewport || !effectiveSize || effectiveSize.height <= 0) {
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

  const contours = contoursData?.contours ?? [];

  const handleOverlayMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!effectiveSize || !overlayRef.current || contours.length === 0) {
      setHoveredContourId(null);
      return;
    }
    const rect = overlayRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    const tolerance = Math.max(2, 5 / zoom);

    let foundId: number | null = null;
    for (const contour of contours) {
      const [bx, by, bw, bh] = contour.bbox;
      if (x < bx - tolerance || x > bx + bw + tolerance || y < by - tolerance || y > by + bh + tolerance) {
        continue;
      }
      if (isNearPolyline(x, y, contour.points, tolerance)) {
        foundId = contour.id;
        break;
      }
    }
    setHoveredContourId(foundId);
  };

  const handleOverlayClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!effectiveSize || !overlayRef.current || contours.length === 0) {
      setSelectedContourId(null);
      return;
    }
    const rect = overlayRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    const tolerance = Math.max(2, 5 / zoom);

    let foundId: number | null = null;
    for (const contour of contours) {
      const [bx, by, bw, bh] = contour.bbox;
      if (x < bx - tolerance || x > bx + bw + tolerance || y < by - tolerance || y > by + bh + tolerance) {
        continue;
      }
      if (isNearPolyline(x, y, contour.points, tolerance)) {
        foundId = contour.id;
        break;
      }
    }
    setSelectedContourId(foundId);
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
          {!effectiveSize && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {ko.workspace.viewerNoImage}
            </div>
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
                  ref={overlayRef}
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
                  onMouseMove={handleOverlayMouseMove}
                  onMouseLeave={() => setHoveredContourId(null)}
                  onClick={handleOverlayClick}
                >
                  {contours.map((contour) => {
                    const closedPoints =
                      contour.points.length > 1
                        ? [...contour.points, contour.points[0]]
                        : contour.points;
                    const points = closedPoints.map(([x, y]) => `${x},${y}`).join(" ");
                    const active = contour.id === selectedContourId;
                    const hover = contour.id === hoveredContourId;
                    const baseStroke = "#22c55e";
                    const stroke = active ? "#f59e0b" : hover ? "#ef4444" : baseStroke;
                    return (
                      <g key={contour.id}>
                        <polyline
                          points={points}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          opacity={active ? 1 : 0.95}
                        />
                        <polyline
                          points={points}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={8}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
        {!contoursData && <p>{ko.step8.viewerFallback}</p>}
        <p>
          {ko.step8.contourCountLabel}: {contours.length}
          {" · "}
          {ko.step8.selectedContourIdLabel}: {selectedContourId == null ? "-" : selectedContourId}
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
