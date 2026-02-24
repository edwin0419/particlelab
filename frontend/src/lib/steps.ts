import { StepId } from "@/types/domain";

export const STEP_ORDER: StepId[] = [1, 2, 3, 4, 45, 5, 6, 7, 8];

export const STEP_SET = new Set<number>(STEP_ORDER);
