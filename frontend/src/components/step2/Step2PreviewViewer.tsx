"use client";

import { WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ko } from "@/i18n/ko";
import { Step2Params, Step2ViewerMode, useStep1Store } from "@/store/useStep1Store";

interface Props {
  inputImageUrl?: string;
  savedImageUrl?: string;
  mode: Step2ViewerMode;
  params: Step2Params;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentileFromHistogram(histogram: number[], targetCount: number): number {
  let accumulated = 0;
  for (let value = 0; value < 256; value += 1) {
    accumulated += histogram[value] ?? 0;
    if (accumulated >= targetCount) {
      return value;
    }
  }
  return 255;
}

function resolveClaheTileSize(width: number, height: number, tile: Step2Params["clahe_tile"]): number {
  const shortEdge = Math.max(16, Math.min(width, height));
  if (tile === "small") {
    return Math.max(16, Math.floor(shortEdge / 16));
  }
  if (tile === "medium") {
    return Math.max(24, Math.floor(shortEdge / 10));
  }
  if (tile === "large") {
    return Math.max(32, Math.floor(shortEdge / 6));
  }
  return Math.max(24, Math.floor(shortEdge / 12));
}

function applyRealtimeClahe(
  source: Uint8Array,
  width: number,
  height: number,
  strength: number,
  tile: Step2Params["clahe_tile"],
): Uint8Array {
  const alpha = clamp(strength / 10, 0, 1);
  if (alpha <= 0) {
    return source;
  }

  const output = new Uint8Array(source);
  const tileSize = resolveClaheTileSize(width, height, tile);

  for (let top = 0; top < height; top += tileSize) {
    for (let left = 0; left < width; left += tileSize) {
      const tileWidth = Math.min(tileSize, width - left);
      const tileHeight = Math.min(tileSize, height - top);
      const tileArea = tileWidth * tileHeight;

      const histogram = new Uint32Array(256);
      for (let y = 0; y < tileHeight; y += 1) {
        const rowOffset = (top + y) * width;
        for (let x = 0; x < tileWidth; x += 1) {
          histogram[source[rowOffset + left + x] ?? 0] += 1;
        }
      }

      const clipLimit = Math.max(1, Math.round((tileArea / 256) * (1 + (strength / 10) * 3)));
      let excess = 0;
      for (let i = 0; i < 256; i += 1) {
        const count = histogram[i] ?? 0;
        if (count > clipLimit) {
          excess += count - clipLimit;
          histogram[i] = clipLimit;
        }
      }

      const redistribute = Math.floor(excess / 256);
      const remainder = excess % 256;
      if (redistribute > 0) {
        for (let i = 0; i < 256; i += 1) {
          histogram[i] += redistribute;
        }
      }
      for (let i = 0; i < remainder; i += 1) {
        histogram[i] += 1;
      }

      const lut = new Uint8Array(256);
      let cdf = 0;
      let cdfMin = -1;
      for (let i = 0; i < 256; i += 1) {
        cdf += histogram[i] ?? 0;
        if (cdfMin < 0 && cdf > 0) {
          cdfMin = cdf;
        }

        if (cdfMin < 0 || tileArea <= cdfMin) {
          lut[i] = i;
          continue;
        }

        const normalized = ((cdf - cdfMin) / (tileArea - cdfMin)) * 255;
        lut[i] = Math.round(clamp(normalized, 0, 255));
      }

      for (let y = 0; y < tileHeight; y += 1) {
        const rowOffset = (top + y) * width;
        for (let x = 0; x < tileWidth; x += 1) {
          const idx = rowOffset + left + x;
          const base = source[idx] ?? 0;
          const eq = lut[base] ?? base;
          output[idx] = Math.round((1 - alpha) * base + alpha * eq);
        }
      }
    }
  }

  return output;
}

function applyStep2Preview(imageData: ImageData, params: Step2Params): ImageData {
  const pixels = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const pixelCount = pixels.length / 4;
  const grayscale = new Uint8Array(pixelCount);
  const histogram = new Array<number>(256).fill(0);

  for (let index = 0; index < pixelCount; index += 1) {
    const pixelIndex = index * 4;
    const r = pixels[pixelIndex] ?? 0;
    const g = pixels[pixelIndex + 1] ?? 0;
    const b = pixels[pixelIndex + 2] ?? 0;
    const gray = Math.round((r * 299 + g * 587 + b * 114) / 1000);
    grayscale[index] = gray;
    histogram[gray] += 1;
  }

  const blackClipPct = clamp(params.black_clip_pct, 0, 5);
  const whiteClipPct = clamp(params.white_clip_pct, 95, 100);
  const blackTarget = Math.floor((pixelCount * blackClipPct) / 100);
  const whiteTarget = Math.floor((pixelCount * whiteClipPct) / 100);

  const blackPoint = percentileFromHistogram(histogram, blackTarget);
  let whitePoint = percentileFromHistogram(histogram, whiteTarget);
  if (whitePoint <= blackPoint) {
    whitePoint = Math.min(255, blackPoint + 1);
  }

  const stretchDenominator = Math.max(1, whitePoint - blackPoint);
  const brightnessShift = clamp(params.brightness, -100, 100) * 2.55;
  const contrastFactor = Math.max(0, 1 + clamp(params.contrast, -100, 100) / 100);
  const gamma = clamp(params.gamma, 0.2, 5);
  const gammaInv = 1 / gamma;

  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    const stretched = ((value - blackPoint) * 255) / stretchDenominator;
    const contrasted = ((stretched - 128) * contrastFactor) + 128 + brightnessShift;
    const clipped = clamp(contrasted, 0, 255);
    const gammaCorrected = 255 * ((clipped / 255) ** gammaInv);
    lut[value] = Math.round(clamp(gammaCorrected, 0, 255));
  }

  const processed = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    processed[index] = lut[grayscale[index]] ?? 0;
  }

  const claheApplied =
    params.clahe_enabled && params.clahe_strength > 0
      ? applyRealtimeClahe(processed, width, height, params.clahe_strength, params.clahe_tile)
      : processed;

  for (let index = 0; index < pixelCount; index += 1) {
    const pixelIndex = index * 4;
    const value = claheApplied[index] ?? 0;
    pixels[pixelIndex] = value;
    pixels[pixelIndex + 1] = value;
    pixels[pixelIndex + 2] = value;
  }

  return imageData;
}

export function Step2PreviewViewer({ inputImageUrl, savedImageUrl, mode, params }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  const zoom = useStep1Store((state) => state.zoom);
  const fitRequestKey = useStep1Store((state) => state.fitRequestKey);
  const zoomIn = useStep1Store((state) => state.zoomIn);
  const zoomOut = useStep1Store((state) => state.zoomOut);
  const setZoom = useStep1Store((state) => state.setZoom);
  const resetZoom = useStep1Store((state) => state.resetZoom);

  const activeImageUrl = useMemo(() => {
    if (mode === "saved") {
      return savedImageUrl ?? inputImageUrl;
    }
    return inputImageUrl;
  }, [inputImageUrl, mode, savedImageUrl]);

  const isSavedFallback = mode === "saved" && !savedImageUrl && Boolean(inputImageUrl);

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
      setSourceImage(null);
      setImageSize(null);
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = activeImageUrl;
    image.onload = () => {
      setSourceImage(image);
      setImageSize({ width: image.width, height: image.height });
    };
    image.onerror = () => {
      setSourceImage(null);
      setImageSize(null);
    };
  }, [activeImageUrl]);

  useEffect(() => {
    if (!imageSize) {
      return;
    }
    fitToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSize?.width, imageSize?.height, fitRequestKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage || !imageSize) {
      return;
    }

    canvas.width = imageSize.width;
    canvas.height = imageSize.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return;
    }

    context.drawImage(sourceImage, 0, 0, imageSize.width, imageSize.height);

    if (mode === "preview") {
      const imageData = context.getImageData(0, 0, imageSize.width, imageSize.height);
      const processed = applyStep2Preview(imageData, params);
      context.putImageData(processed, 0, 0);
    }
  }, [imageSize, mode, params, sourceImage]);

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

          {imageSize && (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <div
                className="relative shrink-0"
                style={{
                  width: imageSize.width * zoom,
                  height: imageSize.height * zoom,
                }}
              >
                <canvas
                  ref={canvasRef}
                  className="absolute left-0 top-0"
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
        {isSavedFallback && <p>{ko.workspace.viewerSavedFallback}</p>}
        {mode === "preview" && params.clahe_enabled && <p>{ko.step2.clahePreviewNotice}</p>}
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
