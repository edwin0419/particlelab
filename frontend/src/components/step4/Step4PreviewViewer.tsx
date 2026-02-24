"use client";

import { WheelEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { Step4ViewerMode, useStep1Store } from "@/store/useStep1Store";

interface Props {
  inputImageUrl?: string;
  overlayImageUrl?: string;
  mode: Step4ViewerMode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Step4PreviewViewer({ inputImageUrl, overlayImageUrl, mode }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

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

  const isBinaryMaskMode = mode === "mask_binary";
  const baseImageUrl = isBinaryMaskMode ? (overlayImageUrl ?? inputImageUrl) : inputImageUrl;

  useEffect(() => {
    if (!baseImageUrl) {
      setImageSize(null);
      return;
    }

    const image = new Image();
    image.src = baseImageUrl;
    image.onload = () => setImageSize({ width: image.width, height: image.height });
    image.onerror = () => setImageSize(null);
  }, [baseImageUrl]);

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

  const showOverlay = mode !== "input" && !isBinaryMaskMode;

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
                  alt={isBinaryMaskMode ? ko.step4.viewerMaskBinary : ko.workspace.viewerImageAlt}
                  className="absolute left-0 top-0"
                  style={{
                    width: imageSize.width,
                    height: imageSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                />
                {showOverlay && overlayImageUrl && (
                  <img
                    src={overlayImageUrl}
                    alt={mode === "seed" ? ko.step4.viewerSeed : mode === "candidate" ? ko.step4.viewerCandidate : ko.step4.viewerMask}
                    className="pointer-events-none absolute left-0 top-0"
                    style={{
                      width: imageSize.width,
                      height: imageSize.height,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                      opacity: 0.82,
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground">
        {mode !== "input" && !overlayImageUrl && <p>{ko.step4.viewerFallback}</p>}
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
