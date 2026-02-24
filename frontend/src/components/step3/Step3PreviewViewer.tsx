"use client";

import { MouseEvent, PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { Step3ExcludeRoi, Step3RoiPoint, Step3RoiTool, drawStep3ExcludeRoiOverlay } from "@/lib/step3-roi";
import { Step3ViewerMode, useStep1Store } from "@/store/useStep1Store";

interface Props {
  originalImageUrl?: string;
  inputImageUrl?: string;
  previewImageUrl?: string;
  savedImageUrl?: string;
  mode: Step3ViewerMode;
  roiTool: Step3RoiTool;
  excludeRoi: Step3ExcludeRoi;
  externalMaskImageUrl?: string;
  onExcludeRoiChange: (next: Step3ExcludeRoi) => void;
  onRoiEdited: () => void;
  onImageSizeChange?: (size: { width: number; height: number } | null) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function distance(a: Step3RoiPoint, b: Step3RoiPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt((dx * dx) + (dy * dy));
}

export function Step3PreviewViewer({
  originalImageUrl,
  inputImageUrl,
  previewImageUrl,
  savedImageUrl,
  mode,
  roiTool,
  excludeRoi,
  externalMaskImageUrl,
  onExcludeRoiChange,
  onRoiEdited,
  onImageSizeChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [externalMaskImage, setExternalMaskImage] = useState<HTMLImageElement | null>(null);
  const [rectangleDraft, setRectangleDraft] = useState<{ start: Step3RoiPoint; end: Step3RoiPoint } | null>(null);
  const [polygonDraft, setPolygonDraft] = useState<Step3RoiPoint[]>([]);
  const [brushDraft, setBrushDraft] = useState<{ size: number; points: Step3RoiPoint[] } | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const sourceCandidates = useMemo(() => {
    const candidates: Array<string | undefined> = [];
    if (mode === "input") {
      candidates.push(originalImageUrl, inputImageUrl);
    } else if (mode === "preview") {
      candidates.push(previewImageUrl, originalImageUrl, inputImageUrl);
    } else {
      candidates.push(savedImageUrl, originalImageUrl, inputImageUrl);
    }

    const unique: string[] = [];
    for (const item of candidates) {
      if (!item || unique.includes(item)) {
        continue;
      }
      unique.push(item);
    }
    return unique;
  }, [inputImageUrl, mode, originalImageUrl, previewImageUrl, savedImageUrl]);

  const activeImageUrl = sourceCandidates[sourceIndex];

  const isSavedFallback = mode === "saved" && !savedImageUrl && Boolean(originalImageUrl || inputImageUrl);
  const isPreviewFallback = mode === "preview" && !previewImageUrl && Boolean(originalImageUrl || inputImageUrl);

  useEffect(() => {
    setSourceIndex(0);
  }, [sourceCandidates]);

  const fitToViewport = () => {
    const viewport = viewportRef.current;
    if (!viewport || !imageSize || imageSize.height <= 0) {
      return;
    }
    const fitZoom = Math.min(viewport.clientWidth / imageSize.width, viewport.clientHeight / imageSize.height);
    const nextZoom = clamp(fitZoom, 0.1, 8);
    setZoom(nextZoom);

    requestAnimationFrame(() => {
      if (!scrollRef.current) {
        return;
      }
      const scroll = scrollRef.current;
      const targetWidth = imageSize.width * nextZoom;
      const targetHeight = imageSize.height * nextZoom;
      scroll.scrollLeft = Math.max(0, (targetWidth - scroll.clientWidth) / 2);
      scroll.scrollTop = Math.max(0, (targetHeight - scroll.clientHeight) / 2);
    });
  };

  useEffect(() => {
    if (!activeImageUrl) {
      setImageSize(null);
      onImageSizeChange?.(null);
      return;
    }

    const image = new Image();
    image.src = activeImageUrl;
    image.onload = () => {
      const nextSize = { width: image.width, height: image.height };
      setImageSize(nextSize);
      onImageSizeChange?.(nextSize);
    };
    image.onerror = () => {
      setImageSize(null);
      onImageSizeChange?.(null);
      setSourceIndex((current) => {
        if (current < sourceCandidates.length - 1) {
          return current + 1;
        }
        return current;
      });
    };
  }, [activeImageUrl, onImageSizeChange, sourceCandidates.length]);

  useEffect(() => {
    if (!externalMaskImageUrl) {
      setExternalMaskImage(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const applyImage = (src: string) => {
      const image = new Image();
      image.onload = () => {
        if (cancelled) {
          return;
        }
        setExternalMaskImage(image);
      };
      image.onerror = () => {
        if (cancelled) {
          return;
        }
        setExternalMaskImage(null);
      };
      image.src = src;
    };

    const loadMask = async () => {
      try {
        const response = await fetch(externalMaskImageUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("마스크 파일 요청 실패");
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        applyImage(objectUrl);
        return;
      } catch {
        // API 응답 정책에 따라 fetch가 실패할 수 있어 URL 직접 로드를 보조로 시도한다.
      }

      applyImage(externalMaskImageUrl);
    };

    loadMask();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [externalMaskImageUrl]);

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

  const toImagePoint = (event: { clientX: number; clientY: number }): Step3RoiPoint | null => {
    if (!imageSize) {
      return null;
    }
    const canvas = overlayCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const px = (event.clientX - rect.left) / zoom;
    const py = (event.clientY - rect.top) / zoom;
    return {
      x: clamp(px, 0, imageSize.width - 1),
      y: clamp(py, 0, imageSize.height - 1),
    };
  };

  const commitPolygonDraft = () => {
    if (polygonDraft.length < 3) {
      setPolygonDraft([]);
      return;
    }
    onExcludeRoiChange({
      ...excludeRoi,
      polygons: [
        ...excludeRoi.polygons,
        {
          id: createLocalId("poly"),
          points: polygonDraft,
          order: Math.max(
            1,
            ...excludeRoi.rectangles.map((item) => item.order),
            ...excludeRoi.polygons.map((item) => item.order),
            ...excludeRoi.brush_strokes.map((item) => item.order),
          ) + 1,
        },
      ],
    });
    setPolygonDraft([]);
    onRoiEdited();
  };

  const onOverlayPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (roiTool === "none" || !imageSize) {
      return;
    }
    if (roiTool === "polygon") {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }

    if (roiTool === "rectangle") {
      setRectangleDraft({ start: point, end: point });
      event.currentTarget.setPointerCapture(event.pointerId);
      onRoiEdited();
      return;
    }

    if (roiTool === "brush") {
      setBrushDraft({ size: 8, points: [point] });
      event.currentTarget.setPointerCapture(event.pointerId);
      onRoiEdited();
    }
  };

  const onOverlayPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (roiTool === "none" || !imageSize) {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }

    if (roiTool === "rectangle" && rectangleDraft) {
      setRectangleDraft({ ...rectangleDraft, end: point });
      return;
    }

    if (roiTool === "brush" && brushDraft) {
      const last = brushDraft.points[brushDraft.points.length - 1];
      if (!last || distance(last, point) >= 0.8) {
        setBrushDraft({
          ...brushDraft,
          points: [...brushDraft.points, point],
        });
      }
    }
  };

  const onOverlayPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!imageSize) {
      return;
    }

    if (roiTool === "rectangle" && rectangleDraft) {
      const x = Math.min(rectangleDraft.start.x, rectangleDraft.end.x);
      const y = Math.min(rectangleDraft.start.y, rectangleDraft.end.y);
      const width = Math.abs(rectangleDraft.end.x - rectangleDraft.start.x);
      const height = Math.abs(rectangleDraft.end.y - rectangleDraft.start.y);
      if (width >= 1 && height >= 1) {
        onExcludeRoiChange({
          ...excludeRoi,
          rectangles: [
            ...excludeRoi.rectangles,
            {
              id: createLocalId("rect"),
              x,
              y,
              width,
              height,
              order: Math.max(
                1,
                ...excludeRoi.rectangles.map((item) => item.order),
                ...excludeRoi.polygons.map((item) => item.order),
                ...excludeRoi.brush_strokes.map((item) => item.order),
              ) + 1,
            },
          ],
        });
      }
      setRectangleDraft(null);
      return;
    }

    if (roiTool === "brush" && brushDraft) {
      if (brushDraft.points.length > 0) {
        onExcludeRoiChange({
          ...excludeRoi,
          brush_strokes: [
            ...excludeRoi.brush_strokes,
            {
              id: createLocalId("brush"),
              size: brushDraft.size,
              points: brushDraft.points,
              order: Math.max(
                1,
                ...excludeRoi.rectangles.map((item) => item.order),
                ...excludeRoi.polygons.map((item) => item.order),
                ...excludeRoi.brush_strokes.map((item) => item.order),
              ) + 1,
            },
          ],
        });
      }
      setBrushDraft(null);
    }
  };

  const onOverlayClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (roiTool !== "polygon" || !imageSize) {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }
    if (polygonDraft.length >= 3 && distance(point, polygonDraft[0]) <= 7) {
      commitPolygonDraft();
      return;
    }
    setPolygonDraft((current) => [...current, point]);
    onRoiEdited();
  };

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !imageSize) {
      return;
    }

    canvas.width = imageSize.width;
    canvas.height = imageSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, imageSize.width, imageSize.height);

    if (externalMaskImage) {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = imageSize.width;
      tempCanvas.height = imageSize.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        try {
          tempCtx.drawImage(externalMaskImage, 0, 0, imageSize.width, imageSize.height);
          const maskImageData = tempCtx.getImageData(0, 0, imageSize.width, imageSize.height);
          const { data } = maskImageData;
          for (let index = 0; index < data.length; index += 4) {
            const masked = data[index] >= 128 || data[index + 1] >= 128 || data[index + 2] >= 128 || data[index + 3] >= 128;
            data[index] = masked ? 255 : 0;
            data[index + 1] = 0;
            data[index + 2] = 0;
            data[index + 3] = masked ? 70 : 0;
          }
          ctx.putImageData(maskImageData, 0, 0);
        } catch {
          // 보안 정책(CORS)으로 픽셀 접근이 막히면 오버레이를 생략하고 화면 동작을 유지한다.
        }
      }
    }

    drawStep3ExcludeRoiOverlay(ctx, excludeRoi);

    if (rectangleDraft) {
      const x = Math.min(rectangleDraft.start.x, rectangleDraft.end.x);
      const y = Math.min(rectangleDraft.start.y, rectangleDraft.end.y);
      const width = Math.abs(rectangleDraft.end.x - rectangleDraft.start.x);
      const height = Math.abs(rectangleDraft.end.y - rectangleDraft.start.y);
      ctx.fillStyle = "rgba(255,0,0,0.25)";
      ctx.strokeStyle = "rgba(220,38,38,0.95)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
    }

    if (polygonDraft.length > 0) {
      ctx.strokeStyle = "rgba(220,38,38,0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(polygonDraft[0].x, polygonDraft[0].y);
      for (let index = 1; index < polygonDraft.length; index += 1) {
        ctx.lineTo(polygonDraft[index].x, polygonDraft[index].y);
      }
      ctx.stroke();
      for (const point of polygonDraft) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(220,38,38,0.95)";
        ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (brushDraft && brushDraft.points.length > 0) {
      ctx.strokeStyle = "rgba(220,38,38,0.95)";
      ctx.fillStyle = "rgba(220,38,38,0.95)";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, brushDraft.size * 2);
      if (brushDraft.points.length === 1) {
        const point = brushDraft.points[0];
        ctx.beginPath();
        ctx.arc(point.x, point.y, brushDraft.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(brushDraft.points[0].x, brushDraft.points[0].y);
        for (let index = 1; index < brushDraft.points.length; index += 1) {
          ctx.lineTo(brushDraft.points[index].x, brushDraft.points[index].y);
        }
        ctx.stroke();
      }
    }
  }, [brushDraft, excludeRoi, externalMaskImage, imageSize, polygonDraft, rectangleDraft]);

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

          {imageSize && activeImageUrl && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                className="relative shrink-0"
                style={{
                  width: imageSize.width * zoom,
                  height: imageSize.height * zoom,
                }}
              >
                <img
                  src={activeImageUrl}
                  alt={ko.workspace.viewerImageAlt}
                  className="absolute left-0 top-0"
                  style={{
                    width: imageSize.width,
                    height: imageSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                />
                <canvas
                  ref={overlayCanvasRef}
                  className="absolute left-0 top-0"
                  style={{
                    width: imageSize.width,
                    height: imageSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    cursor:
                      roiTool === "rectangle"
                        ? "crosshair"
                        : roiTool === "polygon"
                          ? "copy"
                          : roiTool === "brush"
                            ? "cell"
                            : "default",
                  }}
                  onPointerDown={onOverlayPointerDown}
                  onPointerMove={onOverlayPointerMove}
                  onPointerUp={onOverlayPointerUp}
                  onPointerLeave={onOverlayPointerUp}
                  onClick={onOverlayClick}
                  onDoubleClick={() => {
                    if (roiTool === "polygon") {
                      commitPolygonDraft();
                    }
                  }}
                  onContextMenu={(event) => {
                    if (roiTool === "polygon") {
                      event.preventDefault();
                      commitPolygonDraft();
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
        {isSavedFallback && <p>{ko.workspace.viewerSavedFallback}</p>}
        {isPreviewFallback && <p>{ko.step3.previewFallback}</p>}
        {imageSize && (
          <p>
            {ko.workspace.viewerFooterTemplate
              .replace("{{width}}", String(imageSize.width))
              .replace("{{height}}", String(imageSize.height))
              .replace("{{cropped}}", String(imageSize.height))}
          </p>
        )}
      </div>
    </div>
  );
}
