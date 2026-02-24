"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import { MouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import { ko } from "@/i18n/ko";
import { useAppStore } from "@/store/useAppStore";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface OverlaySources {
  maskOuter?: string;
  maskSolid?: string;
  contours?: string;
  splits?: string;
}

interface ViewerProps {
  imageUrl?: string;
  overlays: OverlaySources;
}

type Polyline = [number, number][];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parsePolylines(input: unknown): Polyline[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const lines: Polyline[] = [];
  input.forEach((line) => {
    if (!Array.isArray(line)) {
      return;
    }
    const points: [number, number][] = [];
    line.forEach((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return;
      }
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push([x, y]);
      }
    });
    if (points.length > 1) {
      lines.push(points);
    }
  });
  return lines;
}

export function ImageViewer({ imageUrl, overlays }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [maskOuterImage, setMaskOuterImage] = useState<HTMLImageElement | null>(null);
  const [maskSolidImage, setMaskSolidImage] = useState<HTMLImageElement | null>(null);
  const [contours, setContours] = useState<Polyline[]>([]);
  const [splits, setSplits] = useState<Polyline[]>([]);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const panRef = useRef({ active: false, x: 0, y: 0 });

  const overlaysState = useAppStore((state) => state.overlays);
  const toggleOverlay = useAppStore((state) => state.toggleOverlay);
  const measurementMode = useAppStore((state) => state.measurementMode);
  const measurementPoints = useAppStore((state) => state.measurementPoints);
  const addMeasurementPoint = useAppStore((state) => state.addMeasurementPoint);

  const hasImage = Boolean(image && imageUrl);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setCanvasSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!imageUrl) {
      setImage(null);
      return;
    }

    const img = new Image();
    img.src = imageUrl;
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
  }, [imageUrl]);

  useEffect(() => {
    if (!overlays.maskOuter) {
      setMaskOuterImage(null);
      return;
    }
    const img = new Image();
    img.src = overlays.maskOuter;
    img.onload = () => setMaskOuterImage(img);
    img.onerror = () => setMaskOuterImage(null);
  }, [overlays.maskOuter]);

  useEffect(() => {
    if (!overlays.maskSolid) {
      setMaskSolidImage(null);
      return;
    }
    const img = new Image();
    img.src = overlays.maskSolid;
    img.onload = () => setMaskSolidImage(img);
    img.onerror = () => setMaskSolidImage(null);
  }, [overlays.maskSolid]);

  useEffect(() => {
    let canceled = false;
    if (!overlays.contours) {
      setContours([]);
      return;
    }

    fetch(overlays.contours)
      .then((res) => res.json())
      .then((data) => {
        if (!canceled) {
          setContours(parsePolylines(data));
        }
      })
      .catch(() => {
        if (!canceled) {
          setContours([]);
        }
      });

    return () => {
      canceled = true;
    };
  }, [overlays.contours]);

  useEffect(() => {
    let canceled = false;
    if (!overlays.splits) {
      setSplits([]);
      return;
    }

    fetch(overlays.splits)
      .then((res) => res.json())
      .then((data) => {
        if (!canceled) {
          setSplits(parsePolylines(data));
        }
      })
      .catch(() => {
        if (!canceled) {
          setSplits([]);
        }
      });

    return () => {
      canceled = true;
    };
  }, [overlays.splits]);

  const fitToView = useMemo(() => {
    return () => {
      if (!image || canvasSize.width <= 0 || canvasSize.height <= 0) {
        return;
      }
      const fitScale = Math.min(canvasSize.width / image.width, canvasSize.height / image.height);
      const safeScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
      setScale(safeScale);
      setOffset({
        x: (canvasSize.width - image.width * safeScale) / 2,
        y: (canvasSize.height - image.height * safeScale) / 2,
      });
    };
  }, [canvasSize.height, canvasSize.width, image]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  useEffect(() => {
    const canvas = baseCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!canvas || !overlayCanvas) {
      return;
    }

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    overlayCanvas.width = canvasSize.width;
    overlayCanvas.height = canvasSize.height;

    const baseCtx = canvas.getContext("2d");
    const overlayCtx = overlayCanvas.getContext("2d");
    if (!baseCtx || !overlayCtx) {
      return;
    }

    baseCtx.clearRect(0, 0, canvas.width, canvas.height);
    baseCtx.fillStyle = "#e5eff3";
    baseCtx.fillRect(0, 0, canvas.width, canvas.height);

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (!image) {
      return;
    }

    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;

    baseCtx.drawImage(image, offset.x, offset.y, drawWidth, drawHeight);

    const drawMask = (maskImage: HTMLImageElement, color: string) => {
      overlayCtx.save();
      overlayCtx.drawImage(maskImage, offset.x, offset.y, drawWidth, drawHeight);
      overlayCtx.globalCompositeOperation = "source-in";
      overlayCtx.fillStyle = color;
      overlayCtx.fillRect(offset.x, offset.y, drawWidth, drawHeight);
      overlayCtx.restore();
    };

    if (overlaysState.maskOuter && maskOuterImage) {
      drawMask(maskOuterImage, "rgba(56, 189, 248, 0.45)");
    }

    if (overlaysState.maskSolid && maskSolidImage) {
      drawMask(maskSolidImage, "rgba(245, 158, 11, 0.35)");
    }

    const drawPolylines = (lineData: Polyline[], strokeStyle: string) => {
      overlayCtx.save();
      overlayCtx.strokeStyle = strokeStyle;
      overlayCtx.lineWidth = 2;
      lineData.forEach((line) => {
        if (line.length < 2) {
          return;
        }
        overlayCtx.beginPath();
        overlayCtx.moveTo(offset.x + line[0][0] * scale, offset.y + line[0][1] * scale);
        for (let i = 1; i < line.length; i += 1) {
          overlayCtx.lineTo(offset.x + line[i][0] * scale, offset.y + line[i][1] * scale);
        }
        overlayCtx.stroke();
      });
      overlayCtx.restore();
    };

    if (overlaysState.contours) {
      drawPolylines(contours, "rgba(22, 163, 74, 0.9)");
    }

    if (overlaysState.splits) {
      drawPolylines(splits, "rgba(220, 38, 38, 0.9)");
    }

    if (measurementPoints.length > 0) {
      overlayCtx.save();
      overlayCtx.fillStyle = "rgba(15, 23, 42, 0.95)";
      overlayCtx.strokeStyle = "rgba(15, 23, 42, 0.95)";
      overlayCtx.lineWidth = 2;

      measurementPoints.forEach((point) => {
        const x = offset.x + point.x * scale;
        const y = offset.y + point.y * scale;
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, 4, 0, Math.PI * 2);
        overlayCtx.fill();
      });

      if (measurementPoints.length === 2) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(
          offset.x + measurementPoints[0].x * scale,
          offset.y + measurementPoints[0].y * scale,
        );
        overlayCtx.lineTo(
          offset.x + measurementPoints[1].x * scale,
          offset.y + measurementPoints[1].y * scale,
        );
        overlayCtx.stroke();
      }
      overlayCtx.restore();
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    contours,
    image,
    maskOuterImage,
    maskSolidImage,
    measurementPoints,
    offset.x,
    offset.y,
    overlaysState.contours,
    overlaysState.maskOuter,
    overlaysState.maskSolid,
    overlaysState.splits,
    scale,
    splits,
  ]);

  useEffect(() => {
    const handleMouseUp = () => {
      panRef.current.active = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const zoomAtCenter = (factor: number) => {
    if (!canvasSize.width || !canvasSize.height) {
      return;
    }
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;
    const imageX = (centerX - offset.x) / scale;
    const imageY = (centerY - offset.y) / scale;

    const newScale = clamp(scale * factor, 0.1, 20);
    setScale(newScale);
    setOffset({
      x: centerX - imageX * newScale,
      y: centerY - imageY * newScale,
    });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!image) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const imageX = (mouseX - offset.x) / scale;
    const imageY = (mouseY - offset.y) / scale;

    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    const newScale = clamp(scale * factor, 0.1, 20);

    setScale(newScale);
    setOffset({
      x: mouseX - imageX * newScale,
      y: mouseY - imageY * newScale,
    });
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (measurementMode) {
      return;
    }
    panRef.current.active = true;
    panRef.current.x = event.clientX;
    panRef.current.y = event.clientY;
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!panRef.current.active || measurementMode) {
      return;
    }
    const dx = event.clientX - panRef.current.x;
    const dy = event.clientY - panRef.current.y;
    panRef.current.x = event.clientX;
    panRef.current.y = event.clientY;

    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!measurementMode || !image) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const imageX = (mouseX - offset.x) / scale;
    const imageY = (mouseY - offset.y) / scale;

    addMeasurementPoint({
      x: clamp(imageX, 0, image.width),
      y: clamp(imageY, 0, image.height),
    });
  };

  return (
    <TooltipProvider>
      <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-muted/50">
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="secondary" onClick={() => zoomAtCenter(1.2)}>
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ko.overlays.zoomIn}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="secondary" onClick={() => zoomAtCenter(0.85)}>
                <Minus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ko.overlays.zoomOut}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="secondary" onClick={fitToView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ko.overlays.resetView}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {ko.overlays.menuLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{ko.overlays.menuLabel}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={overlaysState.maskOuter}
                onCheckedChange={() => toggleOverlay("maskOuter")}
              >
                {ko.overlays.maskOuter}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={overlaysState.maskSolid}
                onCheckedChange={() => toggleOverlay("maskSolid")}
              >
                {ko.overlays.maskSolid}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={overlaysState.contours}
                onCheckedChange={() => toggleOverlay("contours")}
              >
                {ko.overlays.contours}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={overlaysState.splits} onCheckedChange={() => toggleOverlay("splits")}>
                {ko.overlays.splits}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          ref={containerRef}
          className="h-full w-full"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onClick={onClick}
          style={{ cursor: measurementMode ? "crosshair" : panRef.current.active ? "grabbing" : "grab" }}
        >
          <canvas ref={baseCanvasRef} className="absolute inset-0" />
          <canvas ref={overlayCanvasRef} className="absolute inset-0" />

          {!hasImage && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {ko.empty.noSelection}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
