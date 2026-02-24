"use client";

import { WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { useStep1Store } from "@/store/useStep1Store";

export type Step7ViewerMode = "solid" | "outer" | "porosity";

interface Props {
  inputImageUrl?: string;
  solidMaskUrl?: string;
  outerMaskUrl?: string;
  mode: Step7ViewerMode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = url;
  });
}

function getMaskAlpha(data: Uint8ClampedArray, index: number): boolean {
  const offset = index * 4;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  const a = data[offset + 3] ?? 0;
  if (a === 0) {
    return false;
  }
  return r >= 128 || g >= 128 || b >= 128;
}

export function Step7DualMaskViewer({ inputImageUrl, solidMaskUrl, outerMaskUrl, mode }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayError, setOverlayError] = useState(false);
  const [porosityPixelCount, setPorosityPixelCount] = useState<number | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const baseImageUrl = inputImageUrl ?? outerMaskUrl ?? solidMaskUrl;

  const activeMaskSummary = useMemo(() => {
    if (mode === "solid") {
      return { hasMask: Boolean(solidMaskUrl), requiresSolid: true, requiresOuter: false };
    }
    if (mode === "outer") {
      return { hasMask: Boolean(outerMaskUrl), requiresSolid: false, requiresOuter: true };
    }
    return {
      hasMask: Boolean(solidMaskUrl && outerMaskUrl),
      requiresSolid: true,
      requiresOuter: true,
    };
  }, [mode, outerMaskUrl, solidMaskUrl]);

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
    const candidates = [baseImageUrl, outerMaskUrl, solidMaskUrl].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    if (candidates.length === 0) {
      setImageSize(null);
      return;
    }

    let cancelled = false;
    let index = 0;

    const tryLoad = () => {
      if (cancelled || index >= candidates.length) {
        if (!cancelled) {
          setImageSize(null);
        }
        return;
      }

      const image = new Image();
      // 기본 배경 이미지는 캔버스 픽셀 읽기가 필요 없으므로 CORS 실패로 로딩이 막히지 않게 한다.
      image.onload = () => {
        if (cancelled) {
          return;
        }
        setImageSize({ width: image.width, height: image.height });
      };
      image.onerror = () => {
        index += 1;
        tryLoad();
      };
      image.src = candidates[index];
    };

    tryLoad();

    return () => {
      cancelled = true;
    };
  }, [baseImageUrl, outerMaskUrl, solidMaskUrl]);

  useEffect(() => {
    if (!imageSize) {
      return;
    }
    fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSize?.width, imageSize?.height, fitRequestKey]);

  useEffect(() => {
    let cancelled = false;
    const renderOverlay = async () => {
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setOverlayError(false);
      setPorosityPixelCount(null);

      if (!activeMaskSummary.hasMask) {
        return;
      }

      try {
        let solidData: Uint8ClampedArray | null = null;
        let outerData: Uint8ClampedArray | null = null;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = imageSize.width;
        tempCanvas.height = imageSize.height;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) {
          return;
        }

        if (activeMaskSummary.requiresSolid && solidMaskUrl) {
          const solidImage = await loadImage(solidMaskUrl);
          if (cancelled) {
            return;
          }
          tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
          tempCtx.drawImage(solidImage, 0, 0, imageSize.width, imageSize.height);
          solidData = tempCtx.getImageData(0, 0, imageSize.width, imageSize.height).data;
        }

        if (activeMaskSummary.requiresOuter && outerMaskUrl) {
          const outerImage = await loadImage(outerMaskUrl);
          if (cancelled) {
            return;
          }
          tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
          tempCtx.drawImage(outerImage, 0, 0, imageSize.width, imageSize.height);
          outerData = tempCtx.getImageData(0, 0, imageSize.width, imageSize.height).data;
        }

        if (cancelled) {
          return;
        }

        const overlay = ctx.createImageData(imageSize.width, imageSize.height);
        const { data } = overlay;
        let poreCount = 0;

        for (let index = 0; index < imageSize.width * imageSize.height; index += 1) {
          let active = false;
          let color: [number, number, number, number] = [0, 0, 0, 0];

          if (mode === "solid" && solidData) {
            active = getMaskAlpha(solidData, index);
            color = [34, 197, 94, 180];
          } else if (mode === "outer" && outerData) {
            active = getMaskAlpha(outerData, index);
            color = [59, 130, 246, 170];
          } else if (mode === "porosity" && solidData && outerData) {
            const inOuter = getMaskAlpha(outerData, index);
            const inSolid = getMaskAlpha(solidData, index);
            if (inOuter && !inSolid) {
              active = true;
              color = [239, 68, 68, 230];
              poreCount += 1;
            } else if (inSolid) {
              // 공극 위치를 더 잘 구분할 수 있도록 고체 영역도 옅게 함께 표시한다.
              active = true;
              color = [59, 130, 246, 70];
            }
          }

          if (!active) {
            continue;
          }

          const offset = index * 4;
          data[offset] = color[0];
          data[offset + 1] = color[1];
          data[offset + 2] = color[2];
          data[offset + 3] = color[3];
        }

        ctx.putImageData(overlay, 0, 0);
        if (mode === "porosity") {
          setPorosityPixelCount(poreCount);
        }
      } catch {
        if (!cancelled) {
          setOverlayError(true);
          setPorosityPixelCount(null);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    };

    void renderOverlay();

    return () => {
      cancelled = true;
    };
  }, [activeMaskSummary, imageSize, mode, outerMaskUrl, solidMaskUrl]);

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

          {imageSize && baseImageUrl && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                className="relative shrink-0"
                style={{
                  width: imageSize.width * zoom,
                  height: imageSize.height * zoom,
                }}
              >
                <img
                  src={baseImageUrl}
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
                  className="pointer-events-none absolute left-0 top-0"
                  style={{
                    width: imageSize.width,
                    height: imageSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
        {!activeMaskSummary.hasMask && <p>{ko.step7.viewerFallback}</p>}
        {overlayError && <p>{ko.step7.viewerOverlayError}</p>}
        {mode === "porosity" && activeMaskSummary.hasMask && porosityPixelCount === 0 && !overlayError && (
          <p>{ko.step7.viewerNoPorosity}</p>
        )}
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
