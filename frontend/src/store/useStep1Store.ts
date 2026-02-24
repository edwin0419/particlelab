import { create } from "zustand";
import { StepId } from "@/types/domain";

export interface Step1Point {
  x: number;
  y: number;
}

export type Step2ViewerMode = "input" | "preview" | "saved";
export type Step2ClaheTile = "auto" | "small" | "medium" | "large";
export type Step3ViewerMode = "input" | "preview" | "saved";
export type Step3Method = "bilateral" | "nlm";
export type Step3QualityMode = "빠름" | "정확";
export type Step4ViewerMode = "input" | "seed" | "candidate" | "mask" | "mask_binary";
export type Step4Mode = "structure" | "simple";

export interface Step2Params {
  brightness: number;
  contrast: number;
  gamma: number;
  black_clip_pct: number;
  white_clip_pct: number;
  clahe_enabled: boolean;
  clahe_strength: number;
  clahe_tile: Step2ClaheTile;
}

export interface Step3Params {
  method: Step3Method;
  strength: number;
  edge_protect: number;
  quality_mode: Step3QualityMode;
}

export interface Step4Params {
  mode: Step4Mode;
  seed_sensitivity: number;
  candidate_sensitivity: number;
  structure_scale_um: number;
  min_area_um2: number;
}

const defaultStep2Params: Step2Params = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  black_clip_pct: 0.5,
  white_clip_pct: 99.5,
  clahe_enabled: false,
  clahe_strength: 2,
  clahe_tile: "auto",
};

const defaultStep3Params: Step3Params = {
  method: "bilateral",
  strength: 40,
  edge_protect: 60,
  quality_mode: "빠름",
};

const defaultStep4Params: Step4Params = {
  mode: "structure",
  seed_sensitivity: 50,
  candidate_sensitivity: 50,
  structure_scale_um: 1.2,
  min_area_um2: 0.2,
};

interface Step1State {
  currentStep: StepId;
  cropBottomPx: number;
  pixelDistanceInput: string;
  realUmInput: string;
  measurementMode: boolean;
  measurementPoints: Step1Point[];
  rectangleVisible: boolean;
  autoApplyRectangleWidth: boolean;
  selectedArtifactId: string | null;
  step2Params: Step2Params;
  step2ViewerMode: Step2ViewerMode;
  selectedStep2ArtifactId: string | null;
  step3Params: Step3Params;
  step3ViewerMode: Step3ViewerMode;
  selectedStep3ArtifactId: string | null;
  step4Params: Step4Params;
  step4ViewerMode: Step4ViewerMode;
  selectedStep4ArtifactId: string | null;
  zoom: number;
  fitRequestKey: number;

  setCurrentStep: (step: StepId) => void;
  setCropBottomPx: (value: number) => void;
  setPixelDistanceInput: (value: string) => void;
  setRealUmInput: (value: string) => void;
  setMeasurementMode: (value: boolean) => void;
  setMeasurementPoints: (points: Step1Point[]) => void;
  setMeasurementRect: (start: Step1Point, end: Step1Point) => void;
  setRectangleVisible: (value: boolean) => void;
  setAutoApplyRectangleWidth: (value: boolean) => void;
  clearMeasurement: () => void;
  setSelectedArtifactId: (artifactId: string | null) => void;
  setStep2Params: (patch: Partial<Step2Params>) => void;
  resetStep2Params: () => void;
  setStep2ViewerMode: (mode: Step2ViewerMode) => void;
  setSelectedStep2ArtifactId: (artifactId: string | null) => void;
  setStep3Params: (patch: Partial<Step3Params>) => void;
  resetStep3Params: () => void;
  setStep3ViewerMode: (mode: Step3ViewerMode) => void;
  setSelectedStep3ArtifactId: (artifactId: string | null) => void;
  setStep4Params: (patch: Partial<Step4Params>) => void;
  resetStep4Params: () => void;
  setStep4ViewerMode: (mode: Step4ViewerMode) => void;
  setSelectedStep4ArtifactId: (artifactId: string | null) => void;
  setZoom: (value: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  requestFitToView: () => void;
  reset: () => void;
  applySavedState: (payload: {
    artifactId: string;
    cropBottomPx: number;
    pixelDistance: number | null;
    realUm: number | null;
    measurementPoints: Step1Point[];
  }) => void;
}

export const useStep1Store = create<Step1State>((set) => ({
  currentStep: 1,
  cropBottomPx: 0,
  pixelDistanceInput: "",
  realUmInput: "",
  measurementMode: false,
  measurementPoints: [],
  rectangleVisible: true,
  autoApplyRectangleWidth: true,
  selectedArtifactId: null,
  step2Params: { ...defaultStep2Params },
  step2ViewerMode: "input",
  selectedStep2ArtifactId: null,
  step3Params: { ...defaultStep3Params },
  step3ViewerMode: "input",
  selectedStep3ArtifactId: null,
  step4Params: { ...defaultStep4Params },
  step4ViewerMode: "input",
  selectedStep4ArtifactId: null,
  zoom: 1,
  fitRequestKey: 0,

  setCurrentStep: (step) => set({ currentStep: step }),
  setCropBottomPx: (value) => set({ cropBottomPx: Math.max(0, Math.floor(value)) }),
  setPixelDistanceInput: (value) => set({ pixelDistanceInput: value }),
  setRealUmInput: (value) => set({ realUmInput: value }),
  setMeasurementMode: (value) => set({ measurementMode: value }),
  setMeasurementPoints: (points) => set({ measurementPoints: points.slice(0, 2) }),
  setMeasurementRect: (start, end) =>
    set({
      measurementPoints: [start, end],
    }),
  setRectangleVisible: (value) => set({ rectangleVisible: value }),
  setAutoApplyRectangleWidth: (value) => set({ autoApplyRectangleWidth: value }),
  clearMeasurement: () => set({ measurementPoints: [], pixelDistanceInput: "", rectangleVisible: true, autoApplyRectangleWidth: true }),
  setSelectedArtifactId: (artifactId) => set({ selectedArtifactId: artifactId }),
  setStep2Params: (patch) =>
    set((state) => ({
      step2Params: {
        ...state.step2Params,
        ...patch,
      },
    })),
  resetStep2Params: () => set({ step2Params: { ...defaultStep2Params } }),
  setStep2ViewerMode: (mode) => set({ step2ViewerMode: mode }),
  setSelectedStep2ArtifactId: (artifactId) => set({ selectedStep2ArtifactId: artifactId }),
  setStep3Params: (patch) =>
    set((state) => ({
      step3Params: {
        ...state.step3Params,
        ...patch,
      },
    })),
  resetStep3Params: () => set({ step3Params: { ...defaultStep3Params } }),
  setStep3ViewerMode: (mode) => set({ step3ViewerMode: mode }),
  setSelectedStep3ArtifactId: (artifactId) => set({ selectedStep3ArtifactId: artifactId }),
  setStep4Params: (patch) =>
    set((state) => ({
      step4Params: {
        ...state.step4Params,
        ...patch,
      },
    })),
  resetStep4Params: () => set({ step4Params: { ...defaultStep4Params } }),
  setStep4ViewerMode: (mode) => set({ step4ViewerMode: mode }),
  setSelectedStep4ArtifactId: (artifactId) => set({ selectedStep4ArtifactId: artifactId }),
  setZoom: (value) =>
    set({
      zoom: Math.max(0.1, Math.min(8, value)),
    }),
  zoomIn: () =>
    set((state) => ({
      zoom: Math.max(0.1, Math.min(8, state.zoom * 1.2)),
    })),
  zoomOut: () =>
    set((state) => ({
      zoom: Math.max(0.1, Math.min(8, state.zoom / 1.2)),
    })),
  resetZoom: () => set({ zoom: 1 }),
  requestFitToView: () => set((state) => ({ fitRequestKey: state.fitRequestKey + 1 })),
  reset: () =>
    set({
      currentStep: 1,
      cropBottomPx: 0,
      pixelDistanceInput: "",
      realUmInput: "",
      measurementMode: false,
      measurementPoints: [],
      rectangleVisible: true,
      autoApplyRectangleWidth: true,
      selectedArtifactId: null,
      step2Params: { ...defaultStep2Params },
      step2ViewerMode: "input",
      selectedStep2ArtifactId: null,
      step3Params: { ...defaultStep3Params },
      step3ViewerMode: "input",
      selectedStep3ArtifactId: null,
      step4Params: { ...defaultStep4Params },
      step4ViewerMode: "input",
      selectedStep4ArtifactId: null,
      zoom: 1,
      fitRequestKey: 0,
    }),
  applySavedState: (payload) =>
    set({
      selectedArtifactId: payload.artifactId,
      cropBottomPx: Math.max(0, Math.floor(payload.cropBottomPx)),
      pixelDistanceInput: payload.pixelDistance == null ? "" : String(payload.pixelDistance),
      realUmInput: payload.realUm == null ? "" : String(payload.realUm),
      measurementPoints: payload.measurementPoints.slice(0, 2),
      measurementMode: false,
      rectangleVisible: true,
    }),
}));
