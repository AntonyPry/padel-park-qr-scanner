export interface TrainingNoteExerciseResult {
  canAdvance: boolean;
  comment: string;
  exercise?: {
    eLevel?: string | null;
    id?: number | null;
    mainSkill?: {
      direction?: string | null;
      id: number;
      name: string;
    } | null;
    name: string;
    status?: string | null;
  } | null;
  exerciseName: string;
  id?: number;
  orderIndex?: number;
  rating: number;
  repeatExercise: boolean;
  repeatSkill: boolean;
  trainingExerciseId: number;
}

export interface TrainingNoteExerciseFormResult {
  canAdvance: boolean;
  comment: string;
  rating: number;
  repeatExercise: boolean;
  repeatSkill: boolean;
  trainingExerciseId: string;
}

export interface TrainingNoteExercisePayload {
  canAdvance: boolean;
  comment?: string | null;
  rating: number;
  repeatExercise: boolean;
  repeatSkill: boolean;
  trainingExerciseId: number;
}

export function createExerciseFormResult(
  trainingExerciseId: number | string,
): TrainingNoteExerciseFormResult {
  return {
    canAdvance: false,
    comment: '',
    rating: 3,
    repeatExercise: false,
    repeatSkill: false,
    trainingExerciseId: String(trainingExerciseId),
  };
}

export function toExerciseResultForm(
  result: TrainingNoteExerciseResult,
): TrainingNoteExerciseFormResult {
  return {
    canAdvance: Boolean(result.canAdvance),
    comment: result.comment || '',
    rating: result.rating || 3,
    repeatExercise: Boolean(result.repeatExercise),
    repeatSkill: Boolean(result.repeatSkill),
    trainingExerciseId: String(result.trainingExerciseId),
  };
}

export function toExerciseResultPayload(
  results: TrainingNoteExerciseFormResult[],
): TrainingNoteExercisePayload[] {
  return results.map((result) => ({
    canAdvance: result.canAdvance,
    comment: result.comment.trim() || null,
    rating: result.rating,
    repeatExercise: result.repeatExercise,
    repeatSkill: result.repeatSkill,
    trainingExerciseId: Number(result.trainingExerciseId),
  }));
}
