import { create } from "zustand";

import { StepId } from "@/types/domain";

export interface ViewerPoint {
  x: number;
  y: number;
}

interface OverlayState {
  maskOuter: boolean;
  maskSolid: boolean;
  contours: boolean;
  splits: boolean;
}

interface AppState {
  currentStepId: StepId;
  setCurrentStepId: (stepId: StepId) => void;

  overlays: OverlayState;
  toggleOverlay: (key: keyof OverlayState) => void;

  measurementMode: boolean;
  setMeasurementMode: (enabled: boolean) => void;
  measurementPoints: ViewerPoint[];
  addMeasurementPoint: (point: ViewerPoint) => void;
  clearMeasurementPoints: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentStepId: 1,
  setCurrentStepId: (stepId) => set({ currentStepId: stepId }),

  overlays: {
    maskOuter: true,
    maskSolid: true,
    contours: true,
    splits: true,
  },
  toggleOverlay: (key) =>
    set((state) => ({
      overlays: {
        ...state.overlays,
        [key]: !state.overlays[key],
      },
    })),

  measurementMode: false,
  setMeasurementMode: (enabled) => set({ measurementMode: enabled }),
  measurementPoints: [],
  addMeasurementPoint: (point) =>
    set((state) => {
      if (state.measurementPoints.length >= 2) {
        return { measurementPoints: [point] };
      }
      return { measurementPoints: [...state.measurementPoints, point] };
    }),
  clearMeasurementPoints: () => set({ measurementPoints: [] }),
}));
