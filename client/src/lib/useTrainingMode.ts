import { useContext } from 'react';
import { TrainingModeContext } from '@/lib/training-mode-context';

export function useTrainingMode() {
  const value = useContext(TrainingModeContext);

  if (!value) {
    throw new Error('useTrainingMode must be used inside TrainingModeProvider');
  }

  return value;
}
