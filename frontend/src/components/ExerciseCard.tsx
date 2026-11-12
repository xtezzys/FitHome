import type { Exercise } from '../types/exercise';
import { DIFFICULTY_LABELS, METRIC_LABELS, MUSCLE_LABELS, PLACE_LABELS, label } from '../lib/labels';
import './ExerciseCard.css';

/**
 * Карточка упражнения каталога (docs/design.md §3.2): название, место,
 * метрика, сложность, группы мышц. Клик — подробная информация.
 */

interface ExerciseCardProps {
  exercise: Exercise;
  onOpen?: (exercise: Exercise) => void;
}

export function ExerciseCard({ exercise, onOpen }: ExerciseCardProps) {
  const clickable = onOpen !== undefined;
  return (
    <button
      type="button"
      className={`exercise-card${clickable ? ' exercise-card--clickable' : ''}`}
      onClick={clickable ? () => onOpen(exercise) : undefined}
      aria-label={clickable ? `Подробнее об упражнении ${exercise.name}` : undefined}
    >
      <div className="exercise-card__top">
        <span className="exercise-card__name">{exercise.name}</span>
        <span className="exercise-card__place">{label(PLACE_LABELS, exercise.place)}</span>
      </div>
      <div className="exercise-card__tags">
        <span className="badge badge--metric">{label(METRIC_LABELS, exercise.metric)}</span>
        <span className={`badge badge--difficulty-${exercise.difficulty}`}>
          {label(DIFFICULTY_LABELS, exercise.difficulty)}
        </span>
        {exercise.equipment.length > 0 && (
          <span className="badge">
            {exercise.equipment.length > 1
              ? `${exercise.equipment.length} ед. инвентаря`
              : exercise.equipment[0]}
          </span>
        )}
      </div>
      <div className="exercise-card__muscles">
        {exercise.muscleGroups.map((token) => (
          <span key={token} className="exercise-card__muscle">
            {label(MUSCLE_LABELS, token)}
          </span>
        ))}
      </div>
    </button>
  );
}
