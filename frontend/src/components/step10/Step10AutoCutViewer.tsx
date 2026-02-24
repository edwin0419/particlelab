"use client";

import { MouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import type { Step8Contour } from "@/components/step8/Step8ContoursViewer";
import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import type { Step10SplitLine } from "@/lib/api";
import { useStep1Store } from "@/store/useStep1Store";
import { toast } from "sonner";

interface Props {
  imageUrl?: string;
  imageSizeHint?: { width: number; height: number } | null;
  polygons: Step8Contour[];
  splitLines: Step10SplitLine[];
  previewLabelsUrl?: string | null;
  onHoverFragmentIdChange?: (labelId: number | null) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type OverlayMode = "polygon" | "label_fill" | "both";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const lig = clamp(l, 0, 1);
  const c = (1 - Math.abs((2 * lig) - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = lig - (c / 2);
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

export function Step10AutoCutViewer({
  imageUrl,
  imageSizeHint,
  polygons,
  splitLines: _splitLines,
  previewLabelsUrl,
  onHoverFragmentIdChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelFillCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("polygon");
  const [hoveredLabelId, setHoveredLabelId] = useState<number | null>(null);
  const [hoveredCursor, setHoveredCursor] = useState<{ x: number; y: number } | null>(null);
  const [labelObjectUrl, setLabelObjectUrl] = useState<string | null>(null);
  const [labelImageData, setLabelImageData] = useState<ImageData | null>(null);

  const effectiveSize = imageSize ?? imageSizeHint ?? null;

  useEffect(() => {
    onHoverFragmentIdChange?.(hoveredLabelId);
  }, [hoveredLabelId, onHoverFragmentIdChange]);

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

  useEffect(() => {
    setHoveredLabelId(null);
    setHoveredCursor(null);
  }, [previewLabelsUrl]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    const load = async () => {
      setLabelImageData(null);
      if (!previewLabelsUrl) {
        setLabelObjectUrl((current) => {
          if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
          return null;
        });
        return;
      }

      let src = previewLabelsUrl;
      if (/^https?:\/\//i.test(previewLabelsUrl)) {
        try {
          const response = await fetch(previewLabelsUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error("label-fetch");
          }
          const blob = await response.blob();
          revoked = URL.createObjectURL(blob);
          src = revoked;
        } catch {
          src = previewLabelsUrl;
        }
      }
      if (cancelled) {
        if (revoked) URL.revokeObjectURL(revoked);
        return;
      }
      setLabelObjectUrl((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return src;
      });
    };
    void load();
    return () => {
      cancelled = true;
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [previewLabelsUrl]);

  useEffect(() => {
    if (!labelObjectUrl) {
      setLabelImageData(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = labelCanvasRef.current ?? document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setLabelImageData(null);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      try {
        setLabelImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        setLabelImageData(null);
      }
    };
    image.onerror = () => {
      if (!cancelled) setLabelImageData(null);
    };
    image.src = labelObjectUrl;
    return () => {
      cancelled = true;
    };
  }, [labelObjectUrl]);

  const fitToViewport = () => {
    const viewport = viewportRef.current;
    if (!viewport || !effectiveSize || effectiveSize.width <= 0 || effectiveSize.height <= 0) {
      return;
    }
    const fitZoom = Math.min(viewport.clientWidth / effectiveSize.width, viewport.clientHeight / effectiveSize.height);
    const nextZoom = clamp(fitZoom, 0.1, 8);
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const scroll = scrollRef.current;
      const targetWidth = effectiveSize.width * nextZoom;
      const targetHeight = effectiveSize.height * nextZoom;
      scroll.scrollLeft = Math.max(0, (targetWidth - scroll.clientWidth) / 2);
      scroll.scrollTop = Math.max(0, (targetHeight - scroll.clientHeight) / 2);
    });
  };

  useEffect(() => {
    if (!effectiveSize) return;
    fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSize?.width, effectiveSize?.height, fitRequestKey]);

  const onWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    if (!effectiveSize || !scrollRef.current) return;
    event.preventDefault();
    const scroll = scrollRef.current;
    const rect = scroll.getBoundingClientRect();
    const cursorX = event.clientX - rect.left + scroll.scrollLeft;
    const cursorY = event.clientY - rect.top + scroll.scrollTop;
    const nextZoom = clamp(event.deltaY < 0 ? zoom * 1.1 : zoom / 1.1, 0.1, 8);
    if (nextZoom === zoom) return;
    const ratio = nextZoom / zoom;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      scroll.scrollLeft = cursorX * ratio - (event.clientX - rect.left);
      scroll.scrollTop = cursorY * ratio - (event.clientY - rect.top);
    });
  };

  useEffect(() => {
    const canvas = highlightCanvasRef.current;
    const labelData = labelImageData;
    const size = effectiveSize;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!labelData || !hoveredLabelId || hoveredLabelId <= 0) {
      return;
    }
    const { width, height, data } = labelData;
    if (width !== canvas.width || height !== canvas.height) {
      return;
    }
    const out = ctx.createImageData(width, height);
    const outData = out.data;
    const target = hoveredLabelId;
    for (let idx = 0; idx < data.length; idx += 4) {
      const label = data[idx] + (data[idx + 1] << 8) + (data[idx + 2] << 16);
      if (label !== target) continue;
      outData[idx] = 251;
      outData[idx + 1] = 191;
      outData[idx + 2] = 36;
      outData[idx + 3] = 110;
    }
    ctx.putImageData(out, 0, 0);
  }, [effectiveSize, hoveredLabelId, labelImageData]);

  useEffect(() => {
    const canvas = labelFillCanvasRef.current;
    const labelData = labelImageData;
    const size = effectiveSize;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!labelData) {
      return;
    }
    const { width, height, data } = labelData;
    if (width !== canvas.width || height !== canvas.height) {
      return;
    }

    const uniqueLabels: number[] = [];
    const seen = new Set<number>();
    for (let idx = 0; idx < data.length; idx += 4) {
      const label = data[idx] + (data[idx + 1] << 8) + (data[idx + 2] << 16);
      if (label <= 0 || seen.has(label)) continue;
      seen.add(label);
      uniqueLabels.push(label);
    }
    uniqueLabels.sort((a, b) => a - b);

    const palette = new Map<number, [number, number, number]>();
    for (let index = 0; index < uniqueLabels.length; index += 1) {
      const label = uniqueLabels[index];
      const hue = (index * 137.508) % 360;
      const lightness = 0.52 + ((index % 3) * 0.08);
      palette.set(label, hslToRgb(hue, 0.8, Math.min(lightness, 0.72)));
    }

    const out = ctx.createImageData(width, height);
    const outData = out.data;
    for (let idx = 0; idx < data.length; idx += 4) {
      const label = data[idx] + (data[idx + 1] << 8) + (data[idx + 2] << 16);
      if (label <= 0) continue;
      const color = palette.get(label);
      if (!color) continue;
      outData[idx] = color[0];
      outData[idx + 1] = color[1];
      outData[idx + 2] = color[2];
      outData[idx + 3] = 132;
    }
    ctx.putImageData(out, 0, 0);
  }, [effectiveSize, labelImageData]);

  const handlePointerMove = (event: MouseEvent<SVGSVGElement>) => {
    if (!effectiveSize || !surfaceRef.current || !labelImageData) {
      setHoveredLabelId(null);
      setHoveredCursor(null);
      return;
    }
    const surfaceRect = surfaceRef.current.getBoundingClientRect();
    const px = (event.clientX - surfaceRect.left) / zoom;
    const py = (event.clientY - surfaceRect.top) / zoom;
    const x = Math.round(px);
    const y = Math.round(py);
    if (x < 0 || y < 0 || x >= labelImageData.width || y >= labelImageData.height) {
      setHoveredLabelId(null);
      setHoveredCursor(null);
      return;
    }
    const idx = ((y * labelImageData.width) + x) * 4;
    const data = labelImageData.data;
    const labelId = data[idx] + (data[idx + 1] << 8) + (data[idx + 2] << 16);
    setHoveredLabelId(labelId > 0 ? labelId : null);
    setHoveredCursor({ x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top });
  };

  const handlePointerLeave = () => {
    setHoveredLabelId(null);
    setHoveredCursor(null);
  };

  const handleDownloadCurrentView = async () => {
    if (!effectiveSize) {
      toast.error(ko.step10.viewerDownloadNoImage);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = effectiveSize.width;
    canvas.height = effectiveSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error(ko.step10.viewerDownloadFailure);
      return;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (imageUrl) {
      let objectUrl: string | null = null;
      try {
        let src = imageUrl;
        if (/^https?:\/\//i.test(imageUrl)) {
          const response = await fetch(imageUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error("image-fetch");
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          src = objectUrl;
        }
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve();
          };
          img.onerror = () => reject(new Error("image-load"));
          img.src = src;
        });
      } catch {
        // 배경 이미지 로드 실패 시 오버레이만 저장한다.
      } finally {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      }
    }

    if (overlayMode === "label_fill" || overlayMode === "both") {
      const labelFillCanvas = labelFillCanvasRef.current;
      if (labelFillCanvas) {
        ctx.drawImage(labelFillCanvas, 0, 0, canvas.width, canvas.height);
      }
    }

    if (overlayMode === "polygon" || overlayMode === "both") {
      ctx.save();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const polygon of polygons) {
        if (!Array.isArray(polygon.points) || polygon.points.length < 2) continue;
        ctx.beginPath();
        for (let index = 0; index < polygon.points.length; index += 1) {
          const [x, y] = polygon.points[index];
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    try {
      const url = canvas.toDataURL("image/png");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "step10-분할-뷰어-이미지.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast.success(ko.step10.viewerDownloadSuccess);
    } catch {
      toast.error(ko.step10.viewerDownloadFailure);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-muted/40">
      <canvas ref={labelCanvasRef} className="hidden" />
      <div className="z-20 flex flex-wrap items-center gap-2 border-b border-border bg-card/95 px-3 py-2">
        <span className="text-sm font-semibold">{ko.workspace.viewerToolbarTitle}</span>
        <Button type="button" size="sm" variant="outline" onClick={zoomOut} className="h-8 px-2">{ko.workspace.viewerZoomOut}</Button>
        <span className="min-w-[58px] text-center text-sm font-semibold">{Math.round(zoom * 100)}%</span>
        <Button type="button" size="sm" variant="outline" onClick={zoomIn} className="h-8 px-2">{ko.workspace.viewerZoomIn}</Button>
        <Button type="button" size="sm" variant="outline" onClick={resetZoom}>{ko.workspace.viewerOriginal}</Button>
        <Button type="button" size="sm" variant="outline" onClick={fitToViewport}>{ko.workspace.viewerFit}</Button>

        <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-1">
          <span className="px-1 text-xs font-medium text-muted-foreground">{ko.step10.viewModeLabel}</span>
          <Button
            type="button"
            size="sm"
            variant={overlayMode === "polygon" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setOverlayMode("polygon")}
          >
            {ko.step10.viewModePolygon}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={overlayMode === "label_fill" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setOverlayMode("label_fill")}
          >
            {ko.step10.viewModeLabelFill}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={overlayMode === "both" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setOverlayMode("both")}
          >
            {ko.step10.viewModeBoth}
          </Button>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={() => void handleDownloadCurrentView()}>
          {ko.step10.viewerDownloadButton}
        </Button>
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 p-3">
        <div ref={scrollRef} className="h-full w-full overflow-auto rounded-md border border-border bg-slate-50" onWheel={onWheelZoom}>
          {!effectiveSize && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{ko.workspace.viewerNoImage}</div>
          )}
          {effectiveSize && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                ref={surfaceRef}
                className="relative shrink-0"
                style={{ width: effectiveSize.width * zoom, height: effectiveSize.height * zoom }}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={ko.workspace.viewerImageAlt}
                    className="absolute left-0 top-0"
                    style={{ width: effectiveSize.width, height: effectiveSize.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}
                  />
                ) : (
                  <div
                    className="absolute left-0 top-0 bg-black"
                    style={{ width: effectiveSize.width, height: effectiveSize.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}
                  />
                )}

                {(overlayMode === "label_fill" || overlayMode === "both") && (
                  <canvas
                    ref={labelFillCanvasRef}
                    className="pointer-events-none absolute left-0 top-0"
                    style={{
                      width: effectiveSize.width,
                      height: effectiveSize.height,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                      imageRendering: "pixelated",
                      mixBlendMode: "multiply",
                    }}
                  />
                )}

                <canvas
                  ref={highlightCanvasRef}
                  className="pointer-events-none absolute left-0 top-0"
                  style={{
                    width: effectiveSize.width,
                    height: effectiveSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    imageRendering: "pixelated",
                  }}
                />

                <svg
                  className="absolute left-0 top-0"
                  width={effectiveSize.width}
                  height={effectiveSize.height}
                  viewBox={`0 0 ${effectiveSize.width} ${effectiveSize.height}`}
                  style={{ width: effectiveSize.width, height: effectiveSize.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}
                  onMouseMove={handlePointerMove}
                  onMouseLeave={handlePointerLeave}
                >
                  {(overlayMode === "polygon" || overlayMode === "both") &&
                    polygons.map((polygon) => {
                      const pts = polygon.points.length > 1 ? [...polygon.points, polygon.points[0]] : [];
                      if (pts.length < 2) return null;
                      return (
                        <polyline
                          key={`poly-${polygon.id}`}
                          points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
                          fill="none"
                          stroke="#22c55e"
                          strokeWidth={1.1}
                          opacity={0.9}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                </svg>

                {hoveredLabelId != null && hoveredCursor && (
                  <div
                    className="pointer-events-none absolute z-30 rounded-md border border-border bg-card px-2 py-1 text-xs shadow"
                    style={{
                      left: Math.min((hoveredCursor.x + 12), (effectiveSize.width * zoom) - 120),
                      top: Math.max(4, hoveredCursor.y - 28),
                    }}
                  >
                    {ko.step10.hoverTooltipPrefix}: {hoveredLabelId}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
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
