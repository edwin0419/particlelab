"use client";

import {
  PointerEvent,
  WheelEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { useStep1Store } from "@/store/useStep1Store";

export type Step5BrushMode = "erase" | "restore";
export type Step5ViewerMode = "overlay" | "binary";

export interface Step5ViewerState {
  canUndo: boolean;
  canRedo: boolean;
  hasMask: boolean;
}

export interface Step5MaskEditorViewerHandle {
  exportMaskPngDataUrl: () => string | null;
  undo: () => void;
  redo: () => void;
  resetToBaseMask: () => void;
}

interface Props {
  baseImageUrl?: string;
  baseMaskUrl?: string;
  sourceMaskUrl?: string;
  brushMode: Step5BrushMode;
  viewerMode: Step5ViewerMode;
  brushSizePx: number;
  editable: boolean;
  onStateChange?: (state: Step5ViewerState) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createEmptyMask(size: number): Uint8Array {
  return new Uint8Array(new ArrayBuffer(size));
}

async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("이미지 요청 실패");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지 로드 실패"));
    };
    image.src = objectUrl;
  });
}

async function loadBinaryMask(url: string, width: number, height: number): Promise<Uint8Array> {
  const image = await loadImageFromUrl(url);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return createEmptyMask(width * height);
  }
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height).data;
  const mask = createEmptyMask(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const pixelIndex = index * 4;
    const value = imageData[pixelIndex] > 0 || imageData[pixelIndex + 1] > 0 || imageData[pixelIndex + 2] > 0 ? 255 : 0;
    mask[index] = value;
  }
  return mask;
}

function updateOverlayPixel(
  overlayData: Uint8ClampedArray,
  index: number,
  value: number,
  viewerMode: Step5ViewerMode,
) {
  const base = index * 4;
  if (viewerMode === "binary") {
    const pixel = value > 0 ? 255 : 0;
    overlayData[base] = pixel;
    overlayData[base + 1] = pixel;
    overlayData[base + 2] = pixel;
    overlayData[base + 3] = 255;
    return;
  }
  if (value > 0) {
    overlayData[base] = 255;
    overlayData[base + 1] = 0;
    overlayData[base + 2] = 0;
    overlayData[base + 3] = 96;
    return;
  }
  overlayData[base] = 0;
  overlayData[base + 1] = 0;
  overlayData[base + 2] = 0;
  overlayData[base + 3] = 0;
}

export const Step5MaskEditorViewer = forwardRef<Step5MaskEditorViewerHandle, Props>(function Step5MaskEditorViewer(
  { baseImageUrl, baseMaskUrl, sourceMaskUrl, brushMode, viewerMode, brushSizePx, editable, onStateChange },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const maskDataRef = useRef<Uint8Array | null>(null);
  const baseMaskRef = useRef<Uint8Array | null>(null);
  const overlayImageDataRef = useRef<ImageData | null>(null);
  const undoStackRef = useRef<Uint8Array[]>([]);
  const redoStackRef = useRef<Uint8Array[]>([]);
  const drawingRef = useRef(false);
  const drawingPointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const activeBaseImageUrl = baseImageUrl ?? sourceMaskUrl ?? baseMaskUrl;

  const emitState = (nextHasMask = hasMask) => {
    onStateChange?.({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
      hasMask: nextHasMask,
    });
  };

  const syncOverlayFromMask = (mask: Uint8Array, width: number, height: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const imageData = context.createImageData(width, height);
    const { data } = imageData;
    for (let index = 0; index < mask.length; index += 1) {
      updateOverlayPixel(data, index, mask[index] ?? 0, viewerMode);
    }
    overlayImageDataRef.current = imageData;
    context.putImageData(imageData, 0, 0);
  };

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

  const pushUndoSnapshot = () => {
    const currentMask = maskDataRef.current;
    if (!currentMask) {
      return;
    }
    undoStackRef.current.push(currentMask.slice());
    if (undoStackRef.current.length > 30) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  };

  const applyBrushAtPoint = (
    centerX: number,
    centerY: number,
    radius: number,
    value: number,
  ): { changed: boolean; minX: number; minY: number; maxX: number; maxY: number } => {
    const currentMask = maskDataRef.current;
    const overlayImageData = overlayImageDataRef.current;
    const size = imageSize;
    if (!currentMask || !overlayImageData || !size) {
      return { changed: false, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    const width = size.width;
    const height = size.height;
    const x0 = Math.max(0, Math.floor(centerX - radius));
    const x1 = Math.min(width - 1, Math.ceil(centerX + radius));
    const y0 = Math.max(0, Math.floor(centerY - radius));
    const y1 = Math.min(height - 1, Math.ceil(centerY + radius));
    const radiusSq = radius * radius;

    let changed = false;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if ((dx * dx) + (dy * dy) > radiusSq) {
          continue;
        }
        const index = (y * width) + x;
        if ((currentMask[index] ?? 0) === value) {
          continue;
        }
        changed = true;
        currentMask[index] = value;
        updateOverlayPixel(overlayImageData.data, index, value, viewerMode);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (!changed) {
      return { changed: false, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    return { changed: true, minX, minY, maxX, maxY };
  };

  const applyBrushStroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const size = imageSize;
    if (!size) {
      return;
    }
    const brushDiameter = clamp(brushSizePx, 1, 60);
    const radius = Math.max(0.5, brushDiameter / 2);
    const value = brushMode === "restore" ? 255 : 0;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const stepSize = Math.max(1, radius * 0.5);
    const steps = Math.max(1, Math.ceil(distance / stepSize));

    let anyChanged = false;
    let dirtyMinX = size.width;
    let dirtyMinY = size.height;
    let dirtyMaxX = 0;
    let dirtyMaxY = 0;

    for (let step = 0; step <= steps; step += 1) {
      const t = steps === 0 ? 1 : step / steps;
      const x = from.x + ((to.x - from.x) * t);
      const y = from.y + ((to.y - from.y) * t);
      const result = applyBrushAtPoint(x, y, radius, value);
      if (!result.changed) {
        continue;
      }
      anyChanged = true;
      dirtyMinX = Math.min(dirtyMinX, result.minX);
      dirtyMinY = Math.min(dirtyMinY, result.minY);
      dirtyMaxX = Math.max(dirtyMaxX, result.maxX);
      dirtyMaxY = Math.max(dirtyMaxY, result.maxY);
    }

    if (!anyChanged) {
      return;
    }

    const canvas = overlayCanvasRef.current;
    const overlayImageData = overlayImageDataRef.current;
    if (!canvas || !overlayImageData) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.putImageData(
      overlayImageData,
      0,
      0,
      dirtyMinX,
      dirtyMinY,
      (dirtyMaxX - dirtyMinX) + 1,
      (dirtyMaxY - dirtyMinY) + 1,
    );
    emitState();
  };

  const toImagePoint = (event: { clientX: number; clientY: number }) => {
    const canvas = overlayCanvasRef.current;
    const size = imageSize;
    if (!canvas || !size) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: clamp((event.clientX - rect.left) / zoom, 0, size.width - 1),
      y: clamp((event.clientY - rect.top) / zoom, 0, size.height - 1),
    };
  };

  const undo = () => {
    const currentMask = maskDataRef.current;
    const size = imageSize;
    if (!currentMask || !size || undoStackRef.current.length === 0) {
      return;
    }
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    redoStackRef.current.push(currentMask.slice());
    maskDataRef.current = snapshot;
    syncOverlayFromMask(snapshot, size.width, size.height);
    emitState();
  };

  const redo = () => {
    const currentMask = maskDataRef.current;
    const size = imageSize;
    if (!currentMask || !size || redoStackRef.current.length === 0) {
      return;
    }
    const snapshot = redoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    undoStackRef.current.push(currentMask.slice());
    maskDataRef.current = snapshot;
    syncOverlayFromMask(snapshot, size.width, size.height);
    emitState();
  };

  const resetToBaseMask = () => {
    const baseMask = baseMaskRef.current;
    const size = imageSize;
    if (!baseMask || !size) {
      return;
    }
    pushUndoSnapshot();
    maskDataRef.current = baseMask.slice();
    syncOverlayFromMask(maskDataRef.current, size.width, size.height);
    emitState();
  };

  useImperativeHandle(ref, () => ({
    exportMaskPngDataUrl: () => {
      const size = imageSize;
      const mask = maskDataRef.current;
      if (!size || !mask) {
        return null;
      }
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = size.width;
      exportCanvas.height = size.height;
      const context = exportCanvas.getContext("2d");
      if (!context) {
        return null;
      }
      const imageData = context.createImageData(size.width, size.height);
      for (let index = 0; index < mask.length; index += 1) {
        const value = mask[index] > 0 ? 255 : 0;
        const pixel = index * 4;
        imageData.data[pixel] = value;
        imageData.data[pixel + 1] = value;
        imageData.data[pixel + 2] = value;
        imageData.data[pixel + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
      return exportCanvas.toDataURL("image/png");
    },
    undo,
    redo,
    resetToBaseMask,
  }));

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    drawingRef.current = false;
    drawingPointerIdRef.current = null;
    lastPointRef.current = null;
    setLoadError(false);
    setHasMask(false);
    maskDataRef.current = null;
    baseMaskRef.current = null;
    overlayImageDataRef.current = null;

    if (!activeBaseImageUrl) {
      setImageSize(null);
      emitState(false);
      return;
    }

    let cancelled = false;

    const loadAll = async () => {
      try {
        const baseImage = await loadImageFromUrl(activeBaseImageUrl);
        if (cancelled) {
          return;
        }
        const nextSize = {
          width: Math.max(1, baseImage.width),
          height: Math.max(1, baseImage.height),
        };
        setImageSize(nextSize);

        let loadedBaseMask = createEmptyMask(nextSize.width * nextSize.height);
        if (baseMaskUrl) {
          loadedBaseMask = new Uint8Array(await loadBinaryMask(baseMaskUrl, nextSize.width, nextSize.height));
        }
        if (cancelled) {
          return;
        }

        let loadedSourceMask = new Uint8Array(loadedBaseMask);
        if (sourceMaskUrl) {
          loadedSourceMask = new Uint8Array(await loadBinaryMask(sourceMaskUrl, nextSize.width, nextSize.height));
        }
        if (cancelled) {
          return;
        }

        baseMaskRef.current = loadedBaseMask;
        maskDataRef.current = loadedSourceMask;
        const nextHasMask = Boolean(baseMaskUrl || sourceMaskUrl);
        setHasMask(nextHasMask);
        syncOverlayFromMask(loadedSourceMask, nextSize.width, nextSize.height);
        emitState(nextHasMask);
      } catch {
        if (cancelled) {
          return;
        }
        setImageSize(null);
        setLoadError(true);
        setHasMask(false);
        emitState(false);
      }
    };

    loadAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBaseImageUrl, baseMaskUrl, sourceMaskUrl]);

  useEffect(() => {
    if (!imageSize || !maskDataRef.current) {
      return;
    }
    syncOverlayFromMask(maskDataRef.current, imageSize.width, imageSize.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerMode, imageSize?.width, imageSize?.height]);

  useEffect(() => {
    if (!imageSize) {
      return;
    }
    fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequestKey, imageSize?.width, imageSize?.height]);

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

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!editable || !hasMask) {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }
    setCursorPoint(point);
    pushUndoSnapshot();
    drawingRef.current = true;
    drawingPointerIdRef.current = event.pointerId;
    lastPointRef.current = point;
    applyBrushStroke(point, point);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const nextPoint = toImagePoint(event);
    if (editable && hasMask && nextPoint) {
      setCursorPoint(nextPoint);
    } else {
      setCursorPoint(null);
    }

    if (!drawingRef.current || drawingPointerIdRef.current !== event.pointerId) {
      return;
    }
    const lastPoint = lastPointRef.current;
    if (!nextPoint || !lastPoint) {
      return;
    }
    applyBrushStroke(lastPoint, nextPoint);
    lastPointRef.current = nextPoint;
  };

  const endPointerDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointerIdRef.current !== event.pointerId) {
      return;
    }
    drawingRef.current = false;
    drawingPointerIdRef.current = null;
    lastPointRef.current = null;
  };

  const hideCursorGuide = () => {
    setCursorPoint(null);
  };

  const guideDiameterPx = clamp(brushSizePx, 1, 60) * zoom;
  const guideStyle =
    cursorPoint && imageSize && editable && hasMask
      ? {
          width: guideDiameterPx,
          height: guideDiameterPx,
          left: (cursorPoint.x * zoom) - (guideDiameterPx / 2),
          top: (cursorPoint.y * zoom) - (guideDiameterPx / 2),
          borderRadius: "9999px",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: brushMode === "restore" ? "rgba(34, 197, 94, 0.95)" : "rgba(239, 68, 68, 0.95)",
          backgroundColor: brushMode === "restore" ? "rgba(34, 197, 94, 0.20)" : "rgba(239, 68, 68, 0.20)",
        }
      : null;

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
          {(!imageSize || !activeBaseImageUrl) && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {loadError ? ko.step5.viewerNoImage : ko.workspace.viewerNoImage}
            </div>
          )}

          {imageSize && activeBaseImageUrl && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                className="relative shrink-0"
                style={{
                  width: imageSize.width * zoom,
                  height: imageSize.height * zoom,
                }}
              >
                <img
                  src={activeBaseImageUrl}
                  alt={ko.workspace.viewerImageAlt}
                  className="absolute left-0 top-0"
                  style={{
                    width: imageSize.width,
                    height: imageSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    imageRendering: "auto",
                    visibility: viewerMode === "binary" ? "hidden" : "visible",
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
                    cursor: editable && hasMask ? "none" : "default",
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endPointerDrawing}
                  onPointerLeave={(event) => {
                    endPointerDrawing(event);
                    hideCursorGuide();
                  }}
                  onPointerCancel={(event) => {
                    endPointerDrawing(event);
                    hideCursorGuide();
                  }}
                />
                {guideStyle && (
                  <div
                    className="pointer-events-none absolute"
                    style={guideStyle}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
        <p>{ko.step5.overlayHint}</p>
        {!hasMask && <p>{ko.step5.viewerMaskFallback}</p>}
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
});
