export type Step3RoiTool = "none" | "rectangle" | "polygon" | "brush";

export interface Step3RoiPoint {
  x: number;
  y: number;
}

export interface Step3RoiRectangle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
}

export interface Step3RoiPolygon {
  id: string;
  points: Step3RoiPoint[];
  order: number;
}

export interface Step3RoiBrushStroke {
  id: string;
  size: number;
  points: Step3RoiPoint[];
  order: number;
}

export interface Step3ExcludeRoi {
  rectangles: Step3RoiRectangle[];
  polygons: Step3RoiPolygon[];
  brush_strokes: Step3RoiBrushStroke[];
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function toPoint(value: unknown): Step3RoiPoint | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const x = toNumber(source.x);
  const y = toNumber(source.y);
  if (x == null || y == null) {
    return null;
  }
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
  };
}

function createId(prefix: string, index: number): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}-${index}`;
}

export function createEmptyStep3ExcludeRoi(): Step3ExcludeRoi {
  return {
    rectangles: [],
    polygons: [],
    brush_strokes: [],
  };
}

export function hasStep3ExcludeRoi(roi: Step3ExcludeRoi): boolean {
  return roi.rectangles.length > 0 || roi.polygons.length > 0 || roi.brush_strokes.length > 0;
}

export function getStep3ExcludeRoiNextOrder(roi: Step3ExcludeRoi): number {
  let maxOrder = 0;
  for (const item of roi.rectangles) {
    maxOrder = Math.max(maxOrder, item.order);
  }
  for (const item of roi.polygons) {
    maxOrder = Math.max(maxOrder, item.order);
  }
  for (const item of roi.brush_strokes) {
    maxOrder = Math.max(maxOrder, item.order);
  }
  return maxOrder + 1;
}

export function removeLastStep3ExcludeSelection(roi: Step3ExcludeRoi): Step3ExcludeRoi {
  const lastRectangle = roi.rectangles.reduce<Step3RoiRectangle | null>((acc, item) => {
    if (acc == null || item.order > acc.order) {
      return item;
    }
    return acc;
  }, null);
  const lastPolygon = roi.polygons.reduce<Step3RoiPolygon | null>((acc, item) => {
    if (acc == null || item.order > acc.order) {
      return item;
    }
    return acc;
  }, null);
  const lastBrush = roi.brush_strokes.reduce<Step3RoiBrushStroke | null>((acc, item) => {
    if (acc == null || item.order > acc.order) {
      return item;
    }
    return acc;
  }, null);

  const candidates = [
    { kind: "rectangle", order: lastRectangle?.order ?? -1, id: lastRectangle?.id ?? "" },
    { kind: "polygon", order: lastPolygon?.order ?? -1, id: lastPolygon?.id ?? "" },
    { kind: "brush", order: lastBrush?.order ?? -1, id: lastBrush?.id ?? "" },
  ];
  const target = candidates.reduce((acc, item) => (item.order > acc.order ? item : acc), candidates[0]);
  if (target.order < 0) {
    return roi;
  }

  if (target.kind === "rectangle") {
    return {
      ...roi,
      rectangles: roi.rectangles.filter((item) => item.id !== target.id),
    };
  }
  if (target.kind === "polygon") {
    return {
      ...roi,
      polygons: roi.polygons.filter((item) => item.id !== target.id),
    };
  }
  return {
    ...roi,
    brush_strokes: roi.brush_strokes.filter((item) => item.id !== target.id),
  };
}

export function parseStep3ExcludeRoi(raw: unknown): Step3ExcludeRoi {
  if (!raw || typeof raw !== "object") {
    return createEmptyStep3ExcludeRoi();
  }
  const source = raw as Record<string, unknown>;
  const rectanglesRaw = Array.isArray(source.rectangles) ? source.rectangles : [];
  const polygonsRaw = Array.isArray(source.polygons) ? source.polygons : [];
  const brushRaw = Array.isArray(source.brush_strokes) ? source.brush_strokes : [];

  let orderCounter = 1;

  const rectangles = rectanglesRaw
    .map((item, index): Step3RoiRectangle | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const rectangle = item as Record<string, unknown>;
      const x = toNumber(rectangle.x);
      const y = toNumber(rectangle.y);
      const width = toNumber(rectangle.width ?? rectangle.w);
      const height = toNumber(rectangle.height ?? rectangle.h);
      if (x == null || y == null || width == null || height == null) {
        return null;
      }
      if (width <= 0 || height <= 0) {
        return null;
      }
      const parsedOrder = toNumber(rectangle.order);
      const normalizedOrder = parsedOrder == null ? orderCounter++ : Math.max(1, Math.floor(parsedOrder));
      return {
        id: createId("rect", index),
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(1, width),
        height: Math.max(1, height),
        order: normalizedOrder,
      };
    })
    .filter((item): item is Step3RoiRectangle => item != null);

  const polygons = polygonsRaw
    .map((item, index): Step3RoiPolygon | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const polygon = item as Record<string, unknown>;
      const pointsRaw = Array.isArray(polygon.points) ? polygon.points : [];
      const points = pointsRaw.map(toPoint).filter((point): point is Step3RoiPoint => point != null);
      if (points.length < 3) {
        return null;
      }
      const parsedOrder = toNumber(polygon.order);
      const normalizedOrder = parsedOrder == null ? orderCounter++ : Math.max(1, Math.floor(parsedOrder));
      return {
        id: createId("poly", index),
        points,
        order: normalizedOrder,
      };
    })
    .filter((item): item is Step3RoiPolygon => item != null);

  const brushStrokes = brushRaw
    .map((item, index): Step3RoiBrushStroke | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const stroke = item as Record<string, unknown>;
      const pointsRaw = Array.isArray(stroke.points) ? stroke.points : [];
      const points = pointsRaw.map(toPoint).filter((point): point is Step3RoiPoint => point != null);
      if (points.length === 0) {
        return null;
      }
      const size = toNumber(stroke.size) ?? 8;
      const parsedOrder = toNumber(stroke.order);
      const normalizedOrder = parsedOrder == null ? orderCounter++ : Math.max(1, Math.floor(parsedOrder));
      return {
        id: createId("brush", index),
        size: Math.max(1, size),
        points,
        order: normalizedOrder,
      };
    })
    .filter((item): item is Step3RoiBrushStroke => item != null);

  return {
    rectangles,
    polygons,
    brush_strokes: brushStrokes,
  };
}

export function toStep3ExcludeRoiPayload(roi: Step3ExcludeRoi): Record<string, unknown> | null {
  if (!hasStep3ExcludeRoi(roi)) {
    return null;
  }

  return {
    rectangles: roi.rectangles.map((item) => ({
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: Math.round(item.width),
      height: Math.round(item.height),
      order: item.order,
    })),
    polygons: roi.polygons.map((item) => ({
      points: item.points.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
      })),
      order: item.order,
    })),
    brush_strokes: roi.brush_strokes.map((item) => ({
      size: Math.max(1, Math.round(item.size)),
      points: item.points.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
      })),
      order: item.order,
    })),
  };
}

function drawRoiPath(ctx: CanvasRenderingContext2D, roi: Step3ExcludeRoi, color: string) {
  ctx.fillStyle = color;
  for (const rectangle of roi.rectangles) {
    ctx.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }

  for (const polygon of roi.polygons) {
    if (polygon.points.length < 3) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
    for (let index = 1; index < polygon.points.length; index += 1) {
      const point = polygon.points[index];
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  for (const stroke of roi.brush_strokes) {
    const points = stroke.points;
    if (points.length === 0) {
      continue;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, stroke.size * 2);

    if (points.length === 1) {
      const point = points[0];
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1, stroke.size), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
  }
}

export function drawStep3ExcludeRoiOverlay(ctx: CanvasRenderingContext2D, roi: Step3ExcludeRoi) {
  drawRoiPath(ctx, roi, "rgba(255,0,0,0.30)");
}

function normalizeBinaryImage(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] >= 128 || data[index + 1] >= 128 || data[index + 2] >= 128 || data[index + 3] >= 128 ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("마스크 이미지를 불러오지 못했습니다."));
    image.src = url;
  });
}

export async function buildStep3ExcludeMaskDataUrl(
  roi: Step3ExcludeRoi,
  width: number,
  height: number,
  baseMaskUrl?: string,
): Promise<string | null> {
  if (width <= 0 || height <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  if (baseMaskUrl) {
    try {
      const image = await loadImage(baseMaskUrl);
      ctx.drawImage(image, 0, 0, width, height);
    } catch {
      // 외부 마스크가 없어도 ROI만으로 계속 진행한다.
    }
  }

  drawRoiPath(ctx, roi, "#fff");
  normalizeBinaryImage(ctx, width, height);
  return canvas.toDataURL("image/png");
}

