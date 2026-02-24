import {
  ImageAsset,
  Run,
  RunArtifactsGrouped,
  StepArtifact,
  Step1ExecuteRequest,
  Step1ExecuteResponse,
  StepExecuteResponse,
} from "@/types/domain";

const API_BASES = (() => {
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()?.replace(/\/+$/, "");
  const bases = [
    envBase,
    typeof window !== "undefined" ? "" : undefined,
    "http://localhost:8000",
    "http://127.0.0.1:8000",
  ].filter((base): base is string => typeof base === "string" && base.length > 0 || base === "");

  return Array.from(new Set(bases));
})();
const DEFAULT_TIMEOUT_MS = 7_000;
const UPLOAD_TIMEOUT_MS = 120_000;
let activeApiBase = API_BASES[0];

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface Step3ExecutePayload {
  method: "bilateral" | "nlm";
  strength: number;
  edge_protect: number;
  quality_mode: "빠름" | "정확";
  input_artifact_id?: string | null;
  exclude_mask?: string | null;
  exclude_roi?: Record<string, unknown> | null;
}

export interface Step4ExecutePayload {
  mode: "structure" | "simple";
  seed_sensitivity: number;
  candidate_sensitivity: number;
  structure_scale_um: number;
  min_area_um2: number;
  input_artifact_id?: string | null;
}

export interface Step4PreviewPayload extends Step4ExecutePayload {
  preview_layer: "seed" | "candidate" | "mask" | "mask_binary";
}

export interface Step5ExecutePayload {
  base_mask_artifact_id?: string | null;
  edited_mask_png_base64: string;
  brush_mode?: "삭제" | "복원";
  brush_size_px?: number;
}

export interface Step6ExecutePayload {
  base_mask_artifact_id?: string | null;
  max_expand_um: number;
  recover_sensitivity: number;
  edge_protect: number;
  fill_small_holes: boolean;
}

export interface Step7ExecutePayload {
  base_mask_artifact_id?: string | null;
  hole_mode: "fill_all" | "fill_small" | "keep";
  max_hole_area_um2?: number | null;
  closing_enabled: boolean;
  closing_radius_um?: number | null;
}

export interface Step7PreviewResponse {
  solid_png_base64: string;
  outer_png_base64: string;
  metrics: {
    solid_area_px: number;
    outer_area_px: number;
    porosity: number;
  };
}

export interface Step8ExecutePayload {
  base_mask_artifact_id?: string | null;
  step7_artifact_id?: string | null;
}

export interface Step9Polygon {
  object_id: number;
  points: [number, number][];
  meta?: {
    smooth_level?: number;
    resample_step_px?: number;
    max_vertex_gap_px?: number;
    [key: string]: unknown;
  };
}

export interface Step9PreviewResponse {
  polygon_count: number;
  polygons: Step9Polygon[];
  image_width?: number;
  image_height?: number;
}

export interface Step9ExecutePayload {
  step8_artifact_id?: string | null;
  smooth_level: number;
  resample_step_px: number;
  max_vertex_gap_px: number;
}

export interface Step10SplitLine {
  id?: number | string;
  object_id?: number;
  bbox?: [number, number, number, number];
  polyline: [number, number][];
  length_px?: number;
}

export interface Step10PreviewResponse {
  split_lines: Step10SplitLine[];
  preview_labels_url: string;
  split_line_count: number;
  label_count: number;
  image_width?: number;
  image_height?: number;
  label_areas?: Record<string, number>;
  qc?: Record<string, unknown>;
}

export interface Step10ExecutePayload {
  split_strength: number;
  min_center_distance_px: number;
  min_particle_area: number;
  step9_artifact_id?: string | null;
  step3_artifact_id?: string | null;
}

export interface RunHistoryImportResponse {
  run_id: string;
  imported_count: number;
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const upperMethod = method.toUpperCase();
  const isLongRequest =
    (path === "/api/images" && upperMethod === "POST") || path.includes("/history/import") || path.includes("/history/export");
  const timeoutMs = isLongRequest ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  let lastApiError: ApiError | null = null;
  let lastNetworkError: unknown = null;

  for (const base of API_BASES) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}${path}`, timeoutMs, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      const timeoutError =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: string }).name === "AbortError";
      lastNetworkError = error;
      console.error("네트워크 요청 실패", {
        base,
        path,
        method,
        timeout: timeoutError,
        error,
      });
      continue;
    }

    if (response.ok) {
      activeApiBase = base;
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    let detail = "요청 처리에 실패했습니다.";
    let errorBody: unknown = null;
    try {
      const text = await response.text();
      errorBody = text;
      if (contentType.includes("application/json") && text) {
        try {
          const parsed = JSON.parse(text) as { detail?: string };
          errorBody = parsed;
          if (parsed.detail) {
            detail = parsed.detail;
          }
        } catch {
          detail = "요청 처리에 실패했습니다.";
        }
      } else if (contentType.includes("text/html")) {
        detail = "백엔드 API 경로를 찾지 못했습니다.";
      } else if (text) {
        detail = text;
      }
    } catch {
      // ignore
    }

    const apiError = new ApiError(detail, response.status, errorBody);
    console.error("API 요청 실패", {
      base,
      path,
      method,
      status: response.status,
      contentType,
      body: errorBody,
    });

    const shouldRetryWithNextBase =
      contentType.includes("text/html") && (response.status === 404 || response.status === 405);
    if (shouldRetryWithNextBase) {
      lastApiError = apiError;
      continue;
    }

    throw apiError;
  }

  if (lastApiError) {
    throw lastApiError;
  }

  throw new ApiError(
    "서버에 연결할 수 없습니다. 백엔드 실행 상태와 포트(8000)를 확인해 주세요.",
    0,
    String(lastNetworkError),
  );
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const method = init?.method ?? "GET";
  const upperMethod = method.toUpperCase();
  const timeoutMs = path.includes("/history/export") && upperMethod === "GET" ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  let lastApiError: ApiError | null = null;
  let lastNetworkError: unknown = null;

  for (const base of API_BASES) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}${path}`, timeoutMs, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      lastNetworkError = error;
      console.error("네트워크 요청 실패", { base, path, method, error });
      continue;
    }

    if (response.ok) {
      activeApiBase = base;
      return response.blob();
    }

    const contentType = response.headers.get("content-type") ?? "";
    let detail = "요청 처리에 실패했습니다.";
    let errorBody: unknown = null;
    try {
      const text = await response.text();
      errorBody = text;
      if (contentType.includes("application/json") && text) {
        const parsed = JSON.parse(text) as { detail?: string };
        errorBody = parsed;
        if (parsed.detail) {
          detail = parsed.detail;
        }
      } else if (text) {
        detail = text;
      }
    } catch {
      // ignore
    }

    const apiError = new ApiError(detail, response.status, errorBody);
    console.error("API 요청 실패", {
      base,
      path,
      method,
      status: response.status,
      contentType,
      body: errorBody,
    });
    lastApiError = apiError;
  }

  if (lastApiError) {
    throw lastApiError;
  }

  throw new ApiError(
    "서버에 연결할 수 없습니다. 백엔드 실행 상태와 포트(8000)를 확인해 주세요.",
    0,
    String(lastNetworkError),
  );
}

export const api = {
  listImages: () => request<ImageAsset[]>("/api/images"),
  getImage: (imageId: string) => request<ImageAsset>(`/api/images/${imageId}`),
  uploadImage: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImageAsset>("/api/images", {
      method: "POST",
      body: form,
    });
  },
  deleteImage: (imageId: string) =>
    request<void>(`/api/images/${imageId}`, {
      method: "DELETE",
    }),
  createRun: (imageId: string, name?: string) =>
    request<Run>("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId, name: name || null }),
    }),
  listRuns: (imageId?: string) => request<Run[]>(imageId ? `/api/runs?image_id=${imageId}` : "/api/runs"),
  getRun: (runId: string) => request<Run>(`/api/runs/${runId}`),
  executeStep1: (runId: string, payload: Step1ExecuteRequest) =>
    request<Step1ExecuteResponse>(`/api/runs/${runId}/steps/1/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep: (runId: string, stepId: number, params: Record<string, unknown>) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/${stepId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    }),
  executeStep3: (runId: string, payload: Step3ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/3/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  previewStep3: (runId: string, payload: Step3ExecutePayload) =>
    requestBlob(`/api/runs/${runId}/steps/3/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep4: (runId: string, payload: Step4ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/4/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep5: (runId: string, payload: Step5ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/5/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep6: (runId: string, payload: Step6ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/6/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep7: (runId: string, payload: Step7ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/7/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep8: (runId: string, payload: Step8ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/8/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep9: (runId: string, payload: Step9ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/9/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  previewStep4: (runId: string, payload: Step4PreviewPayload) =>
    requestBlob(`/api/runs/${runId}/steps/4/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  previewStep6: (runId: string, payload: Step6ExecutePayload) =>
    requestBlob(`/api/runs/${runId}/steps/6/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  previewStep7: (runId: string, payload: Step7ExecutePayload) =>
    request<Step7PreviewResponse>(`/api/runs/${runId}/steps/7/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  previewStep9: (runId: string, payload: Step9ExecutePayload) =>
    request<Step9PreviewResponse>(`/api/runs/${runId}/steps/9/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  executeStep10: (runId: string, payload: Step10ExecutePayload) =>
    request<StepExecuteResponse>(`/api/runs/${runId}/steps/10/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  previewStep10: (runId: string, payload: Step10ExecutePayload) =>
    request<Step10PreviewResponse>(`/api/runs/${runId}/steps/10/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  exportRunHistory: (runId: string) => requestBlob(`/api/runs/${runId}/history/export`),
  importRunHistory: (runId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<RunHistoryImportResponse>(`/api/runs/${runId}/history/import`, {
      method: "POST",
      body: form,
    });
  },
  getRunArtifacts: (runId: string) => request<RunArtifactsGrouped>(`/api/runs/${runId}/artifacts`),
  getArtifactFileJson: <T,>(artifactId: string, fileIndex = 0) =>
    request<T>(`/api/artifacts/${artifactId}/file?file_index=${fileIndex}`),
  renameArtifactVersion: (artifactId: string, name: string) =>
    request<StepArtifact>(`/api/artifacts/${artifactId}/name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  deleteArtifactVersion: (artifactId: string) =>
    request<void>(`/api/artifacts/${artifactId}`, {
      method: "DELETE",
    }),
  getImageFileUrl: (imageId: string) => `${activeApiBase}/api/images/${imageId}/original`,
  getArtifactFileUrl: (artifactId: string, fileIndex = 0) =>
    `${activeApiBase}/api/artifacts/${artifactId}/file?file_index=${fileIndex}`,
};
